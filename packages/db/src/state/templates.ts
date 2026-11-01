// Notice-template state functions (02 notice_templates, 03 §5, PHASE_03 T3.5, DECISIONS #111) — Super Admin only, each
// in one transaction with its audit entry. A template is created as `draft`; it becomes `active` (pickable by admins,
// rendered by the app) only with all four translations reviewed; retired templates still render old notices.
import type { DbHandle } from '../client.ts';
import { withTransaction } from '../client.ts';
import { StateError, writeAudit } from '../effects.ts';
import type { ANNOUNCEMENT_CATEGORY, TEMPLATE_PARAM_TYPE } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { requireSuper } from './guards.ts';

type Four = { readonly en: string; readonly hi: string; readonly ur: string; readonly te: string };
export interface TemplateParamInput {
  readonly name: string;
  readonly type: (typeof TEMPLATE_PARAM_TYPE)[number];
  readonly required: boolean;
}

/** The editable content of a template (validated by the caller: shape, ICU, params used). */
export interface TemplateInput {
  readonly category: (typeof ANNOUNCEMENT_CATEGORY)[number];
  readonly icon: string;
  readonly isImportantDefault: boolean;
  readonly title: Four;
  readonly body: Four;
  readonly params: readonly TemplateParamInput[];
  readonly translationReviewed: boolean;
}

const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;

const docOf = (input: TemplateInput) => ({
  category: input.category,
  icon: input.icon,
  is_important_default: input.isImportantDefault,
  title: { ...input.title },
  body: { ...input.body },
  params: input.params.map((param) => ({ ...param })),
  translation_reviewed: input.translationReviewed,
});

/**
 * Creates a template as `draft` (never active on creation).
 *
 * @throws StateError FORBIDDEN, TEMPLATE_EXISTS.
 */
export async function createTemplate(
  handle: DbHandle,
  scope: Scope,
  input: { key: string; template: TemplateInput; requestId?: string; now?: Date },
): Promise<void> {
  requireSuper(scope);
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    try {
      await scoped(ctx, 'notice_templates').insertOne({
        _id: input.key,
        ...docOf(input.template),
        status: 'draft',
        system: false,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw new StateError('TEMPLATE_EXISTS');
      throw error;
    }
    await writeAudit(ctx, {
      action: 'template.create',
      targetType: 'notice_template',
      targetId: input.key,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
}

/** What a Super Admin edit may change (`status` moves the template, DECISIONS #111). */
export type TemplatePatch = Partial<TemplateInput> & { readonly status?: 'active' | 'retired' };

interface StoredTemplate {
  readonly status: 'draft' | 'active' | 'retired';
  readonly translation_reviewed: boolean;
  readonly system: boolean;
}

/**
 * Edits a template and/or moves its status.
 *
 * Rules (DECISIONS #111): params change only while `draft` (published notices store values by param name); a title or
 * body change of an `active` template must re-confirm `translationReviewed: true`; `active` always means reviewed —
 * draft → active and retired → active need the translations reviewed; active → retired; never back to draft; system
 * templates cannot be retired (the app sends them).
 *
 * @returns the changed database fields.
 * @throws StateError FORBIDDEN, TEMPLATE_NOT_FOUND, NOTHING_TO_UPDATE, INVALID_TRANSITION, TEMPLATE_REVIEW_REQUIRED.
 */
export async function updateTemplate(
  handle: DbHandle,
  scope: Scope,
  input: { key: string; patch: TemplatePatch; requestId?: string; now?: Date },
): Promise<readonly string[]> {
  requireSuper(scope);
  const p = input.patch;
  const set: Record<string, unknown> = {
    ...(p.category === undefined ? {} : { category: p.category }),
    ...(p.icon === undefined ? {} : { icon: p.icon }),
    ...(p.isImportantDefault === undefined ? {} : { is_important_default: p.isImportantDefault }),
    ...(p.title === undefined ? {} : { title: { ...p.title } }),
    ...(p.body === undefined ? {} : { body: { ...p.body } }),
    ...(p.params === undefined ? {} : { params: p.params.map((param) => ({ ...param })) }),
    ...(p.translationReviewed === undefined ? {} : { translation_reviewed: p.translationReviewed }),
    ...(p.status === undefined ? {} : { status: p.status }),
  };
  const fields = Object.keys(set);
  if (fields.length === 0) throw new StateError('NOTHING_TO_UPDATE');
  const now = input.now ?? new Date();
  await withTransaction(handle, scope, async (ctx) => {
    const templates = scoped(ctx, 'notice_templates');
    const found = await templates.findOne({ _id: input.key });
    if (!found) throw new StateError('TEMPLATE_NOT_FOUND');
    const current = found as unknown as StoredTemplate; // validator-enforced document shape (02 notice_templates)
    const status = p.status ?? current.status;
    const reviewed = p.translationReviewed ?? current.translation_reviewed;
    const textChanged = p.title !== undefined || p.body !== undefined;
    if (p.params !== undefined && current.status !== 'draft') throw new StateError('INVALID_TRANSITION');
    if (p.status === 'retired' && (current.system || current.status !== 'active')) {
      throw new StateError('INVALID_TRANSITION');
    }
    if (status === 'active' && !reviewed) throw new StateError('TEMPLATE_REVIEW_REQUIRED');
    if (current.status === 'active' && textChanged && p.translationReviewed !== true) {
      throw new StateError('TEMPLATE_REVIEW_REQUIRED');
    }
    await templates.updateOne({ _id: input.key }, { $set: { ...set, updated_at: now } });
    await writeAudit(ctx, {
      action: 'template.update',
      targetType: 'notice_template',
      targetId: input.key,
      meta: { fields, ...(p.status ? { status: p.status } : {}) },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  });
  return fields;
}

/** A starter template as `@mc/i18n/templates` defines it. */
export interface StarterTemplateInput {
  readonly key: string;
  readonly category: TemplateInput['category'];
  readonly icon: string;
  readonly important: boolean;
  readonly system: boolean;
  readonly params: readonly TemplateParamInput[];
  readonly title: Four;
  readonly body: Four;
}

/**
 * Adds the starter templates that do not exist yet, as `draft` with translations not reviewed (00 §4.3, DECISIONS
 * #111). An existing key — even one the Super Admin changed — is left as it is.
 *
 * @returns how many were added.
 * @throws StateError FORBIDDEN.
 */
export async function addStarterTemplates(
  handle: DbHandle,
  scope: Scope,
  input: { starters: readonly StarterTemplateInput[]; requestId?: string; now?: Date },
): Promise<number> {
  requireSuper(scope);
  const now = input.now ?? new Date();
  return withTransaction(handle, scope, async (ctx) => {
    const templates = scoped(ctx, 'notice_templates');
    const existing = new Set(
      (await templates.find({ _id: { $in: input.starters.map((starter) => starter.key) } })).map((doc) =>
        String(doc['_id']),
      ),
    );
    const missing = input.starters.filter((starter) => !existing.has(starter.key));
    for (const starter of missing) {
      await templates.insertOne({
        _id: starter.key,
        ...docOf({
          category: starter.category,
          icon: starter.icon,
          isImportantDefault: starter.important,
          title: starter.title,
          body: starter.body,
          params: starter.params,
          translationReviewed: false,
        }),
        status: 'draft',
        system: starter.system,
        created_at: now,
        updated_at: now,
      });
    }
    if (missing.length > 0) {
      await writeAudit(ctx, {
        action: 'template.add_starters',
        targetType: 'notice_template',
        meta: { added: missing.map((starter) => starter.key) },
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
    }
    return missing.length;
  });
}

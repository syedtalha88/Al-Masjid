// Notice templates for the Super Admin (07 C9, PHASE_03 T3.5): every status, every field. Reads go through the policy
// gateway with the Super Admin's scope.
import type { Document } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import { ANNOUNCEMENT_CATEGORY, TEMPLATE_PARAM_TYPE, TEMPLATE_STATUS } from '../schema/enums.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { arrayOf, iso, need, objectOf, oneOf } from './read.ts';

const four = (doc: Document | undefined) => {
  const value = doc ?? {};
  return { en: need(value, 'en'), hi: need(value, 'hi'), ur: need(value, 'ur'), te: need(value, 'te') };
};

const rowOf = (doc: Document) => ({
  key: String(doc['_id']),
  category: oneOf(doc, 'category', ANNOUNCEMENT_CATEGORY),
  icon: need(doc, 'icon'),
  isImportantDefault: doc['is_important_default'] === true,
  title: four(objectOf(doc, 'title')),
  body: four(objectOf(doc, 'body')),
  params: arrayOf(doc, 'params').map((param) => ({
    name: need(param, 'name'),
    type: oneOf(param, 'type', TEMPLATE_PARAM_TYPE),
    required: param['required'] === true,
  })),
  status: oneOf(doc, 'status', TEMPLATE_STATUS),
  translationReviewed: doc['translation_reviewed'] === true,
  system: doc['system'] === true,
  updatedAt: iso(doc, 'updated_at') ?? '',
});
export type SuperTemplateRow = ReturnType<typeof rowOf>;

const requireSuperScope = (scope: Scope) => {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
};

/**
 * C9 list: every template, drafts first, then by category and key.
 *
 * @throws StateError FORBIDDEN (not super).
 */
export async function listTemplatesForSuper(handle: DbHandle, scope: Scope): Promise<SuperTemplateRow[]> {
  requireSuperScope(scope);
  const docs = await scoped({ scope, db: await handle.db() }, 'notice_templates').find({}, { limit: 500 });
  const order = { draft: 0, active: 1, retired: 2 } as const;
  return docs
    .map(rowOf)
    .sort(
      (a, b) => order[a.status] - order[b.status] || a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
    );
}

/**
 * C9 editor: one template, any status.
 *
 * @returns `null` for an unknown key.
 * @throws StateError FORBIDDEN (not super).
 */
export async function getTemplateForSuper(
  handle: DbHandle,
  scope: Scope,
  key: string,
): Promise<SuperTemplateRow | null> {
  requireSuperScope(scope);
  const doc = await scoped({ scope, db: await handle.db() }, 'notice_templates').findOne({ _id: key });
  return doc ? rowOf(doc) : null;
}

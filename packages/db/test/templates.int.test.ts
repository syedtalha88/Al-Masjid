// PHASE_03 T3.5 data layer (DECISIONS #111): templates are created as draft; only reviewed ones become active
// (acceptance: "Unreviewed templates cannot be activated"); params are fixed once out of draft; a text change of an
// active template re-confirms the review; retired templates still render old notices; starters are added as drafts.
import { STARTER_TEMPLATES } from '@mc/i18n/templates';
import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { createDbHandle, type DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { listTemplates } from '../src/repos/index.ts';
import { adminScope, superScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { addStarterTemplates, createTemplate, type TemplateInput, updateTemplate } from '../src/state/index.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};
type Raw = { _id: UUID | string } & Record<string, unknown>;
const raw = (name: string) => t().db.collection<Raw>(name);
const SUPER = superScope(newId());
const anAdmin = () => adminScope({ adminId: newId(), masjids: [{ id: newId(), role: 'owner' }] });
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};

const four = (text: string) => ({ en: text, hi: text, ur: text, te: text });
const TEMPLATE: TemplateInput = {
  category: 'general',
  icon: 'megaphone',
  isImportantDefault: false,
  title: four('Test notice'),
  body: four('Test notice on {date}.'),
  params: [{ name: 'date', type: 'date', required: true }],
  translationReviewed: false,
};
let counter = 0;
const created = async (template: Partial<TemplateInput> = {}) => {
  counter += 1;
  const key = `test_template_${String(counter)}`;
  await createTemplate(h(), SUPER, { key, template: { ...TEMPLATE, ...template } });
  return key;
};
const stored = (key: string) => raw('notice_templates').findOne({ _id: key });

beforeAll(async () => {
  test = await createTestDatabase('templates');
  await runMigrations(t().db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: t().name, process: 'script', local: true });
});
afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('notice templates (DECISIONS #111)', () => {
  it('a new template is a draft — even with translations marked reviewed — and is never public', async () => {
    const key = await created({ translationReviewed: true });
    expect(await stored(key)).toMatchObject({ status: 'draft', translation_reviewed: true, system: false });
    expect((await listTemplates(h())).map((template) => template.key)).not.toContain(key);
    expect(await code(createTemplate(h(), SUPER, { key, template: TEMPLATE }))).toBe('TEMPLATE_EXISTS');
    const audit = await raw('audit_log').findOne({ action: 'template.create', target_id: key });
    expect(audit).toMatchObject({ actor_type: 'super_admin' });
  });

  it('unreviewed templates cannot be activated (T3.5 acceptance); reviewed ones can, then admins may pick them', async () => {
    const key = await created();
    expect(await code(updateTemplate(h(), SUPER, { key, patch: { status: 'active' } }))).toBe(
      'TEMPLATE_REVIEW_REQUIRED',
    );
    expect(await stored(key)).toMatchObject({ status: 'draft' });
    await updateTemplate(h(), SUPER, { key, patch: { translationReviewed: true, status: 'active' } });
    expect(await stored(key)).toMatchObject({ status: 'active', translation_reviewed: true });
    expect((await listTemplates(h())).map((template) => template.key)).toContain(key);
    const picked = await scoped({ scope: anAdmin(), db: t().db }, 'notice_templates').findOne({ _id: key });
    expect(picked?.['status']).toBe('active');
  });

  it('active: params are fixed; a text change must re-confirm the review; reviewed cannot be withdrawn', async () => {
    const key = await created({ translationReviewed: true });
    await updateTemplate(h(), SUPER, { key, patch: { status: 'active' } });
    expect(
      await code(
        updateTemplate(h(), SUPER, { key, patch: { params: [{ name: 'day', type: 'date', required: true }] } }),
      ),
    ).toBe('INVALID_TRANSITION');
    expect(await code(updateTemplate(h(), SUPER, { key, patch: { body: four('Changed on {date}.') } }))).toBe(
      'TEMPLATE_REVIEW_REQUIRED',
    );
    expect(await code(updateTemplate(h(), SUPER, { key, patch: { translationReviewed: false } }))).toBe(
      'TEMPLATE_REVIEW_REQUIRED',
    );
    await updateTemplate(h(), SUPER, { key, patch: { body: four('Changed on {date}.'), translationReviewed: true } });
    expect((await stored(key))?.['body']).toEqual(four('Changed on {date}.'));
    // Metadata edits need no re-review.
    expect(await updateTemplate(h(), SUPER, { key, patch: { icon: 'calendar' } })).toEqual(['icon']);
  });

  it('retire: active only, never a system template; a retired template still renders, and can come back', async () => {
    const key = await created({ translationReviewed: true });
    expect(await code(updateTemplate(h(), SUPER, { key, patch: { status: 'retired' } }))).toBe('INVALID_TRANSITION');
    await updateTemplate(h(), SUPER, { key, patch: { status: 'active' } });
    await updateTemplate(h(), SUPER, { key, patch: { status: 'retired' } });
    expect((await listTemplates(h())).map((template) => template.key)).toContain(key); // old notices still render
    const pickable = await scoped({ scope: anAdmin(), db: t().db }, 'notice_templates').findOne({ _id: key });
    expect(pickable).toBeNull(); // but admins cannot pick it
    await updateTemplate(h(), SUPER, { key, patch: { status: 'active' } });
    expect(await stored(key)).toMatchObject({ status: 'active' });
    const audit = await raw('audit_log').findOne({
      action: 'template.update',
      target_id: key,
      'meta.status': 'retired',
    });
    expect(audit).not.toBeNull();
  });

  it('starters: missing ones are added as unreviewed drafts, existing keys are untouched, a system one cannot retire', async () => {
    const before = STARTER_TEMPLATES[0];
    if (!before) throw new Error('no starters');
    await raw('notice_templates').insertOne({
      _id: before.key,
      category: before.category,
      icon: before.icon,
      is_important_default: before.important,
      title: four('Edited by the Super Admin'),
      body: four('Edited by the Super Admin.'),
      params: [],
      status: 'active',
      translation_reviewed: true,
      system: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const added = await addStarterTemplates(h(), SUPER, { starters: STARTER_TEMPLATES });
    expect(added).toBe(STARTER_TEMPLATES.length - 1);
    expect(await stored(before.key)).toMatchObject({ status: 'active', title: four('Edited by the Super Admin') });
    expect(await stored('blood_donation_camp')).toMatchObject({ status: 'draft', translation_reviewed: false });
    expect(await addStarterTemplates(h(), SUPER, { starters: STARTER_TEMPLATES })).toBe(0);
    await updateTemplate(h(), SUPER, {
      key: 'timings_updated',
      patch: { translationReviewed: true, status: 'active' },
    });
    expect(await stored('timings_updated')).toMatchObject({ system: true, status: 'active' });
    expect(await code(updateTemplate(h(), SUPER, { key: 'timings_updated', patch: { status: 'retired' } }))).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('Super Admin only; unknown keys and empty patches are refused', async () => {
    expect(await code(createTemplate(h(), anAdmin(), { key: 'test_admin_try', template: TEMPLATE }))).toBe('FORBIDDEN');
    expect(await code(updateTemplate(h(), anAdmin(), { key: 'x', patch: { icon: 'info' } }))).toBe('FORBIDDEN');
    expect(await code(addStarterTemplates(h(), anAdmin(), { starters: [] }))).toBe('FORBIDDEN');
    expect(await code(updateTemplate(h(), SUPER, { key: 'missing_template', patch: { icon: 'info' } }))).toBe(
      'TEMPLATE_NOT_FOUND',
    );
    const key = await created();
    expect(await code(updateTemplate(h(), SUPER, { key, patch: {} }))).toBe('NOTHING_TO_UPDATE');
  });
});

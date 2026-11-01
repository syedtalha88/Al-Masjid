// PHASE_03 T3.5 (API) as api-admin's own database user: notice templates — ICU and argument checks in all four
// languages, created as draft, activation only with reviewed translations (acceptance), starters added as drafts.
import { describe, expect, it } from 'vitest';

import { superHarness } from './super-harness.ts';

const { asSuper, db } = superHarness('template_routes');

const four = (text: string) => ({ en: text, hi: text, ur: text, te: text });
const TEMPLATE = {
  category: 'event',
  icon: 'calendar',
  isImportantDefault: false,
  title: four('Test gathering'),
  body: four('Test gathering on {date}, {hours_start} to {hours_end}.'),
  params: [
    { name: 'date', type: 'date', required: true },
    { name: 'hours', type: 'time_range', required: true },
  ],
  translationReviewed: false,
};
const errors = (body: unknown) => (body as { errors?: { path: string; code: string }[] }).errors ?? [];

describe('/api/super/templates (C9)', () => {
  it('refuses invalid ICU, arguments in a title and body arguments no param provides — per language', async () => {
    const broken = await asSuper('post', '/templates').send({
      ...TEMPLATE,
      key: 'test_broken',
      title: { ...TEMPLATE.title, hi: 'Test {date}' },
      body: { ...TEMPLATE.body, ur: 'Test {date', te: 'Test {hours}.' },
    });
    expect(broken.status).toBe(400);
    expect(errors(broken.body)).toEqual([
      { path: 'body.title.hi', code: 'title_has_arguments' },
      { path: 'body.body.ur', code: 'invalid_icu' },
      { path: 'body.body.te', code: 'unknown_argument' },
    ]);
  });

  it('creates a draft; activation needs reviewed translations (T3.5 acceptance); then it is listed as active', async () => {
    const created = await asSuper('post', '/templates').send({ ...TEMPLATE, key: 'test_gathering' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ template: { key: 'test_gathering', status: 'draft', system: false } });
    const refused = await asSuper('patch', '/templates/test_gathering').send({ status: 'active' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'TEMPLATE_REVIEW_REQUIRED' });
    const active = await asSuper('patch', '/templates/test_gathering').send({
      translationReviewed: true,
      status: 'active',
    });
    expect(active.body).toMatchObject({ template: { status: 'active', translationReviewed: true } });
    const list = await asSuper('get', '/templates');
    expect((list.body as { templates: { key: string; status: string }[] }).templates).toContainEqual(
      expect.objectContaining({ key: 'test_gathering', status: 'active' }),
    );
    expect((await asSuper('post', '/templates').send({ ...TEMPLATE, key: 'test_gathering' })).status).toBe(409);
  });

  it('a params change is checked against the existing texts; unknown keys answer 404', async () => {
    await asSuper('post', '/templates').send({ ...TEMPLATE, key: 'test_params' });
    const orphaned = await asSuper('patch', '/templates/test_params').send({
      params: [{ name: 'date', type: 'date', required: true }],
    });
    expect(orphaned.status).toBe(400);
    expect(errors(orphaned.body).map((error) => error.code)).toContain('unknown_argument');
    expect((await asSuper('get', '/templates/no_such_template')).body).toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });

  it('adds the starter templates once, as unreviewed drafts', async () => {
    const first = await asSuper('post', '/templates/starters');
    expect(first.body).toEqual({ added: 16 });
    expect((await asSuper('post', '/templates/starters')).body).toEqual({ added: 0 });
    expect(
      await db().collection<{ _id: string }>('notice_templates').findOne({ _id: 'blood_donation_camp' }),
    ).toMatchObject({
      status: 'draft',
      translation_reviewed: false,
    });
  });
});

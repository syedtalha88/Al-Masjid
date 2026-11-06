// Super Admin notice-template API (03 §5 "Templates", 07 C9, PHASE_03 T3.5, DECISIONS #111). Every title and body is
// checked with the ICU parser in all four languages: valid ICU, titles without arguments, bodies using only the
// arguments their params provide. Status rules live in the state functions.
import type { DbHandle, Scope } from '@mc/db';
import { getTemplateForSuper, listTemplatesForSuper } from '@mc/db/repos';
import { addStarterTemplates, createTemplate, type TemplatePatch, updateTemplate } from '@mc/db/state';
import { LOCALES } from '@mc/i18n/locales';
import { messageArguments } from '@mc/i18n/runtime-message';
import { templateArgumentNames } from '@mc/i18n/template-args';
import { STARTER_TEMPLATES } from '@mc/i18n/templates';
import {
  starterTemplatesAddedSchema,
  superTemplateCreateSchema,
  superTemplateListSchema,
  type SuperTemplatePatch,
  superTemplatePatchSchema,
  superTemplateResponseSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem, type ProblemFieldError } from '../http/problem.ts';

export interface SuperTemplateRouteDeps {
  readonly db: DbHandle;
}

type Four = { readonly en: string; readonly hi: string; readonly ur: string; readonly te: string };
type Param = { readonly name: string; readonly type: Parameters<typeof templateArgumentNames>[0]['type'] };

/**
 * Field errors of a template's texts: invalid ICU, an argument in a title, or a body argument no param provides.
 * `{date}` in a body of a template whose params are `[date: date]` is fine; `{hours}` for `hours: time_range` is not
 * (it provides `hours_start` / `hours_end`).
 */
export function templateTextErrors(
  texts: { title?: Four | undefined; body?: Four | undefined },
  params: readonly Param[],
): ProblemFieldError[] {
  const allowed = new Set(params.flatMap(templateArgumentNames));
  const errors: ProblemFieldError[] = [];
  for (const part of ['title', 'body'] as const) {
    const four = texts[part];
    if (!four) continue;
    for (const locale of LOCALES) {
      const names = messageArguments(four[locale]);
      const path = `body.${part}.${locale}`;
      if (names === null) errors.push({ path, code: 'invalid_icu' });
      else if (part === 'title' && names.length > 0) errors.push({ path, code: 'title_has_arguments' });
      else if (names.some((name) => !allowed.has(name))) errors.push({ path, code: 'unknown_argument' });
    }
  }
  return errors;
}

function assertTexts(texts: { title?: Four | undefined; body?: Four | undefined }, params: readonly Param[]): void {
  const errors = templateTextErrors(texts, params);
  if (errors.length > 0) throw new ApiProblem(400, 'VALIDATION_FAILED', undefined, errors);
}

const patchOf = (body: SuperTemplatePatch): TemplatePatch => ({
  ...(body.category === undefined ? {} : { category: body.category }),
  ...(body.icon === undefined ? {} : { icon: body.icon }),
  ...(body.isImportantDefault === undefined ? {} : { isImportantDefault: body.isImportantDefault }),
  ...(body.title === undefined ? {} : { title: body.title }),
  ...(body.body === undefined ? {} : { body: body.body }),
  ...(body.params === undefined ? {} : { params: body.params }),
  ...(body.translationReviewed === undefined ? {} : { translationReviewed: body.translationReviewed }),
  ...(body.status === undefined ? {} : { status: body.status }),
});

const Key = z.object({ key: z.string().max(64) });

/** Every `/api/super/templates…` route. */
export function superTemplateRoutes(deps: SuperTemplateRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'superWrites', key: 'session' }] as const;
  const read = async (scope: Scope, key: string) => {
    const row = await getTemplateForSuper(db, scope, key);
    if (!row) throw new ApiProblem(404, 'TEMPLATE_NOT_FOUND');
    return row;
  };
  return [
    defineRoute({
      method: 'get',
      path: '/templates',
      summary: 'Every notice template, any status (C9)',
      tags: ['super'],
      auth: 'super',
      responses: { 200: superTemplateListSchema },
      handler: async ({ auth, reply }) => reply(200, { templates: await listTemplatesForSuper(db, auth.scope) }),
    }),
    defineRoute({
      method: 'get',
      path: '/templates/:key',
      summary: 'One notice template (C9 editor)',
      tags: ['super'],
      auth: 'super',
      request: { params: Key },
      responses: { 200: superTemplateResponseSchema },
      handler: async ({ auth, params, reply }) => reply(200, { template: await read(auth.scope, params.key) }),
    }),
    defineRoute({
      method: 'post',
      path: '/templates',
      summary: 'Create a notice template — always a draft until its translations are reviewed',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: { body: superTemplateCreateSchema },
      responses: { 201: superTemplateResponseSchema },
      handler: async ({ auth, body, clock, requestId, reply }) => {
        assertTexts(body, body.params);
        const { key, ...template } = body;
        await createTemplate(db, auth.scope, { key, template, now: clock.now(), requestId });
        return reply(201, { template: await read(auth.scope, key) });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/templates/:key',
      summary: 'Edit a template or move its status (activation needs reviewed translations)',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: { params: Key, body: superTemplatePatchSchema },
      responses: { 200: superTemplateResponseSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const current = await read(auth.scope, params.key);
        // New texts against the params they will be used with; new params against the texts they will fill.
        const nextParams = body.params ?? current.params;
        assertTexts(
          body.params ? { title: body.title ?? current.title, body: body.body ?? current.body } : body,
          nextParams,
        );
        await updateTemplate(db, auth.scope, { key: params.key, patch: patchOf(body), now: clock.now(), requestId });
        return reply(200, { template: await read(auth.scope, params.key) });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/templates/starters',
      summary: 'Add the missing starter templates (00 §4.3) as drafts; existing keys are left as they are',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      responses: { 200: starterTemplatesAddedSchema },
      handler: async ({ auth, clock, requestId, reply }) =>
        reply(200, {
          added: await addStarterTemplates(db, auth.scope, {
            starters: STARTER_TEMPLATES,
            now: clock.now(),
            requestId,
          }),
        }),
    }),
  ];
}

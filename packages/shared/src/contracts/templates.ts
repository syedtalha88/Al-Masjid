import { z } from 'zod';

import { TEMPLATE_ICONS } from './template-icons.ts';
import { safeText } from './text.ts';

// Super Admin notice-template contracts (03 §5 "Templates", 07 C9, PHASE_03 T3.5, DECISIONS #111). ICU validity and
// "only declared params" are checked by the API with the ICU parser (@mc/i18n/runtime-message) — Zod checks the shape.
// Enums mirror `@mc/db/schema` (packages/api/test/contracts-sync.test.ts).

export const TEMPLATE_CATEGORIES = ['general', 'event', 'facilities', 'timing'] as const;
export const TEMPLATE_STATUSES = ['draft', 'active', 'retired'] as const;
export const TEMPLATE_PARAM_TYPES = [
  'time',
  'date',
  'date_range',
  'time_range',
  'prayer',
  'number',
  'short_text',
  'phone',
] as const;
/** 00 §4.3: 0–3 params, pickers only; the blood camp needs four (DECISIONS #104). */
export const TEMPLATE_MAX_PARAMS = 4;
export const TEMPLATE_KEY = /^[a-z][a-z0-9_]{2,63}$/;

const four = (max: number, multiline: boolean) =>
  z.strictObject({
    en: safeText(max, { min: 1, multiline }),
    hi: safeText(max, { min: 1, multiline }),
    ur: safeText(max, { min: 1, multiline }),
    te: safeText(max, { min: 1, multiline }),
  });

export const templateParamSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/), // no `_`: range params become `name_start` / `name_end`
  type: z.enum(TEMPLATE_PARAM_TYPES),
  required: z.boolean(),
});

const params = z
  .array(templateParamSchema)
  .max(TEMPLATE_MAX_PARAMS)
  .refine((list) => new Set(list.map((param) => param.name)).size === list.length, { message: 'repeated param name' });

const fields = {
  category: z.enum(TEMPLATE_CATEGORIES),
  icon: z.enum(TEMPLATE_ICONS),
  isImportantDefault: z.boolean(),
  title: four(120, false),
  body: four(1500, true),
  params,
  translationReviewed: z.boolean(),
};

/** `POST /templates` — always created as `draft`. */
export const superTemplateCreateSchema = z.strictObject({
  key: z.string().regex(TEMPLATE_KEY),
  ...fields,
});
export type SuperTemplateCreate = z.output<typeof superTemplateCreateSchema>;

/**
 * `PATCH /templates/:key`. `status` moves draft → active (needs translations reviewed), active → retired, retired →
 * active; params change only while a draft; a text change of an active template needs `translationReviewed: true`
 * in the same request (DECISIONS #111).
 */
export const superTemplatePatchSchema = z
  .strictObject({
    category: fields.category.optional(),
    icon: fields.icon.optional(),
    isImportantDefault: fields.isImportantDefault.optional(),
    title: fields.title.optional(),
    body: fields.body.optional(),
    params: fields.params.optional(),
    translationReviewed: fields.translationReviewed.optional(),
    status: z.enum(['active', 'retired']).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to change' });
export type SuperTemplatePatch = z.output<typeof superTemplatePatchSchema>;

const fourOut = z.object({ en: z.string(), hi: z.string(), ur: z.string(), te: z.string() });

/** One template as C9 shows it: every field, any status. */
export const superTemplateSchema = z
  .object({
    key: z.string(),
    category: z.enum(TEMPLATE_CATEGORIES),
    icon: z.string(),
    isImportantDefault: z.boolean(),
    title: fourOut,
    body: fourOut,
    params: z.array(z.object({ name: z.string(), type: z.enum(TEMPLATE_PARAM_TYPES), required: z.boolean() })),
    status: z.enum(TEMPLATE_STATUSES),
    translationReviewed: z.boolean(),
    system: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SuperTemplate' });
export type SuperTemplate = z.infer<typeof superTemplateSchema>;

export const superTemplateListSchema = z
  .object({ templates: z.array(superTemplateSchema) })
  .meta({ id: 'SuperTemplateList' });
export const superTemplateResponseSchema = z
  .object({ template: superTemplateSchema })
  .meta({ id: 'SuperTemplateResponse' });
/** `POST /templates/starters` — how many missing starter templates were added (as draft). */
export const starterTemplatesAddedSchema = z.object({ added: z.int() }).meta({ id: 'SuperStarterTemplatesAdded' });

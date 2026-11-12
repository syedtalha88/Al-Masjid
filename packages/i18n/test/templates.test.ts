import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '../src/locales.ts';
import { formatRuntimeMessage } from '../src/runtime-message.ts';
import {
  isTemplateValue,
  NUMBER_PARAM_MAX,
  SHORT_TEXT_MAX,
  STARTER_TEMPLATES,
  templateArgumentNames,
  templateArguments,
  type TemplateFormat,
  type TemplateParamType,
  type TemplateValue,
  templateValueProblems,
} from '../src/templates.ts';

// PHASE_03 T3.5 acceptance: every starter template renders in every locale with sample params — each param formatted
// by its type and present in the text, nothing left unfilled. Fake values only (10 §Fixtures).

const SAMPLE: Readonly<Record<TemplateParamType, TemplateValue>> = {
  time: '21:15',
  date: '2026-11-05',
  time_range: { start: '10:00', end: '14:00' },
  date_range: { start: '2026-11-05', end: '2026-11-07' },
  prayer: 'isha',
  number: 3,
  short_text: 'Test Speaker',
  phone: '+910000000000',
};
const format: TemplateFormat = {
  time: (value) => `T<${value}>`,
  date: (value) => `D<${value}>`,
  prayer: (value) => `P<${value}>`,
};

/** Argument names an ICU message uses (top level and inside plural/select branches). */
function argumentsOf(message: string): Set<string> {
  const names = new Set<string>();
  const walk = (elements: ReturnType<typeof parse>) => {
    for (const element of elements) {
      if ('value' in element && typeof element.value === 'string' && element.type !== TYPE.literal)
        names.add(element.value);
      if ('options' in element) for (const option of Object.values(element.options)) walk(option.value);
    }
  };
  walk(parse(message, { ignoreTag: true }));
  return names;
}

describe('starter notice templates', () => {
  it('18 templates with unique keys; three system templates (timings updated, special timings, payment details — T5.2)', () => {
    const keys = STARTER_TEMPLATES.map((template) => template.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(18);
    expect(STARTER_TEMPLATES.filter((template) => template.system).map((template) => template.key)).toEqual([
      'timings_updated',
      'special_timings',
      'payment_details_updated',
    ]);
  });

  for (const template of STARTER_TEMPLATES) {
    describe(template.key, () => {
      const values = Object.fromEntries(template.params.map((param) => [param.name, SAMPLE[param.type]]));
      const args = templateArguments(values, template.params, format);
      const declared = new Set(template.params.flatMap(templateArgumentNames));

      it('uses only the arguments its params provide, in every locale', () => {
        for (const locale of LOCALES) {
          for (const name of argumentsOf(template.body[locale]))
            expect(declared, `${locale}: {${name}}`).toContain(name);
          expect(argumentsOf(template.title[locale]).size, `${locale} title has no params`).toBe(0);
        }
      });

      it.each(LOCALES)('renders in %s with every param filled', (locale) => {
        const text = formatRuntimeMessage(template.body[locale], locale, args);
        expect(text).not.toBeNull();
        expect(text).not.toMatch(/[{}]/);
        for (const value of Object.values(args)) expect(text).toContain(String(value));
        expect(template.title[locale].trim().length).toBeGreaterThan(0);
      });
    });
  }
});

describe('blood_donation_camp (T3.17)', () => {
  const camp = STARTER_TEMPLATES.find((template) => template.key === 'blood_donation_camp');
  const values = {
    date: '2026-11-08',
    hours: { start: '10:00', end: '16:00' },
    place: 'Test Hall',
    contact: '+919876500001',
  };

  it.each(LOCALES)('renders date, hours, place and the grouped number (LTR-isolated) in %s', (locale) => {
    if (!camp) throw new Error('no blood camp template');
    expect(camp.params.map((param) => [param.name, param.type])).toEqual([
      ['date', 'date'],
      ['hours', 'time_range'],
      ['place', 'short_text'],
      ['contact', 'phone'],
    ]);
    const text = formatRuntimeMessage(camp.body[locale], locale, templateArguments(values, camp.params, format));
    for (const part of [
      'D<2026-11-08>',
      '\u2066T<10:00>\u2069',
      '\u2066T<16:00>\u2069',
      'Test Hall',
      '\u2066+91 98765 00001\u2069',
    ]) {
      expect(text).toContain(part);
    }
  });
});

describe('templateArguments', () => {
  const params = [
    { name: 'when', type: 'time' as const },
    { name: 'days', type: 'date_range' as const },
    { name: 'n', type: 'number' as const },
    { name: 'call', type: 'phone' as const },
  ];

  it('formats by type, splits ranges into _start/_end, keeps numbers', () => {
    expect(
      templateArguments(
        { when: '07:00', days: { start: '2026-11-05', end: '2026-11-07' }, n: 2, call: '+910000000000' },
        params,
        format,
      ),
    ).toEqual({
      when: '\u2066T<07:00>\u2069', // times keep their order in Urdu sentences (F58)
      days_start: 'D<2026-11-05>',
      days_end: 'D<2026-11-07>',
      n: 2,
      call: '\u2066+91 00000 00000\u2069',
    });
  });

  it('drops values of the wrong type or shape', () => {
    expect(
      templateArguments({ when: '25:00', days: '2026-11-05', n: Number.NaN, call: '0000000000' }, params, format),
    ).toEqual({});
  });

  it('names the ICU arguments a param provides', () => {
    expect(templateArgumentNames({ name: 'hours', type: 'time_range' })).toEqual(['hours_start', 'hours_end']);
    expect(templateArgumentNames({ name: 'item', type: 'short_text' })).toEqual(['item']);
  });
});

describe('templateValueProblems (B5 publish check)', () => {
  const params = [
    { name: 'hours', type: 'time_range' as const, required: true },
    { name: 'days', type: 'date_range' as const, required: false },
    { name: 'prayer', type: 'prayer' as const, required: false },
    { name: 'n', type: 'number' as const, required: false },
  ];

  it('accepts a sample value of every type', () => {
    for (const [type, value] of Object.entries(SAMPLE)) {
      expect(isTemplateValue(type as TemplateParamType, value), type).toBe(true);
    }
  });

  it('accepts complete values and leaves optional params out', () => {
    expect(templateValueProblems({ hours: { start: '22:00', end: '02:00' } }, params)).toEqual([]);
    expect(
      templateValueProblems(
        { hours: SAMPLE.time_range, days: { start: '2026-11-05', end: '2026-11-05' }, prayer: 'jumuah', n: 0 },
        params,
      ),
    ).toEqual([]);
  });

  it('names a missing required param, a malformed value and an undeclared name', () => {
    expect(templateValueProblems({}, params)).toEqual(['hours']);
    expect(
      templateValueProblems(
        {
          hours: { start: '10:00', end: '10:00' },
          days: { start: '2026-11-07', end: '2026-11-05' },
          prayer: 'tahajjud',
          n: 1.5,
          extra: 'x',
        },
        params,
      ),
    ).toEqual(['hours', 'days', 'prayer', 'n', 'extra']);
  });

  it('refuses out-of-range numbers, blank or long short texts and non-E.164 phones', () => {
    expect(isTemplateValue('number', -1)).toBe(false);
    expect(isTemplateValue('number', NUMBER_PARAM_MAX + 1)).toBe(false);
    expect(isTemplateValue('short_text', '   ')).toBe(false);
    expect(isTemplateValue('short_text', 'x'.repeat(SHORT_TEXT_MAX + 1))).toBe(false);
    expect(isTemplateValue('short_text', 'x'.repeat(SHORT_TEXT_MAX))).toBe(true);
    expect(isTemplateValue('phone', '09000000000')).toBe(false);
    expect(isTemplateValue('time_range', null)).toBe(false);
  });
});

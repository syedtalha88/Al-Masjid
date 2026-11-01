import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '../src/locales.ts';
import { formatRuntimeMessage } from '../src/runtime-message.ts';
import {
  STARTER_TEMPLATES,
  templateArgumentNames,
  templateArguments,
  type TemplateFormat,
  type TemplateParamType,
  type TemplateValue,
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
  it('16 templates with unique keys; exactly one system template (timings updated)', () => {
    const keys = STARTER_TEMPLATES.map((template) => template.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(16);
    expect(STARTER_TEMPLATES.filter((template) => template.system).map((template) => template.key)).toEqual([
      'timings_updated',
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
      when: 'T<07:00>',
      days_start: 'D<2026-11-05>',
      days_end: 'D<2026-11-07>',
      n: 2,
      call: '+910000000000',
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

import { describe, expect, it } from 'vitest';

import {
  COLD_BUDGETS,
  evaluateBudgets,
  median,
  type RunSummary,
  summarizeRun,
  WARM_BUDGETS,
} from '../src/lighthouse.ts';

/** A Lighthouse-13-shaped result (only the fields we read). */
const lhr = (
  url: string,
  scores: { performance?: number | null; accessibility?: number; bp?: number } = {},
  values: { lcp?: number; cls?: number; tbt?: number } = {},
) => ({
  requestedUrl: url,
  finalDisplayedUrl: url,
  categories: {
    performance: { score: scores.performance === undefined ? 0.98 : scores.performance },
    accessibility: { score: scores.accessibility ?? 1 },
    'best-practices': { score: scores.bp ?? 1 },
  },
  audits: {
    'largest-contentful-paint': { numericValue: values.lcp ?? 1800 },
    'cumulative-layout-shift': { numericValue: values.cls ?? 0.01 },
    'total-blocking-time': { numericValue: values.tbt ?? 50 },
  },
  runWarnings: ['slow host'],
});

describe('summarizeRun', () => {
  it('reads scores, metric values and warnings', () => {
    expect(summarizeRun(lhr('https://app/'))).toEqual({
      url: 'https://app/',
      categories: { performance: 0.98, accessibility: 1, 'best-practices': 1 },
      metrics: { 'largest-contentful-paint': 1800, 'cumulative-layout-shift': 0.01, 'total-blocking-time': 50 },
      warnings: ['slow host'],
      longTasks: [],
    });
  });

  it('leaves out null scores, puts a runtime error first, falls back to requestedUrl', () => {
    const result = {
      ...lhr('https://app/', { performance: null }),
      finalDisplayedUrl: undefined,
      runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' },
      runWarnings: undefined,
    };
    const summary = summarizeRun(result);
    expect(summary.url).toBe('https://app/');
    expect(summary.categories).not.toHaveProperty('performance');
    expect(summary.warnings).toEqual(['The page did not paint any content.']);
  });

  it('keeps the machine benchmark when Lighthouse reports it', () => {
    expect(summarizeRun({ ...lhr('https://app/'), environment: { benchmarkIndex: 1234.5 } }).benchmarkIndex).toBe(
      1234.5,
    );
    expect(summarizeRun(lhr('https://app/'))).not.toHaveProperty('benchmarkIndex');
  });

  it('lists the three longest tasks with their script file', () => {
    const items = [
      { url: 'https://app/assets/index-A.js', duration: 64.4 },
      { url: 'https://app/assets/index-A.js', duration: 151.6 },
      { url: 'https://app/assets/react-B.js', duration: 80 },
      { url: 'https://app/assets/x.js', duration: 52 },
      { duration: 999 },
    ];
    const summary = summarizeRun({ ...lhr('https://app/'), audits: { 'long-tasks': { details: { items } } } });
    expect(summary.longTasks).toEqual([
      { script: 'index-A.js', durationMs: 152 },
      { script: 'react-B.js', durationMs: 80 },
      { script: 'index-A.js', durationMs: 64 },
    ]);
  });

  it('rejects anything that is not a Lighthouse result', () => {
    expect(() => summarizeRun({})).toThrow('not a Lighthouse result');
    expect(() => summarizeRun(null)).toThrow('not a Lighthouse result');
  });
});

describe('median', () => {
  it('odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeUndefined();
  });
});

describe('evaluateBudgets', () => {
  const run = (url: string, ...rest: Parameters<typeof lhr> extends [string, ...infer R] ? R : never): RunSummary =>
    summarizeRun(lhr(url, ...rest));

  it('passes when the medians are inside the 01 §9 budgets; one result per page', () => {
    const results = evaluateBudgets(
      [run('https://app/'), run('https://admin/'), run('https://app/', {}, { lcp: 2000 })],
      COLD_BUDGETS,
    );
    expect(results.map(({ url, runs, failures }) => ({ url, runs, failures }))).toEqual([
      { url: 'https://app/', runs: 2, failures: [] },
      { url: 'https://admin/', runs: 1, failures: [] },
    ]);
    expect(results[0]?.metrics['largest-contentful-paint']).toBe(1900);
  });

  it('uses the median, so one bad run out of three does not fail the page', () => {
    const runs = [run('https://app/'), run('https://app/', { performance: 0.5 }, { tbt: 900 }), run('https://app/')];
    expect(evaluateBudgets(runs, COLD_BUDGETS)[0]?.failures).toEqual([]);
  });

  it('names every failure with value and limit', () => {
    const runs = [
      run('https://app/', { performance: 0.85, accessibility: 0.9, bp: 0.94 }, { lcp: 2600, cls: 0.2, tbt: 250 }),
    ];
    expect(evaluateBudgets(runs, COLD_BUDGETS)[0]?.failures).toEqual([
      'performance: 85 < 90',
      'accessibility: 90 < 95',
      'best-practices: 94 < 95',
      'largest-contentful-paint: 2600 ms > 2500 ms',
      'cumulative-layout-shift: 0.200 > 0.050',
      'total-blocking-time: 250 ms > 200 ms',
    ]);
  });

  it('a value that was never measured fails; a metric without a budget is only reported', () => {
    const missing: RunSummary = { url: 'https://app/', categories: {}, metrics: {}, warnings: [], longTasks: [] };
    expect(evaluateBudgets([missing], COLD_BUDGETS)[0]?.failures).toEqual([
      'performance: not measured',
      'accessibility: not measured',
      'best-practices: not measured',
      'largest-contentful-paint: not measured',
      'cumulative-layout-shift: not measured',
      'total-blocking-time: not measured',
    ]);
    const lcpOnly = { categories: COLD_BUDGETS.categories, metrics: { 'largest-contentful-paint': 2500 } };
    const result = evaluateBudgets([run('https://app/', {}, { tbt: 5000 })], lcpOnly)[0];
    expect(result?.failures).toEqual([]);
    expect(result?.metrics['total-blocking-time']).toBe(5000);
  });

  it('warm budget: LCP ≤ 1.0 s', () => {
    expect(evaluateBudgets([run('https://app/', {}, { lcp: 1200 })], WARM_BUDGETS)[0]?.failures).toEqual([
      'largest-contentful-paint: 1200 ms > 1000 ms',
    ]);
  });

  it('warm budget: TBT is reported, not gated (01 §9 warm row = LCP; DECISIONS #51)', () => {
    const [page] = evaluateBudgets([run('https://app/', {}, { lcp: 120, tbt: 900 })], WARM_BUDGETS);
    expect(page?.failures).toEqual([]);
    expect(page?.metrics['total-blocking-time']).toBe(900);
  });
});

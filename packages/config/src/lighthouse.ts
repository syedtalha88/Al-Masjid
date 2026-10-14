// Lighthouse budgets (01 §9) and their evaluation for `pnpm lhci` (scripts/lighthouse.ts). Pure — unit-tested;
// the runner feeds it Lighthouse 13 result objects (lhr). Several runs per page; each value is the median.

export type CategoryId = 'performance' | 'accessibility' | 'best-practices';
export type MetricId = 'largest-contentful-paint' | 'cumulative-layout-shift' | 'total-blocking-time';

export interface LighthouseBudgets {
  /** Minimum category scores, 0–1. */
  readonly categories: Readonly<Record<CategoryId, number>>;
  /** Maximum metric values (ms; CLS unitless). */
  readonly metrics: Readonly<Partial<Record<MetricId, number>>>;
}

/**
 * 01 §9 (musalli; the admin app shares them): Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95,
 * LCP ≤ 2.5 s cold, CLS ≤ 0.05, and Total Blocking Time ≤ 200 ms as the lab stand-in for INP ≤ 200 ms
 * (INP needs real interactions; Lighthouse navigation runs cannot measure it).
 */
export const COLD_BUDGETS: LighthouseBudgets = {
  categories: { performance: 0.9, accessibility: 0.95, 'best-practices': 0.95 },
  metrics: { 'largest-contentful-paint': 2500, 'cumulative-layout-shift': 0.05, 'total-blocking-time': 200 },
};

/** 01 §9 "LCP (warm, SW) ≤ 1.0 s": repeat visits served by the service worker. */
export const WARM_BUDGETS: LighthouseBudgets = {
  categories: COLD_BUDGETS.categories,
  // 01 §9 defines the warm budget as LCP only. TBT is still measured and printed with its long tasks but not
  // gated here: a service-worker start evaluates the whole bundle in one burst, and on CI runners that burst
  // landed just over 200 ms (208 ms) while cold loads measure 0 ms (DECISIONS #51, PROGRESS F27).
  metrics: { 'largest-contentful-paint': 1000, 'cumulative-layout-shift': 0.05 },
};

const CATEGORIES: readonly CategoryId[] = ['performance', 'accessibility', 'best-practices'];
const METRICS: readonly MetricId[] = ['largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time'];

export interface RunSummary {
  readonly url: string;
  readonly categories: Readonly<Partial<Record<CategoryId, number>>>;
  readonly metrics: Readonly<Partial<Record<MetricId, number>>>;
  /** Lighthouse's own run warnings and a top-level runtime error, if any. */
  readonly warnings: readonly string[];
  /** Lighthouse's CPU benchmark of the machine (higher = faster); explains CI-vs-local differences. */
  readonly benchmarkIndex?: number;
  /** The three longest main-thread tasks (simulated ms) and their script file — what makes up TBT. */
  readonly longTasks: readonly { readonly script: string; readonly durationMs: number }[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

/**
 * Extracts what the budgets need from a Lighthouse result (`lhr`). A missing or null score/value is left out
 * (and then fails the budget as "not measured").
 *
 * @throws Error when `lhr` has no `finalDisplayedUrl`/`requestedUrl` (not a Lighthouse result).
 */
export function summarizeRun(lhr: unknown): RunSummary {
  const url = field(lhr, 'finalDisplayedUrl') ?? field(lhr, 'requestedUrl');
  if (typeof url !== 'string') throw new Error('lighthouse: not a Lighthouse result');
  const categories: Partial<Record<CategoryId, number>> = {};
  for (const id of CATEGORIES) {
    const score = field(field(field(lhr, 'categories'), id), 'score');
    if (typeof score === 'number') categories[id] = score;
  }
  const metrics: Partial<Record<MetricId, number>> = {};
  for (const id of METRICS) {
    const value = field(field(field(lhr, 'audits'), id), 'numericValue');
    if (typeof value === 'number' && Number.isFinite(value)) metrics[id] = value;
  }
  const runWarnings = field(lhr, 'runWarnings');
  const warnings = Array.isArray(runWarnings) ? runWarnings.filter((item) => typeof item === 'string') : [];
  const runtimeError = field(field(lhr, 'runtimeError'), 'message');
  const benchmarkIndex = field(field(lhr, 'environment'), 'benchmarkIndex');
  const items = field(field(field(field(lhr, 'audits'), 'long-tasks'), 'details'), 'items');
  const longTasks = (Array.isArray(items) ? items : [])
    .flatMap((item) => {
      const url = field(item, 'url');
      const duration = field(item, 'duration');
      return typeof url === 'string' && typeof duration === 'number'
        ? [{ script: url.split('/').pop() ?? url, durationMs: Math.round(duration) }]
        : [];
    })
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 3);
  return {
    url,
    categories,
    metrics,
    warnings: typeof runtimeError === 'string' ? [runtimeError, ...warnings] : warnings,
    longTasks,
    ...(typeof benchmarkIndex === 'number' ? { benchmarkIndex } : {}),
  };
}

/** Median of a non-empty list (mean of the middle two for even lengths); undefined for an empty list. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export interface PageResult {
  readonly url: string;
  readonly runs: number;
  readonly categories: Readonly<Partial<Record<CategoryId, number>>>;
  readonly metrics: Readonly<Partial<Record<MetricId, number>>>;
  /** Human-readable budget failures; empty = pass. */
  readonly failures: readonly string[];
}

const format = (id: MetricId, value: number): string =>
  id === 'cumulative-layout-shift' ? value.toFixed(3) : `${String(Math.round(value))} ms`;

/**
 * Medians per page (grouped by URL) checked against `budgets`.
 *
 * @returns one result per page, in first-seen order.
 */
export function evaluateBudgets(runs: readonly RunSummary[], budgets: LighthouseBudgets): PageResult[] {
  const byUrl = new Map<string, RunSummary[]>();
  for (const run of runs) byUrl.set(run.url, [...(byUrl.get(run.url) ?? []), run]);
  return [...byUrl].map(([url, pageRuns]) => {
    const failures: string[] = [];
    const categories: Partial<Record<CategoryId, number>> = {};
    for (const id of CATEGORIES) {
      const value = median(pageRuns.flatMap((run) => run.categories[id] ?? []));
      if (value === undefined) failures.push(`${id}: not measured`);
      else {
        categories[id] = value;
        const min = budgets.categories[id];
        if (value < min) failures.push(`${id}: ${String(Math.round(value * 100))} < ${String(Math.round(min * 100))}`);
      }
    }
    const metrics: Partial<Record<MetricId, number>> = {};
    for (const id of METRICS) {
      const max = budgets.metrics[id];
      const value = median(pageRuns.flatMap((run) => run.metrics[id] ?? []));
      if (value !== undefined) metrics[id] = value;
      if (max === undefined) continue;
      if (value === undefined) failures.push(`${id}: not measured`);
      else if (value > max) failures.push(`${id}: ${format(id, value)} > ${format(id, max)}`);
    }
    return { url, runs: pageRuns.length, categories, metrics, failures };
  });
}

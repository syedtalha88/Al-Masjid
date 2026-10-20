import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { type CDPSession, expect, type Locator, type Page, test as base } from '@playwright/test';

import { type AnalyzeOptions, analyzeTrace, describeLongTasks, parseTrace, type TraceReport } from './trace.ts';

// `@mc/config/playwright` — the e2e base every spec imports instead of `@playwright/test` (10 §1, PHASE_00
// T0.12): a CSP-violation guard on every test, an axe check, the app locale as a test option, per-locale
// screenshots and a Chromium perf trace (08 §8).

/** The four UI locales (09 §1). Mirrors `@mc/i18n`, which this tooling package must not depend on. */
export const APP_LOCALES = ['en', 'hi', 'ur', 'te'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

/** localStorage key the apps' `/boot.js` reads before first paint (DECISIONS #38). */
const LOCALE_STORAGE_KEY = 'mc.locale';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Console messages browsers print for CSP / Trusted Types violations. */
const CSP_CONSOLE =
  /content security policy|refused to (load|execute|apply|connect|frame|evaluate|create)|trusted type/i;

/**
 * CSP reports caused by Playwright's own screenshot stylesheet: inline style blocked. WebKit always reports it;
 * Chromium (Playwright 1.63) logs "Applying inline style violates …" when the screenshot uses the `style` option.
 */
const SCREENSHOT_STYLE =
  /^style-src(?:-elem|-attr)? blocked (?:inline|\(inline\))|^console: (?:Refused to apply .*style|Applying inline style violates)/i;

/** Trace categories holding every event `analyzeTrace` reads (checked against a real trace). */
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'v8.execute',
];

export interface AxeOptions {
  /** Limit the scan to this selector. */
  readonly include?: string;
  readonly exclude?: readonly string[];
  /** Rule ids to skip — each needs a reason at the call site. */
  readonly disableRules?: readonly string[];
}

export interface ScreenshotOptions {
  /** Element to capture (default: the full page). */
  readonly target?: Locator;
  /** CSS selector hidden during the capture (e.g. the fixed tab bar over a section). */
  readonly hide?: string;
}

export interface PerfTrace {
  /** Throttles the CPU (default 4× — 08 §8) and starts a Chromium trace. Chromium only. */
  start(options?: { readonly cpuThrottle?: number }): Promise<void>;
  /** Stops tracing and throttling, attaches the raw trace to the report and returns its analysis. */
  stop(options?: AnalyzeOptions): Promise<TraceReport>;
}

export interface McFixtures {
  /** UI language for the test (`test.use({ appLocale: 'ur' })`); unset = the app's own detection. */
  appLocale: AppLocale | undefined;
  /** CSP violations seen so far; the test fails at teardown unless this is empty (T0.5, 04 §7). */
  cspViolations: string[];
  /** Fails with a readable list when axe (WCAG 2.1 AA) finds any violation. Waits for motion to settle first. */
  expectAxeClean: (options?: AxeOptions) => Promise<void>;
  /** Saves `<project outputDir>/screens/<project>/<locale>/<name>.png` and attaches it; returns the path. */
  capture: (name: string, options?: ScreenshotOptions) => Promise<string>;
  perfTrace: PerfTrace;
}

/** Waits until nothing animates: the navigator/sheet driver marks moving layers with `data-animating`. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('[data-animating]') === null);
}

/**
 * axe (WCAG 2.1 AA) on any page — e.g. a second browser context in a test — after motion has settled.
 *
 * @returns one readable line per violation (empty = clean).
 */
export async function axeViolations(page: Page, { include, exclude = [], disableRules = [] }: AxeOptions = {}) {
  await settle(page); // a mid-fade frame is not the real contrast
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include !== undefined) builder = builder.include(include);
  for (const selector of exclude) builder = builder.exclude(selector);
  if (disableRules.length > 0) builder = builder.disableRules([...disableRules]);
  const { violations } = await builder.analyze();
  return violations.map(
    (violation) =>
      `${violation.impact ?? '?'}: ${violation.id} — ${violation.help} (${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(' | ')})`,
  );
}

export const test = base.extend<McFixtures>({
  appLocale: [undefined, { option: true }],

  context: async ({ context, appLocale }, use) => {
    if (appLocale !== undefined) {
      // Only when nothing is stored yet, so a test that switches language keeps its choice across reloads.
      await context.addInitScript(
        ([key, value]) => {
          try {
            if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
          } catch {
            // Opaque origins (about:blank) have no storage.
          }
        },
        [LOCALE_STORAGE_KEY, appLocale] as const,
      );
    }
    await use(context);
  },

  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      await context.exposeBinding('__mcReportCsp', (_source, text: unknown) => {
        violations.push(String(text));
      });
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          // Binding installed by exposeBinding above (test-only global).
          const report = (window as unknown as { __mcReportCsp?: (text: string) => void }).__mcReportCsp;
          report?.(
            `${event.effectiveDirective} blocked ${event.blockedURI || '(inline)'} at ${event.sourceFile || '?'}:${String(event.lineNumber)}`,
          );
        });
      });
      context.on('console', (message) => {
        if (message.type() === 'error' && CSP_CONSOLE.test(message.text()))
          violations.push(`console: ${message.text()}`);
      });
      await use(violations);
      expect(violations, 'CSP violations (04 §7)').toEqual([]);
    },
    { auto: true },
  ],

  expectAxeClean: async ({ page }, use) => {
    await use(async (options = {}) => {
      expect(await axeViolations(page, options), 'axe violations (WCAG 2.1 AA)').toEqual([]);
    });
  },

  capture: async ({ page, cspViolations }, use, testInfo) => {
    await use(async (name, { target, hide } = {}) => {
      await settle(page);
      const lang = await page.evaluate(() => document.documentElement.lang);
      const locale = lang === '' ? 'en' : lang;
      const path = join(testInfo.project.outputDir, 'screens', testInfo.project.name, locale, `${name}.png`);
      const options = {
        path,
        animations: 'disabled' as const,
        ...(hide === undefined ? {} : { style: `${hide} { visibility: hidden !important; }` }),
      };
      const before = cspViolations.length;
      if (target === undefined) await page.screenshot({ ...options, fullPage: true });
      else await target.screenshot(options);
      // Playwright injects a <style> element while screenshotting (caret, animations, `style`); the page CSP
      // reports it (WebKit always, Chromium for `style`). Drop exactly those reports — everything else still fails.
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
      const during = cspViolations.splice(before);
      cspViolations.push(...during.filter((violation) => !SCREENSHOT_STYLE.test(violation)));
      await testInfo.attach(`${locale}/${name}`, { path, contentType: 'image/png' });
      return path;
    });
  },

  perfTrace: async ({ page, browser, browserName }, use, testInfo) => {
    let cdp: CDPSession | undefined;
    const state = { tracing: false };
    await use({
      async start({ cpuThrottle = 4 } = {}) {
        if (browserName !== 'chromium') throw new Error('perfTrace needs Chromium (the `perf` project)');
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
        await browser.startTracing(page, { categories: TRACE_CATEGORIES });
        state.tracing = true;
      },
      async stop(options) {
        const buffer = await browser.stopTracing();
        state.tracing = false;
        await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const path = testInfo.outputPath('chromium-trace.json');
        await writeFile(path, buffer);
        await testInfo.attach('chromium-trace', { path, contentType: 'application/json' });
        return analyzeTrace(parseTrace(buffer.toString('utf8')), options);
      },
    });
    if (state.tracing) await browser.stopTracing();
  },
});

export interface SmoothOptions {
  /** 08 §8: dropped frames < 5 %. */
  readonly maxDroppedRatio?: number;
}

/**
 * 08 §8 assertions on a perf trace: no long task (threshold chosen in `perfTrace.stop`), visible dropped frames
 * under the limit, no layout forced inside animation frames. Failure messages carry the attribution.
 */
export function expectSmooth(report: TraceReport, { maxDroppedRatio = 0.05 }: SmoothOptions = {}): void {
  expect(report.longTasks, `long tasks:\n${describeLongTasks(report.longTasks)}`).toEqual([]);
  const { presented, dropped, droppedVisible, droppedRatio } = report.frames;
  expect(
    droppedRatio,
    `visible dropped frames ${String(droppedVisible)} (all dropped ${String(dropped)}) of ${String(presented + dropped)}`,
  ).toBeLessThan(maxDroppedRatio);
  expect(report.layoutsInAnimationFrames, 'layouts forced inside requestAnimationFrame callbacks').toBe(0);
}

export { expect };

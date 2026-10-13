// Chromium trace analysis for the motion perf specs (08 §8): long tasks on the page's main thread with an
// attribution of what ran inside them (PROGRESS F20: chunk evaluation vs. input handling vs. animation
// frames), dropped frames, and layouts forced from animation-frame callbacks. Pure — unit-tested with
// synthetic traces; event names checked against a real Chromium (Playwright 1.63) trace on 13 Oct 2026.

/** One Chrome trace event (only the fields we read). Times are microseconds. */
export interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly ts: number;
  readonly pid: number;
  readonly tid: number;
  readonly dur?: number;
  readonly cat?: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

export type TaskCategory =
  | 'input'
  | 'script-evaluation'
  | 'script'
  | 'microtasks'
  | 'animation-frame'
  | 'timer'
  | 'style-layout'
  | 'paint'
  | 'parse-html'
  | 'other';

export interface LongTask {
  /** Start, ms since the first event of the trace. */
  readonly startMs: number;
  readonly durationMs: number;
  /** Time per category of the outermost recognised events inside the task (ms, rounded to 0.1); rest = `other`. */
  readonly breakdown: Readonly<Partial<Record<TaskCategory, number>>>;
  /** The three largest outermost events, e.g. `input:click 38.5 ms`. */
  readonly top: readonly string[];
  /** Script files compiled or evaluated during the task (first-load chunk evaluation shows up here). */
  readonly evaluatedScripts: readonly string[];
}

export interface FrameStats {
  readonly presented: number;
  /** Every dropped frame, including idle ones nobody sees. */
  readonly dropped: number;
  /** Dropped frames Chromium marks as affecting smoothness (something was animating, scrolling or reacting to input). */
  readonly droppedVisible: number;
  /** droppedVisible / (presented + dropped); 0 without frames. The 08 §8 metric (< 5 %). */
  readonly droppedRatio: number;
}

export interface TraceReport {
  readonly longTasks: readonly LongTask[];
  readonly frames: FrameStats;
  /** `Layout` events inside `requestAnimationFrame` callbacks: layout thrash caused by animation code. */
  readonly layoutsInAnimationFrames: number;
}

export interface AnalyzeOptions {
  /** A main-thread task longer than this is a long task (default 50 ms — 08 §8). */
  readonly longTaskMs?: number;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

/**
 * Reads a trace file as written by Playwright's `browser.stopTracing()` (`{traceEvents}` or a bare array),
 * keeping only well-formed events.
 *
 * @throws SyntaxError on invalid JSON; Error when the file holds no event list.
 */
export function parseTrace(json: string): TraceEvent[] {
  const data: unknown = JSON.parse(json);
  const list: unknown = Array.isArray(data) ? data : isRecord(data) ? data['traceEvents'] : undefined;
  if (!Array.isArray(list)) throw new Error('trace: no traceEvents list');
  return list.filter(
    (event): event is TraceEvent =>
      isRecord(event) &&
      typeof event['name'] === 'string' &&
      typeof event['ph'] === 'string' &&
      typeof event['ts'] === 'number' &&
      typeof event['pid'] === 'number' &&
      typeof event['tid'] === 'number',
  );
}

const data = (event: TraceEvent): Readonly<Record<string, unknown>> => {
  const value = event.args?.['data'];
  return isRecord(value) ? value : {};
};

const fileName = (url: unknown): string => {
  if (typeof url !== 'string' || url === '') return '(inline)';
  return url.split(/[?#]/)[0]?.split('/').pop() ?? url;
};

const SCRIPT_EVALUATION = new Set(['EvaluateScript', 'v8.compile', 'v8.compileModule', 'v8.evaluateModule']);
const STYLE_LAYOUT = new Set(['UpdateLayoutTree', 'Layout']);
const PAINT = new Set(['Paint', 'PrePaint']);

/** Category + label for events we recognise inside a task; undefined for everything else. */
function classify(event: TraceEvent): { category: TaskCategory; label: string } | undefined {
  const { name } = event;
  if (name === 'EventDispatch') {
    const type = data(event)['type'];
    return { category: 'input', label: `input:${typeof type === 'string' ? type : '?'}` };
  }
  if (SCRIPT_EVALUATION.has(name)) {
    return { category: 'script-evaluation', label: `evaluate ${fileName(data(event)['url'])}` };
  }
  if (name === 'FunctionCall') {
    const fn = data(event)['functionName'];
    const where = fileName(data(event)['url']);
    return { category: 'script', label: `call ${typeof fn === 'string' && fn !== '' ? fn : '(anonymous)'} @ ${where}` };
  }
  if (name === 'RunMicrotasks') return { category: 'microtasks', label: 'microtasks' };
  if (name === 'FireAnimationFrame') return { category: 'animation-frame', label: 'requestAnimationFrame' };
  if (name === 'TimerFire') return { category: 'timer', label: 'timer' };
  if (STYLE_LAYOUT.has(name)) return { category: 'style-layout', label: name };
  if (PAINT.has(name)) return { category: 'paint', label: name };
  if (name === 'ParseHTML') return { category: 'parse-html', label: 'ParseHTML' };
  return undefined;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;
const end = (event: TraceEvent): number => event.ts + (event.dur ?? 0);
const within = (inner: TraceEvent, outer: TraceEvent): boolean =>
  inner !== outer && inner.ts >= outer.ts && end(inner) <= end(outer);

/** Renderer main threads (`CrRendererMain`) as `pid:tid` keys. */
function rendererMainThreads(events: readonly TraceEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.name === 'thread_name' && event.args?.['name'] === 'CrRendererMain')
      keys.add(`${String(event.pid)}:${String(event.tid)}`);
  }
  return keys;
}

function attribute(task: TraceEvent, nested: readonly TraceEvent[], origin: number): LongTask {
  const recognised = nested
    .map((event) => ({ event, kind: classify(event) }))
    .filter(
      (entry): entry is { event: TraceEvent; kind: NonNullable<ReturnType<typeof classify>> } =>
        entry.kind !== undefined,
    );
  const outermost = recognised.filter(({ event }) => !recognised.some((other) => within(event, other.event)));
  const durationMs = (task.dur ?? 0) / 1000;
  const breakdown: Partial<Record<TaskCategory, number>> = {};
  let attributed = 0;
  for (const { event, kind } of outermost) {
    const ms = (event.dur ?? 0) / 1000;
    breakdown[kind.category] = (breakdown[kind.category] ?? 0) + ms;
    attributed += ms;
  }
  breakdown.other = Math.max(0, durationMs - attributed);
  for (const key of Object.keys(breakdown) as TaskCategory[]) breakdown[key] = round(breakdown[key] ?? 0);
  const top = [...outermost]
    .sort((a, b) => (b.event.dur ?? 0) - (a.event.dur ?? 0))
    .slice(0, 3)
    .map(({ event, kind }) => `${kind.label} ${round((event.dur ?? 0) / 1000).toFixed(1)} ms`);
  const evaluatedScripts = [
    ...new Set(
      recognised
        .filter(({ kind }) => kind.category === 'script-evaluation')
        .map(({ event }) => fileName(data(event)['url'])),
    ),
  ].filter((name) => name !== '(inline)');
  return { startMs: round((task.ts - origin) / 1000), durationMs: round(durationMs), breakdown, top, evaluatedScripts };
}

const FRAME_PRESENTED = new Set(['STATE_PRESENTED_ALL', 'STATE_PRESENTED_PARTIAL']);

function frameStats(events: readonly TraceEvent[], rendererPids: ReadonlySet<number>): FrameStats {
  let presented = 0;
  let dropped = 0;
  let droppedVisible = 0;
  for (const event of events) {
    if (event.name !== 'PipelineReporter' || event.ph !== 'b' || !rendererPids.has(event.pid)) continue;
    const reporter = event.args?.['frame_reporter'];
    const state = isRecord(reporter) ? reporter['state'] : undefined;
    if (state === 'STATE_DROPPED') {
      dropped += 1;
      if (isRecord(reporter) && reporter['affects_smoothness'] === true) droppedVisible += 1;
    } else if (typeof state === 'string' && FRAME_PRESENTED.has(state)) presented += 1;
  }
  const total = presented + dropped;
  return { presented, dropped, droppedVisible, droppedRatio: total === 0 ? 0 : droppedVisible / total };
}

/**
 * Analyses a Chromium trace of the page.
 *
 * @returns long tasks (with attribution), frame statistics and layouts forced inside animation frames.
 */
export function analyzeTrace(events: readonly TraceEvent[], { longTaskMs = 50 }: AnalyzeOptions = {}): TraceReport {
  const mains = rendererMainThreads(events);
  const rendererPids = new Set([...mains].map((key) => Number(key.split(':')[0])));
  const origin = events.reduce(
    (min, event) => (event.ts > 0 && event.ts < min ? event.ts : min),
    Number.POSITIVE_INFINITY,
  );
  const onMain = events.filter((event) => event.ph === 'X' && mains.has(`${String(event.pid)}:${String(event.tid)}`));
  const sameThread = (a: TraceEvent, b: TraceEvent) => a.pid === b.pid && a.tid === b.tid;

  const longTasks = onMain
    .filter((event) => event.name === 'RunTask' && (event.dur ?? 0) > longTaskMs * 1000)
    .map((task) =>
      attribute(
        task,
        onMain.filter((event) => sameThread(event, task) && within(event, task)),
        origin,
      ),
    );

  const animationFrames = onMain.filter((event) => event.name === 'FireAnimationFrame');
  const layoutsInAnimationFrames = onMain.filter(
    (event) =>
      event.name === 'Layout' && animationFrames.some((frame) => sameThread(event, frame) && within(event, frame)),
  ).length;

  return { longTasks, frames: frameStats(events, rendererPids), layoutsInAnimationFrames };
}

/** One line per long task for assertion messages. */
export function describeLongTasks(tasks: readonly LongTask[]): string {
  return tasks
    .map((task) => {
      const parts = Object.entries(task.breakdown)
        .filter(([, ms]) => ms > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([category, ms]) => `${category} ${ms.toFixed(1)}`)
        .join(', ');
      const scripts = task.evaluatedScripts.length > 0 ? ` | evaluated: ${task.evaluatedScripts.join(', ')}` : '';
      return `${task.durationMs.toFixed(1)} ms at +${task.startMs.toFixed(0)} ms [${parts}] top: ${task.top.join('; ')}${scripts}`;
    })
    .join('\n');
}

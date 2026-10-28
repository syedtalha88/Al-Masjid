import { describe, expect, it } from 'vitest';

import { analyzeTrace, describeLongTasks, parseTrace, type TraceEvent } from '../src/playwright/trace.ts';

// Synthetic traces shaped like Chromium's (names/args as recorded from Playwright 1.63 Chromium).
const PID = 10;
const MAIN = 1;
const COMPOSITOR = 2;
const ms = (value: number) => value * 1000;

const meta: TraceEvent[] = [
  { name: 'process_name', ph: 'M', ts: 0, pid: PID, tid: MAIN, args: { name: 'Renderer' } },
  { name: 'thread_name', ph: 'M', ts: 0, pid: PID, tid: MAIN, args: { name: 'CrRendererMain' } },
  { name: 'thread_name', ph: 'M', ts: 0, pid: PID, tid: COMPOSITOR, args: { name: 'Compositor' } },
  // Another process's main thread (browser UI) — never analysed.
  { name: 'thread_name', ph: 'M', ts: 0, pid: 99, tid: 1, args: { name: 'CrBrowserMain' } },
];

const x = (name: string, start: number, duration: number, args?: Record<string, unknown>, tid = MAIN, pid = PID) =>
  ({ name, ph: 'X', ts: ms(start), dur: ms(duration), pid, tid, ...(args ? { args } : {}) }) satisfies TraceEvent;

const frame = (state: string, affectsSmoothness = false, pid = PID): TraceEvent => ({
  name: 'PipelineReporter',
  ph: 'b',
  ts: ms(1),
  pid,
  tid: COMPOSITOR,
  args: { frame_reporter: { state, affects_smoothness: affectsSmoothness } },
});

describe('analyzeTrace — long tasks', () => {
  it('finds main-thread tasks over 50 ms and attributes their outermost events', () => {
    const events = [
      ...meta,
      x('RunTask', 1000, 84),
      x('EventDispatch', 1003, 14, { data: { type: 'pointerdown' } }),
      x('FunctionCall', 1004, 4, { data: { functionName: 'listener', url: '' } }), // inside pointerdown
      x('EventDispatch', 1030, 38, { data: { type: 'click' } }),
      x('RunMicrotasks', 1038, 30), // inside click
      x('UpdateLayoutTree', 1069, 4),
      x('FireAnimationFrame', 1078, 2.5),
      x('Paint', 1081, 2),
      x('RunTask', 2000, 49), // under the threshold
      x('RunTask', 3000, 120, undefined, 1, 99), // browser process: ignored
    ];
    const { longTasks } = analyzeTrace(events);
    expect(longTasks).toHaveLength(1);
    expect(longTasks[0]).toEqual({
      startMs: 0, // relative to the first timed event (metadata at ts 0 is ignored)
      durationMs: 84,
      breakdown: { input: 52, 'style-layout': 4, 'animation-frame': 2.5, paint: 2, other: 23.5 },
      top: ['input:click 38.0 ms', 'input:pointerdown 14.0 ms', 'UpdateLayoutTree 4.0 ms'],
      evaluatedScripts: [],
    });
  });

  it('names evaluated chunks (first-load chunk evaluation, PROGRESS F20)', () => {
    const events = [
      ...meta,
      x('RunTask', 500, 70),
      x('v8.compileModule', 501, 1, { data: { url: 'https://app.localhost/assets/demo._number-C2y.js?x=1' } }),
      x('EvaluateScript', 503, 40, { data: { url: 'https://app.localhost/assets/demo._number-C2y.js' } }),
      x('v8.evaluateModule', 504, 30), // nested, no url
      x('TimerFire', 550, 10),
      x('FunctionCall', 561, 5, { data: { functionName: '', url: 'https://app.localhost/assets/index-Ab.js' } }),
      x('ParseHTML', 567, 1),
      x('Layout', 568, 1),
      x('PrePaint', 569, 0.5),
    ];
    const [task] = analyzeTrace(events).longTasks;
    expect(task?.evaluatedScripts).toEqual(['demo._number-C2y.js']);
    expect(task?.breakdown['script-evaluation']).toBe(41);
    expect(task?.breakdown.timer).toBe(10);
    expect(task?.breakdown.script).toBe(5);
    expect(task?.breakdown['parse-html']).toBe(1);
    expect(task?.top[0]).toBe('evaluate demo._number-C2y.js 40.0 ms');
    expect(task?.top).toContain('call (anonymous) @ index-Ab.js 5.0 ms');
  });

  it('honours a custom threshold and labels unknown event data', () => {
    const events = [...meta, x('RunTask', 10, 30), x('EventDispatch', 11, 5), x('FunctionCall', 20, 2)];
    const [task] = analyzeTrace(events, { longTaskMs: 20 }).longTasks;
    expect(task?.top).toEqual(['input:? 5.0 ms', 'call (anonymous) @ (inline) 2.0 ms']);
    expect(analyzeTrace(events).longTasks).toEqual([]);
  });
});

describe('analyzeTrace — frames and layout thrash', () => {
  it('counts presented and dropped renderer frames; only visible drops count towards the ratio', () => {
    const events = [
      ...meta,
      ...Array.from({ length: 16 }, () => frame('STATE_PRESENTED_ALL')),
      frame('STATE_PRESENTED_PARTIAL'),
      frame('STATE_NO_UPDATE_DESIRED'),
      frame('STATE_DROPPED', true),
      frame('STATE_DROPPED', false),
      frame('STATE_DROPPED', true, 99), // browser compositor: ignored
      { name: 'PipelineReporter', ph: 'e', ts: 2, pid: PID, tid: COMPOSITOR },
      { name: 'PipelineReporter', ph: 'b', ts: 2, pid: PID, tid: COMPOSITOR, args: {} },
    ];
    expect(analyzeTrace(events).frames).toEqual({ presented: 17, dropped: 2, droppedVisible: 1, droppedRatio: 1 / 19 });
  });

  it('no frames → ratio 0', () => {
    expect(analyzeTrace(meta).frames).toEqual({ presented: 0, dropped: 0, droppedVisible: 0, droppedRatio: 0 });
  });

  it('counts layouts forced inside requestAnimationFrame callbacks', () => {
    const events = [
      ...meta,
      x('FireAnimationFrame', 100, 10),
      x('Layout', 102, 3), // forced inside rAF
      x('Layout', 120, 3), // normal frame layout
      x('Layout', 103, 1, undefined, COMPOSITOR), // other thread
    ];
    expect(analyzeTrace(events).layoutsInAnimationFrames).toBe(1);
  });

  it('names the script calls of that frame and, when traced, the stack that forced the layout', () => {
    const call = {
      functionName: 'measure',
      url: 'https://app.test/assets/index-abc.js?v=1',
      lineNumber: 3,
      columnNumber: 77,
    };
    const events = [
      ...meta,
      x('FireAnimationFrame', 100, 10),
      x('FunctionCall', 101, 4, { data: call }),
      x('Layout', 102, 3, { beginData: { stackTrace: [call, { functionName: '', url: '' }] } }),
      x('FireAnimationFrame', 200, 10),
      x('Layout', 202, 1),
    ];
    expect(analyzeTrace(events).animationFrameLayouts).toEqual([
      expect.stringMatching(
        /ms: layout 3 ms in a 10 ms frame; calls: measure@index-abc\.js:3:77 ; stack: measure@index-abc\.js:3:77 < \?@\(inline\):\?:\?$/,
      ),
      expect.stringMatching(/layout 1 ms in a 10 ms frame; calls: -$/),
    ]);
  });
});

describe('parseTrace', () => {
  it('reads {traceEvents} and bare arrays, dropping malformed entries', () => {
    const good = { name: 'RunTask', ph: 'X', ts: 1, pid: 1, tid: 1, dur: 2 };
    expect(parseTrace(JSON.stringify({ traceEvents: [good, { name: 1 }, null, 'x'] }))).toEqual([good]);
    expect(parseTrace(JSON.stringify([good]))).toEqual([good]);
  });

  it('rejects files without an event list', () => {
    expect(() => parseTrace('{"metadata":{}}')).toThrow('no traceEvents');
    expect(() => parseTrace('42')).toThrow('no traceEvents');
    expect(() => parseTrace('{')).toThrow(SyntaxError);
  });
});

describe('describeLongTasks', () => {
  it('one readable line per task, largest categories first', () => {
    const events = [
      ...meta,
      x('RunTask', 1000, 60),
      x('EvaluateScript', 1001, 30, { data: { url: 'https://h/assets/a.js' } }),
      x('EventDispatch', 1040, 10, { data: { type: 'click' } }),
    ];
    expect(describeLongTasks(analyzeTrace(events).longTasks)).toBe(
      '60.0 ms at +0 ms [script-evaluation 30.0, other 20.0, input 10.0] top: evaluate a.js 30.0 ms; input:click 10.0 ms | evaluated: a.js',
    );
  });
});

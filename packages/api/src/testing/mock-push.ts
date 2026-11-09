// A push service double (PHASE_04 T4.1): records every request the worker's sender makes and answers with programmed
// status codes — per endpoint, from a function, or 201. Test code only (and the T4.8 load test).
import type { PushRequest, PushResponse, PushTransport } from '../push/sender.ts';

export interface RecordedPush {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The payload before encryption (what the service worker would decrypt). */
  readonly payload: string;
  readonly status: number;
}

export type MockAnswer = number | { readonly status: number; readonly retryAfter?: string } | 'network-error';

export interface MockPushService {
  readonly transport: PushTransport;
  /** Every request answered so far, in order (network errors included with status 0). */
  readonly requests: readonly RecordedPush[];
  /** Answers for one endpoint, used in turn; the last one repeats. */
  answer(endpoint: string, ...answers: MockAnswer[]): void;
  /** Answers for every endpoint without its own (default 201). */
  answerAll(answer: (endpoint: string, attempt: number) => MockAnswer): void;
  /** Delay before each answer (the load test's 50–300 ms receiver). */
  latency(ms: (endpoint: string) => number): void;
  /** Requests to `endpoint` that the service accepted. */
  delivered(endpoint?: string): readonly RecordedPush[];
  reset(): void;
}

/** A fresh push service double. */
export function createMockPushService(): MockPushService {
  const requests: RecordedPush[] = [];
  const perEndpoint = new Map<string, MockAnswer[]>();
  const attempts = new Map<string, number>();
  let fallback: (endpoint: string, attempt: number) => MockAnswer = () => 201;
  let delay: (endpoint: string) => number = () => 0;

  const next = (endpoint: string): MockAnswer => {
    const attempt = (attempts.get(endpoint) ?? 0) + 1;
    attempts.set(endpoint, attempt);
    const queue = perEndpoint.get(endpoint);
    if (!queue || queue.length === 0) return fallback(endpoint, attempt);
    return queue.length > 1 ? (queue.shift() ?? 201) : (queue[0] ?? 201);
  };

  const transport: PushTransport = async (request: PushRequest): Promise<PushResponse> => {
    const wait = delay(request.endpoint);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const answer = next(request.endpoint);
    const record = (status: number) =>
      requests.push({ endpoint: request.endpoint, headers: request.headers, payload: request.plaintext, status });
    if (answer === 'network-error') {
      record(0);
      throw new Error('mock push: network error');
    }
    const { status, retryAfter } = typeof answer === 'number' ? { status: answer, retryAfter: undefined } : answer;
    record(status);
    return { status, retryAfter: retryAfter ?? null };
  };

  return {
    transport,
    requests,
    answer(endpoint, ...answers) {
      perEndpoint.set(endpoint, answers);
    },
    answerAll(answer) {
      fallback = answer;
    },
    latency(ms) {
      delay = ms;
    },
    delivered(endpoint) {
      return requests.filter(
        (entry) =>
          entry.status >= 200 && entry.status <= 202 && (endpoint === undefined || entry.endpoint === endpoint),
      );
    },
    reset() {
      requests.length = 0;
      perEndpoint.clear();
      attempts.clear();
      fallback = () => 201;
      delay = () => 0;
    },
  };
}

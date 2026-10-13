/**
 * Injectable time source (10 §3 "deterministic tests: fixed clock"). Services, jobs and test hooks take a
 * `Clock` instead of calling `Date.now()` directly, so tests (and the e2e `/api/test/clock` hook) control time.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * A clock that only moves when told to (tests, e2e time travel). Starts at `start`.
 *
 * @throws RangeError when set to an invalid date or advanced by a non-finite amount.
 */
export class ManualClock implements Clock {
  #now: number;

  constructor(start: Date) {
    this.#now = ManualClock.#valid(start.getTime());
  }

  static #valid(time: number): number {
    if (!Number.isFinite(time)) throw new RangeError('ManualClock: invalid time');
    return time;
  }

  now(): Date {
    return new Date(this.#now);
  }

  /** Jumps to `instant`. */
  set(instant: Date): void {
    this.#now = ManualClock.#valid(instant.getTime());
  }

  /** Moves forward (or back, with a negative value) by `ms`. */
  advance(ms: number): void {
    this.#now = ManualClock.#valid(this.#now + ms);
  }
}

/** A clock tests can move while time keeps flowing (e2e time travel through `/test/clock` — 10 §3). */
export interface AdjustableClock extends Clock {
  /** From now on, `now()` reads `instant` plus the time elapsed since this call. */
  set(instant: Date): void;
  /** Shifts time forward (or back, with a negative value) by `ms`. */
  advance(ms: number): void;
  /** Back to the real time. */
  reset(): void;
}

/**
 * Real time plus an offset. Used by the servers only in test-hook mode (APP_ENV=local, NODE_ENV=test), so
 * an e2e test can jump a day ahead (e.g. the 24 h UPI change hold) while timers and timeouts keep running.
 *
 * @throws RangeError when set to an invalid date or advanced by a non-finite amount.
 */
export class ShiftableClock implements AdjustableClock {
  #offset = 0;
  readonly #source: () => number;

  /** @param source - the underlying time source (default `Date.now`; injectable for tests). */
  constructor(source: () => number = Date.now) {
    this.#source = source;
  }

  now(): Date {
    return new Date(this.#source() + this.#offset);
  }

  set(instant: Date): void {
    const time = instant.getTime();
    if (!Number.isFinite(time)) throw new RangeError('ShiftableClock: invalid time');
    this.#offset = time - this.#source();
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms)) throw new RangeError('ShiftableClock: invalid time');
    this.#offset += ms;
  }

  reset(): void {
    this.#offset = 0;
  }
}

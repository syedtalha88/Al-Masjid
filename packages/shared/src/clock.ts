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

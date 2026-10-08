import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { bootEnv, onShutdownSignal, type ProcessLike } from '../src/lifecycle.ts';

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`exit(${String(code)})`);
  }
}

function fakeProcess(env: Record<string, string> = {}) {
  const emitter = new EventEmitter();
  const stderr: string[] = [];
  const exits: number[] = [];
  const proc: ProcessLike = {
    env,
    on: (event, listener) => emitter.on(event, listener),
    exit: (code: number): never => {
      exits.push(code);
      throw new ExitCalled(code);
    },
    stderr: { write: (chunk: string) => stderr.push(chunk) },
  };
  return { proc, emitter, stderr, exits };
}

const MIGRATE_ENV = {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  MONGODB_DB_NAME: 'dev',
  MONGODB_URI_MIGRATOR: 'mongodb://mc_migrator:pw@localhost:27017/',
};

describe('bootEnv', () => {
  it('returns the parsed env when valid', () => {
    const { proc } = fakeProcess(MIGRATE_ENV);
    expect(bootEnv('migrate', proc).MONGODB_DB_NAME).toBe('dev');
  });

  it('prints name-only problems and exits 1 when invalid', () => {
    const { proc, stderr, exits } = fakeProcess({
      ...MIGRATE_ENV,
      MONGODB_URI_SYSTEM: 'mongodb://mc_system:TOPSECRET@x/',
    });
    expect(() => bootEnv('migrate', proc)).toThrow(ExitCalled);
    expect(exits).toEqual([1]);
    expect(stderr.join('')).toContain('MONGODB_URI_SYSTEM');
    expect(stderr.join('')).not.toContain('TOPSECRET');
  });
});

describe('onShutdownSignal', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('runs shutdown once on SIGTERM and exits 0', async () => {
    const { proc, emitter, exits } = fakeProcess();
    const shutdown = vi.fn(() => Promise.resolve());
    onShutdownSignal(shutdown, { ...proc, exit: (code: number): never => exits.push(code) as never });
    emitter.emit('SIGTERM');
    await flush();
    expect(shutdown).toHaveBeenCalledWith('SIGTERM');
    expect(exits).toEqual([0]);
  });

  it('exits 1 and reports when shutdown fails', async () => {
    const { proc, emitter, exits, stderr } = fakeProcess();
    onShutdownSignal(() => Promise.reject(new Error('redis quit failed')), {
      ...proc,
      exit: (code: number): never => exits.push(code) as never,
    });
    emitter.emit('SIGINT');
    await flush();
    expect(exits).toEqual([1]);
    expect(stderr.join('')).toContain('shutdown failed: redis quit failed');
  });

  it('a second signal during shutdown exits 1 immediately', async () => {
    const { proc, emitter, exits } = fakeProcess();
    let finish: () => void = () => undefined;
    const shutdown = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    onShutdownSignal(shutdown, { ...proc, exit: (code: number): never => exits.push(code) as never });
    emitter.emit('SIGTERM');
    emitter.emit('SIGINT');
    expect(exits).toEqual([1]);
    finish();
    await flush();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('reports non-Error rejections too', async () => {
    const { proc, emitter, exits, stderr } = fakeProcess();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the non-Error branch
    onShutdownSignal(() => Promise.reject('x'), {
      ...proc,
      exit: (code: number): never => exits.push(code) as never,
    });
    emitter.emit('SIGTERM');
    await flush();
    expect(stderr.join('')).toContain('shutdown failed: x');
  });
});

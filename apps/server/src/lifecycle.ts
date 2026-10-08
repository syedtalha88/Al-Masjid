import { EnvError, type EnvSource, loadServerEnv, type ServerEnv, type ServerProcess } from '@mc/shared/env';

/** Minimal process surface used by the lifecycle helpers (injectable for tests). */
export interface ProcessLike {
  readonly env: EnvSource;
  on(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  exit(code: number): never;
  readonly stderr: { write(chunk: string): unknown };
}

/**
 * Loads and validates this process's environment. On failure prints the name-only problem list to
 * stderr and exits with code 1 — the process never starts with a bad or over-privileged env (01 §7).
 */
export function bootEnv<P extends ServerProcess>(name: P, proc: ProcessLike): Readonly<ServerEnv<P>> {
  try {
    return loadServerEnv(name, proc.env);
  } catch (error) {
    if (error instanceof EnvError) {
      proc.stderr.write(`${error.message}\n`);
      return proc.exit(1);
    }
    throw error;
  }
}

/**
 * Runs `shutdown` once on the first SIGTERM/SIGINT, then exits 0 (or 1 if shutdown throws).
 * A second signal while shutting down exits immediately with 1.
 */
export function onShutdownSignal(shutdown: (signal: string) => Promise<void>, proc: ProcessLike): void {
  let stopping = false;
  const handle = (signal: 'SIGTERM' | 'SIGINT'): void => {
    if (stopping) return proc.exit(1);
    stopping = true;
    shutdown(signal).then(
      () => proc.exit(0),
      (error: unknown) => {
        proc.stderr.write(`shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
        proc.exit(1);
      },
    );
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    proc.on(signal, () => {
      handle(signal);
    });
  }
}

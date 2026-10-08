import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Logger } from 'pino';

/** Server timeouts (03 §0). keepAlive > Caddy's idle timeout so Caddy closes first. */
export const SERVER_TIMEOUTS = {
  requestTimeoutMs: 15_000,
  headersTimeoutMs: 10_000,
  keepAliveTimeoutMs: 65_000,
} as const;

/** Max time in-flight requests get to finish after SIGTERM before connections are cut (01 §5.1). */
export const DRAIN_TIMEOUT_MS = 10_000;

export interface RunningServer {
  readonly server: Server;
  /** Port actually bound (useful with port 0 in tests). */
  readonly port: number;
  /**
   * Graceful shutdown: stop accepting connections, close idle keep-alive sockets, let in-flight requests
   * finish for up to `drainTimeoutMs`, then force-close what is left. Idempotent.
   */
  readonly shutdown: (drainTimeoutMs?: number) => Promise<void>;
}

/**
 * Starts an HTTP server for an Express app with the spec's timeouts.
 *
 * @param listener - the Express app.
 * @param port - port to bind (0 = ephemeral).
 * @param host - interface to bind (`0.0.0.0` in containers).
 * @throws when the port cannot be bound.
 */
export async function startHttpServer(
  listener: RequestListener,
  port: number,
  host: string,
  logger: Logger,
): Promise<RunningServer> {
  const server = createServer(
    {
      requestTimeout: SERVER_TIMEOUTS.requestTimeoutMs,
      headersTimeout: SERVER_TIMEOUTS.headersTimeoutMs,
      keepAliveTimeout: SERVER_TIMEOUTS.keepAliveTimeoutMs,
    },
    listener,
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  let closing: Promise<void> | undefined;
  const shutdown = (drainTimeoutMs = DRAIN_TIMEOUT_MS): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn({ drainTimeoutMs }, 'drain timeout reached; closing remaining connections');
        server.closeAllConnections();
      }, drainTimeoutMs);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      server.closeIdleConnections();
    });
    return closing;
  };

  return { server, port: (server.address() as AddressInfo).port, shutdown }; // TCP server → AddressInfo
}

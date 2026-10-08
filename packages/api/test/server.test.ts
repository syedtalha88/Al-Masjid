import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPublicApp } from '../src/app.ts';
import { defineRoute } from '../src/http/define-route.ts';
import { type RunningServer, SERVER_TIMEOUTS, startHttpServer } from '../src/http/server.ts';
import { silentLogger } from './helpers.ts';

/** A route whose response is held until the test releases it (simulates an in-flight request). */
function slowRoute() {
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  const hasEntered = new Promise<void>((resolve) => (entered = resolve));
  const route = defineRoute({
    method: 'get',
    path: '/slow',
    summary: 'test',
    auth: 'none',
    responses: { 200: z.object({ done: z.literal(true) }) },
    handler: async ({ reply }) => {
      entered();
      await released;
      return reply(200, { done: true });
    },
  });
  return { route, release, hasEntered };
}

function get(port: number, path: string, agentKeepAlive = false): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, headers: agentKeepAlive ? {} : { connection: 'close' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.shutdown(10);
  running = undefined;
});

describe('startHttpServer', () => {
  it('applies the spec timeouts (03 §0)', async () => {
    const { app } = createPublicApp({ logger: silentLogger(), release: 't', trustedProxyMode: 'none' });
    running = await startHttpServer(app, 0, '127.0.0.1', silentLogger());
    expect(running.server.requestTimeout).toBe(SERVER_TIMEOUTS.requestTimeoutMs);
    expect(running.server.headersTimeout).toBe(SERVER_TIMEOUTS.headersTimeoutMs);
    expect(running.server.keepAliveTimeout).toBe(SERVER_TIMEOUTS.keepAliveTimeoutMs);
    expect(running.port).toBeGreaterThan(0);
  });

  it('SIGTERM-style shutdown drains in-flight requests and refuses new connections', async () => {
    const slow = slowRoute();
    const { app } = createPublicApp({
      logger: silentLogger(),
      release: 't',
      trustedProxyMode: 'none',
      routes: [slow.route],
    });
    running = await startHttpServer(app, 0, '127.0.0.1', silentLogger());
    const { port } = running;

    const inFlight = get(port, '/api/v1/slow');
    await slow.hasEntered;

    let shutdownDone = false;
    const shutdown = running.shutdown(5_000).then(() => (shutdownDone = true));

    await expect(get(port, '/api/v1/health')).rejects.toThrow(/ECONNREFUSED|ECONNRESET/);
    expect(shutdownDone).toBe(false);

    slow.release();
    await expect(inFlight).resolves.toEqual({ status: 200, body: '{"done":true}' });
    await shutdown;
    expect(shutdownDone).toBe(true);
  });

  it('force-closes requests that outlive the drain timeout', async () => {
    const slow = slowRoute();
    const { app } = createPublicApp({
      logger: silentLogger(),
      release: 't',
      trustedProxyMode: 'none',
      routes: [slow.route],
    });
    running = await startHttpServer(app, 0, '127.0.0.1', silentLogger());

    const inFlight = get(running.port, '/api/v1/slow');
    await slow.hasEntered;
    await running.shutdown(50);
    await expect(inFlight).rejects.toThrow(/socket hang up|ECONNRESET/);
    slow.release();
  });

  it('shutdown is idempotent', async () => {
    const { app } = createPublicApp({ logger: silentLogger(), release: 't', trustedProxyMode: 'none' });
    running = await startHttpServer(app, 0, '127.0.0.1', silentLogger());
    const first = running.shutdown();
    expect(running.shutdown()).toBe(first);
    await first;
  });

  it('rejects when the port is taken', async () => {
    const { app } = createPublicApp({ logger: silentLogger(), release: 't', trustedProxyMode: 'none' });
    running = await startHttpServer(app, 0, '127.0.0.1', silentLogger());
    await expect(startHttpServer(app, running.port, '127.0.0.1', silentLogger())).rejects.toThrow(/EADDRINUSE/);
  });
});

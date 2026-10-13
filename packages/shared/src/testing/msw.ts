import type { RequestHandler } from 'msw';
import { type SetupServer, setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * Vitest hook: mocks the network for this test file with MSW (10 §3 "no external network — MSW for client
 * tests"). Any request without a handler fails the test instead of reaching the network. Handlers added with
 * `server.use()` inside a test are removed after it.
 *
 * @param handlers - the file's default handlers.
 * @returns the MSW server (for `server.use()` overrides).
 */
export function useMockNetwork(...handlers: RequestHandler[]): SetupServer {
  const server = setupServer(...handlers);
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });
  return server;
}

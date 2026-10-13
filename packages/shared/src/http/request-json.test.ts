import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useMockNetwork } from '../testing/msw.ts';
import { NetworkError, ProblemError, requestJson, ResponseError } from './request-json.ts';

const API = 'https://app.test/api/v1';
const health = z.object({ ok: z.boolean(), version: z.string() });

const server = useMockNetwork(
  http.get(`${API}/health`, () =>
    HttpResponse.json({ ok: true, version: 'abc' }, { headers: { 'X-Request-Id': 'req-1' } }),
  ),
);

const problem = (status: number, body: unknown) =>
  new HttpResponse(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': 'req-2' },
  });

/** Awaits a rejection and returns the error for instance/field assertions. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the request to fail');
}

describe('requestJson — success', () => {
  it('GETs and returns the schema-parsed body; asks for JSON and sends no Content-Type', async () => {
    let seen: Request | undefined;
    server.events.on('request:start', ({ request }) => {
      seen = request;
    });
    await expect(requestJson(`${API}/health`, { schema: health })).resolves.toEqual({ ok: true, version: 'abc' });
    expect(seen?.headers.get('accept')).toBe('application/json, application/problem+json');
    expect(seen?.headers.has('content-type')).toBe(false);
    server.events.removeAllListeners();
  });

  it('POSTs a JSON body with Content-Type and extra headers', async () => {
    server.use(
      http.post(`${API}/echo`, async ({ request }) =>
        HttpResponse.json({
          body: (await request.json()) as unknown,
          type: request.headers.get('content-type'),
          csrf: request.headers.get('x-mc-csrf'),
        }),
      ),
    );
    const result = await requestJson(`${API}/echo`, {
      method: 'POST',
      body: { locale: 'ur' },
      headers: { 'X-MC-CSRF': '1' },
      schema: z.object({ body: z.object({ locale: z.string() }), type: z.string(), csrf: z.string() }),
    });
    expect(result).toEqual({ body: { locale: 'ur' }, type: 'application/json', csrf: '1' });
  });

  it('accepts a JSON content type with parameters', async () => {
    server.use(
      http.get(`${API}/charset`, () =>
        HttpResponse.text('{"ok":true,"version":"v"}', {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      ),
    );
    await expect(requestJson(`${API}/charset`, { schema: health })).resolves.toEqual({ ok: true, version: 'v' });
  });

  it('204 → the schema receives undefined', async () => {
    server.use(http.delete(`${API}/item`, () => new HttpResponse(null, { status: 204 })));
    await expect(requestJson(`${API}/item`, { method: 'DELETE', schema: z.undefined() })).resolves.toBeUndefined();
  });
});

describe('requestJson — API errors', () => {
  it('problem+json → ProblemError with the code, status and request id', async () => {
    server.use(
      http.get(`${API}/missing`, () =>
        problem(404, {
          type: 'urn:masjid-connect:problem:not-found',
          title: 'Not Found',
          status: 404,
          code: 'NOT_FOUND',
        }),
      ),
    );
    const error = await failure(requestJson(`${API}/missing`, { schema: health }));
    expect(error).toBeInstanceOf(ProblemError);
    expect(error).toMatchObject({ kind: 'problem', status: 404, requestId: 'req-2', problem: { code: 'NOT_FOUND' } });
  });

  it('keeps field errors and accepts codes this client does not know yet', async () => {
    server.use(
      http.post(`${API}/devices`, () =>
        problem(400, {
          type: 'urn:masjid-connect:problem:validation-failed',
          title: 'Bad Request',
          status: 400,
          code: 'SOME_FUTURE_CODE',
          errors: [{ path: 'body.locale', code: 'invalid_value' }],
          requestId: 'from-body',
        }),
      ),
    );
    const error = await failure(requestJson(`${API}/devices`, { method: 'POST', body: {}, schema: health }));
    expect(error).toMatchObject({
      problem: { code: 'SOME_FUTURE_CODE', errors: [{ path: 'body.locale', code: 'invalid_value' }] },
      requestId: 'req-2',
    });
  });

  it('a problem body that breaks the contract, or a non-problem error → ResponseError unexpected-status', async () => {
    server.use(
      http.get(`${API}/bad-problem`, () => problem(500, { status: 'nope' })),
      http.get(`${API}/html-error`, () => HttpResponse.html('<h1>Bad gateway</h1>', { status: 502 })),
    );
    for (const path of ['bad-problem', 'html-error']) {
      const error = await failure(requestJson(`${API}/${path}`, { schema: health }));
      expect(error).toBeInstanceOf(ResponseError);
      expect(error).toMatchObject({ kind: 'response', reason: 'unexpected-status' });
    }
  });

  it('broken JSON in a problem body → ResponseError invalid-json', async () => {
    server.use(
      http.get(`${API}/broken-problem`, () =>
        HttpResponse.text('{', { status: 500, headers: { 'Content-Type': 'application/problem+json' } }),
      ),
    );
    await expect(requestJson(`${API}/broken-problem`, { schema: health })).rejects.toMatchObject({
      reason: 'invalid-json',
      status: 500,
    });
  });
});

describe('requestJson — unusable success responses', () => {
  it('not JSON → not-json', async () => {
    server.use(http.get(`${API}/page`, () => HttpResponse.html('<html></html>')));
    await expect(requestJson(`${API}/page`, { schema: health })).rejects.toMatchObject({ reason: 'not-json' });
  });

  it('malformed JSON → invalid-json', async () => {
    server.use(
      http.get(`${API}/cut`, () => HttpResponse.text('{"ok":', { headers: { 'Content-Type': 'application/json' } })),
    );
    await expect(requestJson(`${API}/cut`, { schema: health })).rejects.toMatchObject({ reason: 'invalid-json' });
  });

  it('wrong shape → invalid-shape naming the paths but never the values', async () => {
    server.use(http.get(`${API}/shape`, () => HttpResponse.json({ ok: 'secret-value', version: 3 })));
    const error = await failure(requestJson(`${API}/shape`, { schema: health }));
    expect(error).toMatchObject({ reason: 'invalid-shape', issues: ['ok', 'version'] });
    expect(String(error)).not.toContain('secret-value');
  });

  it('a non-object body failing the schema reports the root', async () => {
    server.use(http.get(`${API}/null`, () => HttpResponse.json(null)));
    await expect(requestJson(`${API}/null`, { schema: health })).rejects.toMatchObject({ issues: ['(root)'] });
  });
});

describe('requestJson — no response', () => {
  it('network failure → NetworkError failed', async () => {
    server.use(http.get(`${API}/down`, () => HttpResponse.error()));
    const error = await failure(requestJson(`${API}/down`, { schema: health }));
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ kind: 'network', reason: 'failed', requestId: undefined });
  });

  it('a request with no handler never reaches the network (fails instead)', async () => {
    await expect(requestJson('https://unmocked.example/x', { schema: health })).rejects.toMatchObject({
      kind: 'network',
      reason: 'failed',
    });
  });

  it('no response within timeoutMs → timeout', async () => {
    server.use(
      http.get(`${API}/slow`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await expect(requestJson(`${API}/slow`, { schema: health, timeoutMs: 30 })).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('a body that stalls after the headers → timeout (not invalid-json)', async () => {
    server.use(
      http.get(
        `${API}/stall`,
        () =>
          new HttpResponse(
            new ReadableStream({
              start: (stream) => {
                stream.enqueue(new TextEncoder().encode('{'));
              },
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );
    await expect(requestJson(`${API}/stall`, { schema: health, timeoutMs: 50 })).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('caller abort, before or during the request → aborted', async () => {
    const before = new AbortController();
    before.abort();
    await expect(requestJson(`${API}/health`, { schema: health, signal: before.signal })).rejects.toMatchObject({
      reason: 'aborted',
    });

    server.use(
      http.get(`${API}/slow`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const during = new AbortController();
    const pending = requestJson(`${API}/slow`, { schema: health, signal: during.signal });
    setTimeout(() => {
      during.abort();
    }, 10);
    await expect(pending).rejects.toMatchObject({ reason: 'aborted' });
  });

  it('uses an injected fetch', async () => {
    const fakeFetch: typeof fetch = () => Promise.resolve(Response.json({ ok: false, version: 'injected' }));
    await expect(requestJson('/relative', { schema: health, fetch: fakeFetch })).resolves.toEqual({
      ok: false,
      version: 'injected',
    });
  });
});

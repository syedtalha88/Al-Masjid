import { describe, expect, it } from 'vitest';

import { installTrustedTypes, TrustedTypesViolation } from '../src/security/trusted-types.ts';

// 04 §7 / T0.5: the default policy allows only our worker script; every other sink value is rejected.

type Fn = (input: string, type?: string, sink?: string) => string | null | undefined;
interface Captured {
  name?: string;
  createHTML?: Fn;
  createScript?: Fn;
  createScriptURL?: Fn;
}

function fakeWindow(href = 'https://app.example.test/home') {
  const captured: Captured = {};
  const scope = {
    location: { href },
    trustedTypes: {
      createPolicy(name: string, options: Omit<Captured, 'name'>) {
        Object.assign(captured, { name, ...options });
        return {};
      },
    },
  };
  return { scope, captured };
}

const call = (fn: Fn | undefined, input: string, sink: string) => {
  if (!fn) throw new Error('policy method missing');
  return fn(input, 'Trusted', sink);
};

describe('installTrustedTypes', () => {
  it('installs a policy named "default"', () => {
    const { scope, captured } = fakeWindow();
    expect(installTrustedTypes({ dev: true, scope })).toBe(true);
    expect(captured.name).toBe('default');
  });

  it('returns false where the browser has no Trusted Types', () => {
    expect(installTrustedTypes({ dev: true, scope: { location: { href: 'https://x.test/' } } })).toBe(false);
  });

  it('allows only the same-origin service worker script', () => {
    const { scope, captured } = fakeWindow();
    installTrustedTypes({ dev: false, scope });
    const sink = 'ServiceWorkerContainer register';
    expect(call(captured.createScriptURL, '/sw.js', sink)).toBe('/sw.js');
    expect(call(captured.createScriptURL, 'https://app.example.test/sw.js', sink)).toBe('/sw.js');
    for (const rejected of [
      'https://evil.test/sw.js', // other origin
      '/sw.js?x=1', // query — not the built worker
      '/assets/index.js', // not a worker we register
      'javascript:alert(1)',
      'http://[bad',
    ]) {
      expect(call(captured.createScriptURL, rejected, sink), rejected).toBeNull();
    }
  });

  it('production: HTML and script are rejected silently (the browser blocks the sink and reports it)', () => {
    const { scope, captured } = fakeWindow();
    installTrustedTypes({ dev: false, scope });
    expect(call(captured.createHTML, '<img src=x onerror=alert(1)>', 'Element innerHTML')).toBeNull();
    expect(call(captured.createScript, 'alert(1)', 'eval')).toBeNull();
  });

  it('dev: every rejection throws and names the sink', () => {
    const { scope, captured } = fakeWindow();
    installTrustedTypes({ dev: true, scope });
    expect(() => call(captured.createHTML, '<b>x</b>', 'Element innerHTML')).toThrow(TrustedTypesViolation);
    expect(() => call(captured.createHTML, '<b>x</b>', 'Element innerHTML')).toThrow(/HTML for Element innerHTML/);
    expect(() => call(captured.createScript, '1', 'eval')).toThrow(/script for eval/);
    expect(() => call(captured.createScriptURL, 'https://evil.test/a.js', 'HTMLScriptElement src')).toThrow(
      /script URL for HTMLScriptElement src/,
    );
    expect(() => call(captured.createScriptURL, 'http://[bad', 'x')).toThrow(TrustedTypesViolation);
  });
});

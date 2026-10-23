// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { captureInstallPrompt, promptInstall } from '../install.ts';
import { TURNSTILE_DUMMY_TOKEN, turnstileTokenSource } from '../turnstile.ts';

afterEach(() => {
  document.head.innerHTML = '';
});

describe('turnstileTokenSource', () => {
  it('test site keys never load Cloudflare: pass keys give the dummy token, 2x keys fail', async () => {
    await expect(turnstileTokenSource('1x00000000000000000000AA')()).resolves.toBe(TURNSTILE_DUMMY_TOKEN);
    await expect(turnstileTokenSource('3x00000000000000000000FF')()).resolves.toBe(TURNSTILE_DUMMY_TOKEN);
    await expect(turnstileTokenSource('2x00000000000000000000AB')()).rejects.toThrow(/always fails/);
    expect(document.querySelector('script')).toBeNull();
  });

  it('a real key loads the exact Turnstile script once and fails cleanly when it cannot load', async () => {
    const source = turnstileTokenSource('0x4AAAAAAFch5ViHreqwA9Mu');
    const pending = source();
    const script = document.querySelector<HTMLScriptElement>('script');
    expect(script?.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    script?.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow(/script failed/);
  });

  it('renders an invisible widget and resolves with its token', async () => {
    const calls: string[] = [];
    let options: Record<string, unknown> = {};
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_container: HTMLElement, given: Record<string, unknown>) => {
        options = given;
        calls.push('render');
        return 'w1';
      },
      execute: () => {
        calls.push('execute');
        (options['callback'] as (token: string) => void)('real-token');
      },
      remove: () => calls.push('remove'),
    };
    const source = turnstileTokenSource('0x4AAAAAAFch5ViHreqwA9Mu');
    const pending = source();
    document.querySelector('script')?.dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe('real-token');
    expect(calls).toEqual(['render', 'execute', 'remove']);
    expect(options).toMatchObject({
      sitekey: '0x4AAAAAAFch5ViHreqwA9Mu',
      execution: 'execute',
      appearance: 'interaction-only',
    });
    expect(document.querySelector('.mc-turnstile')).toBeNull();
  });
});

describe('install prompt capture', () => {
  it('keeps the early beforeinstallprompt and shows it on demand', async () => {
    const target = new EventTarget() as unknown as Window;
    captureInstallPrompt(target);
    expect(await promptInstall()).toBe(false);
    let prevented = false;
    const event = Object.assign(new Event('beforeinstallprompt'), {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      preventDefault: () => {
        prevented = true;
      },
    });
    target.dispatchEvent(event);
    expect(prevented).toBe(true);
    expect(await promptInstall()).toBe(true);
    expect(await promptInstall()).toBe(false); // used once
    target.dispatchEvent(new Event('appinstalled'));
  });
});

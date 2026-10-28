// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AdapterLocation, NavAdapter, ResolvedScreen } from '../src/navigation/adapter.ts';
import { StackNavigator } from '../src/navigation/StackNavigator.tsx';

// DECISIONS #105: navigations are applied as React transitions, so back-to-back history changes can render as ONE
// update. The navigator must still animate off and unmount every screen that left — not only the last transition's
// `from` — and settle every screen it skipped, or a popped screen stays on top (inert, swallowing taps).

function Screen() {
  return <h1 data-screen-title>Screen</h1>;
}

/** An in-memory history: the test drives location changes; the navigator only listens. */
function memoryAdapter() {
  let current: AdapterLocation = { key: 'k0', href: '/', pathname: '/', search: {} };
  const listeners = new Set<(location: AdapterLocation, replaced: boolean) => void>();
  const go = (location: AdapterLocation) => {
    current = location;
    for (const listener of listeners) listener(location, false);
  };
  const at = (n: number): AdapterLocation =>
    n === 0
      ? { key: 'k0', href: '/', pathname: '/', search: {} }
      : { key: `k${String(n)}`, href: `/s/${String(n)}`, pathname: `/s/${String(n)}`, search: {} };
  const adapter: NavAdapter = {
    getLocation: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    resolve: (pathname): ResolvedScreen => ({ routeId: pathname, component: Screen, params: {} }),
    preload: () => undefined,
  };
  return {
    adapter,
    go: (n: number) => {
      go(at(n));
    },
  };
}

const CONFIG = { tabs: [{ id: 'home', path: '/' }], modalPaths: [] };
const sections = (container: HTMLElement) =>
  [...container.querySelectorAll('section[data-screen]')].map((s) => s.getAttribute('data-screen'));

describe('StackNavigator — batched navigations', () => {
  it('two pops in one update unmount both popped screens and leave the target interactive', async () => {
    const history = memoryAdapter();
    const { container } = render(
      <StackNavigator
        adapter={history.adapter}
        config={CONFIG}
        pendingFallback={null}
        errorFallback={() => null}
        notFound={Screen}
      />,
    );
    for (const n of [1, 2, 3]) {
      act(() => {
        history.go(n);
      });
      await waitFor(() => {
        expect(sections(container).at(-1)).toBe(`k${String(n)}`);
      });
    }
    act(() => {
      history.go(2);
      history.go(1);
    });

    await waitFor(
      () => {
        expect(sections(container)).not.toContain('k2');
        expect(sections(container)).not.toContain('k3');
        expect(sections(container).at(-1)).toBe('k1');
      },
      { timeout: 3000 },
    );
    const top = container.querySelector('section[data-screen="k1"]');
    expect(top?.hasAttribute('inert')).toBe(false);
  });

  it('a pop and a push in one update unmount the popped screen', async () => {
    const history = memoryAdapter();
    const { container } = render(
      <StackNavigator
        adapter={history.adapter}
        config={CONFIG}
        pendingFallback={null}
        errorFallback={() => null}
        notFound={Screen}
      />,
    );
    for (const n of [1, 2]) {
      act(() => {
        history.go(n);
      });
      await waitFor(() => {
        expect(sections(container).at(-1)).toBe(`k${String(n)}`);
      });
    }
    act(() => {
      history.go(1); // pop k2
      history.go(4); // push k4 over k1
    });
    await waitFor(
      () => {
        expect(sections(container)).not.toContain('k2');
        expect(sections(container).at(-1)).toBe('k4');
      },
      { timeout: 3000 },
    );
  });
});

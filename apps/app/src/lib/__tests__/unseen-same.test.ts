// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { sameElements, sameMap } from '../same.ts';
import { setUnseenCount, useUnseenCount } from '../unseen.ts';

describe('unseen count store (Updates tab badge)', () => {
  it('publishes changes to subscribers; ignores repeats and clamps', () => {
    const { result } = renderHook(() => useUnseenCount());
    expect(result.current).toBe(0);
    act(() => {
      setUnseenCount(3.7);
    });
    expect(result.current).toBe(3);
    act(() => {
      setUnseenCount(3);
      setUnseenCount(-2);
    });
    expect(result.current).toBe(0);
  });
});

describe('memo comparators', () => {
  it('sameElements compares entries by identity', () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const list = [a, b];
    expect(sameElements(list, list)).toBe(true);
    expect(sameElements([a, b], [a, b])).toBe(true);
    expect(sameElements([a, b], [b, a])).toBe(false);
    expect(sameElements([a], [a, b])).toBe(false);
    expect(sameElements([{ id: 1 }], [a])).toBe(false);
  });

  it('sameMap compares keys and values by identity', () => {
    const value = { name: 'x' };
    const map = new Map([['a', value]]);
    expect(sameMap(map, map)).toBe(true);
    expect(sameMap(map, new Map([['a', value]]))).toBe(true);
    expect(sameMap(map, new Map([['a', { name: 'x' }]]))).toBe(false);
    expect(sameMap(map, new Map([['b', value]]))).toBe(false);
    expect(sameMap(map, undefined)).toBe(false);
    expect(sameMap(undefined, undefined)).toBe(true);
  });
});

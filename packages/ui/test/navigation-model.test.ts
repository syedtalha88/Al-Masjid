import { describe, expect, it } from 'vitest';

import {
  activeDepth,
  finishLeaving,
  finishModalLeaving,
  initialState,
  type NavConfig,
  type NavLocation,
  type NavState,
  reduceLocation,
} from '../src/navigation/model.ts';

const CONFIG: NavConfig = {
  tabs: [
    { id: 'home', path: '/' },
    { id: 'masjids', path: '/masjids' },
    { id: 'updates', path: '/updates' },
  ],
  modalPaths: ['/scan'],
};

let counter = 0;
const at = (pathname: string, key = `k${String((counter += 1))}`): NavLocation => ({ key, href: pathname, pathname });
const keys = (state: NavState, tab = state.activeTab) => (state.stacks[tab] ?? []).map((entry) => entry.pathname);
const reduce = (state: NavState, location: NavLocation, replaced = false) =>
  reduceLocation(CONFIG, state, location, replaced);

describe('initialState', () => {
  it('starts on the tab whose root was opened', () => {
    const state = initialState(CONFIG, at('/updates'));
    expect(state.activeTab).toBe('updates');
    expect(keys(state)).toEqual(['/updates']);
  });

  it('opens a deep link on top of a synthetic home root', () => {
    const state = initialState(CONFIG, at('/demo/3'));
    expect(state.activeTab).toBe('home');
    expect(keys(state)).toEqual(['/', '/demo/3']);
    expect(state.stacks['home']?.[0]?.synthetic).toBe(true);
  });

  it('opens a modal link over the home root', () => {
    const state = initialState(CONFIG, at('/scan'));
    expect(state.modal?.pathname).toBe('/scan');
    expect(keys(state)).toEqual(['/']);
  });
});

describe('reduceLocation', () => {
  it('pushes onto the active tab and pops back by key', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    const a = at('/demo/1');
    state = reduce(state, a);
    expect(state.transition).toEqual({ type: 'push', tab: 'home', from: home.key, to: a.key });
    const b = at('/demo/2');
    state = reduce(state, b);
    expect(keys(state)).toEqual(['/', '/demo/1', '/demo/2']);
    state = reduce(state, a); // browser back
    expect(state.transition).toEqual({ type: 'pop', tab: 'home', from: b.key, to: a.key });
    expect(keys(state)).toEqual(['/', '/demo/1']);
    expect(state.leaving['home']?.map((entry) => entry.key)).toEqual([b.key]);
    state = finishLeaving(state, b.key);
    expect(state.leaving['home']).toBeUndefined();
  });

  it('pops several screens at once (go(-2) / pop to root): only the visible top one animates out', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    state = reduce(state, at('/demo/1'));
    state = reduce(state, at('/demo/2'));
    state = reduce(state, home);
    expect(keys(state)).toEqual(['/']);
    expect(state.leaving['home']?.map((entry) => entry.pathname)).toEqual(['/demo/2']);
    expect(state.transition.type).toBe('pop');
  });

  it('switching tabs keeps each stack; back across tabs switches back without popping', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    const detail = at('/demo/1');
    state = reduce(state, detail);
    const masjids = at('/masjids');
    state = reduce(state, masjids);
    expect(state.activeTab).toBe('masjids');
    expect(state.transition).toEqual({ type: 'tab', from: 'home', to: 'masjids' });
    expect(keys(state, 'home')).toEqual(['/', '/demo/1']);
    state = reduce(state, detail); // browser back lands on home's top
    expect(state.activeTab).toBe('home');
    expect(state.transition).toEqual({ type: 'tab', from: 'masjids', to: 'home' });
    expect(keys(state, 'home')).toEqual(['/', '/demo/1']);
    expect(keys(state, 'masjids')).toEqual(['/masjids']);
  });

  it('tapping a tab restores its top entry (same key) without resetting it', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    const masjids = at('/masjids');
    state = reduce(state, masjids);
    const inner = at('/demo/9');
    state = reduce(state, inner);
    state = reduce(state, at('/')); // tap Home (new root entry)
    expect(state.activeTab).toBe('home');
    state = reduce(state, { ...inner }); // tap My Masjids → navigator re-pushes its top with the same key
    expect(state.activeTab).toBe('masjids');
    expect(keys(state, 'masjids')).toEqual(['/masjids', '/demo/9']);
  });

  it('re-tapping the active tab pops to root (root key reused)', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    const one = at('/demo/1');
    state = reduce(state, one);
    state = reduce(state, at('/demo/2'));
    state = reduce(state, { ...home });
    expect(keys(state)).toEqual(['/']);
    expect(state.transition).toMatchObject({ type: 'pop', to: home.key });
    expect(activeDepth(state)).toBe(1);
  });

  it('back from a deep link replaces onto the synthetic root', () => {
    let state = initialState(CONFIG, at('/demo/3'));
    const root = state.stacks['home']?.[0];
    if (!root) throw new Error('missing root');
    state = reduce(state, { key: root.key, href: '/', pathname: '/' }, true);
    expect(keys(state)).toEqual(['/']);
    expect(state.transition.type).toBe('pop');
  });

  it('presents and dismisses a modal over the current tab', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    const scan = at('/scan');
    state = reduce(state, scan);
    expect(state.modal?.key).toBe(scan.key);
    expect(state.transition).toEqual({ type: 'modal-present', key: scan.key });
    expect(keys(state)).toEqual(['/']);
    state = reduce(state, home); // back
    expect(state.modal).toBeNull();
    expect(state.leavingModal?.key).toBe(scan.key);
    expect(state.transition).toEqual({ type: 'modal-dismiss', key: scan.key });
    state = finishModalLeaving(state, scan.key);
    expect(state.leavingModal).toBeNull();
  });

  it('history.replace swaps the top entry without a push', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    state = reduce(state, at('/demo/1'));
    const replacement = at('/demo/1b');
    state = reduce(state, replacement, true);
    expect(keys(state)).toEqual(['/', '/demo/1b']);
    expect(state.transition).toEqual({ type: 'replace', tab: 'home', to: replacement.key });
  });

  it('forward to a popped screen pushes it again and cancels its exit', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    const a = at('/demo/1');
    state = reduce(state, a);
    state = reduce(state, home);
    expect(state.leaving['home']).toHaveLength(1);
    state = reduce(state, a); // browser forward
    expect(keys(state)).toEqual(['/', '/demo/1']);
    expect(state.leaving['home']).toBeUndefined();
    expect(state.transition.type).toBe('push');
  });

  it('rapid push/pop sequences always leave a consistent stack', () => {
    const home = at('/');
    let state = initialState(CONFIG, home);
    const history: NavLocation[] = [home];
    for (let step = 0; step < 200; step += 1) {
      if (step % 3 === 2 && history.length > 1) {
        history.pop();
        const back = history.at(-1);
        if (back) state = reduce(state, back);
      } else {
        const next = at(`/demo/${String(step)}`);
        history.push(next);
        state = reduce(state, next);
      }
      expect(keys(state)).toEqual(history.map((location) => location.pathname));
    }
  });
});

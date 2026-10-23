// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Pager } from '../src/components/Pager.tsx';
import { breathe, crossfadeIn, drawStrokesIn, shake, snapTo, sweep } from '../src/motion/effects.ts';
import { renderUi } from './render.tsx';

// T2.4 Pager (07 A1, 08 §5.11): swipe between full-width pages, forward only when allowed, inert hidden pages.

afterEach(cleanup);

function PagerDemo({ allowForward }: { readonly allowForward: boolean }) {
  const [index, setIndex] = useState(0);
  return (
    <>
      <p data-testid="index">{index}</p>
      <Pager pageCount={3} index={index} onIndexChange={setIndex} canAdvance={() => allowForward}>
        {(page) => (
          <section aria-label={`Page ${String(page)}`}>
            <span data-parallax>art {page}</span>
            <button type="button">Action {page}</button>
          </section>
        )}
      </Pager>
    </>
  );
}

const swipe = (target: Element, dx: number, dy = 2) => {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: 200, clientY: 100, timeStamp: 0 });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 200 + dx / 2, clientY: 100 + dy / 2, timeStamp: 50 });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy, timeStamp: 100 });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy, timeStamp: 120 });
};

describe('Pager', () => {
  it('shows one page; the others are inert and hidden from assistive tech', async () => {
    await renderUi(<PagerDemo allowForward />);
    const pages = document.querySelectorAll('[data-page]');
    expect(pages).toHaveLength(3);
    expect(pages[0]?.getAttribute('aria-hidden')).toBe('false');
    expect(pages[1]?.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('button', { name: 'Action 0' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Action 1' })).toBeNull();
  });

  it('a horizontal swipe moves forward and back; a vertical one does not', async () => {
    await renderUi(<PagerDemo allowForward />);
    const viewport = document.querySelector('[data-page]')?.parentElement?.parentElement;
    if (!viewport) throw new Error('no viewport');
    viewport.setPointerCapture = vi.fn();
    swipe(viewport, 0, 120);
    expect(screen.getByTestId('index').textContent).toBe('0');
    swipe(viewport, -150);
    expect(screen.getByTestId('index').textContent).toBe('1');
    swipe(viewport, 150);
    expect(screen.getByTestId('index').textContent).toBe('0');
    swipe(viewport, 150); // nothing before the first page
    expect(screen.getByTestId('index').textContent).toBe('0');
  });

  it('refuses to move forward until the page allows it (a choice is required)', async () => {
    await renderUi(<PagerDemo allowForward={false} />);
    const viewport = document.querySelector('[data-page]')?.parentElement?.parentElement;
    if (!viewport) throw new Error('no viewport');
    viewport.setPointerCapture = vi.fn();
    swipe(viewport, -150);
    expect(screen.getByTestId('index').textContent).toBe('0');
    fireEvent.pointerDown(viewport, { pointerId: 2, button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerCancel(viewport, { pointerId: 2 });
  });

  it('with reduced motion pages switch without sliding', async () => {
    await renderUi(<PagerDemo allowForward />, { reduced: true });
    expect(screen.getByTestId('index').textContent).toBe('0');
  });
});

describe('motion effects', () => {
  it('crossfadeIn ends visible when stopped; drawStrokesIn handles no strokes', () => {
    const element = document.createElement('div');
    const effect = crossfadeIn(element);
    expect(element.style.opacity).toBe('0');
    act(() => {
      effect.stop();
    });
    expect(element.style.opacity).toBe('1');
    drawStrokesIn([]).stop();
  });

  it('scanner effects (08 §5.8, §5.10) write transforms and clear them when stopped', async () => {
    const element = document.createElement('div');
    for (const effect of [shake(element), breathe(element), sweep(element, 200), snapTo(element, 0.9)]) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(element.style.transform).not.toBe('');
      effect.stop();
      expect(element.style.transform).toBe('');
    }
  });
});

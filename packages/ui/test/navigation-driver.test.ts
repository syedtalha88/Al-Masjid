// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { animateChannel, getChannel, holdLayer, initLayer, setChannel } from '../src/navigation/driver.ts';

// Navigator animation driver (08 §1.2 "interruptible", §3.2 release velocity; DECISIONS #44).

const layer = () => document.createElement('section');

describe('navigator driver', () => {
  it('renders initial and instant values as transform / opacity / radius', () => {
    const element = layer();
    initLayer(element, { x: -28, opacity: 0.5 });
    expect(element.style.transform).toBe('translateX(-28%)');
    expect(element.style.opacity).toBe('0.5');
    setChannel(element, 'x', 40);
    expect(element.style.transform).toBe('translateX(40%)');
    expect(getChannel(element, 'x')).toBe(40);

    const app = layer();
    setChannel(app, 'scale', 0.94);
    setChannel(app, 'radius', 16);
    expect(app.style.transform).toBe('scale(0.94)');
    expect(app.style.borderRadius).toBe('16px');
    expect(getChannel(layer(), 'opacity')).toBe(1);
  });

  it('springs to the target and marks the layer as moving only while it moves', async () => {
    const element = layer();
    initLayer(element, { x: 100 });
    const done = animateChannel(element, 'x', 0, 'smooth');
    expect(element.hasAttribute('data-animating')).toBe(true);
    expect(element.style.willChange).toBe('transform, opacity');
    await expect(done).resolves.toBe(true);
    expect(getChannel(element, 'x')).toBe(0);
    expect(element.style.transform).toBe('translateX(0%)');
    expect(element.hasAttribute('data-animating')).toBe(false);
    expect(element.style.willChange).toBe('');
  });

  it('a new target interrupts the running animation from where it is (no jump back)', async () => {
    const element = layer();
    initLayer(element, { x: 0 });
    const first = animateChannel(element, 'x', 100, 'smooth');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const reached = getChannel(element, 'x');
    expect(reached).toBeGreaterThan(0);
    const seen: number[] = [];
    const observer = new MutationObserver(() => seen.push(getChannel(element, 'x')));
    observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    const second = animateChannel(element, 'x', 0, 'smooth');
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    observer.disconnect();
    // Continues from the interrupted position: it never restarts from 100 or jumps to 0.
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(reached + 25);
    expect(element.hasAttribute('data-animating')).toBe(false);
  });

  it('asking again for the same target joins the running animation', () => {
    const element = layer();
    initLayer(element, { x: 100 });
    const first = animateChannel(element, 'x', 0, 'smooth');
    expect(animateChannel(element, 'x', 0, 'smooth')).toBe(first);
    // A new release velocity always starts a new spring.
    expect(animateChannel(element, 'x', 0, 'smooth', -500)).not.toBe(first);
  });

  it('hands a release velocity to the spring (a flick away from the target overshoots first)', async () => {
    const element = layer();
    initLayer(element, { x: 50 });
    let max = 50;
    const observer = new MutationObserver(() => {
      max = Math.max(max, getChannel(element, 'x'));
    });
    observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    await expect(animateChannel(element, 'x', 0, 'smooth', 2000)).resolves.toBe(true);
    observer.disconnect();
    expect(max).toBeGreaterThan(70);
    expect(getChannel(element, 'x')).toBe(0);
  });

  it('a finger grabbing the layer (instant set) cancels its animation', async () => {
    const element = layer();
    initLayer(element, { x: 100 });
    const done = animateChannel(element, 'x', 0, 'smooth');
    setChannel(element, 'x', 70);
    await expect(done).resolves.toBe(false);
    expect(getChannel(element, 'x')).toBe(70);
  });

  it('holdLayer promotes the layer until every hold is released', () => {
    const element = layer();
    const releaseA = holdLayer(element);
    const releaseB = holdLayer(element);
    releaseA();
    releaseA(); // idempotent
    expect(element.hasAttribute('data-animating')).toBe(true);
    releaseB();
    expect(element.hasAttribute('data-animating')).toBe(false);
  });
});

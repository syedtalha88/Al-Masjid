// @vitest-environment jsdom
// ChandaChart (06 §6, 07 A11, PHASE_05 T5.5): 0–8 bars render; heights scale to the tallest week; the current week is
// primary; a week not entered is a stub; a tap shows the amount (again hides it); each bar is a named button.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type ChandaBar, ChandaChart } from '../src/components/index.ts';
import { renderUi } from './render.tsx';

afterEach(cleanup);

const bar = (index: number, value: number | null, current = false): ChandaBar => ({
  key: `w${String(index)}`,
  label: `W${String(index)}`,
  value,
  valueText: value === null ? 'Not entered' : `₹${String(value / 100)}`,
  current,
});
const heights = () => [...document.querySelectorAll<HTMLElement>('[data-bar] > span')].map((node) => node.style.height);

describe('ChandaChart', () => {
  it('renders 0 to 8 bars', async () => {
    for (const count of [0, 1, 8]) {
      const bars = Array.from({ length: count }, (_, index) => bar(index, (index + 1) * 1000));
      await renderUi(<ChandaChart bars={bars} label="Chanda" selectedText={(entry) => entry.valueText} />);
      expect(screen.getByRole('group', { name: 'Chanda' }).querySelectorAll('button')).toHaveLength(count);
      cleanup();
    }
  });

  it('scales to the tallest week; current primary; a missing week is a stub', async () => {
    await renderUi(
      <ChandaChart
        bars={[bar(0, 50_000), bar(1, null), bar(2, 100_000, true)]}
        label="Chanda"
        selectedText={(entry) => entry.valueText}
      />,
    );
    expect(heights()).toEqual(['50%', '2%', '100%']);
    const spans = document.querySelectorAll('[data-bar] > span');
    expect(spans[2]?.className).toContain('bg-primary-500');
    expect(spans[0]?.className).toContain('bg-mint-200');
    expect(spans[1]?.className).toContain('bg-surface-muted');
  });

  it('a tap shows the amount; a second tap hides it', async () => {
    await renderUi(
      <ChandaChart
        bars={[bar(0, 185_000)]}
        label="Chanda"
        selectedText={(entry) => `${entry.label}: ${entry.valueText}`}
      />,
    );
    const button = screen.getByRole('button', { name: 'W0: ₹1850' });
    fireEvent.click(button);
    expect(screen.getByText('W0: ₹1850')).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(screen.queryByText('W0: ₹1850')).toBeNull();
  });
});

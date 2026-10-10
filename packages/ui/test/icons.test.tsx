// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { MasjidTile } from '../src/icons/MasjidTile.tsx';
import { PrayerIcon, PRAYERS } from '../src/icons/PrayerIcon.tsx';
import { BellIllustration, MosqueIllustration, QrPosterIllustration } from '../src/illustrations/Illustrations.tsx';

afterEach(cleanup);

describe('PrayerIcon', () => {
  it.each(PRAYERS)('%s is decorative by default and uses currentColor', (prayer) => {
    const { container } = render(<PrayerIcon prayer={prayer} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(1);
  });

  it('with a title it is an image with that accessible name', () => {
    render(<PrayerIcon prayer="isha" title="Isha" size={32} />);
    const icon = screen.getByRole('img', { name: 'Isha' });
    expect(icon.getAttribute('width')).toBe('32');
  });
});

describe('MasjidTile', () => {
  it('renders the glyph on the primary tile', () => {
    const { container } = render(<MasjidTile title="Masjid" />);
    expect(container.firstElementChild?.className).toContain('bg-primary-700');
    expect(screen.getByRole('img', { name: 'Masjid' })).toBeTruthy();
  });
});

describe('illustrations (06 §5)', () => {
  it.each([
    ['mosque', MosqueIllustration],
    ['qr poster', QrPosterIllustration],
    ['bell', BellIllustration],
  ] as const)('%s is decorative, token-colored and < 4 KB', (_name, Illustration) => {
    const markup = renderToStaticMarkup(<Illustration />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(new TextEncoder().encode(markup).length).toBeLessThan(4096);
  });
});

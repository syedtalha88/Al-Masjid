// @vitest-environment jsdom
// T3.16 acceptance: the WhatsApp number is never rendered — not as text, not in any attribute — in any locale; "Message"
// opens `wa.me/<digits>` with "Assalamu alaikum" in the app language; the admin preview opens nothing. Fake data only.
import type { IlmContact } from '@mc/shared/contracts/public';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IlmContactCard } from '../src/content/index.ts';
import { renderUi } from './render.tsx';

const CONTACT: IlmContact = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Test Contact',
  role: 'Sample role',
  topics: 'Sample topics',
  whatsapp: '+910000012345',
  audience: 'sisters',
};
const GREETING = { en: 'Assalamu alaikum', hi: 'अस्सलामु अलैकुम', ur: 'السلام علیکم', te: 'అస్సలాము అలైకుమ్' } as const;

/** Every attribute value and text node under `root`. */
function everything(root: Element): string {
  const parts = [root.textContent];
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of element.attributes) parts.push(attribute.value);
  }
  return parts.join('\n');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IlmContactCard (07 A21)', () => {
  for (const locale of ['en', 'hi', 'ur', 'te'] as const) {
    it(`never renders the number; "Message" opens wa.me with the greeting in ${locale}`, async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const { container } = await renderUi(<IlmContactCard contact={CONTACT} />, { locale });
      const card = container.querySelector('[data-ilm-contact]');
      if (!card) throw new Error('no card');
      const rendered = everything(card);
      expect(rendered).not.toMatch(/12345|\+91|wa\.me/);
      expect(rendered).toContain('Test Contact');
      expect(rendered).toContain('Sample role');
      expect(rendered).toContain('Sample topics');

      const button = screen.getByRole('button', { name: /Test Contact/ });
      fireEvent.click(button);
      expect(open).toHaveBeenCalledTimes(1);
      const [url, target, features] = open.mock.calls[0] ?? [];
      expect(target).toBe('_blank');
      expect(features).toBe('noopener,noreferrer');
      const parsed = new URL(String(url));
      expect(`${parsed.origin}${parsed.pathname}`).toBe('https://wa.me/910000012345');
      expect(parsed.searchParams.get('text')).toBe(GREETING[locale]);
    });
  }

  it('shows the initial and leaves out a missing role or topics', async () => {
    const { container } = await renderUi(
      <IlmContactCard contact={{ name: 'test person', whatsapp: CONTACT.whatsapp }} />,
    );
    expect(container.querySelector('[aria-hidden] .type-headline')?.textContent).toBe('T');
    expect(screen.queryByText('Sample role')).toBeNull();
    expect(screen.getByRole('button', { name: 'Message test person on WhatsApp' })).toBeTruthy();
  });

  it('the admin preview opens nothing', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderUi(<IlmContactCard contact={CONTACT} preview />);
    fireEvent.click(screen.getByRole('button', { name: /Message/ }));
    expect(open).not.toHaveBeenCalled();
  });
});

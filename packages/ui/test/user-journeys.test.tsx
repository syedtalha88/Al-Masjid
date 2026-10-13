// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, SearchField, SegmentedControl, TextArea } from '../src/components/index.ts';
import { renderUi } from './render.tsx';

// Component journeys with @testing-library/user-event (10 §1): real event sequences — focus moves, key
// down/press/up, pointer down/up/click, per-character input honouring `maxlength` — instead of the single
// synthetic events `fireEvent` dispatches.

afterEach(() => {
  cleanup();
});

describe('keyboard-only journey (admins on a phone keyboard, screen-reader users)', () => {
  function Form({ onPublish }: { readonly onPublish: () => void }) {
    const [kind, setKind] = useState<'hadith' | 'quran'>('hadith');
    return (
      <>
        <SegmentedControl
          segments={[
            { id: 'hadith', label: 'Hadith' },
            { id: 'quran', label: 'Quran' },
          ]}
          value={kind}
          onChange={setKind}
          label="Show"
        />
        <TextArea label="Message" maxLength={10} />
        <Button onPress={onPublish}>Publish</Button>
      </>
    );
  }

  it('Tab enters the group once, arrows choose, typing stops at maxlength, Enter and Space publish once each', async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    await renderUi(<Form onPublish={onPublish} />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Hadith' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Quran' }).getAttribute('aria-checked')).toBe('true');

    // One tab stop for the whole radio group (roving tabindex), then the text area.
    await user.tab();
    const area = screen.getByRole('textbox', { name: 'Message' });
    expect(document.activeElement).toBe(area);
    await user.keyboard('Assalamu Alaikum');
    expect(area).toHaveProperty('value', 'Assalamu A');
    expect(screen.getByText('10/10')).toBeTruthy();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Publish' }));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onPublish).toHaveBeenCalledTimes(2);
  });

  it('in Urdu (RTL) ArrowLeft moves forward', async () => {
    const user = userEvent.setup();
    await renderUi(<Form onPublish={vi.fn()} />, { locale: 'ur' });
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Quran' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('pointer journey', () => {
  it('a tap presses on pointerdown, releases on pointerup and fires once', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    await renderUi(<Button onPress={onPress}>Donate Now</Button>);
    const button = screen.getByRole('button', { name: 'Donate Now' });

    await user.pointer({ keys: '[MouseLeft>]', target: button });
    expect(button.hasAttribute('data-pressed')).toBe(true);
    expect(onPress).not.toHaveBeenCalled();
    await user.pointer({ keys: '[/MouseLeft]', target: button });
    expect(button.hasAttribute('data-pressed')).toBe(false);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a loading button ignores taps', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    await renderUi(
      <Button loading onPress={onPress}>
        Donate Now
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: /Donate Now/ }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('search: type, tap clear → empty and focus back in the field', async () => {
    function Demo() {
      const [value, setValue] = useState('');
      return <SearchField label="Search masjids" value={value} onChange={setValue} />;
    }
    const user = userEvent.setup();
    await renderUi(<Demo />);
    const input = screen.getByRole('searchbox', { name: 'Search masjids' });
    await user.click(input);
    await user.keyboard('Noor');
    expect(input).toHaveProperty('value', 'Noor');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Checkbox,
  ChipGroup,
  RadioCardGroup,
  SearchField,
  SegmentedControl,
  Switch,
  TabPanels,
  TextArea,
  TextField,
  UnderlineTabs,
} from '../src/components/index.ts';
import { arrowTarget } from '../src/components/SegmentedControl.tsx';
import { renderUi } from './render.tsx';

// T0.10 component tests (06 §6, 08 §5.2, §5.10): roles, keyboard, RTL mirroring, interactions.

afterEach(cleanup);

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'timings', label: 'Prayer Timings' },
  { id: 'notices', label: 'Announcements' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function TabsDemo({ swipe = false }: { readonly swipe?: boolean }) {
  const [value, setValue] = useState<TabId>('overview');
  return (
    <>
      <UnderlineTabs tabs={TABS} value={value} onChange={setValue} label="Sections" idPrefix="demo" />
      <TabPanels tabs={TABS} value={value} idPrefix="demo" {...(swipe ? { onChange: setValue } : {})}>
        {(id) => <p>Panel {id}</p>}
      </TabPanels>
    </>
  );
}

describe('UnderlineTabs + TabPanels', () => {
  it('tablist/tab/tabpanel wiring; one tab stop; click selects', async () => {
    await renderUi(<TabsDemo />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    fireEvent.click(screen.getByRole('tab', { name: 'Prayer Timings' }), { detail: 0 });
    expect(screen.getByRole('tab', { name: 'Prayer Timings' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel timings');
  });

  it('arrow keys move selection + focus and wrap; Home/End jump', async () => {
    await renderUi(<TabsDemo />);
    const first = screen.getByRole('tab', { name: 'Overview' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement?.textContent).toBe('Announcements');
    fireEvent.keyDown(document.activeElement ?? first, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement ?? first, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel timings');
  });

  it('in RTL the arrow keys are mirrored', async () => {
    await renderUi(<TabsDemo />, { locale: 'ur' });
    const first = screen.getByRole('tab', { name: 'Overview' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement?.textContent).toBe('Prayer Timings');
  });

  it('a horizontal swipe on the panel changes tab; a vertical one does not', async () => {
    await renderUi(<TabsDemo swipe />);
    const panel = screen.getByRole('tabpanel');
    panel.setPointerCapture = vi.fn();
    const swipe = (dx: number, dy: number) => {
      fireEvent.pointerDown(panel, { pointerId: 1, button: 0, clientX: 200, clientY: 100, timeStamp: 0 });
      fireEvent.pointerMove(panel, { pointerId: 1, clientX: 200 + dx / 2, clientY: 100 + dy / 2, timeStamp: 100 });
      fireEvent.pointerMove(panel, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy, timeStamp: 200 });
      fireEvent.pointerUp(panel, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy, timeStamp: 400 });
    };
    swipe(0, 120);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel overview');
    swipe(-120, 4);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel timings');
    swipe(120, 4);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel overview');
    // No previous tab: resists and stays.
    swipe(120, 4);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel overview');
  });
});

describe('arrowTarget', () => {
  it('clamps, mirrors in RTL, handles Home/End and ignores other keys', () => {
    expect(arrowTarget('ArrowRight', 0, 3, false)).toBe(1);
    expect(arrowTarget('ArrowRight', 0, 3, true)).toBe(0);
    expect(arrowTarget('ArrowLeft', 0, 3, true)).toBe(1);
    expect(arrowTarget('ArrowDown', 2, 3, false)).toBe(2);
    expect(arrowTarget('End', 0, 3, false)).toBe(2);
    expect(arrowTarget('Enter', 0, 3, false)).toBeNull();
  });
});

describe('SegmentedControl', () => {
  function Demo() {
    const [value, setValue] = useState<'hadith' | 'quran'>('hadith');
    return (
      <SegmentedControl
        segments={[
          { id: 'hadith', label: 'Hadith' },
          { id: 'quran', label: 'Quran' },
        ]}
        value={value}
        onChange={setValue}
        label="Show"
      />
    );
  }

  it('radio group: checked state, click and arrows; thumb follows the index', async () => {
    const { container } = await renderUi(<Demo />);
    expect(screen.getByRole('radiogroup', { name: 'Show' })).toBeTruthy();
    const hadith = screen.getByRole('radio', { name: 'Hadith' });
    expect(hadith.getAttribute('aria-checked')).toBe('true');
    hadith.focus();
    fireEvent.keyDown(hadith, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Quran' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Quran' }));
    const thumb = container.querySelector<HTMLElement>('[role="radiogroup"] > span');
    expect(thumb?.style.getPropertyValue('--mc-index')).toBe('1');
  });
});

describe('ChipGroup', () => {
  it('chips are radios; selecting one checks it', async () => {
    const onChange = vi.fn();
    await renderUi(
      <ChipGroup
        chips={[
          { id: 'all', label: 'All' },
          { id: 'illness', label: 'Illness' },
          { id: 'inteqal', label: 'Inteqal' },
        ]}
        value="all"
        onChange={onChange}
        label="Filter"
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Filter' }).className).toContain('scroller-x');
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Inteqal' }), { detail: 0 });
    expect(onChange).toHaveBeenCalledWith('inteqal');
    const all = screen.getByRole('radio', { name: 'All' });
    fireEvent.keyDown(all, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('inteqal');
  });
});

describe('Switch / Checkbox', () => {
  it('switch: role, label toggles, description, disabled', async () => {
    const onChange = vi.fn();
    const { rerender } = await renderUi(
      <Switch checked={false} onChange={onChange} label="Notify followers" description="6 of 8 left today" />,
    );
    const control = screen.getByRole('switch', { name: 'Notify followers' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByText('Notify followers'));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Switch checked onChange={onChange} label="Notify followers" disabled />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true);
  });

  it('checkbox: native input labelled by its row', async () => {
    const onChange = vi.fn();
    await renderUi(<Checkbox checked={false} onChange={onChange} label="I own this photo" invalid />);
    const box = screen.getByRole('checkbox', { name: 'I own this photo' });
    expect(box.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('RadioCardGroup', () => {
  it('fieldset with legend; native radios; each option in its own language', async () => {
    const onChange = vi.fn();
    await renderUi(
      <RadioCardGroup
        legend="Choose your language"
        name="language"
        value="en"
        onChange={onChange}
        options={[
          { value: 'en', title: 'English', lang: 'en' },
          { value: 'ur', title: 'اردو', lang: 'ur' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Choose your language' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'English' })).toHaveProperty('checked', true);
    expect(screen.getByText('اردو').closest('[lang]')?.getAttribute('lang')).toBe('ur');
    fireEvent.click(screen.getByRole('radio', { name: 'اردو' }));
    expect(onChange).toHaveBeenCalledWith('ur');
  });
});

describe('TextField / TextArea / SearchField', () => {
  it('label, hint, optional marker; error: invalid + alert + shake', async () => {
    const { rerender } = await renderUi(<TextField label="Masjid name" hint="As on the board" optional />);
    const input = screen.getByRole('textbox', { name: /Masjid name/ });
    expect(screen.getByText('Optional')).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toContain('-hint');
    rerender(<TextField label="Masjid name" hint="As on the board" optional error="Please enter a name" />);
    const invalid = screen.getByRole('textbox', { name: /Masjid name/ });
    expect(invalid.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Please enter a name');
    expect(invalid.getAttribute('aria-describedby')).toContain('-error');
    expect(invalid.classList.contains('shake')).toBe(true);
    act(() => {
      invalid.dispatchEvent(new Event('animationend'));
    });
    expect(invalid.classList.contains('shake')).toBe(false);
  });

  it('textarea counter counts live (Latin digits) and is described', async () => {
    await renderUi(<TextArea label="Message" maxLength={10} />);
    const area = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(area, { target: { value: 'Assalamu' } });
    expect(screen.getByText('8/10')).toBeTruthy();
    expect(screen.getByText('8 of 10 characters used')).toBeTruthy();
    expect(area.getAttribute('maxLength')).toBe('10');
  });

  it('search field: hidden label, clear button only with text', async () => {
    function Demo() {
      const [value, setValue] = useState('');
      return <SearchField label="Search masjids" value={value} onChange={setValue} />;
    }
    await renderUi(<Demo />);
    const input = screen.getByRole('searchbox', { name: 'Search masjids' });
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    fireEvent.change(input, { target: { value: 'Noor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }), { detail: 0 });
    expect(input).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input);
  });
});

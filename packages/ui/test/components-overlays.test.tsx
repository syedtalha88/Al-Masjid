// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyPadKey,
  Button,
  DatePickerSheet,
  Dialog,
  MAX_PAISE,
  NumberPad,
  Select,
  Sheet,
  TimeWheel,
  ToastProvider,
  useToast,
} from '../src/components/index.ts';
import { renderUi } from './render.tsx';

// T0.10 component tests (06 §6, 08 §5.3, §5.10, §5.12): overlays and pickers. Drag, snap and focus trap of
// the Sheet run in a real browser (e2e/components).

afterEach(cleanup);

const settle = { timeout: 3000 };

function SheetDemo({ onClose }: { readonly onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onPress={() => {
          setOpen(true);
        }}
      >
        Open
      </Button>
      <Sheet
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Donate via UPI"
      >
        <p>Sheet body</p>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('opens as a named modal dialog, focuses its title, closes with the close button and unmounts', async () => {
    const onClose = vi.fn();
    await renderUi(<SheetDemo onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 0 });
    const dialog = await screen.findByRole('dialog', { name: 'Donate via UPI' });
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Donate via UPI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }), { detail: 0 });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    }, settle);
  });

  it('Esc (cancel) and a backdrop tap ask to close; the browser closing it keeps state in sync', async () => {
    const onClose = vi.fn();
    const { container } = await renderUi(<SheetDemo onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 0 });
    const dialog = await screen.findByRole('dialog');
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    }, settle);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 0 });
    await screen.findByRole('dialog');
    const backdrop = container.ownerDocument.querySelector<HTMLElement>('dialog > div[aria-hidden]');
    fireEvent.click(backdrop ?? document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    }, settle);
  });

  it('reduced motion: still opens and closes (fades)', async () => {
    await renderUi(<SheetDemo />, { reduced: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }), { detail: 0 });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }), { detail: 0 });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    }, settle);
  });
});

describe('Dialog', () => {
  it('destructive: alertdialog, Cancel focused first, confirm and cancel callbacks', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    await renderUi(
      <Dialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        destructive
        title="Clear all data?"
        body="This removes all your masjids."
        confirmLabel="Clear data"
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Clear all data?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear data' }), { detail: 0 });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }), { detail: 0 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('loading: confirm busy, cancel disabled, Esc ignored', async () => {
    const onClose = vi.fn();
    await renderUi(
      <Dialog open loading onClose={onClose} onConfirm={vi.fn()} title="Publish?" body="" confirmLabel="Publish" />,
    );
    expect(screen.getByRole('button', { name: 'Publish' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    act(() => {
      screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Toast', () => {
  function Demo({ duration }: { readonly duration?: number | null }) {
    const toast = useToast();
    return (
      <Button
        onPress={() => {
          toast.show({
            message: 'Opening your UPI app…',
            ...(duration === undefined ? {} : { duration }),
            action: { label: 'Undo', onPress: onAction },
          });
        }}
      >
        Show
      </Button>
    );
  }
  const onAction = vi.fn();

  it('shows, is announced politely, and auto-dismisses', async () => {
    await renderUi(
      <ToastProvider>
        <Demo duration={150} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show' }), { detail: 0 });
    expect(screen.getByRole('status').textContent).toBe('Opening your UPI app…');
    expect(screen.getByText('Opening your UPI app…', { selector: 'p' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Opening your UPI app…', { selector: 'p' })).toBeNull();
    }, settle);
  });

  it('the action runs and dismisses; persistent toasts stay until then', async () => {
    await renderUi(
      <ToastProvider>
        <Demo duration={null} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show' }), { detail: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByText('Opening your UPI app…', { selector: 'p' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }), { detail: 0 });
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('Opening your UPI app…', { selector: 'p' })).toBeNull();
    }, settle);
  });

  it('useToast outside the provider fails loudly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderUi(<Demo />)).rejects.toThrow(/ToastProvider/);
    vi.restoreAllMocks();
  });
});

describe('Select', () => {
  it('field shows placeholder → sheet of radios → choice closes and shows', async () => {
    function Demo() {
      const [value, setValue] = useState<'fajr' | 'isha' | null>(null);
      return (
        <Select
          label="Prayer"
          value={value}
          onChange={setValue}
          options={[
            { value: 'fajr', label: 'Fajr' },
            { value: 'isha', label: 'Isha' },
          ]}
        />
      );
    }
    await renderUi(<Demo />);
    const field = screen.getByRole('button', { name: 'Prayer Choose' });
    expect(field.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(field, { detail: 0 });
    await screen.findByRole('dialog', { name: 'Prayer' });
    fireEvent.click(screen.getByRole('radio', { name: 'Isha' }), { detail: 0 });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    }, settle);
    expect(screen.getByRole('button', { name: 'Prayer Isha' })).toBeTruthy();
  });
});

describe('DatePickerSheet', () => {
  it('month grid with spoken dates, today, selection, limits; picking closes', async () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    await renderUi(
      <DatePickerSheet
        open
        onClose={onClose}
        title="Choose date"
        value="2026-09-26"
        onChange={onChange}
        today="2026-09-20"
        min="2026-09-10"
        max="2026-10-15"
      />,
    );
    expect(screen.getByText('September 2026')).toBeTruthy();
    const selected = screen.getByRole('button', { name: 'Saturday, 26 September 2026' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('button', { name: 'Sunday, 20 September 2026' }).getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('button', { name: 'Wednesday, 9 September 2026' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Monday, 28 September 2026' }), { detail: 0 });
    expect(onChange).toHaveBeenCalledWith('2026-09-28');
    expect(onClose).toHaveBeenCalled();
  });

  it('arrow keys move by day/week and PageDown by month (focus follows)', async () => {
    await renderUi(
      <DatePickerSheet open onClose={vi.fn()} title="Date" value="2026-09-30" onChange={vi.fn()} today="2026-09-01" />,
    );
    const start = screen.getByRole('button', { name: 'Wednesday, 30 September 2026' });
    start.focus();
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Thursday, 1 October 2026');
    });
    expect(screen.getByText('October 2026')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? start, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Thursday, 24 September 2026');
    });
    fireEvent.keyDown(document.activeElement ?? start, { key: 'PageDown' });
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Saturday, 24 October 2026');
    });
  });
});

describe('TimeWheel', () => {
  it('three spinbuttons with spoken values; keys change the time; output is 24-hour HH:mm', async () => {
    const onChange = vi.fn();
    await renderUi(<TimeWheel value="20:15" onChange={onChange} label="Isha jamaat" minuteStep={5} />);
    expect(screen.getByRole('group', { name: 'Isha jamaat' }).getAttribute('dir')).toBe('ltr');
    const hour = screen.getByRole('spinbutton', { name: 'Hour' });
    const minute = screen.getByRole('spinbutton', { name: 'Minute' });
    const period = screen.getByRole('spinbutton', { name: 'AM or PM' });
    expect(hour.getAttribute('aria-valuetext')).toBe('8');
    expect(minute.getAttribute('aria-valuetext')).toBe('15');
    expect(period.getAttribute('aria-valuetext')).toBe('PM');
    fireEvent.keyDown(minute, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('20:20');
    fireEvent.keyDown(hour, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('13:15');
    fireEvent.keyDown(period, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('08:15');
  });
});

describe('NumberPad', () => {
  it('applyPadKey appends rupees, deletes, and enforces the limit', () => {
    expect(applyPadKey(0, '7')).toBe(700);
    expect(applyPadKey(7200, '00')).toBe(720_000);
    expect(applyPadKey(720_000, 'back')).toBe(72_000);
    expect(applyPadKey(700, 'back')).toBe(0);
    expect(applyPadKey(0, '0')).toBe(0);
    expect(applyPadKey(MAX_PAISE, '1')).toBe(MAX_PAISE);
    expect(applyPadKey(500, '1', 1000)).toBe(500);
  });

  it('shows ₹ with Indian grouping live; keys and Backspace work; ⌫ is named', async () => {
    function Demo() {
      const [paise, setPaise] = useState(1_000_000);
      return <NumberPad value={paise} onChange={setPaise} label="Target amount" />;
    }
    await renderUi(<Demo />);
    const output = screen.getByRole('status', { name: 'Target amount' });
    expect(output.textContent).toBe('₹10,000');
    fireEvent.click(screen.getByRole('button', { name: '0' }), { detail: 0 });
    expect(output.textContent).toBe('₹1,00,000');
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }), { detail: 0 });
    expect(output.textContent).toBe('₹10,000');
    fireEvent.keyDown(screen.getByRole('button', { name: '5' }), { key: '5' });
    expect(output.textContent).toBe('₹1,00,005');
    fireEvent.keyDown(screen.getByRole('button', { name: '5' }), { key: 'Backspace' });
    expect(output.textContent).toBe('₹10,000');
  });
});

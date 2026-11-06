// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreviewFrame } from '../src/admin/PreviewFrame.tsx';
import { PublishBar } from '../src/admin/PublishBar.tsx';
import { PublishSuccess } from '../src/admin/PublishSuccess.tsx';
import { StepHeader } from '../src/admin/StepHeader.tsx';
import { renderUi } from './render.tsx';

// T3.11 shared preview & publish components (06 §6 admin, 07 B4–B7, 08 §5.12).

/** A preview language loads its locale files first (slower under coverage instrumentation). */
const LOCALE_LOAD = { timeout: 5000 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A probe that shows the language the preview content sees. */
function Probe() {
  return <p data-testid="probe">content</p>;
}

function SwitchablePreview() {
  const [locale, setLocale] = useState<'en' | 'hi' | 'ur' | 'te'>('en');
  return (
    <PreviewFrame locale={locale} onLocaleChange={setLocale} label="Preview" languageLabel="Show in">
      <Probe />
    </PreviewFrame>
  );
}

describe('PreviewFrame', () => {
  it('a labelled region with a language switcher in each language’s own name', async () => {
    await renderUi(<SwitchablePreview />);
    expect(screen.getByRole('region', { name: 'Preview' })).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'Show in' });
    expect(group.textContent).toContain('English');
    expect(group.textContent).toContain('हिन्दी');
    expect(group.textContent).toContain('اردو');
    expect(group.textContent).toContain('తెలుగు');
  });

  it('switching language marks only the preview with lang/dir (Urdu mirrors inside the frame); the admin page stays', async () => {
    await renderUi(<SwitchablePreview />, { locale: 'te' });
    const screenOf = () => document.querySelector<HTMLElement>('[data-preview-locale]');
    await waitFor(() => {
      expect(screenOf()?.getAttribute('lang')).toBe('en');
    }, LOCALE_LOAD);
    expect(screenOf()?.classList.contains('mc-preview')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'اردو' }));
    await waitFor(() => {
      expect(screenOf()?.getAttribute('lang')).toBe('ur');
    }, LOCALE_LOAD);
    expect(screenOf()?.getAttribute('dir')).toBe('rtl');
    expect(screenOf()?.textContent).toBe('content');
    expect(document.documentElement.lang).toBe('te');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

describe('PublishBar', () => {
  it('notify switch with today’s quota and the big primary action', async () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    await renderUi(
      <PublishBar
        notify={{ checked: true, onChange, label: 'Notify followers', quota: '6 of 8 left today' }}
        actionLabel="Publish"
        onAction={onAction}
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Notify followers' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.body.textContent).toContain('6 of 8 left today');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('no switch for actions that never notify; busy and disabled ignore presses', async () => {
    const onAction = vi.fn();
    const { rerender } = await renderUi(<PublishBar actionLabel="Save" onAction={onAction} busy />);
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    rerender(<PublishBar actionLabel="Save" onAction={onAction} disabled />);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('a notify switch with no quota left is disabled', async () => {
    const onChange = vi.fn();
    await renderUi(
      <PublishBar
        notify={{ checked: false, onChange, label: 'Notify followers', quota: '0 of 8 left today', disabled: true }}
        actionLabel="Publish"
        onAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Notify followers' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('StepHeader', () => {
  it('says the step and marks done / current / todo dots (clamped)', async () => {
    const { container, rerender } = await renderUi(
      <StepHeader step={2} total={3} label="Step 2 of 3" title="Fill the details" />,
    );
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fill the details' })).toBeTruthy();
    const states = () => [...container.querySelectorAll('li')].map((dot) => dot.dataset['state']);
    expect(states()).toEqual(['done', 'current', 'todo']);
    expect(container.querySelector('ol')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<StepHeader step={9} total={3} label="Step 3 of 3" />);
    expect(states()).toEqual(['done', 'done', 'current']);
    rerender(<StepHeader step={0} total={3} label="Step 1 of 3" />);
    expect(states()).toEqual(['current', 'todo', 'todo']);
  });
});

describe('PublishSuccess', () => {
  it('a modal moment: the check, the title focused for screen readers, the message, Done and View', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const onDone = vi.fn();
    const onView = vi.fn();
    await renderUi(
      <PublishSuccess
        title="Published"
        message="1,240 people will be notified."
        doneLabel="Done"
        onDone={onDone}
        view={{ label: 'View', onPress: onView }}
      />,
      { reduced: true },
    );
    const dialog = screen.getByRole('dialog', { name: 'Published' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Published' }));
    expect(screen.getByRole('img', { name: 'Published' })).toBeTruthy();
    expect(dialog.textContent).toContain('1,240 people will be notified.');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(onView).toHaveBeenCalledOnce();
  });

  it('without a View action only Done shows', async () => {
    await renderUi(<PublishSuccess title="Saved" doneLabel="Done" onDone={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

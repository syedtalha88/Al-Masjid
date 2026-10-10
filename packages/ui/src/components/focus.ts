import type { KeyboardEvent } from 'react';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keeps Tab inside a modal (06 §6 Sheet "focus trap"). A native modal `<dialog>` makes the page inert, but
 * Tab past its last control moves focus to the browser's own UI; this wraps it to the first control instead
 * (and Shift+Tab from the first to the last), as the APG dialog pattern describes.
 *
 * @param event - the dialog's keydown event.
 * @param container - the dialog element.
 */
export function wrapTab(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return;
  const items = [...container.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => !element.closest('[inert]') && element.getClientRects().length > 0,
  );
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

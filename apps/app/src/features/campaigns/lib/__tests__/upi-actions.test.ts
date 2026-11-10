// @vitest-environment jsdom
// Donate Now and Save QR (07 A10, PHASE_05 T5.4): the link is clicked exactly as built; the QR sheet opens only when
// nothing took the link within 1.5 s; iOS saves through the share sheet, others download. Fake UPI data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openUpiLink, qrFilename, saveQrImage, UPI_FALLBACK_MS } from '../upi-actions.ts';

const LINK = 'upi://pay?pa=test.masjid@okbank&pn=Test%20Masjid&tn=Test%20roof&cu=INR';

let clicked: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  clicked = [];
  // jsdom cannot navigate: record what a click would open instead.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.getAttribute('href') ?? '');
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('openUpiLink', () => {
  it('opens exactly the built link and leaves no element behind', () => {
    openUpiLink(LINK, vi.fn());
    expect(clicked).toEqual([LINK]);
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('falls back to the QR sheet when the page stays in front for 1.5 s', () => {
    const onNoApp = vi.fn();
    openUpiLink(LINK, onNoApp);
    vi.advanceTimersByTime(UPI_FALLBACK_MS - 1);
    expect(onNoApp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onNoApp).toHaveBeenCalledOnce();
  });

  it('no fallback when a UPI app took over (page hidden or focus lost) or the screen went away', () => {
    const hidden = vi.fn();
    openUpiLink(LINK, hidden);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(UPI_FALLBACK_MS);
    expect(hidden).not.toHaveBeenCalled();

    const blurred = vi.fn();
    openUpiLink(LINK, blurred);
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(UPI_FALLBACK_MS);
    expect(blurred).not.toHaveBeenCalled();

    const cancelled = vi.fn();
    openUpiLink(LINK, cancelled)();
    vi.advanceTimersByTime(UPI_FALLBACK_MS);
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe('saveQrImage', () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const revoke = vi.fn();
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:qr');
    URL.revokeObjectURL = revoke;
  });

  it('iOS: shares the PNG file (Save Image); a closed share sheet is not an error', async () => {
    const share = vi.fn(() => Promise.resolve());
    const env = { navigator: { share, canShare: () => true }, document };
    expect(await saveQrImage(png, 'upi-qr-test.png', true, env)).toBe('shared');
    const [data] = share.mock.calls[0] as unknown as [{ files: File[] }];
    expect(data.files[0]?.name).toBe('upi-qr-test.png');
    expect(data.files[0]?.type).toBe('image/png');
    share.mockRejectedValueOnce(new DOMException('closed', 'AbortError'));
    expect(await saveQrImage(png, 'upi-qr-test.png', true, env)).toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('Android / desktop (or iOS without file sharing): downloads it', async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(
      await saveQrImage(png, 'upi-qr-test.png', false, { navigator: { share, canShare: () => true }, document }),
    ).toBe('saved');
    expect(await saveQrImage(png, 'upi-qr-test.png', true, { navigator: undefined, document })).toBe('saved');
    expect(share).not.toHaveBeenCalled();
    expect(clicked).toEqual(['blob:qr', 'blob:qr']);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:qr');
  });
});

describe('qrFilename', () => {
  it('keeps an ASCII name from the UPI ID user part', () => {
    expect(qrFilename('test.masjid@okbank')).toBe('upi-qr-test.masjid.png');
    expect(qrFilename('@okbank')).toBe('upi-qr-masjid.png');
    expect(qrFilename('a/b\\c<d>@x')).toBe('upi-qr-abcd.png');
  });
});

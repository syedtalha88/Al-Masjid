// @vitest-environment jsdom
import { NetworkError, ProblemError } from '@mc/shared/http';
import { describe, expect, it, vi } from 'vitest';

import {
  CameraError,
  cameraPermission,
  closeCamera,
  nativeQrDetector,
  openCamera,
  setTorch,
  torchSupported,
} from '../camera.ts';
import { codeInput } from '../EnterCodeSheet.tsx';
import { lookupFailure } from '../lookup.ts';

// T2.5 scan helpers (07 A4, 04 §6): native detector detection, camera permission/errors, torch, code entry, lookup
// failures. Real cameras and the WebAssembly reader are exercised by the e2e scan journey.

const ORIGIN = 'https://app.example.test';

describe('nativeQrDetector', () => {
  const withDetector = (formats: readonly string[], found: readonly string[] = []) => {
    class FakeDetector {
      static getSupportedFormats = () => Promise.resolve(formats);
      detect = () => Promise.resolve(found.map((rawValue) => ({ rawValue })));
    }
    return { BarcodeDetector: FakeDetector };
  };

  it('is null without BarcodeDetector or without QR support', async () => {
    expect(await nativeQrDetector({})).toBeNull();
    expect(await nativeQrDetector(withDetector(['ean_13']))).toBeNull();
    expect(
      await nativeQrDetector({ BarcodeDetector: { getSupportedFormats: () => Promise.reject(new Error('x')) } }),
    ).toBeNull();
  });

  it('returns the raw text of every QR in the frame', async () => {
    const detector = await nativeQrDetector(withDetector(['qr_code'], [`${ORIGIN}/m/TESTA001`, 'hello']));
    expect(await detector?.detect(document.createElement('video'))).toEqual([`${ORIGIN}/m/TESTA001`, 'hello']);
  });
});

describe('camera', () => {
  const nav = (overrides: Record<string, unknown>) => overrides as unknown as Navigator;

  it('reads the permission without asking; unknown when the browser cannot tell', async () => {
    const query = vi.fn().mockResolvedValue({ state: 'granted' });
    expect(await cameraPermission(nav({ permissions: { query } }))).toBe('granted');
    expect(query).toHaveBeenCalledWith({ name: 'camera' });
    expect(await cameraPermission(nav({ permissions: { query: () => Promise.reject(new TypeError('no')) } }))).toBe(
      'unknown',
    );
  });

  it('opens the back camera without audio', async () => {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    expect(await openCamera(nav({ mediaDevices: { getUserMedia } }))).toBe(stream);
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
    ['NotReadableError', 'busy'],
  ])('%s → %s', async (name, reason) => {
    const getUserMedia = () => Promise.reject(new DOMException('x', name));
    await expect(openCamera(nav({ mediaDevices: { getUserMedia } }))).rejects.toEqual(
      new CameraError(reason as 'busy'),
    );
  });

  it('is unavailable without mediaDevices (insecure context)', async () => {
    await expect(openCamera(nav({}))).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('torch: detected from the track capabilities, switched with a constraint', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const track = { getCapabilities: () => ({ torch: true }), applyConstraints, stop: vi.fn() };
    expect(torchSupported(track as unknown as MediaStreamTrack)).toBe(true);
    expect(torchSupported({ getCapabilities: () => ({}) } as unknown as MediaStreamTrack)).toBe(false);
    expect(torchSupported({} as unknown as MediaStreamTrack)).toBe(false);
    expect(torchSupported(undefined)).toBe(false);
    expect(await setTorch(track as unknown as MediaStreamTrack, true)).toBe(true);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    applyConstraints.mockRejectedValueOnce(new Error('busy'));
    expect(await setTorch(track as unknown as MediaStreamTrack, false)).toBe(false);
    closeCamera({ getTracks: () => [track] } as unknown as MediaStream);
    expect(track.stop).toHaveBeenCalled();
    closeCamera(null);
  });
});

describe('codeInput', () => {
  it('keeps letters and digits, upper-cased, at most 8', () => {
    expect(codeInput('test-a0', ORIGIN)).toBe('TESTA0');
    expect(codeInput(' te st a001 xyz', ORIGIN)).toBe('TESTA001');
  });

  it('a pasted follow link becomes its code; a foreign link is just characters', () => {
    expect(codeInput(`${ORIGIN}/m/TESTA001`, ORIGIN)).toBe('TESTA001');
    expect(codeInput('https://evil.example/m/TESTA001', ORIGIN)).toBe('HTTPSEVI');
  });
});

describe('lookupFailure', () => {
  const problem = (status: number, code: string) =>
    new ProblemError({ type: 'urn:x', title: 'x', status, code }, undefined);

  it('maps answers and network failures', () => {
    expect(lookupFailure(problem(404, 'MASJID_NOT_FOUND'), true)).toBe('not-found');
    expect(lookupFailure(problem(400, 'VALIDATION_FAILED'), true)).toBe('not-found');
    expect(lookupFailure(new NetworkError('failed'), true)).toBe('offline');
    expect(lookupFailure(problem(500, 'INTERNAL_ERROR'), false)).toBe('offline');
    expect(lookupFailure(problem(500, 'INTERNAL_ERROR'), true)).toBe('failed');
    expect(lookupFailure(new NetworkError('aborted'), true)).toBe('failed');
  });
});

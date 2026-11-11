// The UPI QR scanner in a sheet (07 B8 / B19, DECISIONS #147): the camera reads a QR with the phone's built-in reader
// only (no WebAssembly fallback on the admin origin — its CSP is unchanged); every text goes through `onText`, which
// says whether it was a UPI payment QR. Used for the masjid's own UPI details and for a needy person's.
import { useTranslation } from '@mc/i18n/react';
import { Button, Sheet } from '@mc/ui/components';
import { nativeQrDetector, useScanner } from '@mc/ui/scanner';
import { useEffect, useRef, useState } from 'react';

/** Whether this phone can scan here: only with a built-in QR reader (DECISIONS #147). */
export function useCanScanUpi(): boolean {
  const [canScan, setCanScan] = useState(false);
  useEffect(() => {
    let alive = true;
    void nativeQrDetector().then((detector) => {
      if (alive) setCanScan(detector !== null);
    });
    return () => {
      alive = false;
    };
  }, []);
  return canScan;
}

export interface UpiScanSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Sheet title ("Scan the masjid's UPI QR"). */
  readonly title: string;
  /** What to point the camera at. */
  readonly hint: string;
  /** Receives every text the camera reads; returns whether it was a UPI payment QR. */
  readonly onText: (text: string) => boolean;
}

export function UpiScanSheet({ open, onClose, title, hint, onText }: UpiScanSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open ? <Camera hint={hint} onText={onText} /> : null}
    </Sheet>
  );
}

function Camera({ hint, onText }: { readonly hint: string; readonly onText: (text: string) => boolean }) {
  const { t } = useTranslation('admin');
  const video = useRef<HTMLVideoElement>(null);
  const [wrong, setWrong] = useState(false);
  const scanner = useScanner({
    video,
    paused: false,
    detector: nativeQrDetector,
    onText: (text) => {
      setWrong(!onText(text));
    },
  });
  useEffect(() => {
    if (video.current) video.current.srcObject = scanner.stream;
  }, [scanner.stream]);
  const blocked = scanner.state === 'denied' || scanner.state === 'unavailable' || scanner.state === 'busy';
  return (
    <div className="flex flex-col gap-4 pb-4" data-payment-scanner={scanner.state}>
      <p className="type-callout text-text-secondary">{hint}</p>
      {blocked ? (
        <p className="type-body text-text">{t('payment.scanUnavailable')}</p>
      ) : (
        <div className="relative aspect-square overflow-hidden rounded-md bg-surface-muted">
          {/* muted + playsInline + autoPlay: plays as soon as the stream is attached (no audio track is asked for). */}
          <video ref={video} className="size-full object-cover" muted playsInline autoPlay aria-hidden />
        </div>
      )}
      {scanner.state === 'ask' ? (
        <Button size="lg" fullWidth onPress={scanner.start}>
          {t('payment.scanStart')}
        </Button>
      ) : null}
      {wrong ? (
        <p className="type-callout text-danger" aria-live="polite">
          {t('payment.scanNotUpi')}
        </p>
      ) : null}
    </div>
  );
}

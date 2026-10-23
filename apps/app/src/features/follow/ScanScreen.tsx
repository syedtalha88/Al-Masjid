// A4 Scan (07 A4, 08 §5.8, 04 §6) — full-screen modal. Camera view with a rounded scan window (breathing corner
// brackets, sweeping line, dimmed surroundings), close and torch at the top, "Enter code instead" at the bottom.
// A Masjid Connect QR (`https://<this origin>/m/<code>` or a bare code) → haptic, brackets snap in and turn green →
// preview sheet. Anything else → shake + "not a Masjid Connect QR code", no navigation. Following → Masjid Detail.
import { followCodeFromScan } from '@mc/domain/follow-code';
import { useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import type { MasjidSummary } from '@mc/shared/contracts/public';
import { Button, IconButton } from '@mc/ui/components';
import { CameraIcon, FlashlightIcon, KeyboardIcon, WarningIcon } from '@mc/ui/icons';
import { breathe, haptic, shake, snapTo, sweep, useMotionPrefs } from '@mc/ui/motion';
import { CloseIcon, useNavigator, useScreen } from '@mc/ui/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { useAppData } from '../../lib/data.tsx';
import { EnterCodeSheet } from './EnterCodeSheet.tsx';
import { FollowSheet } from './FollowSheet.tsx';
import { lookupFailure, resolveKey } from './lookup.ts';
import { useScanner } from './useScanner.ts';

/**
 * A QR just handled — refused, not found, or its sheet cancelled — is ignored this long while it stays in view, so the
 * message can be read and Cancel is not undone by the poster still in front of the camera, ms.
 */
const COOLDOWN_MS = 2500;
/** Bracket scale when a code is found ("snap inward", 08 §5.8). */
const SNAP_SCALE = 0.9;

export function ScanScreen() {
  const { t } = useTranslation('follow');
  const { t: tc } = useTranslation();
  const { t: te } = useTranslation('errors');
  const navigator = useNavigator();
  const { search } = useScreen();
  const { api } = useAppData();
  const queryClient = useQueryClient();
  const { reduced } = useMotionPrefs();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const [codeOpen, setCodeOpen] = useState(search['enter'] === 'code');
  const [preview, setPreview] = useState<MasjidSummary | null>(null);
  const [found, setFound] = useState(false);
  const [message, setMessage] = useState<{ readonly text: string; readonly tone: 'info' | 'error' } | null>(null);
  const handled = useRef<{ text: string; at: number } | null>(null);
  const cooldown = (text: string) => {
    handled.current = { text, at: Date.now() };
  };

  const onText = (text: string) => {
    if (found) return;
    const previous = handled.current;
    if (previous?.text === text && Date.now() - previous.at < COOLDOWN_MS) return;
    const code = followCodeFromScan(text, window.location.origin);
    if (!code) {
      cooldown(text);
      haptic('warning');
      setMessage({ text: t('scan.invalid', { app: BRAND.name }), tone: 'error' });
      if (frame.current && !reduced) shake(frame.current);
      return;
    }
    setFound(true);
    haptic('success');
    setMessage({ text: t('scan.found'), tone: 'info' });
    void queryClient
      .query({
        queryKey: resolveKey(code),
        queryFn: ({ signal }) => api.resolve(code, signal),
        staleTime: 60_000,
        retry: false,
      })
      .then((masjid) => {
        lastScanned.current = text;
        setPreview(masjid);
      })
      .catch((error: unknown) => {
        cooldown(text);
        const failure = lookupFailure(error);
        setMessage({
          text:
            failure === 'not-found'
              ? te('MASJID_NOT_FOUND')
              : failure === 'offline'
                ? te('NETWORK')
                : te('INTERNAL_ERROR'),
          tone: 'error',
        });
        setFound(false);
      });
  };

  /** The QR text behind the open preview (cancelling cools it down). */
  const lastScanned = useRef<string | null>(null);

  const scanner = useScanner({ video, paused: found || codeOpen || preview !== null, onText });

  // Breathing brackets + sweeping line while scanning (off with reduced motion); snap in + green when found.
  useEffect(() => {
    const brackets = frame.current?.querySelector<HTMLElement>('[data-brackets]');
    if (!brackets || scanner.state !== 'scanning') return;
    if (found) {
      if (reduced) return;
      const snap = snapTo(brackets, SNAP_SCALE);
      return () => {
        snap.stop();
      };
    }
    if (reduced) return;
    const effects = [breathe(brackets)];
    if (line.current && frame.current) effects.push(sweep(line.current, frame.current.offsetHeight - 4));
    return () => {
      for (const effect of effects) effect.stop();
    };
  }, [scanner.state, found, reduced]);

  const openMasjid = (masjidId: string) => {
    setPreview(null);
    navigator.push(`/masjid/${masjidId}`);
  };

  const showCamera = scanner.state === 'scanning' || scanner.state === 'starting';

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-primary-900 text-on-primary">
      <video
        ref={(element) => {
          video.current = element;
          // muted + playsInline + autoPlay: plays as soon as the stream is attached, no gesture needed.
          if (element && element.srcObject !== scanner.stream) element.srcObject = scanner.stream;
        }}
        aria-hidden
        muted
        playsInline
        autoPlay
        className={`absolute inset-0 size-full object-cover ${showCamera ? '' : 'hidden'}`}
      />
      <header className="relative z-10 flex items-center justify-between px-screen pt-safe">
        <IconButton
          label={tc('nav.close')}
          variant="onImageBare"
          icon={<CloseIcon />}
          onPress={() => {
            navigator.back();
          }}
        />
        <h1 data-screen-title tabIndex={-1} className="type-headline outline-none">
          {t('scan.title')}
        </h1>
        {scanner.torchAvailable ? (
          <IconButton
            label={t('scan.torch')}
            aria-pressed={scanner.torchOn}
            variant={scanner.torchOn ? 'tinted' : 'onImageBare'}
            icon={<FlashlightIcon />}
            onPress={scanner.toggleTorch}
          />
        ) : (
          <span className="size-(--mc-hit)" />
        )}
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-screen">
        {showCamera ? (
          <>
            <div ref={frame} className="relative size-64 rounded-xl shadow-[0_0_0_100vmax_var(--color-overlay)]">
              <Brackets found={found} />
              {found || reduced ? null : (
                <div ref={line} aria-hidden className="absolute inset-x-4 top-0 h-1 rounded-full bg-mint-200/80" />
              )}
            </div>
            <p
              role="status"
              className={`min-h-12 max-w-xs text-center type-callout ${message?.tone === 'error' ? 'rounded-md bg-danger px-3 py-2' : ''}`}
            >
              {scanner.state === 'starting' ? t('scan.starting') : (message?.text ?? t('scan.hint'))}
            </p>
          </>
        ) : (
          <ScannerNotice state={scanner.state} onStart={scanner.start} />
        )}
      </div>

      <footer className="relative z-10 px-screen pt-4 pb-safe">
        <Button
          size="lg"
          variant="secondary"
          fullWidth
          leadingIcon={<KeyboardIcon />}
          onPress={() => {
            setCodeOpen(true);
          }}
          className="mb-4"
        >
          {t('scan.enterCode')}
        </Button>
      </footer>

      <EnterCodeSheet
        open={codeOpen}
        onClose={() => {
          setCodeOpen(false);
        }}
        onFound={(masjid) => {
          setCodeOpen(false);
          setPreview(masjid);
        }}
      />
      <FollowSheet
        masjid={preview}
        onClose={() => {
          if (lastScanned.current !== null) cooldown(lastScanned.current);
          lastScanned.current = null;
          setPreview(null);
          setFound(false);
          setMessage(null);
        }}
        onOpen={openMasjid}
        onManage={() => {
          setPreview(null);
          navigator.selectTab('masjids');
        }}
      />
    </div>
  );
}

/** Four rounded corner brackets (white; green when a code is found). */
function Brackets({ found }: { readonly found: boolean }) {
  const color = found ? 'border-primary-500' : 'border-on-primary';
  const corner = `absolute size-10 border-4 transition-colors ${color}`;
  return (
    <div data-brackets aria-hidden className="absolute inset-0">
      <span className={`${corner} start-0 top-0 rounded-ss-xl border-e-0 border-b-0`} />
      <span className={`${corner} end-0 top-0 rounded-se-xl border-s-0 border-b-0`} />
      <span className={`${corner} start-0 bottom-0 rounded-es-xl border-e-0 border-t-0`} />
      <span className={`${corner} end-0 bottom-0 rounded-ee-xl border-s-0 border-t-0`} />
    </div>
  );
}

/** Instead of the camera: ask, blocked, unavailable or failed (07 A4 permission states). */
function ScannerNotice({ state, onStart }: { readonly state: string; readonly onStart: () => void }) {
  const { t } = useTranslation('follow');
  const { t: tc } = useTranslation();
  const card = (icon: ReactNode, title: string, body: string, action?: ReactNode) => (
    <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl bg-surface p-6 text-center text-text">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-mint-50 text-primary-700">
        {icon}
      </span>
      <h2 className="type-title2">{title}</h2>
      <p className="type-body text-text-secondary">{body}</p>
      {action}
    </div>
  );
  switch (state) {
    case 'ask':
      return card(
        <CameraIcon size={28} />,
        t('scan.permission.title'),
        t('scan.permission.body'),
        <Button size="lg" fullWidth onPress={onStart} className="mt-2">
          {t('scan.permission.allow')}
        </Button>,
      );
    case 'denied':
      return card(<CameraIcon size={28} />, t('scan.denied.title'), t('scan.denied.body'));
    case 'unavailable':
      return card(<KeyboardIcon size={28} />, t('scan.unavailable.title'), t('scan.unavailable.body'));
    case 'busy':
      return card(
        <WarningIcon size={28} />,
        t('scan.busy.title'),
        t('scan.busy.body'),
        <Button size="lg" variant="outline" fullWidth onPress={onStart} className="mt-2">
          {tc('appError.retry')}
        </Button>,
      );
    default:
      // Checking: nothing to say yet (a few ms).
      return <div className="size-64" />;
  }
}

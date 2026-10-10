import { useTranslation } from '@mc/i18n/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { DownloadIcon, PlusSquareIcon, ShareIosIcon } from '../icons/glyphs.tsx';
import { MasjidGlyph, MasjidTile } from '../icons/MasjidTile.tsx';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';

/** Chromium's install prompt event (not in the TS DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

/** Validates an untrusted event before we call its methods. */
function isInstallPrompt(event: Event): event is BeforeInstallPromptEvent {
  return 'prompt' in event && typeof event.prompt === 'function' && 'userChoice' in event;
}

export interface InstallPromptState {
  /** The browser offered installation (Android Chrome) and the app is not installed yet. */
  readonly canInstall: boolean;
  /** Shows the browser's install dialog. @returns whether the user accepted. */
  readonly install: () => Promise<boolean>;
}

/**
 * Captures `beforeinstallprompt` (Android / desktop Chromium) so the app can offer "Install app" at a good
 * moment (07 Onboarding step 6) instead of the browser's mini-infobar.
 */
export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      if (!isInstallPrompt(event)) return;
      event.preventDefault();
      setDeferred(event);
    };
    const onInstalled = () => {
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome === 'accepted';
  }, [deferred]);

  return { canInstall: deferred !== null, install };
}

export interface InstallPromptProps {
  /** App name from `@mc/shared/brand` (the only place the name lives). */
  readonly appName: string;
  readonly onInstall: () => void;
  readonly onDismiss: () => void;
  /** Install in progress. */
  readonly loading?: boolean;
}

/** Android install card (06 §6 InstallPrompt): app tile, why to install, "Install app" + "Not now". */
export function InstallPrompt({ appName, onInstall, onDismiss, loading = false }: InstallPromptProps) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <MasjidTile />
        <div className="min-w-0">
          <h2 className="type-headline text-text">{t('ui.install.title', { app: appName })}</h2>
          <p className="type-footnote text-text-secondary">{t('ui.install.body')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Button fullWidth leadingIcon={<DownloadIcon size={20} />} loading={loading} onPress={onInstall}>
          {t('ui.install.action')}
        </Button>
        <Button fullWidth variant="ghost" onPress={onDismiss}>
          {t('ui.notNow')}
        </Button>
      </div>
    </Card>
  );
}

/** Seconds per highlighted step in the looping guide. */
const STEP_MS = 2200;

export interface IosInstallGuideProps {
  readonly appName: string;
  readonly onDismiss: () => void;
}

/**
 * iOS Safari "Add to Home Screen" guide (06 §6, 07 Onboarding): three steps — Share → Add to Home Screen →
 * open from the Home Screen — highlighted in a gentle loop (static with reduced motion). iOS offers no install
 * API, so this only explains.
 */
export function IosInstallGuide({ appName, onDismiss }: IosInstallGuideProps) {
  const { t } = useTranslation();
  const { reduced } = useMotionPrefs();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      setActive((step) => (step + 1) % 3);
    }, STEP_MS);
    return () => {
      clearInterval(timer);
    };
  }, [reduced]);

  const steps: readonly { readonly icon: ReactNode; readonly text: string }[] = [
    { icon: <ShareIosIcon size={24} />, text: t('ui.iosInstall.share') },
    { icon: <PlusSquareIcon size={24} />, text: t('ui.iosInstall.add') },
    { icon: <MasjidGlyph size={24} />, text: t('ui.iosInstall.open', { app: appName }) },
  ];

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="type-headline text-text">{t('ui.iosInstall.title', { app: appName })}</h2>
      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => {
          const current = reduced || index === active;
          return (
            <li
              key={step.text}
              aria-current={!reduced && index === active ? 'step' : undefined}
              className={`flex items-center gap-3 rounded-md p-3 transition-state ${
                current ? 'bg-mint-50 text-primary-700' : 'bg-surface text-text-secondary'
              }`}
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface shadow-e1">
                {step.icon}
              </span>
              <span className="type-callout">
                <span className="me-1 font-semibold tabular-nums">{String(index + 1)}.</span>
                {step.text}
              </span>
            </li>
          );
        })}
      </ol>
      <Button fullWidth variant="ghost" onPress={onDismiss}>
        {t('ui.notNow')}
      </Button>
    </Card>
  );
}

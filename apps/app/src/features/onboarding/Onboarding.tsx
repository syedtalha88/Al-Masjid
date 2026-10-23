// A1 Onboarding (07 A1, 05 §2, 08 §5.11) — first launch only. Pages: welcome → language → brother/sister → privacy at
// a glance (records the accepted privacy version and starts device registration; offline it continues and registers
// later) → add your first masjid (skipped when the app was opened from a /m/:code link) → install (only when not
// installed and the platform can install). The Notifications page arrives with push (Phase 4). Lazy-loaded: returning
// users never download it.
import { loadLegalDoc } from '@mc/i18n/legal';
import { type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { MosqueIllustration, QrPosterIllustration } from '@mc/ui';
import {
  Button,
  IconButton,
  IconCircle,
  InfoNote,
  IosInstallGuide,
  Pager,
  RadioCardGroup,
  Sheet,
  Tag,
} from '@mc/ui/components';
import {
  CaretLeftIcon,
  DeviceMobileIcon,
  DownloadIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@mc/ui/icons';
import { crossfadeIn, drawStrokesIn, useMotionPrefs } from '@mc/ui/motion';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { configQuery } from '../../lib/api/queries.ts';
import { useAppData, useDeviceState } from '../../lib/data.tsx';
import { promptInstall, useCanInstall } from '../../lib/install.ts';
import { isStandalone, platformKind } from '../../lib/platform.ts';

/** Where the app goes after onboarding (the scanner / code entry from page 5, else Home). */
export type OnboardingNext = '/' | '/scan' | '/scan?enter=code';

type PageId = 'welcome' | 'language' | 'audience' | 'privacy' | 'masjid' | 'install';

export interface OnboardingProps {
  /** Opened from a follow link: page 5 is skipped (the masjid is followed after onboarding). */
  readonly arrivedWithCode: boolean;
  readonly onFinished: (next: OnboardingNext) => void;
}

export default function Onboarding({ arrivedWithCode, onFinished }: OnboardingProps) {
  const { t, ready } = useTranslation('onboarding');
  const { store, sync } = useAppData();
  const state = useDeviceState();
  const canInstall = useCanInstall();
  const [index, setIndex] = useState(0);
  const [next, setNext] = useState<OnboardingNext>('/');
  const [registration, setRegistration] = useState<'idle' | 'deferred'>('idle');
  const root = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPrefs();
  const { locale } = useLocale();

  // Loaded while online (the app just opened): "Continue" on the privacy page must work offline too, and on a first
  // visit the service worker does not control the page yet, so nothing is cached for later.
  const privacyDoc = useQuery({
    queryKey: ['legal', 'privacy', locale],
    queryFn: () => loadLegalDoc('privacy', locale),
    staleTime: Number.POSITIVE_INFINITY,
  });
  useEffect(() => {
    void import('../../lib/device/sync.ts');
    void import('../../lib/turnstile.ts');
  }, []);

  const platform = platformKind();
  const showInstall = !isStandalone() && (platform === 'ios' || canInstall);
  const pages = useMemo<PageId[]>(
    () => [
      'welcome',
      'language',
      'audience',
      'privacy',
      ...(arrivedWithCode ? [] : (['masjid'] as const)),
      ...(showInstall ? (['install'] as const) : []),
    ],
    [arrivedWithCode, showInstall],
  );

  // 08 §5.11: a language change crossfades the content to hide the LTR ↔ RTL flip.
  const firstLocale = useRef(locale);
  useEffect(() => {
    const node = root.current;
    if (!node || firstLocale.current === locale) return;
    firstLocale.current = locale;
    const effect = crossfadeIn(node);
    return () => {
      effect.stop();
    };
  }, [locale, reduced]);

  const finish = async (target: OnboardingNext) => {
    await store.update((current) => ({ ...current, onboardedAt: new Date().toISOString() }));
    onFinished(target);
  };
  const advance = () => {
    if (index + 1 < pages.length) setIndex(index + 1);
    else void finish(next);
  };
  const canAdvance = (from: number) => {
    const page = pages[from];
    if (page === 'audience') return state.audiencePref !== undefined;
    if (page === 'privacy') return state.privacyVersion !== undefined;
    return true;
  };

  const acceptPrivacy = async () => {
    const version = privacyDoc.data?.version ?? (await loadLegalDoc('privacy', locale)).version;
    await store.update((current) => ({ ...current, privacyVersion: version }));
    // Registration runs in the background; offline it is deferred and retried (07 A1).
    void import('../../lib/device/sync.ts')
      .then((module) => module.ensureRegistered(sync))
      .then((result) => {
        if (result === 'deferred') setRegistration('deferred');
      })
      .catch(() => {
        setRegistration('deferred');
      });
    advance();
  };

  const page = (id: PageId | undefined) => {
    switch (id) {
      case 'welcome':
        return <WelcomePage onStart={advance} />;
      case 'language':
        return <LanguagePage onNext={advance} />;
      case 'audience':
        return <AudiencePage onNext={advance} />;
      case 'privacy':
        return <PrivacyPage onContinue={() => void acceptPrivacy()} />;
      case 'masjid':
        return (
          <MasjidPage
            offline={registration === 'deferred'}
            onChoose={(target) => {
              setNext(target);
              if (index + 1 < pages.length) setIndex(index + 1);
              else void finish(target);
            }}
          />
        );
      case 'install':
        return <InstallPage offline={registration === 'deferred'} onDone={() => void finish(next)} />;
      case undefined:
        return null;
    }
  };

  // The namespace loads with this chunk; never show raw keys.
  if (!ready) return <div className="h-dvh bg-bg" aria-busy />;

  return (
    <div ref={root} className="flex h-dvh flex-col bg-bg pt-safe">
      <header className="flex min-h-14 items-center gap-2 px-screen">
        <div className="w-11">
          {index > 0 ? (
            <IconButton
              label={t('back')}
              icon={<CaretLeftIcon size={24} className="rtl:-scale-x-100" />}
              onPress={() => {
                setIndex(index - 1);
              }}
            />
          ) : null}
        </div>
        <ProgressDots
          count={pages.length}
          index={index}
          label={t('progress', { current: index + 1, total: pages.length })}
        />
        <div className="w-11" />
      </header>
      <Pager
        className="min-h-0 flex-1"
        pageCount={pages.length}
        index={index}
        onIndexChange={setIndex}
        canAdvance={canAdvance}
      >
        {(position) => page(pages[position])}
      </Pager>
    </div>
  );
}

/** Progress dots: the current one is elongated (scaleX on a pill — transform only, 08 §4). */
function ProgressDots({
  count,
  index,
  label,
}: {
  readonly count: number;
  readonly index: number;
  readonly label: string;
}) {
  return (
    <div role="img" aria-label={label} className="flex flex-1 items-center justify-center gap-1.5">
      {Array.from({ length: count }, (_, dot) => (
        <span
          key={dot}
          className={`h-1.5 w-1.5 rounded-full transition-indicator ${
            dot === index ? 'origin-center scale-x-[3] bg-primary-700' : dot < index ? 'bg-primary-500' : 'bg-border'
          }`}
        />
      ))}
    </div>
  );
}

/** One onboarding page: illustration (parallax), content, primary actions pinned to the bottom (safe area). */
function Page({
  illustration,
  title,
  children,
  actions,
}: {
  readonly illustration?: ReactNode;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex h-full flex-col">
      <div className="scroller min-h-0 flex-1 px-screen pb-4">
        {illustration ? (
          <div data-parallax className="flex justify-center pt-6 pb-2">
            {illustration}
          </div>
        ) : null}
        <h1 className="pt-4 text-center type-large-title text-text">{title}</h1>
        {children}
      </div>
      <div className="flex flex-col gap-2 px-screen pt-3 pb-safe">
        <div className="flex flex-col gap-2 pb-4">{actions}</div>
      </div>
    </section>
  );
}

function WelcomePage({ onStart }: { readonly onStart: () => void }) {
  const { t } = useTranslation('onboarding');
  const art = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPrefs();
  // 08 §5.11: the mosque line art draws itself in once (1.2 s).
  useEffect(() => {
    if (reduced || !art.current) return;
    // The first circle is the mint backdrop, not a stroke.
    const strokes = [...art.current.querySelectorAll<SVGGeometryElement>('path, rect, circle')].slice(1);
    const effect = drawStrokesIn(strokes);
    return () => {
      effect.stop();
    };
  }, [reduced]);
  return (
    <Page
      illustration={
        <div ref={art}>
          <MosqueIllustration width={220} />
        </div>
      }
      title={t('welcome.title')}
      actions={
        <Button size="lg" fullWidth onPress={onStart}>
          {t('welcome.start')}
        </Button>
      }
    >
      <p className="pt-2 text-center type-body text-text-secondary">{t('welcome.body')}</p>
    </Page>
  );
}

function LanguagePage({ onNext }: { readonly onNext: () => void }) {
  const { t, i18n } = useTranslation('onboarding');
  const { locale, setLocale } = useLocale();
  const { store } = useAppData();
  const [loaded, setLoaded] = useState(false);
  // The title in all four scripts at once (07 A1): every language's `common` catalogue is loaded for this page.
  useEffect(() => {
    void i18n.loadLanguages([...LOCALES]).then(() => {
      setLoaded(true);
    });
  }, [i18n]);
  const titles = LOCALES.map((code) => ({
    code,
    text: loaded ? i18n.getFixedT(code, 'common')('language.choose') : '',
  }));
  const choose = async (next: Locale) => {
    await setLocale(next);
    await store.update((current) => ({ ...current, locale: next }));
  };
  return (
    <Page
      title={titles.find((title) => title.code === locale)?.text ?? ''}
      actions={
        <Button size="lg" fullWidth onPress={onNext}>
          {t('next')}
        </Button>
      }
    >
      <div aria-hidden className="flex flex-col items-center gap-0.5 pt-2 pb-5">
        {titles
          .filter((title) => title.code !== locale && title.text !== '')
          .map((title) => (
            <span key={title.code} lang={title.code} dir="auto" className="type-footnote text-text-tertiary">
              {title.text}
            </span>
          ))}
      </div>
      <RadioCardGroup
        legend={titles.find((title) => title.code === locale)?.text ?? NATIVE_NAME[locale]}
        hideLegend
        name="language"
        value={locale}
        options={LOCALES.map((code) => ({ value: code, title: NATIVE_NAME[code], lang: code }))}
        onChange={(code) => void choose(code)}
      />
      <p className="pt-4 text-center type-footnote text-text-tertiary">{t('language.hint')}</p>
    </Page>
  );
}

function AudiencePage({ onNext }: { readonly onNext: () => void }) {
  const { t } = useTranslation('onboarding');
  const { store } = useAppData();
  const { audiencePref } = useDeviceState();
  return (
    <Page
      title={t('audience.title')}
      actions={
        <Button size="lg" fullWidth disabled={audiencePref === undefined} onPress={onNext}>
          {t('next')}
        </Button>
      }
    >
      <RadioCardGroup
        className="pt-6"
        legend={t('audience.title')}
        hideLegend
        name="audience"
        value={audiencePref ?? null}
        options={[
          {
            value: 'brothers',
            title: t('audience.brother'),
            leading: (
              <IconCircle size={48}>
                <UserCircleIcon size={26} />
              </IconCircle>
            ),
          },
          {
            value: 'sisters',
            title: t('audience.sister'),
            leading: (
              <IconCircle size={48} tone="rose">
                <UserCircleIcon size={26} />
              </IconCircle>
            ),
          },
        ]}
        onChange={(value) => void store.update((current) => ({ ...current, audiencePref: value }))}
      />
      <p className="pt-4 type-footnote text-text-secondary">{t('audience.help')}</p>
    </Page>
  );
}

function PrivacyPage({ onContinue }: { readonly onContinue: () => void }) {
  const { t } = useTranslation('onboarding');
  const [sheet, setSheet] = useState<'policy' | 'grievance' | null>(null);
  const rows = [
    { icon: <UserCircleIcon size={24} />, text: t('privacy.noAccount') },
    { icon: <MapPinIcon size={24} />, text: t('privacy.location') },
    { icon: <DeviceMobileIcon size={24} />, text: t('privacy.stored') },
  ];
  return (
    <Page
      illustration={
        <IconCircle size={56}>
          <ShieldCheckIcon size={30} />
        </IconCircle>
      }
      title={t('privacy.title')}
      actions={
        <Button size="lg" fullWidth onPress={onContinue}>
          {t('next')}
        </Button>
      }
    >
      <ul className="flex flex-col gap-4 pt-6">
        {rows.map((row) => (
          <li key={row.text} className="flex items-start gap-3">
            <IconCircle>{row.icon}</IconCircle>
            <span className="pt-2.5 type-callout text-text">{row.text}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 pt-6">
        <Button
          variant="ghost"
          onPress={() => {
            setSheet('policy');
          }}
        >
          {t('privacy.policy')}
        </Button>
        <Button
          variant="ghost"
          onPress={() => {
            setSheet('grievance');
          }}
        >
          {t('privacy.grievance')}
        </Button>
      </div>
      <PrivacyPolicySheet
        open={sheet === 'policy'}
        onClose={() => {
          setSheet(null);
        }}
      />
      <GrievanceSheet
        open={sheet === 'grievance'}
        onClose={() => {
          setSheet(null);
        }}
      />
    </Page>
  );
}

/** The full (draft) privacy notice — legal reader with the draft badge (05 §10); full reader in Settings (A15). */
function PrivacyPolicySheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const { t } = useTranslation('onboarding');
  const { locale } = useLocale();
  const doc = useQuery({
    queryKey: ['legal', 'privacy', locale],
    queryFn: () => loadLegalDoc('privacy', locale),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <Sheet open={open} onClose={onClose} title={t('privacy.policy')} snaps={['full']}>
      {doc.data?.status === 'draft' ? (
        <Tag tone="danger" className="mb-3">
          {t('privacy.draft')}
        </Tag>
      ) : null}
      <ul
        lang={doc.data && locale !== 'en' ? 'en' : undefined}
        className="flex list-disc flex-col gap-3 ps-5 pb-6 type-callout text-text"
      >
        {doc.data?.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Grievance Officer details from `/config` (05 §3 — they change without deploys). */
function GrievanceSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const { t } = useTranslation('onboarding');
  const { api } = useAppData();
  const config = useQuery({ ...configQuery(api), enabled: open });
  const officer = config.data?.grievanceOfficer;
  return (
    <Sheet open={open} onClose={onClose} title={t('privacy.grievance')}>
      {officer ? (
        <dl className="flex flex-col gap-1 pb-6 type-callout text-text">
          <dt className="sr-only">{t('privacy.grievance')}</dt>
          <dd className="type-headline">{officer.name}</dd>
          <dd dir="ltr" className="text-start">
            {officer.email}
          </dd>
          <dd>{officer.address}</dd>
          <dd>{officer.city}</dd>
        </dl>
      ) : (
        <p className="pb-6 type-callout text-text-secondary">{t('privacy.offline')}</p>
      )}
    </Sheet>
  );
}

function MasjidPage({
  offline,
  onChoose,
}: {
  readonly offline: boolean;
  readonly onChoose: (next: OnboardingNext) => void;
}) {
  const { t } = useTranslation('onboarding');
  return (
    <Page
      illustration={<QrPosterIllustration width={200} />}
      title={t('masjid.title')}
      actions={
        <>
          <Button
            size="lg"
            fullWidth
            onPress={() => {
              onChoose('/scan');
            }}
          >
            {t('masjid.scan')}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            onPress={() => {
              onChoose('/scan?enter=code');
            }}
          >
            {t('masjid.code')}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onPress={() => {
              onChoose('/');
            }}
          >
            {t('masjid.later')}
          </Button>
        </>
      }
    >
      <p className="pt-2 text-center type-body text-text-secondary">{t('masjid.body')}</p>
      {offline ? <InfoNote className="mt-6">{t('privacy.offline')}</InfoNote> : null}
    </Page>
  );
}

function InstallPage({ offline, onDone }: { readonly offline: boolean; readonly onDone: () => void }) {
  const { t } = useTranslation('onboarding');
  const { t: tc } = useTranslation();
  const canInstall = useCanInstall();
  const [installing, setInstalling] = useState(false);
  const ios = platformKind() === 'ios';
  return (
    <Page
      title={t('install.title')}
      actions={
        <>
          {canInstall ? (
            <Button
              size="lg"
              fullWidth
              loading={installing}
              leadingIcon={<DownloadIcon size={20} />}
              onPress={() => {
                setInstalling(true);
                void promptInstall().finally(() => {
                  setInstalling(false);
                  onDone();
                });
              }}
            >
              {tc('ui.install.action')}
            </Button>
          ) : null}
          <Button variant={canInstall ? 'ghost' : 'primary'} size={canInstall ? 'md' : 'lg'} fullWidth onPress={onDone}>
            {canInstall ? tc('ui.notNow') : t('next')}
          </Button>
        </>
      }
    >
      <p className="pt-2 pb-6 text-center type-body text-text-secondary">{t('install.body')}</p>
      {ios ? <IosInstallGuide appName={BRAND.name} onDismiss={onDone} /> : null}
      {offline ? <InfoNote className="mt-6">{t('privacy.offline')}</InfoNote> : null}
    </Page>
  );
}

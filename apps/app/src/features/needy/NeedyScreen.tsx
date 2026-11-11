// A23 Help the needy (07 A23, 00 §4.14, DECISIONS #104, PHASE_05 T5.8): the people this masjid has verified as in
// need, least-funded first — category, first name or initials, reason, "₹1,200 of ₹3,000" with a progress bar, the
// masjid's "Zakat-eligible" tag and a filter for it. Tap → a sheet with the details, "Pay with UPI" (a `upi://pay` link
// straight to the person, no amount; the QR sheet when no UPI app took it), "Show UPI QR", the payee name and UPI ID
// with Copy, and "Amount received is reported by the masjid." The app never handles money (CLAUDE.md §2.2). The list is
// versioned like the feed: a person who reaches their cap is gone with the next version. Kept offline once opened.
import { wallClockInZone } from '@mc/domain/time';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { ltrIsolate } from '@mc/i18n/template-args';
import { BRAND } from '@mc/shared/brand';
import type { Beneficiary } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import {
  Button,
  ChipGroup,
  EmptyState,
  IconButton,
  IconCircle,
  InfoNote,
  PressableCard,
  ProgressBar,
  Sheet,
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  Tag,
  useToast,
} from '@mc/ui/components';
import {
  BookOpenIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  HeartbeatIcon,
  HeartIcon,
  QrCodeIcon,
  RefreshIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '@mc/ui/icons';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { needyQuery } from '../../lib/api/queries.ts';
import { useAppData } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { onReturnFromUpi, openUpiLink, UPI_FALLBACK_MS } from '../campaigns/lib/upi-actions.ts';
import { ContentGate } from '../content/components/ContentGate.tsx';
import { useMasjidDetail } from '../masjid/hooks/useMasjidDetail.ts';
import { needyLink, needyProgress, peopleToShow } from './lib/needy-view.ts';

const loadQrSheet = () => import('../campaigns/UpiQrSheet.tsx');
const UpiQrSheet = lazy(loadQrSheet);
// My zakat's "Add payment" (07 A24) — loaded only when someone answers "Log it".
const ZakatLogSheet = lazy(() =>
  import('../zakat/components/ZakatLogSheet.tsx').then((module) => ({ default: module.ZakatLogSheet })),
);

/** How long the copy button shows its check (08 §5.7). */
const COPIED_MS = 1500;

type Filter = 'all' | 'zakat';

export function NeedyScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <NeedyList masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

/** The icon of a category where the set has a fitting one; a heart otherwise (decorative — the label says it). */
function CategoryIcon({ category }: { readonly category: Beneficiary['category'] }) {
  switch (category) {
    case 'illness':
      return <HeartbeatIcon />;
    case 'student':
      return <BookOpenIcon />;
    case 'orphan':
      return <UsersIcon />;
    case 'widow':
    case 'disability':
    case 'elderly':
    case 'homeless':
    case 'debt':
    case 'other':
      return <HeartIcon />;
  }
}

function NeedyList({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const { t: tm } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const { api } = useAppData();
  const { masjid } = useMasjidDetail(masjidId);
  const bundle = masjid.state === 'active' ? masjid.bundle : null;
  const list = useQuery({
    ...needyQuery(api, masjidId, bundle?.v ?? 0),
    enabled: bundle !== null,
    // The list stays while the next version loads (a poll found a change): no skeleton flash.
    placeholderData: (previous) => previous,
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Beneficiary | null>(null);
  const [sheet, setSheet] = useState<'pay' | 'qr' | 'zakat' | null>(null);
  const [qrMounted, setQrMounted] = useState(false);
  /** How often "Log it" was tapped: 0 = the zakat sheet is not loaded yet; each time is a fresh form. */
  const [zakatForm, setZakatForm] = useState(0);

  const all = useMemo(() => list.data?.people ?? [], [list.data]);
  const people = useMemo(() => peopleToShow(all, filter === 'zakat'), [all, filter]);
  const name = bundle ? masjidName(bundle.masjid, locale) : '';

  // The QR sheet's chunk loads while the musalli reads, so the no-UPI-app fallback opens without a wait (and offline).
  useEffect(() => {
    void loadQrSheet().catch(() => undefined);
  }, []);

  const showQr = () => {
    setQrMounted(true);
    setSheet('qr');
  };
  const back = (
    <Button
      variant="outline"
      onPress={() => {
        navigator.back();
      }}
    >
      {t('back')}
    </Button>
  );

  const body = (() => {
    if (masjid.state === 'suspended' || masjid.state === 'gone') {
      return <EmptyState className="pt-8" title={tm(masjid.state)} action={back} />;
    }
    if (masjid.state === 'loading' || (bundle && list.isPending)) {
      return (
        <SkeletonGroup className="flex flex-col gap-4">
          {[0, 1, 2].map((row) => (
            <span key={row} className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1">
              <Skeleton className="h-6 w-1/2 rounded-xs" />
              <SkeletonText lines={2} />
            </span>
          ))}
        </SkeletonGroup>
      );
    }
    if (masjid.state === 'failed' || list.isError) {
      return (
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('needy.failed')}
          body={t('needy.failedBody')}
          action={
            <Button
              variant="secondary"
              leadingIcon={<RefreshIcon />}
              onPress={() => {
                void list.refetch();
              }}
            >
              {tc('ui.refresh')}
            </Button>
          }
        />
      );
    }
    if (all.length === 0) {
      return (
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('needy.empty')}
          body={t('needy.emptyBody')}
          action={back}
        />
      );
    }
    return (
      <>
        <InfoNote icon={<ShieldCheckIcon />}>
          <span data-needy-intro>{t('needy.intro', { masjid: name })}</span>
        </InfoNote>
        <ChipGroup<Filter>
          label={t('needy.filter')}
          chips={[
            { id: 'all', label: t('needy.all') },
            { id: 'zakat', label: t('needy.zakat') },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {people.length === 0 ? (
          <EmptyState className="pt-4" title={t('needy.emptyZakat')} />
        ) : (
          <ul className="flex flex-col gap-4">
            {people.map((person) => {
              const { fraction } = needyProgress(person);
              return (
                <li key={person.publicId}>
                  <PressableCard
                    className="flex w-full flex-col gap-3 text-start"
                    data-person={person.publicId}
                    onPress={() => {
                      setSelected(person);
                      setSheet('pay');
                    }}
                  >
                    <span className="flex items-start gap-3">
                      <IconCircle tone="heart">
                        <CategoryIcon category={person.category} />
                      </IconCircle>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        {/* <bdi>, not dir="auto": a Latin name in an Urdu list stays next to its icon. */}
                        <span className="type-headline text-text">
                          <bdi>{person.displayName}</bdi>
                        </span>
                        <span className="type-footnote text-text-secondary">
                          {t(`needy.category.${person.category}`)}
                        </span>
                      </span>
                      {person.zakatEligible ? <Tag tone="primary">{t('needy.zakat')}</Tag> : null}
                    </span>
                    <span dir="auto" className="line-clamp-2 type-callout text-text-secondary">
                      {person.reason}
                    </span>
                    <ProgressBar value={fraction} label={t('needy.progressLabel')} decorative />
                    <span className="type-subhead-strong tabular-nums text-text">
                      {t('needy.amounts', {
                        received: format.money(person.receivedPaise),
                        target: format.money(person.capPaise),
                      })}
                    </span>
                  </PressableCard>
                </li>
              );
            })}
          </ul>
        )}
        <InfoNote>
          <span data-disclaimer>{t('needy.disclaimer', { app: BRAND.name })}</span>
        </InfoNote>
      </>
    );
  })();

  return (
    <Screen title={tm('needy')} {...(bundle ? { subtitle: name } : {})}>
      <div className="flex flex-col gap-4 pt-2 pb-6" data-needy-list>
        {body}
      </div>
      <PaySheet
        person={selected}
        masjid={name}
        open={sheet === 'pay'}
        onClose={() => {
          setSheet(null);
        }}
        onShowQr={showQr}
        onLogZakat={() => {
          setZakatForm((count) => count + 1);
          setSheet('zakat');
        }}
      />
      {zakatForm > 0 && selected ? (
        <Suspense fallback={null}>
          <ZakatLogSheet
            open={sheet === 'zakat'}
            onClose={() => {
              setSheet(null);
            }}
            formKey={zakatForm}
            person={{ publicId: selected.publicId, displayName: selected.displayName }}
          />
        </Suspense>
      ) : null}
      {qrMounted && selected ? (
        <Suspense fallback={null}>
          <UpiQrSheet
            open={sheet === 'qr'}
            onClose={() => {
              setSheet(null);
            }}
            payment={{ vpa: selected.vpa, payeeName: selected.payeeName }}
            note={name}
          />
        </Suspense>
      ) : null}
    </Screen>
  );
}

interface PaySheetProps {
  /** The person tapped last (kept while the sheet closes). */
  readonly person: Beneficiary | null;
  /** The masjid's name: the payment note. */
  readonly masjid: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** "Show UPI QR", and the fallback when no UPI app took the link. */
  readonly onShowQr: () => void;
  /** "Log it" on "Log this in My zakat?" (07 A23 → A24). */
  readonly onLogZakat: () => void;
}

function PaySheet({ person, masjid, open, onClose, onShowQr, onLogZakat }: PaySheetProps) {
  const { t } = useTranslation('content');
  const { format } = useLocale();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  /** The person whose "Pay with UPI" the musalli came back from — the question shows for them, until answered. */
  const [returnedFor, setReturnedFor] = useState<string | null>(null);
  const cancelOpen = useRef<(() => void) | null>(null);
  const cancelReturn = useRef<(() => void) | null>(null);
  const link = useMemo(() => (person ? needyLink(person, masjid) : null), [person, masjid]);

  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => {
      setOpening(false);
    }, UPI_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [opening]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  useEffect(
    () => () => {
      cancelOpen.current?.();
      cancelReturn.current?.();
    },
    [],
  );

  if (!person) return null;
  const { fraction, remainingPaise } = needyProgress(person);
  const updatedAt = person.receivedUpdatedAt ? new Date(person.receivedUpdatedAt) : null;

  const pay = () => {
    if (!link || opening) return;
    setOpening(true);
    setReturnedFor(null);
    toast.show({ message: t('campaign.opening') });
    cancelOpen.current?.();
    cancelReturn.current?.();
    // Only for someone the masjid marked zakat-eligible (DECISIONS #158): the app does not suggest counting any
    // other help as zakat. Back from the UPI app → the question; what was paid, if anything, only the person knows.
    if (person.zakatEligible) {
      const { publicId } = person;
      cancelReturn.current = onReturnFromUpi(() => {
        setReturnedFor(publicId);
      });
    }
    cancelOpen.current = openUpiLink(link, () => {
      cancelReturn.current?.(); // no UPI app took the link: nobody is coming back from one
      onShowQr();
    });
  };
  const askZakat = open && returnedFor === person.publicId;
  const copy = () => {
    void navigator.clipboard
      .writeText(person.vpa)
      .then(() => {
        setCopied(true);
        toast.show({ message: t('campaign.qr.copied'), tone: 'success' });
      })
      .catch(() => undefined);
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setReturnedFor(null);
        onClose();
      }}
      title={t('needy.help', { name: person.displayName })}
    >
      <div className="flex flex-col gap-4 pb-2" data-needy-sheet={person.publicId}>
        {askZakat ? (
          <div role="status" className="flex flex-col gap-3 rounded-md bg-mint-50 p-4" data-zakat-ask>
            <div className="flex flex-col gap-1">
              <p className="type-headline text-text">{t('needy.zakatAsk')}</p>
              <p className="type-footnote text-text-secondary">{t('needy.zakatAskBody')}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                onPress={() => {
                  setReturnedFor(null);
                  onLogZakat();
                }}
              >
                {t('needy.zakatLog')}
              </Button>
              <Button
                variant="outline"
                onPress={() => {
                  setReturnedFor(null);
                }}
              >
                {t('needy.zakatNotNow')}
              </Button>
            </div>
          </div>
        ) : null}
        <p className="flex flex-wrap items-center gap-2 type-footnote text-text-secondary">
          {t(`needy.category.${person.category}`)}
          {person.zakatEligible ? <Tag tone="primary">{t('needy.zakat')}</Tag> : null}
        </p>
        <p dir="auto" className="type-body whitespace-pre-line text-text">
          {person.reason}
        </p>
        <div className="flex flex-col gap-2">
          <ProgressBar
            value={fraction}
            label={t('needy.progressLabel')}
            valueText={t('needy.amounts', {
              received: format.money(person.receivedPaise),
              target: format.money(person.capPaise),
            })}
          />
          <p className="type-subhead-strong tabular-nums text-text">
            {t('needy.amounts', {
              received: format.money(person.receivedPaise),
              target: format.money(person.capPaise),
            })}
          </p>
          <p className="type-footnote text-text-secondary">
            {t('needy.stillNeeded', { amount: format.money(remainingPaise) })}
          </p>
        </div>
        {updatedAt ? (
          <p className="flex items-center gap-2 rounded-sm bg-mint-50 px-3 py-2 type-footnote text-text-secondary">
            <ClockIcon size={18} className="shrink-0 text-primary-700" />
            {t('campaign.lastUpdated', {
              // The time is an LTR isolate: inside an Urdu sentence it would read "PM 10:10" (DECISIONS #136).
              when: `${format.date(updatedAt, 'short')}, ${ltrIsolate(format.time(wallClockInZone(updatedAt)).text)}`,
            })}
          </p>
        ) : null}
        <div className="flex flex-col gap-1 rounded-md bg-surface-muted p-3">
          <p dir="auto" className="type-headline text-text">
            {person.payeeName}
          </p>
          <p className="flex items-center gap-1 type-callout text-text-secondary">
            <bdi data-vpa>{person.vpa}</bdi>
            <IconButton
              label={t('campaign.qr.copy')}
              icon={copied ? <CheckIcon className="text-primary-700" /> : <CopyIcon />}
              onPress={copy}
            />
          </p>
        </div>
        {link ? (
          <div className="flex flex-col gap-3">
            <Button size="lg" fullWidth loading={opening} leadingIcon={<HeartIcon filled />} onPress={pay} data-pay>
              {t('needy.pay')}
            </Button>
            <Button variant="secondary" size="lg" fullWidth leadingIcon={<QrCodeIcon />} onPress={onShowQr}>
              {t('needy.showQr')}
            </Button>
          </div>
        ) : null}
        <p className="type-footnote text-text-secondary">{t('needy.reported')}</p>
        <InfoNote>{t('campaign.qr.checkName', { payee: person.payeeName })}</InfoNote>
      </div>
    </Sheet>
  );
}

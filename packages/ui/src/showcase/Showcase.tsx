// DEV-ONLY component showcase (06 §6, PHASE_00 T0.10) — served at `/_dev/showcase` in dev builds only. The
// chrome (section names, toggles) is developer tooling in English; component text comes from the components'
// own i18n keys and per-locale sample fixtures (./samples.ts).
import { rgbaToThumbHash } from '@mc/domain/thumbhash';
import { LOCALES, NATIVE_NAME } from '@mc/i18n';
import { Bdi, useLocale } from '@mc/i18n/react';
import { type ReactNode, useId, useMemo, useState } from 'react';

import {
  ArabicText,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  CircleAction,
  CountBadge,
  DatePickerSheet,
  Dialog,
  Divider,
  EmptyState,
  IconButton,
  IconCircle,
  Image,
  InfoNote,
  InstallPrompt,
  IosInstallGuide,
  ListRow,
  NumberPad,
  OfflineBanner,
  PressableCard,
  ProgressBar,
  RadioCardGroup,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  Switch,
  TabPanels,
  Tag,
  TextArea,
  TextField,
  TimeWheel,
  ToastProvider,
  UnderlineTabs,
  useToast,
  useUpdateAvailableToast,
  VerifiedBadge,
} from '../components/index.ts';
import {
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  CaretLeftIcon,
  DotsIcon,
  HandsPrayingIcon,
  HeartIcon,
  InfoIcon,
  MapPinIcon,
  MegaphoneIcon,
  PlusIcon,
  ShareIcon,
} from '../icons/glyphs.tsx';
import { MasjidTile } from '../icons/MasjidTile.tsx';
import { MosqueIllustration } from '../illustrations/Illustrations.tsx';
import { MotionPrefsOverride, useMotionPrefs } from '../motion/MotionProvider.tsx';
import { NavBar } from '../navigation/NavBar.tsx';
import { Screen } from '../navigation/Screen.tsx';
import { ScanFab } from '../navigation/TabBar.tsx';
import { ARABIC_SAMPLE, SAMPLES, TRANSLITERATION_SAMPLE } from './samples.ts';

/** A 16:10 mint → primary gradient, hashed at runtime (dev only) to show the ThumbHash placeholder. */
function sampleThumbHash(): string {
  const w = 32;
  const h = 20;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      rgba.set([Math.round(220 - 200 * t), Math.round(238 - 154 * t), Math.round(226 - 166 * t), 255], (y * w + x) * 4);
    }
  }
  return btoa(String.fromCharCode(...rgbaToThumbHash(w, h, rgba)));
}

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section data-showcase-section={id} aria-labelledby={headingId} className="flex flex-col gap-4 py-6">
      <h2 id={headingId} className="type-title2 text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export interface ShowcaseProps {
  /** App name from `@mc/shared/brand` (install surfaces). */
  readonly appName: string;
}

/** Every shared component in its variants and states, with locale and motion toggles. */
export function Showcase({ appName }: ShowcaseProps) {
  const prefs = useMotionPrefs();
  const [reduced, setReduced] = useState(prefs.reduced);
  const [lite, setLite] = useState(prefs.lite);
  const value = useMemo(() => ({ reduced, lite }), [reduced, lite]);
  return (
    <MotionPrefsOverride value={value}>
      <ToastProvider>
        <ShowcaseBody appName={appName} reduced={reduced} lite={lite} setReduced={setReduced} setLite={setLite} />
      </ToastProvider>
    </MotionPrefsOverride>
  );
}

function ShowcaseBody({
  appName,
  reduced,
  lite,
  setReduced,
  setLite,
}: {
  readonly appName: string;
  readonly reduced: boolean;
  readonly lite: boolean;
  readonly setReduced: (value: boolean) => void;
  readonly setLite: (value: boolean) => void;
}) {
  const { locale, setLocale } = useLocale();
  const s = SAMPLES[locale];
  // Latin masjid names inside RTL text stay in order only when isolated (09 §5).
  const meta = (
    <>
      <Bdi>{s.masjid}</Bdi> • {s.ago}
    </>
  );
  const toast = useToast();
  const [thumbhash] = useState(sampleThumbHash);

  const [tab, setTab] = useState<'overview' | 'timings' | 'notices'>('overview');
  const [segment, setSegment] = useState<'hadith' | 'quran'>('hadith');
  const [chip, setChip] = useState<'all' | 'general' | 'events' | 'facilities'>('all');
  const [notify, setNotify] = useState(true);
  const [owned, setOwned] = useState(false);
  const [gender, setGender] = useState<'brother' | 'sister' | null>('brother');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [query, setQuery] = useState('');
  const [prayer, setPrayer] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'none' | 'short' | 'long'>('none');
  const [dialog, setDialog] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState<string | null>('2026-09-26');
  const [time, setTime] = useState('20:15');
  const [amount, setAmount] = useState(10_000_000);
  const [offline, setOffline] = useState(false);
  const [update, setUpdate] = useState(false);
  const [progress, setProgress] = useState(0.72);
  useUpdateAvailableToast(update, () => {
    setUpdate(false);
  });

  const tabs = [
    { id: 'overview', label: s.overview },
    { id: 'timings', label: s.prayerTimings },
    { id: 'notices', label: s.announcements },
  ] as const;

  return (
    <Screen variant="large" title="Component showcase" lead="Dev only · 06 §6">
      <OfflineBanner offline={offline} />
      <Section id="controls" title="Showcase controls">
        <SegmentedControl
          label="Language"
          segments={LOCALES.map((id) => ({ id, label: NATIVE_NAME[id] }))}
          value={locale}
          onChange={(next) => {
            void setLocale(next);
          }}
        />
        <Card flush className="px-4">
          <Switch label="Reduced motion (JS-driven motion)" checked={reduced} onChange={setReduced} />
          <Divider />
          <Switch label="Lite motion" checked={lite} onChange={setLite} />
        </Card>
      </Section>

      <Section id="buttons" title="Button · IconButton · CircleAction">
        <Row>
          <Button>{s.donateNow}</Button>
          <Button variant="secondary">{s.readFull}</Button>
          <Button variant="outline" leadingIcon={<ShareIcon size={20} />}>
            {s.share}
          </Button>
          <Button variant="ghost">{s.readFull}</Button>
          <Button variant="danger">{s.dialogConfirm}</Button>
        </Row>
        <Button size="lg" fullWidth leadingIcon={<HeartIcon size={22} filled />}>
          {s.donateNow}
        </Button>
        <Button size="lg" fullWidth variant="secondary">
          {s.showQr}
        </Button>
        <Button variant="outline" fullWidth leadingIcon={<PlusIcon size={20} />}>
          {s.addMasjid}
        </Button>
        <Row>
          <Button loading>{s.donateNow}</Button>
          <Button loading leadingIcon={<ShareIcon size={20} />} variant="outline">
            {s.share}
          </Button>
          <Button disabled>{s.donateNow}</Button>
        </Row>
        <Row>
          <IconButton label="More" icon={<DotsIcon />} />
          <IconButton label={s.notifications} icon={<BellIcon size={22} />} variant="tinted" />
          <span className="inline-flex rounded-md bg-primary-700 p-2">
            <IconButton label="More" icon={<DotsIcon />} variant="onImage" />
            <IconButton
              label="Back"
              icon={<CaretLeftIcon size={22} className="rtl:-scale-x-100" />}
              variant="onImageBare"
            />
          </span>
          <IconButton label="Disabled" icon={<InfoIcon />} disabled />
        </Row>
        <Row>
          <CircleAction icon={<BellIcon size={22} />} label={s.notifications} />
          <CircleAction icon={<ShareIcon size={22} />} label={s.share} />
          <CircleAction icon={<MapPinIcon size={22} />} label={s.directions} />
        </Row>
      </Section>

      <Section id="cards" title="Card · ListRow · IconCircle · CountBadge · Divider">
        <Card>
          <div className="flex items-center gap-3">
            <MasjidTile />
            <div className="min-w-0 flex-1">
              <p className="type-headline text-text">{s.masjid}</p>
              <p className="type-callout text-text-secondary">{s.location}</p>
            </div>
          </div>
        </Card>
        <Card variant="mint">
          <p className="type-caption text-text-secondary">{s.prayer}</p>
          <p className="type-title2 text-primary-900">{s.prayers[1]}</p>
        </Card>
        <Card variant="outline">{s.sheetBody}</Card>
        <PressableCard>
          <p className="type-headline text-text">{s.masjid}</p>
          <p className="type-footnote text-text-secondary">{s.location}</p>
        </PressableCard>
        <Card flush className="px-4">
          <ListRow
            leading={
              <IconCircle tone="danger">
                <MegaphoneIcon size={22} />
              </IconCircle>
            }
            title={s.noticeTitle}
            subtitle={s.noticeBody}
            meta={meta}
            trailing={<CountBadge count={3} />}
            onPress={() => undefined}
          />
          <Divider inset="icon" />
          <ListRow
            leading={
              <IconCircle tone="rose">
                <HandsPrayingIcon size={22} />
              </IconCircle>
            }
            title={s.illness}
            subtitle={s.noticeBody}
            meta={meta}
            trailing={<CountBadge count={12} />}
            onPress={() => undefined}
          />
          <Divider inset="icon" />
          <ListRow
            leading={
              <IconCircle tone="info">
                <BookOpenIcon size={22} />
              </IconCircle>
            }
            title={s.hadith}
            subtitle={s.translation}
            subtitleLines={1}
          />
        </Card>
        <Row>
          {(['primary', 'danger', 'info', 'rose', 'slate', 'purple', 'heart', 'sun', 'neutral'] as const).map(
            (tone) => (
              <IconCircle key={tone} tone={tone} size={48}>
                <CalendarIcon size={22} />
              </IconCircle>
            ),
          )}
        </Row>
      </Section>

      <Section id="tags" title="Tag · VerifiedBadge · InfoNote · SectionHeader">
        <Row>
          <Tag tone="danger">{s.important}</Tag>
          <Tag tone="primary">{s.event}</Tag>
          <Tag>{s.general}</Tag>
          <Tag tone="sun">{s.facilities}</Tag>
          <Tag tone="rose">{s.illness}</Tag>
          <Tag tone="slate">{s.inteqal}</Tag>
          <VerifiedBadge />
        </Row>
        <InfoNote>{s.infoNote}</InfoNote>
        <SectionHeader title={s.recentUpdates} onSeeAll={() => undefined} />
      </Section>

      <Section id="progress" title="ProgressBar · ArabicText · Image">
        <ProgressBar value={progress} label={s.raised} />
        <Row>
          <Button
            variant="secondary"
            onPress={() => {
              setProgress((value) => (value > 0.9 ? 0.2 : Math.min(value + 0.25, 1)));
            }}
          >
            +25%
          </Button>
        </Row>
        <Card>
          <ArabicText variant="hero">{ARABIC_SAMPLE}</ArabicText>
          <p className="mt-2 text-center type-callout text-text-secondary">{TRANSLITERATION_SAMPLE}</p>
          <p className="mt-1 text-center type-body text-text">{s.translation}</p>
        </Card>
        <Card variant="mint">
          <ArabicText>{ARABIC_SAMPLE}</ArabicText>
        </Card>
        <Image src="/__showcase/missing-photo.jpg" alt={s.masjid} thumbhash={thumbhash} ratio="16/10" />
      </Section>

      <Section id="skeleton" title="Skeleton · EmptyState">
        <SkeletonGroup className="flex flex-col gap-3">
          <Card className="flex items-center gap-3">
            <Skeleton className="size-11 shrink-0 rounded-full" />
            <SkeletonText lines={2} className="flex-1" />
          </Card>
          <Skeleton className="h-3 w-full rounded-full" />
        </SkeletonGroup>
        <EmptyState
          illustration={<MosqueIllustration />}
          title={s.emptyTitle}
          body={s.emptyBody}
          action={<Button leadingIcon={<PlusIcon size={20} />}>{s.scan}</Button>}
        />
      </Section>

      <Section id="tabs" title="UnderlineTabs · SegmentedControl · ChipGroup">
        <UnderlineTabs tabs={tabs} value={tab} onChange={setTab} label={s.masjid} idPrefix="showcase" />
        <TabPanels tabs={tabs} value={tab} idPrefix="showcase" onChange={setTab}>
          {(id) => (
            <Card variant="mint">
              <p className="type-body text-text">{tabs.find((item) => item.id === id)?.label}</p>
            </Card>
          )}
        </TabPanels>
        <SegmentedControl
          label={s.hadith}
          segments={[
            { id: 'hadith', label: s.hadith },
            { id: 'quran', label: s.quran },
          ]}
          value={segment}
          onChange={setSegment}
        />
        <div className="-mx-(--mc-gutter)">
          <ChipGroup
            label={s.announcements}
            chips={[
              { id: 'all', label: s.all },
              { id: 'general', label: s.general },
              { id: 'events', label: s.event },
              { id: 'facilities', label: s.facilities },
            ]}
            value={chip}
            onChange={setChip}
          />
        </div>
      </Section>

      <Section id="navbar" title="NavBar · ScanFab">
        <Card flush className="overflow-hidden">
          <NavBar
            title={s.announcements}
            subtitle={s.masjid}
            variant="inline"
            leading={<IconButton label="Back" icon={<CaretLeftIcon size={22} className="rtl:-scale-x-100" />} />}
            actions={<IconButton label="More" icon={<DotsIcon />} />}
          />
        </Card>
        <div className="flex justify-center pt-6">
          <ScanFab label={s.scan} onPress={() => undefined} />
        </div>
      </Section>

      <Section id="toggles" title="Switch · Checkbox · RadioCard">
        <Card flush className="px-4">
          <Switch label={s.notify} description={s.notifyHint} checked={notify} onChange={setNotify} />
          <Divider />
          <Switch label={s.notify} checked={false} onChange={() => undefined} disabled />
        </Card>
        <Checkbox label={s.ownPhoto} checked={owned} onChange={setOwned} />
        <Checkbox label={s.ownPhoto} checked={false} onChange={() => undefined} invalid />
        <RadioCardGroup
          legend={s.iAm}
          name="showcase-gender"
          value={gender}
          onChange={setGender}
          options={[
            { value: 'brother', title: s.brother },
            { value: 'sister', title: s.sister },
          ]}
        />
        <RadioCardGroup
          legend="Language"
          hideLegend
          name="showcase-language"
          value={locale}
          onChange={(next) => {
            void setLocale(next);
          }}
          options={LOCALES.map((id) => ({ value: id, title: NATIVE_NAME[id], lang: id }))}
        />
      </Section>

      <Section id="fields" title="TextField · TextArea · SearchField · Select">
        <TextField
          label={s.nameLabel}
          hint={s.nameHint}
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setNameError(undefined);
          }}
          {...(nameError ? { error: nameError } : {})}
        />
        <Button
          variant="outline"
          onPress={() => {
            setNameError(name.trim() ? undefined : s.nameError);
          }}
        >
          Validate
        </Button>
        <TextField label={s.nameLabel} optional disabled defaultValue={s.masjid} />
        <TextArea label={s.message} maxLength={120} defaultValue={s.noticeBody} />
        <SearchField label={s.search} placeholder={s.search} value={query} onChange={setQuery} />
        <Select
          label={s.prayer}
          value={prayer}
          onChange={setPrayer}
          options={s.prayers.map((label, index) => ({ value: String(index), label }))}
        />
      </Section>

      <Section id="overlays" title="Sheet · Dialog · Toast · DatePickerSheet">
        <Row>
          <Button
            variant="outline"
            onPress={() => {
              setSheet('short');
            }}
          >
            Open sheet
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              setSheet('long');
            }}
          >
            Open long sheet
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              setDialog(true);
            }}
          >
            Open dialog
          </Button>
        </Row>
        <Row>
          <Button
            variant="secondary"
            onPress={() => {
              toast.show({ message: s.toast });
            }}
          >
            Toast
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              toast.show({ message: s.saved, tone: 'success' });
            }}
          >
            Success
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              toast.show({ message: s.failed, tone: 'error', action: { label: 'Retry', onPress: () => undefined } });
            }}
          >
            Error
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              setUpdate(true);
            }}
          >
            Update available
          </Button>
        </Row>
        <Button
          variant="outline"
          leadingIcon={<CalendarIcon size={20} />}
          onPress={() => {
            setDateOpen(true);
          }}
        >
          {date ?? s.chooseDate}
        </Button>
        <Sheet
          open={sheet === 'short'}
          onClose={() => {
            setSheet('none');
          }}
          title={s.sheetTitle}
          footer={<Button fullWidth>{s.donateNow}</Button>}
        >
          <p className="type-body text-text-secondary">{s.sheetBody}</p>
        </Sheet>
        <Sheet
          open={sheet === 'long'}
          onClose={() => {
            setSheet('none');
          }}
          title={s.announcements}
          snaps={['content', 'full']}
        >
          {Array.from({ length: 30 }, (_, index) => (
            <ListRow key={index} title={`${s.noticeTitle} ${String(index + 1)}`} subtitle={meta} />
          ))}
        </Sheet>
        <Dialog
          open={dialog}
          destructive
          title={s.dialogTitle}
          body={s.dialogBody}
          confirmLabel={s.dialogConfirm}
          onConfirm={() => {
            setDialog(false);
          }}
          onClose={() => {
            setDialog(false);
          }}
        />
        <DatePickerSheet
          open={dateOpen}
          onClose={() => {
            setDateOpen(false);
          }}
          title={s.chooseDate}
          value={date}
          onChange={setDate}
          today="2026-09-26"
        />
      </Section>

      <Section id="pickers" title="TimeWheel · NumberPad">
        <Card>
          <TimeWheel label={s.jamaatTime} value={time} onChange={setTime} minuteStep={5} />
          <p className="mt-3 text-center type-footnote text-text-secondary tabular-nums">{time}</p>
        </Card>
        <Card>
          <NumberPad label={s.targetAmount} value={amount} onChange={setAmount} />
        </Card>
      </Section>

      <Section id="feedback" title="OfflineBanner · InstallPrompt · IosInstallGuide">
        <Switch label="Simulate offline" checked={offline} onChange={setOffline} />
        <InstallPrompt appName={appName} onInstall={() => undefined} onDismiss={() => undefined} />
        <IosInstallGuide appName={appName} onDismiss={() => undefined} />
      </Section>
    </Screen>
  );
}

// B4 building blocks (07 B4): a prayer's card (two big buttons — Adhan, Jamaat — and its live checks), the Jumu'ah
// list, the musalli preview for a chosen day, and the confirm sheet with what changes today.
import type { JumuahJamaat, PrayerName, ResolvedDay } from '@mc/domain/prayer';
import { addDays } from '@mc/domain/time';
import type { TimingIssue } from '@mc/domain/timings';
import type { Locale } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { PreviewFrame } from '@mc/ui/admin';
import { Button, Card, DatePickerSheet, DateStepper, IconButton, Sheet, Tag, usePrayerName } from '@mc/ui/components';
import { DayTimings } from '@mc/ui/content';
import { PlusIcon, PrayerIcon, XIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { useState } from 'react';

import { type Change, MAX_JUMUAH } from '../lib/editor.ts';
import { ltr } from '../lib/text.ts';

/** "5:15 AM" in the admin's language, isolated so it never reorders in Urdu (09 §5). */
function useTime(): (hhmm: string) => string {
  const { format } = useLocale();
  return (hhmm) => ltr(format.time(hhmm).text);
}

/** A 56px row button: label on top, the value large, a hint under it. */
function SlotButton({
  label,
  value,
  hint,
  onPress,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string | undefined;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      kind="button"
      onPress={onPress}
      className="flex min-h-14 flex-1 flex-col items-start justify-center rounded-md bg-surface-muted px-3 py-2 text-start"
    >
      <span className="type-caption text-text-secondary">{label}</span>
      <span className="type-headline text-text tabular-nums">{value}</span>
      {hint ? <span className="type-caption text-text-tertiary">{hint}</span> : null}
    </Pressable>
  );
}

/** The issue chips of one prayer (red blocks saving, amber only warns). */
function Issues({ issues }: { readonly issues: readonly TimingIssue[] }) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-live="polite">
      {issues.map((issue) => {
        const text = t(`timings.issue.${issue.code}`);
        return (
          <li key={issue.code}>
            <Tag tone={issue.severity === 'error' ? 'danger' : 'sun'}>
              {issue.date
                ? t('timings.issueFrom', { issue: text, date: format.calendarDate(issue.date, 'medium') })
                : text}
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

export interface PrayerCardProps {
  readonly prayer: PrayerName;
  /** Today's resolved times with the draft. */
  readonly today: { readonly adhan: string; readonly adhanCalculated: boolean; readonly jamaat: string | null };
  readonly jamaatMode: 'fixed' | 'offset' | 'none';
  readonly jamaatOffsetMin: number | undefined;
  readonly issues: readonly TimingIssue[];
  readonly onAdhan: () => void;
  readonly onJamaat: () => void;
}

/** One prayer: big name + icon, "Adhan 5:15 AM (calculated)" and "Jamaat 5:30 AM" buttons, live checks. */
export function PrayerCard({ prayer, today, jamaatMode, jamaatOffsetMin, issues, onAdhan, onJamaat }: PrayerCardProps) {
  const { t } = useTranslation('admin');
  const prayerName = usePrayerName();
  const time = useTime();
  return (
    <Card className="flex flex-col gap-3" data-prayer={prayer}>
      <h2 className="flex items-center gap-2 type-title2 text-text">
        <PrayerIcon prayer={prayer} size={28} />
        {prayerName(prayer)}
      </h2>
      <div className="flex gap-3">
        <SlotButton
          label={t('timings.adhan')}
          value={time(today.adhan)}
          hint={today.adhanCalculated ? t('timings.calculated') : t('timings.setByYou')}
          onPress={onAdhan}
        />
        <SlotButton
          label={t('timings.jamaat')}
          value={today.jamaat === null || jamaatMode === 'none' ? t('timings.notSet') : time(today.jamaat)}
          hint={
            jamaatMode === 'offset' && jamaatOffsetMin !== undefined
              ? t('timings.minutesAfter', { minutes: jamaatOffsetMin })
              : undefined
          }
          onPress={onJamaat}
        />
      </div>
      <Issues issues={issues} />
    </Card>
  );
}

export interface JumuahEditorProps {
  readonly jumuah: readonly JumuahJamaat[];
  readonly issues: readonly TimingIssue[];
  readonly onJamaat: (seq: number) => void;
  readonly onKhutbah: (seq: number) => void;
  readonly onAdd: () => void;
  readonly onRemove: (seq: number) => void;
}

/** Jumu'ah: 1–3 jamaats, each with an optional khutbah time; add / remove. */
export function JumuahEditor({ jumuah, issues, onJamaat, onKhutbah, onAdd, onRemove }: JumuahEditorProps) {
  const { t } = useTranslation('admin');
  const time = useTime();
  return (
    <Card className="flex flex-col gap-3" data-prayer="jumuah">
      <h2 className="flex items-center gap-2 type-title2 text-text">
        <PrayerIcon prayer="dhuhr" size={28} />
        {t('timings.jumuah')}
      </h2>
      <ul className="flex flex-col gap-3">
        {jumuah.map((slot) => (
          <li key={slot.seq} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="type-subhead-strong text-text">{t('timings.jumuahN', { n: slot.seq })}</span>
              {jumuah.length > 1 ? (
                <IconButton
                  label={t('timings.removeJumuah', { n: slot.seq })}
                  icon={<XIcon size={22} />}
                  onPress={() => {
                    onRemove(slot.seq);
                  }}
                />
              ) : null}
            </div>
            <div className="flex gap-3">
              <SlotButton
                label={t('timings.khutbah')}
                value={slot.khutbahTime ? time(slot.khutbahTime) : t('timings.notSet')}
                onPress={() => {
                  onKhutbah(slot.seq);
                }}
              />
              <SlotButton
                label={t('timings.jamaat')}
                value={time(slot.jamaatTime)}
                onPress={() => {
                  onJamaat(slot.seq);
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <Issues issues={issues} />
      {jumuah.length < MAX_JUMUAH ? (
        <Button variant="outline" size="lg" fullWidth leadingIcon={<PlusIcon />} onPress={onAdd}>
          {t('timings.addJumuah')}
        </Button>
      ) : null}
    </Card>
  );
}

export interface TimingsPreviewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly today: string;
  /** The draft resolved for a day (exactly what the musalli phones compute). */
  readonly resolve: (date: string) => ResolvedDay;
}

/** How followers will see it: the musalli A6 table (`@mc/ui/content`) for a chosen day, in each language. */
export function TimingsPreview({ open, onClose, today, resolve }: TimingsPreviewProps) {
  const { t } = useTranslation('admin');
  const { locale, format } = useLocale();
  const [date, setDate] = useState(today);
  const [shown, setShown] = useState<Locale>(locale);
  const [picking, setPicking] = useState(false);
  const last = addDays(today, 60);
  return (
    <Sheet open={open} onClose={onClose} title={t('timings.previewTitle')} snaps={['full']}>
      <div className="flex flex-col gap-4 pb-4">
        <DateStepper
          label={format.calendarDate(date, 'medium')}
          prevLabel={t('timings.prevDay')}
          nextLabel={t('timings.nextDay')}
          pickLabel={t('timings.pickDay')}
          prevDisabled={date === today}
          nextDisabled={date === last}
          onPrev={() => {
            setDate(addDays(date, -1));
          }}
          onNext={() => {
            setDate(addDays(date, 1));
          }}
          onPick={() => {
            setPicking(true);
          }}
        />
        <PreviewFrame
          locale={shown}
          onLocaleChange={setShown}
          label={t('timings.preview')}
          languageLabel={t('timings.showIn')}
          namespaces={['common', 'masjid']}
        >
          <DayTimings day={resolve(date)} date={date} highlighted={null} />
        </PreviewFrame>
      </div>
      <DatePickerSheet
        open={picking}
        onClose={() => {
          setPicking(false);
        }}
        title={t('timings.pickDay')}
        value={date}
        min={today}
        max={last}
        today={today}
        onChange={(value) => {
          setDate(value);
          setPicking(false);
        }}
      />
    </Sheet>
  );
}

export interface ConfirmSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly changes: readonly Change[];
  readonly notify: boolean;
  readonly busy: boolean;
  readonly onSave: () => void;
}

/** "Save these timings?" with today's changes ("Isha jamaat 8:15 PM → 8:30 PM") and whether followers are told. */
export function ConfirmSheet({ open, onClose, changes, notify, busy, onSave }: ConfirmSheetProps) {
  const { t } = useTranslation('admin');
  const prayerName = usePrayerName();
  const time = useTime();
  const part = (change: Change) =>
    change.part === 'khutbah'
      ? t('timings.khutbah')
      : change.part === 'adhan'
        ? t('timings.adhan')
        : t('timings.jamaat');
  const name = (change: Change) =>
    change.what === 'jumuah' ? `${t('timings.jumuah')} ${String(change.seq ?? 1)}` : prayerName(change.what);
  const shown = (value: string | null) => (value === null ? t('timings.notSet') : time(value));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('timings.confirmTitle')}
      footer={
        <Button size="lg" fullWidth loading={busy} onPress={onSave}>
          {t('timings.confirmSave')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <h3 className="type-subhead-strong text-text-secondary">{t('timings.confirmToday')}</h3>
        {changes.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {changes.map((change) => (
              <li key={`${change.what}-${change.part}-${String(change.seq ?? 0)}`} className="type-body text-text">
                {t('timings.changeLine', {
                  name: name(change),
                  part: part(change),
                  from: shown(change.from),
                  to: shown(change.to),
                })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body text-text-secondary">{t('timings.noChangeToday')}</p>
        )}
        <p className="type-callout text-text">{notify ? t('timings.willNotify') : t('timings.willNotNotify')}</p>
      </div>
    </Sheet>
  );
}

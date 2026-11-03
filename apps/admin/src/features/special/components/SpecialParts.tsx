// B11 building blocks (07 B11): the type icon, a special date's row in the list, the times editor (up to 5, each with
// an optional name), the Ramadan card (on/off, first and last day, precaution steppers and today's Sehri / Iftar with
// them), and the musalli preview of an entry.
import type { RamadanIssue, SpecialDateIssue } from '@mc/domain/special';
import { addDays } from '@mc/domain/time';
import type { Locale } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { AdminSchedule, AdminSpecialDate, Ramadan, SpecialType } from '@mc/shared/contracts';
import { PreviewFrame } from '@mc/ui/admin';
import {
  Button,
  Card,
  DatePickerSheet,
  IconButton,
  IconCircle,
  InfoNote,
  PressableCard,
  Sheet,
  Switch,
  Tag,
  TextField,
} from '@mc/ui/components';
import { SpecialDateCard } from '@mc/ui/content';
import { CalendarIcon, CrescentIcon, MoonStarsIcon, PlusIcon, XIcon } from '@mc/ui/icons';
import { useState } from 'react';

import { SlotButton } from '../../timings/components/EditorParts.tsx';
import { Stepper } from '../../timings/components/TimingSheets.tsx';
import { ltr } from '../../timings/lib/text.ts';
import {
  IFTAR_RANGE,
  ramadanBody,
  ramadanDirty,
  type RamadanDraft,
  ramadanDraftOf,
  ramadanIssues,
  ramadanPreview,
  SEHRI_RANGE,
  SPECIAL_TIMES_MAX,
} from '../lib/special.ts';

/** How far back the date pickers go (the list shows 30 days back; older days are not worth editing). */
export const PICK_PAST_DAYS = 30;
/** How far ahead (the 400-day window of `@mc/domain/special`, minus a margin for "today" moving on). */
export const PICK_FUTURE_DAYS = 399;

/** The icon of a special date type: the crescent for Eid, the moon and stars for the night prayers. */
export function SpecialTypeIcon({ type, size = 24 }: { readonly type: SpecialType; readonly size?: number }) {
  if (type === 'eid_ul_fitr' || type === 'eid_ul_adha') return <CrescentIcon size={size} />;
  if (type === 'other') return <CalendarIcon size={size} />;
  return <MoonStarsIcon size={size} />;
}

/** "5:15 AM" in the admin's language, isolated so it never reorders in Urdu (09 §5). */
function useTime(): (hhmm: string) => string {
  const { format } = useLocale();
  return (hhmm) => ltr(format.time(hhmm).text);
}

/** One entry in the B11 list: icon, the day's name (+ title), its date and times — one tap opens it. */
export function SpecialRow({ entry, onPress }: { readonly entry: AdminSpecialDate; readonly onPress: () => void }) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const time = useTime();
  return (
    <PressableCard onPress={onPress} data-special={entry.id}>
      <div className="flex items-start gap-3">
        <IconCircle tone="sun" size={44}>
          <SpecialTypeIcon type={entry.type} />
        </IconCircle>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="type-headline text-text">
            {t(`special.type.${entry.type}`)}
            {entry.label ? (
              <span dir="auto" className="type-callout text-text-secondary">
                {' · '}
                {entry.label}
              </span>
            ) : null}
          </span>
          <span className="type-callout text-text-secondary">{format.calendarDate(entry.date, 'long')}</span>
          <span className="type-subhead-strong text-text tabular-nums">
            {entry.times.map((slot) => time(slot.time)).join(' · ')}
          </span>
        </div>
      </div>
    </PressableCard>
  );
}

/** The live checks as chips. */
export function IssueTags({
  issues,
  prefix,
}: {
  readonly issues: readonly (SpecialDateIssue | RamadanIssue)[];
  readonly prefix: 'special.issue' | 'special.ramadanIssue';
}) {
  const { t } = useTranslation('admin');
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-live="polite">
      {issues.map((issue) => (
        <li key={issue}>
          <Tag tone="danger">{t(`${prefix}.${issue}` as 'special.issue.duplicate_time')}</Tag>
        </li>
      ))}
    </ul>
  );
}

export interface TimesEditorProps {
  readonly times: readonly { readonly time: string; readonly label: string }[];
  readonly onTime: (index: number) => void;
  readonly onLabel: (index: number, label: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
}

/** 1–5 times, each a big button (opens the wheel) with an optional name ("1st Jamaat"). */
export function TimesEditor({ times, onTime, onLabel, onAdd, onRemove }: TimesEditorProps) {
  const { t } = useTranslation('admin');
  const time = useTime();
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-4">
        {times.map((slot, index) => {
          const n = index + 1;
          return (
            // The times have no ids; their position is what the admin sees ("Time 2").
            <li key={index} className="flex flex-col gap-2" data-time={n}>
              <div className="flex items-center gap-2">
                <SlotButton
                  label={t('special.timeN', { n })}
                  value={time(slot.time)}
                  onPress={() => {
                    onTime(index);
                  }}
                />
                <IconButton
                  label={t('special.removeTime', { n })}
                  icon={<XIcon size={22} />}
                  onPress={() => {
                    onRemove(index);
                  }}
                />
              </div>
              <TextField
                label={t('special.timeLabel', { n })}
                optional
                hint={t('special.timeLabelHint')}
                value={slot.label}
                maxLength={40}
                dir="auto"
                onChange={(event) => {
                  onLabel(index, event.target.value);
                }}
              />
            </li>
          );
        })}
      </ol>
      {times.length < SPECIAL_TIMES_MAX ? (
        <Button variant="outline" size="lg" fullWidth leadingIcon={<PlusIcon />} onPress={onAdd}>
          {t('special.addTime')}
        </Button>
      ) : null}
    </div>
  );
}

export interface RamadanCardProps {
  readonly masjid: AdminSchedule['masjid'];
  readonly saved: Ramadan;
  readonly today: string;
  readonly busy: boolean;
  readonly onSave: (draft: RamadanDraft) => void;
}

/**
 * Ramadan mode (07 B11, 00 §4.2): a switch, the first and last day, the Sehri / Iftar precautions and — live — today's
 * Sehri end and Iftar with them, as the musalli Ramadan card computes them.
 */
export function RamadanCard({ masjid, saved, today, busy, onSave }: RamadanCardProps) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const time = useTime();
  const base = ramadanDraftOf(saved);
  const [draft, setDraft] = useState(base);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const issues = ramadanIssues(draft, today);
  const preview = ramadanPreview(masjid, today, draft);
  const canSave = ramadanDirty(base, draft) && ramadanBody(draft) !== null && issues.length === 0;
  const day = (date: string | null) => (date === null ? t('timings.notSet') : format.calendarDate(date, 'medium'));
  const earliest = addDays(today, -PICK_PAST_DAYS);
  const latest = addDays(today, PICK_FUTURE_DAYS);

  return (
    <Card className="flex flex-col gap-4" data-section="ramadan">
      <h2 className="flex items-center gap-2 type-title2 text-text">
        <CrescentIcon size={28} />
        {t('special.ramadan')}
      </h2>
      <Switch
        checked={draft.on}
        label={t('special.ramadanMode')}
        description={t('special.ramadanHint')}
        onChange={(on) => {
          setDraft({ ...draft, on });
        }}
      />
      {draft.on ? (
        <div className="flex gap-3">
          <SlotButton
            label={t('special.firstDay')}
            value={day(draft.start)}
            onPress={() => {
              setPicking('start');
            }}
          />
          <SlotButton
            label={t('special.lastDay')}
            value={day(draft.end)}
            onPress={() => {
              setPicking('end');
            }}
          />
        </div>
      ) : null}
      <IssueTags issues={issues} prefix="special.ramadanIssue" />
      <div className="flex flex-col gap-2">
        <p className="type-callout text-text-secondary">{t('special.sehriEarlier')}</p>
        <Stepper
          value={draft.sehri}
          range={SEHRI_RANGE}
          text={t('special.minutes', { minutes: draft.sehri })}
          lessLabel={t('special.sehriLess')}
          moreLabel={t('special.sehriMore')}
          onChange={(sehri) => {
            setDraft({ ...draft, sehri });
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="type-callout text-text-secondary">{t('special.iftarLater')}</p>
        <Stepper
          value={draft.iftar}
          range={IFTAR_RANGE}
          text={t('special.minutes', { minutes: draft.iftar })}
          lessLabel={t('special.iftarLess')}
          moreLabel={t('special.iftarMore')}
          onChange={(iftar) => {
            setDraft({ ...draft, iftar });
          }}
        />
      </div>
      <InfoNote>
        <span className="flex flex-col gap-1">
          <output aria-live="polite" className="type-subhead-strong text-text">
            {t('special.previewToday', { sehri: time(preview.sehriEnds), iftar: time(preview.iftar) })}
          </output>
          <span>{t('special.disclaimer')}</span>
        </span>
      </InfoNote>
      <Button
        size="lg"
        fullWidth
        disabled={!canSave}
        loading={busy}
        onPress={() => {
          onSave(draft);
        }}
      >
        {t('special.saveRamadan')}
      </Button>
      <DatePickerSheet
        open={picking !== null}
        onClose={() => {
          setPicking(null);
        }}
        title={picking === 'end' ? t('special.pickLast') : t('special.pickFirst')}
        value={picking === 'end' ? draft.end : draft.start}
        min={picking === 'end' && draft.start !== null ? draft.start : earliest}
        max={latest}
        today={today}
        onChange={(value) => {
          setDraft(picking === 'end' ? { ...draft, end: value } : { ...draft, start: value });
          setPicking(null);
        }}
      />
    </Card>
  );
}

export interface SpecialPreviewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly date: string;
  readonly entry: Parameters<typeof SpecialDateCard>[0]['special'];
}

/** How followers will see the entry: the musalli Special Dates card (`@mc/ui/content`), in each language. */
export function SpecialPreview({ open, onClose, date, entry }: SpecialPreviewProps) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const [shown, setShown] = useState<Locale>(locale);
  return (
    <Sheet open={open} onClose={onClose} title={t('special.previewTitle')}>
      <div className="pb-4">
        <PreviewFrame
          locale={shown}
          onLocaleChange={setShown}
          label={t('special.preview')}
          languageLabel={t('special.showIn')}
          namespaces={['common', 'masjid']}
        >
          <PreviewDay date={date} entry={entry} />
        </PreviewFrame>
      </div>
    </Sheet>
  );
}

/** Inside the frame: the date heading and the card, both in the frame's language. */
function PreviewDay({ date, entry }: { readonly date: string; readonly entry: SpecialPreviewProps['entry'] }) {
  const { format } = useLocale();
  return (
    <div className="flex flex-col gap-2 p-4">
      <h3 className="type-subhead-strong text-text-secondary">{format.calendarDate(date, 'long')}</h3>
      <SpecialDateCard special={entry} />
    </div>
  );
}

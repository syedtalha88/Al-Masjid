// B5 building blocks (07 B5): the template grid, one picker per template param type (time and date sheets, two wheels
// for a range, big prayer buttons, short text, phone), the photo field with its ownership tick, the issue list and the
// musalli preview of the notice.
import { addDays } from '@mc/domain/time';
import type { Locale } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { PRAYER_KEYS, type PrayerKey, type TemplateParam, type TemplateValue } from '@mc/i18n/template-args';
import type { FeedItem, NoticeTemplate } from '@mc/shared/contracts/public';
import { AdminTile, PreviewFrame } from '@mc/ui/admin';
import {
  Button,
  Checkbox,
  DatePickerSheet,
  Image,
  InfoNote,
  Spinner,
  Tag,
  TextField,
  type Tone,
  useToast,
} from '@mc/ui/components';
import { BloodCampCard, bloodCampOf, FeedItemCard } from '@mc/ui/content';
import { PencilIcon, TemplateIcon } from '@mc/ui/icons';
import { type ChangeEvent, useId, useRef, useState } from 'react';

import { useErrorText } from '../../auth/hooks/use-session.ts';
import { SlotButton } from '../../timings/components/EditorParts.tsx';
import { TimeRangeSheet, TimeSheet } from '../../timings/components/TimingSheets.tsx';
import { ltr } from '../../timings/lib/text.ts';
import { usePhotoUpload } from '../hooks/use-notice.ts';
import type { NoticeCategory, NoticeIssue, NoticePhoto } from '../lib/notice.ts';
import { phoneValue } from '../lib/notice.ts';

/** How far ahead the date pickers go (the server takes event times up to 400 days ahead). */
export const PICK_FUTURE_DAYS = 399;

/** Icon circle colour per notice category (06 §2, as the musalli tags). */
export const CATEGORY_TONE: Readonly<Record<NoticeCategory, Tone>> = {
  general: 'primary',
  event: 'primary',
  facilities: 'sun',
  timing: 'info',
};

/** A template's name in the admin's language (English when a translation is missing). */
export const templateName = (template: NoticeTemplate, locale: Locale): string =>
  template.title[locale] || template.title.en;

export interface TemplateGridProps {
  readonly templates: readonly NoticeTemplate[];
  readonly onTemplate: (template: NoticeTemplate) => void;
  readonly onWriteOwn: () => void;
}

/** Step 1: icon + short name tiles in the admin language, two per row, and last "Write your own" (06 §6 admin). */
export function TemplateGrid({ templates, onTemplate, onWriteOwn }: TemplateGridProps) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  return (
    <ul aria-label={t('notice.templates')} className="grid grid-cols-2 gap-3">
      {templates.map((template) => (
        <li key={template.key} className="flex">
          <AdminTile
            className="flex-1"
            data-template={template.key}
            icon={<TemplateIcon name={template.icon} size={28} />}
            tone={CATEGORY_TONE[template.category]}
            label={templateName(template, locale)}
            onPress={() => {
              onTemplate(template);
            }}
          />
        </li>
      ))}
      <li className="flex">
        <AdminTile
          className="flex-1"
          data-template="own"
          icon={<PencilIcon size={28} />}
          tone="neutral"
          label={t('notice.writeOwn')}
          onPress={onWriteOwn}
        />
      </li>
    </ul>
  );
}

/** Param names with their own label; others are named by their type. */
const NAMED_PARAMS = [
  'hours',
  'days',
  'prayer',
  'time',
  'from',
  'date',
  'speaker',
  'item',
  'place',
  'contact',
] as const;
type NamedParam = (typeof NAMED_PARAMS)[number];
const isNamedParam = (name: string): name is NamedParam => (NAMED_PARAMS as readonly string[]).includes(name);

/** The label of a template param in the admin's language. */
export function useParamLabel(): (param: Pick<TemplateParam, 'name' | 'type'>) => string {
  const { t } = useTranslation('admin');
  return (param) => (isNamedParam(param.name) ? t(`notice.param.${param.name}`) : t(`notice.paramType.${param.type}`));
}

type Range = { readonly start: string; readonly end: string };
const isRange = (value: TemplateValue | undefined): value is Range => typeof value === 'object';
const textOf = (value: TemplateValue | undefined): string | null => (typeof value === 'string' ? value : null);

export interface ParamFieldProps {
  readonly param: TemplateParam;
  readonly value: TemplateValue | undefined;
  /** `undefined` clears the value. */
  readonly onChange: (value: TemplateValue | undefined) => void;
  /** "YYYY-MM-DD" in IST — the date pickers start here. */
  readonly today: string;
}

/** One template param as a big picker (07 B5: time range → two wheels, date → calendar sheet, prayer → buttons). */
export function ParamField({ param, value, onChange, today }: ParamFieldProps) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const label = useParamLabel()(param);
  const [open, setOpen] = useState<'start' | 'end' | 'one' | null>(null);
  const time = (hhmm: string | null) => (hhmm === null ? t('notice.notSet') : ltr(format.time(hhmm).text));
  const date = (day: string | null) => (day === null ? t('notice.notSet') : format.calendarDate(day, 'long'));
  const range = isRange(value) ? value : null;
  const setEnd = (side: 'start' | 'end', picked: string) => {
    const next = { start: range?.start ?? '', end: range?.end ?? '', [side]: picked };
    onChange(next);
  };
  const close = () => {
    setOpen(null);
  };

  switch (param.type) {
    case 'time':
    case 'date': {
      const shown = textOf(value);
      return (
        <div className="flex flex-col gap-2" data-param={param.name}>
          <h2 className="type-headline text-text">{label}</h2>
          <div className="flex">
            <SlotButton
              label={label}
              value={param.type === 'time' ? time(shown) : date(shown)}
              onPress={() => {
                setOpen('one');
              }}
            />
          </div>
          {param.type === 'time' ? (
            open === 'one' ? (
              <TimeSheet
                open
                title={label}
                value={shown ?? '12:00'}
                onClose={close}
                onDone={(picked) => {
                  onChange(picked);
                  close();
                }}
              />
            ) : null
          ) : (
            <DatePickerSheet
              open={open === 'one'}
              onClose={close}
              title={label}
              value={shown}
              min={today}
              max={addDays(today, PICK_FUTURE_DAYS)}
              today={today}
              onChange={(picked) => {
                onChange(picked);
                close();
              }}
            />
          )}
        </div>
      );
    }
    case 'time_range':
    case 'date_range': {
      const isTime = param.type === 'time_range';
      const shown = (side: 'start' | 'end') => {
        const part = range?.[side] ? range[side] : null;
        return isTime ? time(part) : date(part);
      };
      return (
        <div className="flex flex-col gap-2" data-param={param.name}>
          <h2 className="type-headline text-text">{label}</h2>
          <div className="flex gap-3">
            <SlotButton
              label={t('notice.from')}
              value={shown('start')}
              onPress={() => {
                setOpen('start');
              }}
            />
            <SlotButton
              label={t('notice.to')}
              value={shown('end')}
              onPress={() => {
                setOpen('end');
              }}
            />
          </div>
          {isTime ? (
            open === 'start' || open === 'end' ? (
              // Both ends in one sheet, whichever slot was tapped (T3.12 tap budget).
              <TimeRangeSheet
                open
                title={label}
                fromLabel={t('notice.from')}
                toLabel={t('notice.to')}
                value={{ start: range?.start || '10:00', end: range?.end || '14:00' }}
                onClose={close}
                onDone={(picked) => {
                  onChange(picked);
                  close();
                }}
              />
            ) : null
          ) : (
            <DatePickerSheet
              open={open === 'start' || open === 'end'}
              onClose={close}
              title={`${label} · ${open === 'end' ? t('notice.to') : t('notice.from')}`}
              value={(open === 'end' ? range?.end : range?.start) || null}
              min={open === 'end' && range?.start ? range.start : today}
              max={addDays(today, PICK_FUTURE_DAYS)}
              today={today}
              onChange={(picked) => {
                if (open === 'start' || open === 'end') setEnd(open, picked);
                close();
              }}
            />
          )}
        </div>
      );
    }
    case 'prayer':
      return <PrayerChoice label={label} value={textOf(value)} onChange={onChange} name={param.name} />;
    case 'number':
      return (
        <div data-param={param.name}>
          <TextField
            label={label}
            optional={!param.required}
            inputMode="numeric"
            dir="ltr"
            value={typeof value === 'number' ? String(value) : ''}
            maxLength={7}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '');
              onChange(digits === '' ? undefined : Number(digits));
            }}
          />
        </div>
      );
    case 'short_text':
      return (
        <div data-param={param.name}>
          <TextField
            label={label}
            optional={!param.required}
            dir="auto"
            value={textOf(value) ?? ''}
            maxLength={80}
            onChange={(event) => {
              onChange(event.target.value === '' ? undefined : event.target.value);
            }}
          />
        </div>
      );
    case 'phone':
      return <PhoneField label={label} optional={!param.required} name={param.name} onChange={onChange} />;
  }
}

/** A phone param: typed as the admin likes ("98765 43210"), kept as E.164 (+91 added for a 10-digit mobile). */
function PhoneField({
  label,
  optional,
  name,
  onChange,
}: {
  readonly label: string;
  readonly optional: boolean;
  readonly name: string;
  readonly onChange: (value: TemplateValue | undefined) => void;
}) {
  const { t } = useTranslation('admin');
  const [typed, setTyped] = useState('');
  return (
    <div data-param={name}>
      <TextField
        label={label}
        optional={optional}
        hint={t('notice.phoneHint')}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        dir="ltr"
        value={typed}
        maxLength={20}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(event.target.value.trim() === '' ? undefined : phoneValue(event.target.value));
        }}
      />
    </div>
  );
}

/** "prayer → 5 big buttons" (07 B5) — plus Jumu'ah: a radio group drawn as a 2-column grid of 56 px buttons. */
function PrayerChoice({
  label,
  value,
  onChange,
  name,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly onChange: (value: TemplateValue) => void;
  readonly name: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2" data-param={name}>
      <legend className="mb-2 type-headline text-text">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        {PRAYER_KEYS.map((prayer: PrayerKey) => {
          const checked = value === prayer;
          return (
            <label
              key={prayer}
              className={`flex min-h-14 cursor-pointer items-center justify-center rounded-md border-[1.5px] px-3 type-headline transition-state has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
                checked ? 'border-primary-700 bg-mint-50 text-primary-800' : 'border-border bg-surface text-text'
              }`}
            >
              <input
                type="radio"
                name={`${id}-prayer`}
                value={prayer}
                checked={checked}
                className="sr-only"
                onChange={() => {
                  onChange(prayer);
                }}
              />
              {t(`prayer.${prayer}`)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/avif';

export interface PhotoFieldProps {
  readonly masjidId: string | undefined;
  readonly photo: NoticePhoto | null;
  readonly onPhoto: (photo: NoticePhoto | null) => void;
}

/**
 * The optional photo (00 §4.3, 05 §9): the ownership tick first — the picker opens only once it is ticked — then the
 * upload (sanitized by the server), a thumbnail and "Remove photo". JPEG / PNG / WebP / AVIF: an iPhone converts HEIC
 * to JPEG for this picker.
 */
export function PhotoField({ masjidId, photo, onPhoto }: PhotoFieldProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const errorText = useErrorText();
  const upload = usePhotoUpload(masjidId);
  const [rights, setRights] = useState(photo !== null);
  const input = useRef<HTMLInputElement>(null);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    upload.mutate(file, {
      onSuccess: (stored) => {
        onPhoto({ key: stored.imageKey, thumbhash: stored.thumbhash, url: stored.urls.w480 });
      },
      onError: (error) => {
        toast.show({ message: errorText(error), tone: 'error' });
      },
    });
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="notice-photo">
      <div className="flex flex-col gap-1">
        <h2 id="notice-photo" className="type-headline text-text">
          {t('notice.photo')}
        </h2>
        <p className="type-footnote text-text-secondary">{t('notice.photoOptional')}</p>
      </div>
      {photo ? (
        <div className="flex flex-col gap-3">
          <Image src={photo.url} alt={t('notice.photoAlt')} thumbhash={photo.thumbhash} ratio="16/10" />
          <Button
            variant="outline"
            size="lg"
            fullWidth
            onPress={() => {
              onPhoto(null);
            }}
          >
            {t('notice.removePhoto')}
          </Button>
        </div>
      ) : (
        <>
          <Checkbox
            checked={rights}
            onChange={setRights}
            label={t('notice.rights')}
            description={t('notice.rightsHint')}
          />
          <input
            ref={input}
            type="file"
            accept={PHOTO_TYPES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={choose}
          />
          {upload.isPending ? (
            <p className="flex min-h-14 items-center gap-3 type-callout text-text-secondary" aria-live="polite">
              <Spinner size={24} />
              {t('notice.uploading')}
            </p>
          ) : (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              disabled={!rights}
              onPress={() => {
                input.current?.click();
              }}
            >
              {t('notice.addPhoto')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** What still blocks the preview, in plain words (shown after the admin tried to go on). */
export function NoticeIssues({
  issues,
  params,
}: {
  readonly issues: readonly NoticeIssue[];
  readonly params: readonly TemplateParam[];
}) {
  const { t } = useTranslation('admin');
  const paramLabel = useParamLabel();
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-live="polite" data-notice-issues>
      {issues.map((issue) => {
        const param = issue.kind === 'param' ? params.find((entry) => entry.name === issue.name) : undefined;
        return (
          <li key={issue.kind === 'param' ? `param-${issue.name}` : issue.kind}>
            <Tag tone="danger">
              {issue.kind === 'param'
                ? t('notice.issue.param', { name: param ? paramLabel(param) : issue.name })
                : t(`notice.issue.${issue.kind}`)}
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

export interface NoticePreviewProps {
  readonly item: FeedItem;
  readonly templates: readonly NoticeTemplate[] | undefined;
  readonly now: Date;
  readonly hasPhoto: boolean;
}

/** Step 3: the notice in the musalli Announcements card (`@mc/ui/content`), in each language (07 B5). */
export function NoticePreview({ item, templates, now, hasPhoto }: NoticePreviewProps) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const [shown, setShown] = useState<Locale>(item.contentLocale ?? locale);
  // A blood camp also shows its Home / Masjid Detail card (07 A22, T3.17).
  const camp = bloodCampOf(item);
  return (
    <div className="flex flex-col gap-3">
      <PreviewFrame
        locale={shown}
        onLocaleChange={setShown}
        label={t('notice.preview')}
        languageLabel={t('notice.showIn')}
      >
        <div className="flex flex-col gap-3">
          <FeedItemCard item={item} templates={templates} now={now} />
          {camp ? <BloodCampCard camp={camp} preview /> : null}
        </div>
      </PreviewFrame>
      {hasPhoto ? <InfoNote>{t('notice.previewNote')}</InfoNote> : null}
    </div>
  );
}

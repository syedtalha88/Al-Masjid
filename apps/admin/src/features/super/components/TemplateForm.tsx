import { INTL_LOCALE, type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { useTranslation } from '@mc/i18n/react';
import type * as RuntimeMessageModule from '@mc/i18n/runtime-message';
import {
  templateArgumentNames,
  templateArguments,
  type TemplateFormat,
  type TemplateValue,
} from '@mc/i18n/template-args';
import { TEMPLATE_CATEGORIES, TEMPLATE_PARAM_TYPES } from '@mc/shared/contracts';
import { TEMPLATE_ICONS, type TemplateIconName } from '@mc/shared/contracts/template-icons';
import {
  Button,
  Card,
  Checkbox,
  ChipGroup,
  IconButton,
  InfoNote,
  SectionHeader,
  SegmentedControl,
  Select,
  Switch,
  TextArea,
  TextField,
} from '@mc/ui/components';
import { MinusIcon, PlusIcon, TemplateIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { useEffect, useMemo, useState } from 'react';

export type Four = Record<Locale, string>;
export type ParamType = (typeof TEMPLATE_PARAM_TYPES)[number];
export interface ParamDraft {
  readonly name: string;
  readonly type: ParamType;
  readonly required: boolean;
}
/** Everything the C9 editor edits (07 C9). */
export interface TemplateDraft {
  readonly key: string;
  readonly category: (typeof TEMPLATE_CATEGORIES)[number];
  readonly icon: TemplateIconName;
  readonly isImportantDefault: boolean;
  readonly title: Four;
  readonly body: Four;
  readonly params: readonly ParamDraft[];
  readonly translationReviewed: boolean;
}

/** A stored icon name, or the megaphone when the name is not in the icon set any more. */
export const iconOf = (name: string): TemplateIconName => TEMPLATE_ICONS.find((icon) => icon === name) ?? 'megaphone';

export const EMPTY_DRAFT: TemplateDraft = {
  key: '',
  category: 'general',
  icon: 'megaphone',
  isImportantDefault: false,
  title: { en: '', hi: '', ur: '', te: '' },
  body: { en: '', hi: '', ur: '', te: '' },
  params: [],
  translationReviewed: false,
};

// The ICU parser is its own lazy chunk (DECISIONS #100): loaded once, on the editor only.
let runtime: Promise<typeof RuntimeMessageModule> | undefined;
function useRuntimeMessage() {
  const [module, setModule] = useState<typeof RuntimeMessageModule | undefined>();
  useEffect(() => {
    let live = true;
    runtime ??= import('@mc/i18n/runtime-message');
    void runtime.then((loaded) => {
      if (live) setModule(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  return module;
}

/** Sample values for the preview (fake, 10 §Fixtures). */
const SAMPLE: Readonly<Record<ParamType, TemplateValue>> = {
  time: '21:15',
  date: '2026-11-05',
  time_range: { start: '10:00', end: '14:00' },
  date_range: { start: '2026-11-05', end: '2026-11-07' },
  prayer: 'isha',
  number: 3,
  short_text: 'Test',
  phone: '+910000000000',
};
const sampleFormat = (locale: Locale): TemplateFormat => {
  const intl = INTL_LOCALE[locale];
  const time = new Intl.DateTimeFormat(intl, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const date = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return {
    time: (hhmm) => time.format(new Date(`2026-11-05T${hhmm}:00+05:30`)),
    date: (day) => date.format(new Date(`${day}T12:00:00+05:30`)),
    prayer: (name) => name.charAt(0).toUpperCase() + name.slice(1),
  };
};

/** Problems of one text, as the API checks them (DECISIONS #111). */
export function textProblem(
  module: typeof RuntimeMessageModule | undefined,
  text: string,
  allowed: ReadonlySet<string>,
  part: 'title' | 'body',
): { kind: 'invalid' } | { kind: 'title' } | { kind: 'unknown'; names: string } | null {
  if (!module || text.trim() === '') return null;
  const names = module.messageArguments(text);
  if (names === null) return { kind: 'invalid' };
  if (part === 'title' && names.length > 0) return { kind: 'title' };
  const unknown = names.filter((name) => !allowed.has(name));
  return unknown.length > 0 ? { kind: 'unknown', names: unknown.join(', ') } : null;
}

export interface TemplateFormProps {
  readonly draft: TemplateDraft;
  readonly onChange: (draft: TemplateDraft) => void;
  /** New templates choose their key. */
  readonly keyEditable: boolean;
  /** Params change only while a draft (DECISIONS #111). */
  readonly paramsEditable: boolean;
}

/** C9 editor fields: key, category, icon, important, params builder, text per language with live preview, review. */
export function TemplateForm({ draft, onChange, keyEditable, paramsEditable }: TemplateFormProps) {
  const { t } = useTranslation('super');
  const runtimeModule = useRuntimeMessage();
  const [language, setLanguage] = useState<Locale>('en');
  const set = (patch: Partial<TemplateDraft>) => {
    onChange({ ...draft, ...patch });
  };
  const allowed = useMemo(() => new Set(draft.params.flatMap(templateArgumentNames)), [draft.params]);
  const values = useMemo(
    () => Object.fromEntries(draft.params.map((param) => [param.name, SAMPLE[param.type]])),
    [draft.params],
  );
  const preview = runtimeModule?.formatRuntimeMessage(
    draft.body[language],
    language,
    templateArguments(values, draft.params, sampleFormat(language)),
  );
  const problemText = (problem: ReturnType<typeof textProblem>) =>
    problem === null
      ? undefined
      : problem.kind === 'invalid'
        ? t('templates.invalid', { braces: '{ }' })
        : problem.kind === 'title'
          ? t('templates.titleArguments')
          : t('templates.unknownArgument', { names: problem.names });
  const dir = language === 'ur' ? 'rtl' : 'ltr';

  const setParam = (index: number, patch: Partial<ParamDraft>) => {
    set({ params: draft.params.map((param, i) => (i === index ? { ...param, ...patch } : param)) });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        {keyEditable ? (
          <TextField
            label={t('templates.key')}
            hint={t('templates.keyHint')}
            value={draft.key}
            maxLength={64}
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            onChange={(event) => {
              set({ key: event.target.value.toLowerCase() });
            }}
          />
        ) : null}
        <ChipGroup
          label={t('templates.category')}
          value={draft.category}
          onChange={(category) => {
            set({ category });
          }}
          chips={TEMPLATE_CATEGORIES.map((id) => ({ id, label: t(`templates.categories.${id}`) }))}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="type-subhead-strong text-text">{t('templates.icon')}</legend>
          <div className="grid grid-cols-6 gap-2">
            {TEMPLATE_ICONS.map((icon) => (
              <Pressable
                key={icon}
                kind="card"
                aria-label={icon}
                aria-pressed={draft.icon === icon}
                onPress={() => {
                  set({ icon });
                }}
                className={`flex min-h-14 items-center justify-center rounded-sm ${
                  draft.icon === icon
                    ? 'bg-mint-100 text-primary-800 ring-2 ring-primary-700'
                    : 'bg-surface-muted text-text-secondary'
                }`}
              >
                <TemplateIcon name={icon} />
              </Pressable>
            ))}
          </div>
        </fieldset>
        <Switch
          label={t('templates.important')}
          checked={draft.isImportantDefault}
          onChange={(isImportantDefault) => {
            set({ isImportantDefault });
          }}
        />
      </Card>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t('templates.params')} />
        <Card className="flex flex-col gap-4">
          <p className="type-footnote text-text-secondary">{t('templates.paramsHint')}</p>
          {draft.params.map((param, index) => (
            <div key={index} className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0">
              <div className="flex items-end gap-2">
                <TextField
                  className="flex-1"
                  label={t('templates.paramName')}
                  value={param.name}
                  maxLength={40}
                  disabled={!paramsEditable}
                  autoCapitalize="none"
                  spellCheck={false}
                  dir="ltr"
                  onChange={(event) => {
                    setParam(index, { name: event.target.value });
                  }}
                />
                {paramsEditable ? (
                  <IconButton
                    label={t('templates.removeParam')}
                    icon={<MinusIcon />}
                    onPress={() => {
                      set({ params: draft.params.filter((_, i) => i !== index) });
                    }}
                  />
                ) : null}
              </div>
              <Select<ParamType>
                label={t('templates.paramType')}
                value={param.type}
                options={TEMPLATE_PARAM_TYPES.map((value) => ({ value, label: t(`templates.types.${value}`) }))}
                onChange={(type) => {
                  if (paramsEditable) setParam(index, { type });
                }}
              />
              <Checkbox
                label={t('templates.paramRequired')}
                checked={param.required}
                disabled={!paramsEditable}
                onChange={(required) => {
                  setParam(index, { required });
                }}
              />
            </div>
          ))}
          {paramsEditable && draft.params.length < 4 ? (
            <Button
              variant="outline"
              leadingIcon={<PlusIcon />}
              onPress={() => {
                set({ params: [...draft.params, { name: '', type: 'short_text', required: true }] });
              }}
            >
              {t('templates.addParam')}
            </Button>
          ) : null}
          {allowed.size > 0 ? (
            <p className="type-footnote text-text-secondary">
              {t('templates.available', { names: [...allowed].map((name) => `{${name}}`).join(' ') })}
            </p>
          ) : null}
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <SegmentedControl<Locale>
          label={t('templates.language')}
          value={language}
          onChange={setLanguage}
          segments={LOCALES.map((id) => ({ id, label: NATIVE_NAME[id] }))}
        />
        <Card className="flex flex-col gap-4">
          <TextField
            label={t('templates.title')}
            lang={language}
            dir={dir}
            value={draft.title[language]}
            maxLength={120}
            error={problemText(textProblem(runtimeModule, draft.title[language], allowed, 'title'))}
            onChange={(event) => {
              set({ title: { ...draft.title, [language]: event.target.value } });
            }}
          />
          <TextArea
            label={t('templates.body')}
            hint={t('templates.bodyHint')}
            lang={language}
            dir={dir}
            value={draft.body[language]}
            maxLength={1500}
            rows={4}
            error={problemText(textProblem(runtimeModule, draft.body[language], allowed, 'body'))}
            onChange={(event) => {
              set({ body: { ...draft.body, [language]: event.target.value } });
            }}
          />
        </Card>
        <Card variant="mint" className="flex flex-col gap-2" aria-live="polite">
          <p className="type-caption text-text-tertiary">{t('templates.preview')}</p>
          <div className="flex items-start gap-3" lang={language} dir={dir}>
            <TemplateIcon name={draft.icon} className="mt-0.5 shrink-0 text-primary-700" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="type-headline text-text">{draft.title[language]}</p>
              <p className="type-body whitespace-pre-line text-text-secondary">{preview ?? draft.body[language]}</p>
            </div>
          </div>
        </Card>
      </section>

      <Card className="flex flex-col gap-2">
        <Checkbox
          label={t('templates.reviewed')}
          description={t('templates.reviewedHint')}
          checked={draft.translationReviewed}
          onChange={(translationReviewed) => {
            set({ translationReviewed });
          }}
        />
      </Card>
      {!draft.translationReviewed ? <InfoNote>{t('templates.reviewFirst')}</InfoNote> : null}
    </div>
  );
}

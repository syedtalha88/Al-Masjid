import { addDays, calendarDateInZone } from '@mc/domain/time';
import { type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { PublishBar, StepHeader } from '@mc/ui/admin';
import {
  Button,
  DatePickerSheet,
  EmptyState,
  RadioCardGroup,
  SegmentedControl,
  Switch,
  TextArea,
  TextField,
} from '@mc/ui/components';
import { TemplateIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import {
  NoticeIssues,
  ParamField,
  PhotoField,
  PICK_FUTURE_DAYS,
  templateName,
} from '../features/notice/components/NoticeParts.tsx';
import { useNoticeTemplates } from '../features/notice/hooks/use-notice.ts';
import { setNoticeDraft, useNoticeDraft } from '../features/notice/lib/draft-store.ts';
import {
  NOTICE_CATEGORIES,
  type NoticeCategory,
  type NoticeDraft,
  noticeIssues,
  templateOf,
} from '../features/notice/lib/notice.ts';
import { SlotButton } from '../features/timings/components/EditorParts.tsx';
import { TimeSheet } from '../features/timings/components/TimingSheets.tsx';
import { ltr } from '../features/timings/lib/text.ts';

export const Route = createFileRoute('/notice/fill')({
  component: FillNoticeScreen,
});

/**
 * B5 step 2 — Fill (07 B5): the template's params as big pickers (no typing where a picker exists), or a title and
 * message in a chosen language; the type of notice and Important (preset by the template); an event's date and time;
 * an optional photo. "Next: Preview" shows what is still missing instead of going on.
 */
function FillNoticeScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const draft = useNoticeDraft();
  if (!draft) {
    return (
      <Screen title={t('notice.title')}>
        <EmptyState
          className="mt-8"
          title={t('notice.lostTitle')}
          body={t('notice.lostBody')}
          action={
            <Button
              size="lg"
              onPress={() => {
                navigator.replace('/notice');
              }}
            >
              {t('notice.startAgain')}
            </Button>
          }
        />
      </Screen>
    );
  }
  return <FillForm draft={draft} />;
}

function FillForm({ draft }: { readonly draft: NoticeDraft }) {
  const { t } = useTranslation('admin');
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const templates = useNoticeTemplates(masjid?.id);
  const today = calendarDateInZone(useMinute());
  // Each refused "Next" brings the list of what is missing into view (it sits above the bar, often off screen).
  const [tried, setTried] = useState(0);
  const issueList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tried > 0) issueList.current?.scrollIntoView({ block: 'center' });
  }, [tried]);
  const [picking, setPicking] = useState<'eventDate' | 'eventTime' | null>(null);

  const template = templateOf(draft, templates.data?.templates);
  const issues = templates.data || draft.content.kind === 'text' ? noticeIssues(draft, template) : [];
  const update = (patch: Partial<NoticeDraft>) => {
    setNoticeDraft({ ...draft, ...patch });
  };
  const { content } = draft;

  return (
    <Screen title={t('notice.title')}>
      <div className="flex flex-col gap-6">
        <StepHeader step={2} total={3} label={t('notice.step', { n: 2, total: 3 })} title={t('notice.fillTitle')} />

        {content.kind === 'template' ? (
          <>
            {template ? (
              <p className="flex items-center gap-3 type-title3 text-text">
                <TemplateIcon name={template.icon} size={28} className="shrink-0 text-primary-700" />
                {templateName(template, locale)}
              </p>
            ) : null}
            {template?.params.map((param) => (
              <ParamField
                key={param.name}
                param={param}
                value={content.values[param.name]}
                today={today}
                onChange={(value) => {
                  const { [param.name]: _previous, ...rest } = content.values;
                  update({
                    content: { ...content, values: value === undefined ? rest : { ...rest, [param.name]: value } },
                  });
                }}
              />
            ))}
          </>
        ) : (
          <>
            <SegmentedControl<Locale>
              label={t('notice.language')}
              segments={LOCALES.map((id) => ({ id, label: NATIVE_NAME[id] }))}
              value={content.locale}
              onChange={(next) => {
                update({ content: { ...content, locale: next } });
              }}
            />
            <TextField
              label={t('notice.ownTitle')}
              value={content.title}
              maxLength={80}
              dir="auto"
              lang={content.locale}
              onChange={(event) => {
                update({ content: { ...content, title: event.target.value } });
              }}
            />
            <TextArea
              label={t('notice.ownBody')}
              value={content.body}
              maxLength={1000}
              rows={6}
              dir="auto"
              lang={content.locale}
              onChange={(event) => {
                update({ content: { ...content, body: event.target.value } });
              }}
            />
          </>
        )}

        <RadioCardGroup<NoticeCategory>
          legend={t('notice.category')}
          name="notice-category"
          options={NOTICE_CATEGORIES.map((category) => ({
            value: category,
            title: t(`notice.categories.${category}`),
          }))}
          value={draft.category}
          onChange={(category) => {
            update({ category, ...(category === 'event' ? {} : { eventDate: null, eventTime: null }) });
          }}
        />

        {draft.category === 'event' ? (
          <div className="flex flex-col gap-2">
            <h2 className="type-headline text-text">{t('notice.event')}</h2>
            <div className="flex gap-3">
              <SlotButton
                label={t('notice.eventDate')}
                value={draft.eventDate === null ? t('notice.notSet') : format.calendarDate(draft.eventDate, 'long')}
                onPress={() => {
                  setPicking('eventDate');
                }}
              />
              <SlotButton
                label={t('notice.eventTime')}
                value={draft.eventTime === null ? t('notice.notSet') : ltr(format.time(draft.eventTime).text)}
                onPress={() => {
                  setPicking('eventTime');
                }}
              />
            </div>
            {draft.eventDate !== null || draft.eventTime !== null ? (
              <Button
                variant="ghost"
                onPress={() => {
                  update({ eventDate: null, eventTime: null });
                }}
              >
                {t('notice.eventClear')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <Switch
          checked={draft.isImportant}
          onChange={(isImportant) => {
            update({ isImportant });
          }}
          label={t('notice.important')}
          description={t('notice.importantHint')}
        />

        <PhotoField
          masjidId={masjid?.id}
          photo={draft.photo}
          onPhoto={(photo) => {
            update({ photo });
          }}
        />

        <div ref={issueList}>{tried > 0 ? <NoticeIssues issues={issues} params={template?.params ?? []} /> : null}</div>

        <PublishBar
          actionLabel={t('notice.next')}
          disabled={content.kind === 'template' && !templates.data}
          onAction={() => {
            if (issues.length > 0) {
              setTried((count) => count + 1);
              return;
            }
            navigator.push('/notice/preview');
          }}
        />
      </div>

      <DatePickerSheet
        open={picking === 'eventDate'}
        onClose={() => {
          setPicking(null);
        }}
        title={t('notice.eventDate')}
        value={draft.eventDate}
        min={today}
        max={addDays(today, PICK_FUTURE_DAYS)}
        today={today}
        onChange={(eventDate) => {
          update({ eventDate });
          setPicking(draft.eventTime === null ? 'eventTime' : null);
        }}
      />
      {picking === 'eventTime' ? (
        <TimeSheet
          open
          title={t('notice.eventTime')}
          value={draft.eventTime ?? '18:00'}
          onClose={() => {
            setPicking(null);
          }}
          onDone={(eventTime) => {
            update({ eventTime });
            setPicking(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

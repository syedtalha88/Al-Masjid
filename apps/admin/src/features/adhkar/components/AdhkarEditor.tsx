// B16 Adhkar after salah (07 B16, PHASE_03 T3.14): the "Show adhkar after salah" switch, the chosen dhikr in order
// (drag or Move up / Move down — WCAG 2.5.7 — and Remove), "Add dhikr" from the verified library (≤ 30), the musalli
// Home card in the preview frame (the real `@mc/ui/content` component), and Save. Library text only (CLAUDE.md §2.3).
import type { Locale } from '@mc/i18n/locales';
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import { ADHKAR_MAX, type AdminAdhkar, type AdminLibraryEntry } from '@mc/shared/contracts';
import { PreviewFrame, PublishBar } from '@mc/ui/admin';
import { ArabicText, Button, Card, EmptyState, ReorderList, Switch, Tag, useToast } from '@mc/ui/components';
import { AdhkarCard, libraryText } from '@mc/ui/content';
import { MoonStarsIcon, PlusIcon } from '@mc/ui/icons';
import { useMemo, useState } from 'react';

import { useErrorText } from '../../auth/hooks/use-session.ts';
import { LibrarySearchSheet } from '../../daily/components/DailyParts.tsx';
import { useSaveAdhkar } from '../hooks/use-adhkar.ts';
import { addDhikr, adhkarBody, adhkarChanged, type AdhkarEdit, moveDhikr, removeDhikr } from '../lib/adhkar.ts';

export function AdhkarEditor({
  masjidId,
  masjidName,
  saved,
}: {
  readonly masjidId: string | undefined;
  readonly masjidName: string | undefined;
  readonly saved: AdminAdhkar;
}) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const toast = useToast();
  const errorText = useErrorText();
  const save = useSaveAdhkar(masjidId);
  const [edit, setEdit] = useState<AdhkarEdit>(saved);
  const [adding, setAdding] = useState(false);
  const chosen = useMemo(() => new Set(edit.entries.map((entry) => entry.id)), [edit.entries]);
  const full = edit.entries.length >= ADHKAR_MAX;
  const changed = adhkarChanged(edit, saved);

  return (
    <div className="flex flex-col gap-6 pb-6">
      <Switch
        checked={edit.enabled}
        label={t('adhkar.show')}
        description={t('adhkar.showHint')}
        onChange={(enabled) => {
          setEdit({ ...edit, enabled });
        }}
      />
      <section aria-labelledby="adhkar-chosen" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="adhkar-chosen" className="type-headline text-text">
            {t('adhkar.chosen')}
          </h2>
          <Tag tone="neutral">
            {t('adhkar.count', { count: format.number(edit.entries.length), max: format.number(ADHKAR_MAX) })}
          </Tag>
        </div>
        {edit.entries.length === 0 ? (
          <EmptyState illustration={<MoonStarsIcon size={48} />} title={t('adhkar.none')} body={t('adhkar.noneBody')} />
        ) : (
          <ReorderList
            label={t('adhkar.chosen')}
            className="flex flex-col gap-3"
            items={edit.entries}
            keyOf={(entry) => entry.id}
            handleLabel={(entry) => t('adhkar.reorder', { reference: entry.reference })}
            onReorder={(from, to) => {
              setEdit((current) => moveDhikr(current, from, to));
            }}
            renderItem={(entry, index) => (
              <DhikrRow
                entry={entry}
                first={index === 0}
                last={index === edit.entries.length - 1}
                onMove={(by) => {
                  setEdit((current) => moveDhikr(current, index, index + by));
                }}
                onRemove={() => {
                  setEdit((current) => removeDhikr(current, entry.id));
                }}
              />
            )}
          />
        )}
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          leadingIcon={<PlusIcon />}
          disabled={full}
          onPress={() => {
            setAdding(true);
          }}
        >
          {t('adhkar.add')}
        </Button>
        {full ? (
          <p className="type-footnote text-text-secondary">{t('adhkar.full', { max: format.number(ADHKAR_MAX) })}</p>
        ) : null}
      </section>
      {edit.entries[0] ? <AdhkarPreview first={edit.entries[0]} masjidName={masjidName} /> : null}
      <PublishBar
        actionLabel={t('adhkar.save')}
        busy={save.isPending}
        disabled={!changed}
        onAction={() => {
          save.mutate(adhkarBody(edit), {
            onSuccess: (answer) => {
              setEdit(answer);
              toast.show({ message: t('adhkar.saved'), tone: 'success' });
            },
            onError: (error) => {
              toast.show({ message: errorText(error), tone: 'error' });
            },
          });
        }}
      />
      <LibrarySearchSheet
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        masjidId={masjidId}
        kind="dhikr"
        title={t('adhkar.searchTitle')}
        chosen={chosen}
        onPick={(entry) => {
          setEdit((current) => addDhikr(current, entry));
          setAdding(false);
        }}
      />
    </div>
  );
}

/** One chosen dhikr: the Arabic (two lines), the translation in the admin's language, the repeat count, the actions. */
function DhikrRow({
  entry,
  first,
  last,
  onMove,
  onRemove,
}: {
  readonly entry: AdminLibraryEntry;
  readonly first: boolean;
  readonly last: boolean;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const text = libraryText(entry, locale);
  return (
    <Card className="flex min-w-0 flex-1 flex-col gap-2" data-dhikr={entry.id}>
      <ArabicText className="line-clamp-2">{entry.arabic}</ArabicText>
      <p dir="auto" className="line-clamp-2 type-callout text-text">
        {text.translation}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="primary">{t('adhkar.repeat', { count: entry.repeat ?? 1 })}</Tag>
        <span className="type-footnote text-text-secondary">
          <Bdi>{entry.reference}</Bdi>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={first}
          onPress={() => {
            onMove(-1);
          }}
        >
          {t('adhkar.moveUp')}
        </Button>
        <Button
          variant="outline"
          disabled={last}
          onPress={() => {
            onMove(1);
          }}
        >
          {t('adhkar.moveDown')}
        </Button>
        <Button variant="danger" onPress={onRemove}>
          {t('adhkar.remove')}
        </Button>
      </div>
    </Card>
  );
}

/** The musalli Home card as it will look after Maghrib, in each language (T3.11 preview frame). */
function AdhkarPreview({
  first,
  masjidName,
}: {
  readonly first: AdminLibraryEntry;
  readonly masjidName: string | undefined;
}) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const [shown, setShown] = useState<Locale>(locale);
  return (
    <PreviewFrame
      locale={shown}
      onLocaleChange={setShown}
      label={t('adhkar.preview')}
      languageLabel={t('notice.showIn')}
    >
      <AdhkarCard
        prayer="maghrib"
        masjid={masjidName}
        arabic={first.arabic}
        onSeeAll={() => undefined}
        onDismiss={() => undefined}
      />
    </PreviewFrame>
  );
}

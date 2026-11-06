import { type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import {
  RUQYAH_ARABIC_MAX,
  RUQYAH_CATEGORIES,
  RUQYAH_INSTRUCTIONS_MAX,
  RUQYAH_REFERENCE_MAX,
  RUQYAH_TITLE_MAX,
  RUQYAH_TRANSLATION_MAX,
  type RuqyahCategory,
} from '@mc/shared/contracts';
import { PreviewFrame, PublishBar } from '@mc/ui/admin';
import {
  ArabicText,
  Button,
  Card,
  ChipGroup,
  Dialog,
  EmptyState,
  RadioCardGroup,
  SkeletonText,
  TextArea,
  TextField,
  useToast,
} from '@mc/ui/components';
import { RuqyahCard } from '@mc/ui/content';
import { BookOpenIcon, PencilIcon, PlayCircleIcon } from '@mc/ui/icons';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { LibrarySearchSheet } from '../features/daily/components/DailyParts.tsx';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useRuqyah, useRuqyahWrites } from '../features/ruqyah/hooks/use-ruqyah.ts';
import {
  draftBody,
  draftDirty,
  draftIssues,
  draftOf,
  emptyDraft,
  previewEntry,
  type RuqyahDraft,
  type RuqyahSource,
} from '../features/ruqyah/lib/ruqyah.ts';
import { VoiceField } from '../features/voice/components/VoiceField.tsx';

export const Route = createFileRoute('/ruqyah/$id')({
  component: RuqyahEntryScreen,
});

/** The path id of a new entry (`/ruqyah/new`; saved entries use their UUID). */
const NEW = 'new';
const LIBRARY_KINDS = ['dua', 'ayah', 'hadith', 'dhikr'] as const;
type LibraryKind = (typeof LIBRARY_KINDS)[number];
const LANGUAGE_CHIPS = LOCALES.map((id) => ({ id, label: NATIVE_NAME[id] }));

/**
 * B15 Ruqyah entry (07 B15, PHASE_03 T3.15): what it is — from the verified library, text the masjid types (Arabic +
 * translation + optional reference, shown to musallis as "Added by <masjid>"), or a recording (B14, with the ownership
 * tick and a title) — under which heading, an optional title and instruction, the musalli card in the preview, Save.
 * A saved entry can be changed or deleted.
 */
function RuqyahEntryScreen() {
  const { t } = useTranslation('admin');
  const { t: te } = useTranslation('errors');
  const { locale } = useLocale();
  const { params } = useScreen();
  const entryId = params['id'] ?? NEW;
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const list = useRuqyah(masjid?.id);

  if (entryId === NEW) {
    return <Editor masjidId={masjid?.id} masjidName={masjid?.name ?? ''} entryId={null} saved={emptyDraft(locale)} />;
  }
  if (list.isError) {
    return (
      <Screen title={t('ruqyah.editTitle')}>
        <EmptyState className="mt-8" title={errorText(list.error)} />
      </Screen>
    );
  }
  if (!list.data) {
    return (
      <Screen title={t('ruqyah.editTitle')}>
        <div aria-busy className="py-4">
          <SkeletonText lines={6} />
        </div>
      </Screen>
    );
  }
  const entry = list.data.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return (
      <Screen title={t('ruqyah.editTitle')}>
        <EmptyState className="mt-8" title={te('RUQYAH_NOT_FOUND')} />
      </Screen>
    );
  }
  return (
    <Editor
      key={entry.id}
      masjidId={masjid?.id}
      masjidName={masjid?.name ?? ''}
      entryId={entry.id}
      saved={draftOf(entry, locale)}
    />
  );
}

function Editor({
  masjidId,
  masjidName,
  entryId,
  saved,
}: {
  readonly masjidId: string | undefined;
  readonly masjidName: string;
  readonly entryId: string | null;
  readonly saved: RuqyahDraft;
}) {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const { save, remove } = useRuqyahWrites(masjidId);
  const [draft, setDraft] = useState(saved);
  const [kind, setKind] = useState<LibraryKind>(saved.library?.kind ?? 'dua');
  const [searching, setSearching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shown, setShown] = useState<Locale>(locale);
  const set = (patch: Partial<RuqyahDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const issues = draftIssues(draft);
  const body = draftBody(draft);
  const canSave = body !== null && draftDirty(saved, draft);
  const preview = previewEntry(draft);

  const sourceOptions = [
    { value: 'library', icon: <BookOpenIcon size={28} /> },
    { value: 'text', icon: <PencilIcon size={28} /> },
    { value: 'audio', icon: <PlayCircleIcon size={28} /> },
  ] as const;

  return (
    <Screen title={t(entryId === null ? 'ruqyah.newTitle' : 'ruqyah.editTitle')}>
      <div className="flex flex-col gap-6 pb-6" data-ruqyah-editor>
        <RadioCardGroup<RuqyahSource>
          legend={t('ruqyah.sourceQuestion')}
          name="ruqyah-source"
          options={sourceOptions.map((option) => ({
            value: option.value,
            title: t(`ruqyah.source.${option.value}`),
            description: t(`ruqyah.sourceHint.${option.value}`),
            leading: option.icon,
          }))}
          value={draft.source}
          onChange={(source) => {
            set({ source });
          }}
        />
        <RadioCardGroup<RuqyahCategory>
          legend={t('ruqyah.categoryQuestion')}
          name="ruqyah-category"
          options={RUQYAH_CATEGORIES.map((category) => ({
            value: category,
            title: tc(`ui.ruqyah.category.${category}`),
          }))}
          value={draft.category}
          onChange={(category) => {
            set({ category });
          }}
        />

        {draft.source === 'library' ? (
          <section className="flex flex-col gap-3" aria-labelledby="ruqyah-library">
            <h2 id="ruqyah-library" className="type-headline text-text">
              {t('ruqyah.libraryTitle')}
            </h2>
            <ChipGroup<LibraryKind>
              label={t('ruqyah.kindLabel')}
              value={kind}
              onChange={setKind}
              chips={LIBRARY_KINDS.map((id) => ({ id, label: t(`ruqyah.kind.${id}`) }))}
            />
            {draft.library ? (
              <Card className="flex flex-col gap-2" data-ruqyah-picked={draft.library.id}>
                <ArabicText className="line-clamp-3">{draft.library.arabic}</ArabicText>
                <p className="type-footnote text-text-secondary">
                  <Bdi>{draft.library.reference}</Bdi>
                </p>
              </Card>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leadingIcon={<BookOpenIcon />}
              onPress={() => {
                setSearching(true);
              }}
            >
              {t(draft.library ? 'ruqyah.libraryChange' : 'ruqyah.libraryChoose')}
            </Button>
          </section>
        ) : null}

        {draft.source === 'text' ? (
          <section className="flex flex-col gap-4" aria-labelledby="ruqyah-text">
            <h2 id="ruqyah-text" className="type-headline text-text">
              {t('ruqyah.textTitle')}
            </h2>
            <TextArea
              label={t('ruqyah.arabic')}
              lang="ar"
              dir="rtl"
              rows={5}
              maxLength={RUQYAH_ARABIC_MAX}
              value={draft.arabic}
              onChange={(event) => {
                set({ arabic: event.target.value });
              }}
            />
            <TextArea
              label={t('ruqyah.translation')}
              lang={draft.translationLocale}
              dir="auto"
              rows={4}
              maxLength={RUQYAH_TRANSLATION_MAX}
              value={draft.translation}
              onChange={(event) => {
                set({ translation: event.target.value });
              }}
            />
            <ChipGroup<Locale>
              label={t('ruqyah.translationLanguage')}
              value={draft.translationLocale}
              onChange={(translationLocale) => {
                set({ translationLocale });
              }}
              chips={LANGUAGE_CHIPS}
            />
            <TextField
              label={t('ruqyah.reference')}
              optional
              hint={t('ruqyah.referenceHint')}
              maxLength={RUQYAH_REFERENCE_MAX}
              value={draft.reference}
              onChange={(event) => {
                set({ reference: event.target.value });
              }}
            />
          </section>
        ) : null}

        {draft.source === 'audio' ? (
          <VoiceField
            masjidId={masjidId}
            voice={draft.voice}
            onVoice={(voice) => {
              set({ voice });
            }}
            title={{
              value: draft.title,
              onChange: (title) => {
                set({ title });
              },
            }}
          />
        ) : null}

        {draft.source !== null && draft.source !== 'audio' ? (
          <TextField
            label={t('ruqyah.entryTitle')}
            optional
            maxLength={RUQYAH_TITLE_MAX}
            value={draft.title}
            onChange={(event) => {
              set({ title: event.target.value });
            }}
          />
        ) : null}

        {draft.source !== null ? (
          <div className="flex flex-col gap-3">
            <TextArea
              label={t('ruqyah.instructions')}
              optional
              hint={t('ruqyah.instructionsHint')}
              lang={draft.instructionsLocale}
              dir="auto"
              rows={3}
              maxLength={RUQYAH_INSTRUCTIONS_MAX}
              value={draft.instructions}
              onChange={(event) => {
                set({ instructions: event.target.value });
              }}
            />
            {draft.instructions.trim() !== '' ? (
              <ChipGroup<Locale>
                label={t('ruqyah.instructionsLanguage')}
                value={draft.instructionsLocale}
                onChange={(instructionsLocale) => {
                  set({ instructionsLocale });
                }}
                chips={LANGUAGE_CHIPS}
              />
            ) : null}
          </div>
        ) : null}

        {preview ? (
          <PreviewFrame
            locale={shown}
            onLocaleChange={setShown}
            label={t('ruqyah.preview')}
            languageLabel={t('notice.showIn')}
          >
            <div className="p-4">
              <RuqyahCard entry={preview} masjid={masjidName} audioSrc={draft.voice?.url ?? null} />
            </div>
          </PreviewFrame>
        ) : null}

        {issues.length > 0 && draft.source !== null ? (
          <p className="type-footnote text-text-secondary" aria-live="polite" data-ruqyah-missing>
            {t('ruqyah.missing', { fields: issues.map((issue) => t(`ruqyah.issue.${issue}`)).join(', ') })}
          </p>
        ) : null}

        {entryId !== null ? (
          <Button
            variant="danger"
            size="lg"
            fullWidth
            onPress={() => {
              setDeleting(true);
            }}
          >
            {t('ruqyah.delete')}
          </Button>
        ) : null}

        <PublishBar
          actionLabel={t('ruqyah.save')}
          disabled={!canSave}
          busy={save.isPending}
          onAction={() => {
            if (!body) return;
            save.mutate(
              { entryId, body },
              {
                onSuccess: () => {
                  toast.show({ message: t('ruqyah.saved'), tone: 'success' });
                  navigator.back();
                },
                onError: (error) => {
                  toast.show({ message: errorText(error), tone: 'error' });
                },
              },
            );
          }}
        />
      </div>

      <LibrarySearchSheet
        open={searching}
        onClose={() => {
          setSearching(false);
        }}
        masjidId={masjidId}
        kind={kind}
        title={t('ruqyah.searchTitle')}
        chosen={draft.library ? new Set([draft.library.id]) : undefined}
        onPick={(library) => {
          set({ library });
          setSearching(false);
        }}
      />
      {entryId !== null ? (
        <Dialog
          open={deleting}
          destructive
          loading={remove.isPending}
          onClose={() => {
            setDeleting(false);
          }}
          title={t('ruqyah.deleteTitle')}
          body={t('ruqyah.deleteBody')}
          confirmLabel={t('ruqyah.delete')}
          onConfirm={() => {
            remove.mutate(entryId, {
              onSuccess: () => {
                setDeleting(false);
                toast.show({ message: t('ruqyah.deleted'), tone: 'success' });
                navigator.back();
              },
              onError: (error) => {
                setDeleting(false);
                toast.show({ message: errorText(error), tone: 'error' });
              },
            });
          }}
        />
      ) : null}
    </Screen>
  );
}

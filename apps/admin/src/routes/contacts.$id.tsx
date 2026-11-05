import type { Locale } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { CONTACT_NAME_MAX, CONTACT_ROLE_MAX, CONTACT_TOPICS_MAX } from '@mc/shared/contracts';
import { PreviewFrame, PublishBar } from '@mc/ui/admin';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  RadioCardGroup,
  SkeletonText,
  TextField,
  useToast,
} from '@mc/ui/components';
import { IlmContactCard } from '@mc/ui/content';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useContacts, useContactWrites } from '../features/contacts/hooks/use-contacts.ts';
import {
  applyChange,
  type ContactAudience,
  type ContactDraft,
  draftBody,
  draftDirty,
  draftIssues,
  draftOf,
  emptyDraft,
} from '../features/contacts/lib/contacts.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { phoneValue } from '../features/notice/lib/notice.ts';

export const Route = createFileRoute('/contacts/$id')({
  component: ContactScreen,
});

/** The path id of a new contact (`/contacts/new`; saved contacts use their UUID). */
const NEW = 'new';
const AUDIENCES = ['brothers', 'sisters'] as const;

/**
 * B17 Ilm contact (07 B17, PHASE_03 T3.16): name, role, topics, WhatsApp number (+91 prefilled), "For brothers / For
 * sisters", and the required tick that the person agreed to be listed; the musalli card in the preview; Save. A saved
 * contact can be changed (a new name or number needs the tick again) or removed — also how a "remove me" request is done.
 */
function ContactScreen() {
  const { t } = useTranslation('admin');
  const { t: te } = useTranslation('errors');
  const { params } = useScreen();
  const contactId = params['id'] ?? NEW;
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const list = useContacts(masjid?.id);

  if (contactId === NEW) return <Editor masjidId={masjid?.id} contactId={null} saved={null} />;
  if (list.isError) {
    return (
      <Screen title={t('contacts.editTitle')}>
        <EmptyState className="mt-8" title={errorText(list.error)} />
      </Screen>
    );
  }
  if (!list.data) {
    return (
      <Screen title={t('contacts.editTitle')}>
        <div aria-busy className="py-4">
          <SkeletonText lines={6} />
        </div>
      </Screen>
    );
  }
  const contact = list.data.contacts.find((candidate) => candidate.id === contactId);
  if (!contact) {
    return (
      <Screen title={t('contacts.editTitle')}>
        <EmptyState className="mt-8" title={te('CONTACT_NOT_FOUND')} />
      </Screen>
    );
  }
  return <Editor key={contact.id} masjidId={masjid?.id} contactId={contact.id} saved={draftOf(contact)} />;
}

function Editor({
  masjidId,
  contactId,
  saved,
}: {
  readonly masjidId: string | undefined;
  readonly contactId: string | null;
  readonly saved: ContactDraft | null;
}) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const { save, remove } = useContactWrites(masjidId);
  const [draft, setDraft] = useState<ContactDraft>(saved ?? emptyDraft());
  const [deleting, setDeleting] = useState(false);
  const [shown, setShown] = useState<Locale>(locale);
  const set = (patch: Partial<ContactDraft>) => {
    setDraft((current) => applyChange(saved, current, patch));
  };
  const issues = draftIssues(draft);
  const body = draftBody(draft);
  const canSave = body !== null && (saved === null || draftDirty(saved, draft));
  const started = draft.name.trim() !== '' || draft.audience !== null;

  return (
    <Screen title={t(contactId === null ? 'contacts.newTitle' : 'contacts.editTitle')}>
      <div className="flex flex-col gap-6 pb-6" data-contact-editor>
        <TextField
          label={t('contacts.name')}
          autoComplete="off"
          dir="auto"
          maxLength={CONTACT_NAME_MAX}
          value={draft.name}
          onChange={(event) => {
            set({ name: event.target.value });
          }}
        />
        <TextField
          label={t('contacts.role')}
          optional
          hint={t('contacts.roleHint')}
          dir="auto"
          maxLength={CONTACT_ROLE_MAX}
          value={draft.role}
          onChange={(event) => {
            set({ role: event.target.value });
          }}
        />
        <TextField
          label={t('contacts.topics')}
          optional
          hint={t('contacts.topicsHint')}
          dir="auto"
          maxLength={CONTACT_TOPICS_MAX}
          value={draft.topics}
          onChange={(event) => {
            set({ topics: event.target.value });
          }}
        />
        <TextField
          label={t('contacts.whatsapp')}
          hint={t('notice.phoneHint')}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          dir="ltr"
          maxLength={20}
          value={draft.phone}
          onChange={(event) => {
            set({ phone: event.target.value });
          }}
        />
        <RadioCardGroup<ContactAudience>
          legend={t('contacts.audienceQuestion')}
          name="contact-audience"
          options={AUDIENCES.map((audience) => ({ value: audience, title: t(`contacts.for.${audience}`) }))}
          value={draft.audience}
          onChange={(audience) => {
            set({ audience });
          }}
        />
        <Checkbox
          checked={draft.consent}
          onChange={(consent) => {
            set({ consent });
          }}
          label={t('contacts.consent')}
          description={t('contacts.consentHint')}
        />

        {draft.name.trim() !== '' ? (
          <PreviewFrame
            locale={shown}
            onLocaleChange={setShown}
            label={t('contacts.preview')}
            languageLabel={t('notice.showIn')}
          >
            <div className="p-4">
              <IlmContactCard
                preview
                contact={{
                  name: draft.name.trim(),
                  ...(draft.role.trim() === '' ? {} : { role: draft.role.trim() }),
                  ...(draft.topics.trim() === '' ? {} : { topics: draft.topics.trim() }),
                  whatsapp: phoneValue(draft.phone.trim()),
                }}
              />
            </div>
          </PreviewFrame>
        ) : null}

        {issues.length > 0 && started ? (
          <p className="type-footnote text-text-secondary" aria-live="polite" data-contact-missing>
            {t('contacts.missing', { fields: issues.map((issue) => t(`contacts.issue.${issue}`)).join(', ') })}
          </p>
        ) : null}

        {contactId !== null ? (
          <Button
            variant="danger"
            size="lg"
            fullWidth
            onPress={() => {
              setDeleting(true);
            }}
          >
            {t('contacts.delete')}
          </Button>
        ) : null}

        <PublishBar
          actionLabel={t('contacts.save')}
          disabled={!canSave}
          busy={save.isPending}
          onAction={() => {
            if (!body) return;
            save.mutate(
              { contactId, body },
              {
                onSuccess: () => {
                  toast.show({ message: t('contacts.saved'), tone: 'success' });
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

      {contactId !== null ? (
        <Dialog
          open={deleting}
          destructive
          loading={remove.isPending}
          onClose={() => {
            setDeleting(false);
          }}
          title={t('contacts.deleteTitle')}
          body={t('contacts.deleteBody')}
          confirmLabel={t('contacts.delete')}
          onConfirm={() => {
            remove.mutate(contactId, {
              onSuccess: () => {
                setDeleting(false);
                toast.show({ message: t('contacts.deleted'), tone: 'success' });
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

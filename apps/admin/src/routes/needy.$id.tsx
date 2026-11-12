import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import {
  BENEFICIARY_CAP_MAX_PAISE,
  BENEFICIARY_CATEGORY_VALUES,
  BENEFICIARY_NAME_MAX,
  BENEFICIARY_NOTE_MAX,
  BENEFICIARY_REASON_MAX,
} from '@mc/shared/contracts';
import { PublishBar } from '@mc/ui/admin';
import {
  Button,
  Checkbox,
  EmptyState,
  InfoNote,
  NumberPad,
  RadioCardGroup,
  SkeletonText,
  Switch,
  TextArea,
  TextField,
  useToast,
} from '@mc/ui/components';
import { CameraIcon, ShieldCheckIcon } from '@mc/ui/icons';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useNeedy, useNeedyWrites } from '../features/needy/hooks/use-needy.ts';
import {
  draftFromScan,
  draftOf,
  emptyDraft,
  NEEDY_PAYEE_MAX,
  needyBody,
  type NeedyCategory,
  type NeedyDraft,
  needyIssues,
  withPrivate,
} from '../features/needy/lib/needy.ts';
import { UpiScanSheet, useCanScanUpi } from '../features/payment/components/UpiScanSheet.tsx';

export const Route = createFileRoute('/needy/$id')({
  component: NeedyPersonScreen,
});

/** The path id of a new person (`/needy/new`; listed people use their UUID). */
const NEW = 'new';

/**
 * B19 add / edit (07 B19, 00 §4.14, 05 §1, PHASE_05 T5.8): display name ("first name or initials only"), category
 * cards, reason, the person's own UPI ID (typed, or scanned from their UPI QR) and payee name, the amount needed on the
 * NumberPad, the zakat-eligible switch, the private phone / note ("only admins of this masjid see this" — stored
 * encrypted; for a listed person shown only on request, and each view is recorded) and the consent tick, required on
 * every save. Only active people are edited.
 */
function NeedyPersonScreen() {
  const { t } = useTranslation('admin');
  const { t: te } = useTranslation('errors');
  const { params } = useScreen();
  const personId = params['id'] ?? NEW;
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const list = useNeedy(masjid?.id);

  if (personId === NEW) return <Editor masjidId={masjid?.id} personId={null} saved={null} />;
  if (list.isError) {
    return (
      <Screen title={t('needy.editTitle')}>
        <EmptyState className="mt-8" title={errorText(list.error)} />
      </Screen>
    );
  }
  if (!list.data) {
    return (
      <Screen title={t('needy.editTitle')}>
        <div aria-busy className="py-4">
          <SkeletonText lines={6} />
        </div>
      </Screen>
    );
  }
  const person = list.data.people.find((candidate) => candidate.id === personId && candidate.status === 'active');
  if (!person) {
    return (
      <Screen title={t('needy.editTitle')}>
        <EmptyState className="mt-8" title={te('BENEFICIARY_NOT_FOUND')} />
      </Screen>
    );
  }
  return <Editor key={person.id} masjidId={masjid?.id} personId={person.id} saved={draftOf(person)} />;
}

function Editor({
  masjidId,
  personId,
  saved,
}: {
  readonly masjidId: string | undefined;
  readonly personId: string | null;
  readonly saved: NeedyDraft | null;
}) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const format = formatters(locale);
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const { save, showPrivate } = useNeedyWrites(masjidId);
  const canScan = useCanScanUpi();
  const [draft, setDraft] = useState<NeedyDraft>(saved ?? emptyDraft());
  const [scanning, setScanning] = useState(false);
  const set = (patch: Partial<NeedyDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const issues = needyIssues(draft);
  const body = needyBody(draft, locale);
  const started = saved !== null || draft.name.trim() !== '' || draft.category !== null;

  return (
    <Screen title={t(personId === null ? 'needy.newTitle' : 'needy.editTitle')}>
      <div className="flex flex-col gap-6 pb-6" data-needy-editor>
        <TextField
          label={t('needy.name')}
          hint={t('needy.nameHint')}
          autoComplete="off"
          dir="auto"
          maxLength={BENEFICIARY_NAME_MAX}
          value={draft.name}
          onChange={(event) => {
            set({ name: event.target.value });
          }}
        />
        <RadioCardGroup<NeedyCategory>
          legend={t('needy.categoryQuestion')}
          name="needy-category"
          options={BENEFICIARY_CATEGORY_VALUES.map((category) => ({
            value: category,
            title: t(`needy.category.${category}`),
          }))}
          value={draft.category}
          onChange={(category) => {
            set({ category });
          }}
        />
        <TextArea
          label={t('needy.reason')}
          hint={t('needy.reasonHint')}
          dir="auto"
          maxLength={BENEFICIARY_REASON_MAX}
          value={draft.reason}
          onChange={(event) => {
            set({ reason: event.target.value });
          }}
        />

        <section className="flex flex-col gap-4" aria-labelledby="needy-upi">
          <h2 id="needy-upi" className="type-headline text-text">
            {t('needy.upiTitle')}
          </h2>
          <p className="type-callout text-text-secondary">{t('needy.upiHint')}</p>
          {canScan ? (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leadingIcon={<CameraIcon />}
              onPress={() => {
                setScanning(true);
              }}
            >
              {t('needy.scan')}
            </Button>
          ) : null}
          <TextField
            label={t('payment.vpa')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            dir="ltr"
            maxLength={256}
            value={draft.vpa}
            onChange={(event) => {
              set({ vpa: event.target.value });
            }}
          />
          <TextField
            label={t('payment.payee')}
            hint={t('payment.payeeHint')}
            autoComplete="off"
            dir="auto"
            maxLength={NEEDY_PAYEE_MAX}
            value={draft.payee}
            onChange={(event) => {
              set({ payee: event.target.value });
            }}
          />
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="needy-cap">
          <h2 id="needy-cap" className="type-headline text-text">
            {t('needy.cap')}
          </h2>
          <p className="type-title2 text-center text-text" aria-live="polite">
            {format.money(draft.capPaise)}
          </p>
          <p className="type-footnote text-center text-text-secondary">{t('needy.capHint')}</p>
          <NumberPad
            value={draft.capPaise}
            max={BENEFICIARY_CAP_MAX_PAISE}
            onChange={(capPaise) => {
              set({ capPaise });
            }}
            label={t('needy.cap')}
          />
        </section>

        <Switch
          checked={draft.zakat}
          onChange={(zakat) => {
            set({ zakat });
          }}
          label={t('needy.zakatLabel')}
          description={t('needy.zakatHint')}
        />

        <section className="flex flex-col gap-4" aria-labelledby="needy-private" data-needy-private>
          <h2 id="needy-private" className="type-headline text-text">
            {t('needy.privateTitle')}
          </h2>
          <InfoNote icon={<ShieldCheckIcon />}>{t('needy.privateHint')}</InfoNote>
          {draft.privateLoaded ? (
            <>
              <TextField
                label={t('needy.phone')}
                optional
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
              <TextArea
                label={t('needy.note')}
                optional
                dir="auto"
                maxLength={BENEFICIARY_NOTE_MAX}
                value={draft.note}
                onChange={(event) => {
                  set({ note: event.target.value });
                }}
              />
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="lg"
                fullWidth
                loading={showPrivate.isPending}
                onPress={() => {
                  if (personId === null) return;
                  showPrivate.mutate(personId, {
                    onSuccess: (result) => {
                      setDraft((current) => withPrivate(current, result.private));
                    },
                    onError: (error) => {
                      toast.show({ message: errorText(error), tone: 'error' });
                    },
                  });
                }}
              >
                {t('needy.showPrivate')}
              </Button>
              <p className="type-footnote text-text-secondary">{t('needy.showPrivateHint')}</p>
            </>
          )}
        </section>

        <Checkbox
          checked={draft.consent}
          onChange={(consent) => {
            set({ consent });
          }}
          label={t('needy.consent')}
          description={t('needy.consentHint')}
        />

        {issues.length > 0 && started ? (
          <p className="type-footnote text-text-secondary" aria-live="polite" data-needy-missing>
            {t('needy.missing', { fields: issues.map((issue) => t(`needy.issue.${issue}`)).join(', ') })}
          </p>
        ) : null}

        <PublishBar
          actionLabel={t('needy.save')}
          disabled={body === null}
          busy={save.isPending}
          onAction={() => {
            if (!body) return;
            save.mutate(
              { personId, body },
              {
                onSuccess: (result) => {
                  toast.show({
                    message: t(result.status === 'fulfilled' ? 'needy.fulfilledNote' : 'needy.personSaved'),
                    tone: 'success',
                  });
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

      <UpiScanSheet
        title={t('needy.scan')}
        hint={t('needy.scanHint')}
        open={scanning}
        onClose={() => {
          setScanning(false);
        }}
        onText={(text) => {
          const next = draftFromScan(text, draft);
          if (!next) return false;
          setDraft(next);
          setScanning(false);
          toast.show({ message: t('payment.scanFilled'), tone: 'success' });
          return true;
        }}
      />
    </Screen>
  );
}

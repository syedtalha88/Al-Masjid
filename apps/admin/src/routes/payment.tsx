import { useTranslation } from '@mc/i18n/react';
import { PublishBar } from '@mc/ui/admin';
import { Button, InfoNote, SkeletonText, TextArea, TextField, useToast } from '@mc/ui/components';
import { CameraIcon, ShieldCheckIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { UpiScanSheet, useCanScanUpi } from '../features/payment/components/UpiScanSheet.tsx';
import { usePayment, usePaymentRequest } from '../features/payment/hooks/use-payment.ts';
import {
  draftFromScan,
  draftIssues,
  emptyDraft,
  NOTE_MAX,
  PAYEE_MAX,
  type PaymentDraft,
  requestBody,
} from '../features/payment/lib/payment.ts';

export const Route = createFileRoute('/payment')({
  component: PaymentScreen,
});

/**
 * B8 "UPI setup / change" (07 B8, 04 R1, PHASE_05 T5.2): scan the masjid's own UPI QR (phones with a built-in QR
 * reader — DECISIONS #147) or type the UPI ID, the payee name as the bank shows it, a note for the Super Admin, and
 * "Send for approval" under the safety warning: nothing changes for followers until the Super Admin approves and 24 h
 * have passed, and then they are told. While a request is open the form explains that instead.
 */
function PaymentScreen() {
  const { t } = useTranslation('admin');
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const payment = usePayment(masjid?.id);
  const open = payment.data?.request?.status === 'pending' || payment.data?.request?.status === 'approved_on_hold';

  return (
    <Screen title={t('payment.formTitle')}>
      <div className="flex flex-col gap-6 pb-6" data-payment-form>
        <InfoNote icon={<ShieldCheckIcon />}>{t('payment.warning')}</InfoNote>
        {!payment.data ? (
          <div aria-busy>
            <SkeletonText lines={6} />
          </div>
        ) : open ? (
          <p className="type-body text-text-secondary" data-payment-waiting>
            {t('payment.waiting')}
          </p>
        ) : masjid?.role === 'editor' ? (
          // DECISIONS #161 (F69): only an owner may ask; the API refuses an editor with PAYMENT_OWNER_ONLY anyway.
          <p className="type-body text-text-secondary" data-payment-owner-only>
            {t('payment.ownerOnly')}
          </p>
        ) : (
          <Form masjidId={masjid?.id} />
        )}
      </div>
    </Screen>
  );
}

function Form({ masjidId }: { readonly masjidId: string | undefined }) {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const send = usePaymentRequest(masjidId);
  const [draft, setDraft] = useState<PaymentDraft>(emptyDraft());
  const [scanning, setScanning] = useState(false);
  // DECISIONS #147: only a built-in QR reader on the admin origin — no WebAssembly fallback (its CSP is unchanged).
  const canScan = useCanScanUpi();
  const issues = draftIssues(draft);
  const body = requestBody(draft);
  const started = draft.vpa.trim() !== '' || draft.payee.trim() !== '';

  return (
    <>
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
          {t('payment.scan')}
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
          setDraft({ ...draft, vpa: event.target.value });
        }}
      />
      <TextField
        label={t('payment.payee')}
        hint={t('payment.payeeHint')}
        autoComplete="off"
        dir="auto"
        maxLength={PAYEE_MAX}
        value={draft.payee}
        onChange={(event) => {
          setDraft({ ...draft, payee: event.target.value });
        }}
      />
      <TextArea
        label={t('payment.note')}
        optional
        hint={t('payment.noteHint')}
        dir="auto"
        maxLength={NOTE_MAX}
        value={draft.note}
        onChange={(event) => {
          setDraft({ ...draft, note: event.target.value });
        }}
      />
      {issues.length > 0 && started ? (
        <p className="type-footnote text-text-secondary" aria-live="polite" data-payment-missing>
          {t('payment.missing', { fields: issues.map((issue) => t(`payment.issue.${issue}`)).join(', ') })}
        </p>
      ) : null}
      <PublishBar
        actionLabel={t('payment.submit')}
        disabled={body === null}
        busy={send.isPending}
        onAction={() => {
          if (!body) return;
          send.mutate(body, {
            onSuccess: () => {
              toast.show({ message: t('payment.sent'), tone: 'success' });
              navigator.back();
            },
            onError: (error) => {
              toast.show({ message: errorText(error), tone: 'error' });
            },
          });
        }}
      />
      <UpiScanSheet
        title={t('payment.scan')}
        hint={t('payment.scanHint')}
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
    </>
  );
}

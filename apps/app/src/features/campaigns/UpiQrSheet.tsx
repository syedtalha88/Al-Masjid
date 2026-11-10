// The UPI QR sheet (07 A10, 08 §5.7): payee name, the UPI ID with Copy, the QR code (fades/scales in once the sheet has
// settled), "Scan with any UPI app from another phone", Save QR to gallery, the gallery hint, "Payment details changed
// on …" for 30 days after a change (04 R1) and the check-the-name hint. A lazy chunk: the QR generator stays out of the
// app's entry (PHASE_05 T5.7 budgets).
import { buildUpiUri } from '@mc/domain/upi';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { ActiveMasjidBundle } from '@mc/shared/contracts/public';
import { Button, IconButton, InfoNote, Sheet, useToast } from '@mc/ui/components';
import { paymentChangedRecently } from '@mc/ui/content';
import { CheckIcon, CopyIcon, DownloadIcon, WarningIcon } from '@mc/ui/icons';
import { settleIn, useMotionPrefs } from '@mc/ui/motion';
import { QrCodeView, qrMatrix, qrPng } from '@mc/ui/qr';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useNow } from '../../lib/clock.ts';
import { platformKind } from '../../lib/platform.ts';
import { qrFilename, saveQrImage } from './lib/upi-actions.ts';

/** How long the copy button shows its check (08 §5.7 "Copied" micro-animation). */
const COPIED_MS = 1500;

export interface UpiQrSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly payment: NonNullable<ActiveMasjidBundle['payment']>;
  /** The campaign title — the payment note (`tn`) the UPI app pre-fills. */
  readonly note: string;
}

export default function UpiQrSheet({ open, onClose, payment, note }: UpiQrSheetProps) {
  const { t } = useTranslation('content');
  const { format } = useLocale();
  const toast = useToast();
  const now = useNow();
  const { reduced } = useMotionPrefs();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const qr = useRef<HTMLDivElement>(null);
  const link = useMemo(() => {
    try {
      return buildUpiUri({ vpa: payment.vpa, payeeName: payment.payeeName, note });
    } catch {
      return null; // the server validated the details; an invalid one shows no QR rather than a wrong one
    }
  }, [payment.vpa, payment.payeeName, note]);
  const changed = paymentChangedRecently(payment.effectiveAt, now);

  useEffect(() => {
    const node = qr.current;
    if (!open || !node || reduced) return;
    const effect = settleIn(node);
    return () => {
      effect.stop();
    };
  }, [open, reduced]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = () => {
    void navigator.clipboard
      .writeText(payment.vpa)
      .then(() => {
        setCopied(true);
        toast.show({ message: t('campaign.qr.copied'), tone: 'success' });
      })
      .catch(() => undefined);
  };

  const save = async () => {
    if (!link) return;
    setSaving(true);
    try {
      const png = await qrPng(qrMatrix(link), { caption: [payment.payeeName, payment.vpa] });
      const result = png ? await saveQrImage(png, qrFilename(payment.vpa), platformKind() === 'ios') : 'failed';
      if (result === 'saved') toast.show({ message: t('campaign.qr.saved'), tone: 'success' });
      if (result === 'failed') toast.show({ message: t('campaign.qr.saveFailed'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('campaign.qr.title')}>
      <div className="flex flex-col items-center gap-4 pb-2 text-center" data-upi-sheet>
        <div className="flex w-full flex-col items-center gap-1">
          <p dir="auto" className="type-headline text-text">
            {payment.payeeName}
          </p>
          <p className="flex items-center gap-1 type-callout text-text-secondary">
            <bdi data-vpa>{payment.vpa}</bdi>
            <IconButton
              label={t('campaign.qr.copy')}
              icon={copied ? <CheckIcon className="text-primary-700" /> : <CopyIcon />}
              onPress={copy}
            />
          </p>
        </div>
        {changed ? (
          <InfoNote icon={<WarningIcon size={20} className="text-facilities" />} className="w-full text-start">
            {t('campaign.qr.changed', { date: format.date(changed, 'short') })}
          </InfoNote>
        ) : null}
        {link ? (
          <div ref={qr}>
            <QrCodeView value={link} label={t('campaign.qr.label', { payee: payment.payeeName })} />
          </div>
        ) : null}
        <p className="type-callout text-text-secondary">{t('campaign.qr.scanHint')}</p>
        {link ? (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={saving}
            leadingIcon={<DownloadIcon />}
            onPress={() => void save()}
          >
            {t('campaign.qr.save')}
          </Button>
        ) : null}
        <p className="type-footnote text-text-secondary">{t('campaign.qr.saveHint')}</p>
        <InfoNote className="w-full text-start">{t('campaign.qr.checkName', { payee: payment.payeeName })}</InfoNote>
      </div>
    </Sheet>
  );
}

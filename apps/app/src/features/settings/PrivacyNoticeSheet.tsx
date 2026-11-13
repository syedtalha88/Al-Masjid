// The privacy notice re-acceptance sheet (05 §2, PHASE_08 T8.6): "We updated our privacy notice" (a new version) or
// the yearly reminder. Shows the bundled notice in the person's language with its draft marks; "I understand" stores
// the server's version and tells the server (queued offline). Lazy chunk.
import { loadLegalDoc } from '@mc/i18n/legal';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { Button, Sheet, Tag, useToast } from '@mc/ui/components';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useAppData } from '../../lib/data.tsx';
import type { PrivacyRecheck } from '../../lib/device/privacy-notice.ts';

export default function PrivacyNoticeSheet({
  reason,
  version,
  onClose,
}: {
  readonly reason: Exclude<PrivacyRecheck, null>;
  readonly version: string;
  readonly onClose: () => void;
}) {
  const { t, ready } = useTranslation('settings');
  const { locale } = useLocale();
  const { sync } = useAppData();
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  // Same key as onboarding and Settings → Privacy: one copy in memory.
  const doc = useQuery({
    queryKey: ['legal', 'privacy', locale],
    queryFn: () => loadLegalDoc('privacy', locale),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const accept = async () => {
    setBusy(true);
    try {
      const preferences = await import('../../lib/device/preferences.ts');
      await preferences.acceptPrivacyNotice(sync, version, new Date());
      setOpen(false);
    } catch {
      toast.show({ message: t('privacyNotice.failed'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  if (!ready) return null;
  return (
    <Sheet
      open={open}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
      title={t(reason === 'changed' ? 'privacyNotice.changedTitle' : 'privacyNotice.yearlyTitle')}
      snaps={['full']}
      footer={
        <Button
          size="lg"
          fullWidth
          loading={busy}
          disabled={!doc.data}
          onPress={() => {
            void accept();
          }}
        >
          {t('privacyNotice.accept')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-6" data-privacy-notice={reason}>
        <p className="type-callout text-text-secondary">
          {t(reason === 'changed' ? 'privacyNotice.changedLead' : 'privacyNotice.yearlyLead')}
        </p>
        {doc.data ? (
          <div className="flex flex-wrap gap-2">
            {doc.data.status === 'draft' ? <Tag tone="danger">{t('draft')}</Tag> : null}
            {doc.data.draftTranslation ? <Tag tone="sun">{t('draftTranslation')}</Tag> : null}
          </div>
        ) : null}
        <ul dir="auto" className="flex list-disc flex-col gap-3 ps-5 type-callout text-text">
          {doc.data?.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

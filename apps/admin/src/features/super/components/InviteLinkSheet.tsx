import { useLocale, useTranslation } from '@mc/i18n/react';
import type { InviteLink } from '@mc/shared/contracts';
import { Button, Sheet, useToast } from '@mc/ui/components';
import { CopyIcon, ShareIcon } from '@mc/ui/icons';

export interface InviteLinkSheetProps {
  /** The link to hand over, or `null` when the sheet is closed. */
  readonly link: InviteLink | null;
  /** The admin's name, for the WhatsApp message. */
  readonly adminName: string;
  readonly onClose: () => void;
}

/** A new login link (C2 admins): copy it, or open WhatsApp with a ready message. Shown once — never stored here. */
export function InviteLinkSheet({ link, adminName, onClose }: InviteLinkSheetProps) {
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const toast = useToast();
  return (
    <Sheet open={link !== null} onClose={onClose} title={t('admin.inviteReady')}>
      {link ? (
        <div className="flex flex-col gap-4 pb-4">
          <p className="type-body text-text-secondary">
            {t('admin.inviteLead', { date: format.date(new Date(link.expiresAt), 'medium') })}
          </p>
          <p dir="ltr" className="rounded-sm bg-surface-muted p-3 type-footnote break-all text-text-secondary">
            {link.inviteUrl}
          </p>
          <Button
            variant="secondary"
            fullWidth
            leadingIcon={<CopyIcon />}
            onPress={() => {
              void navigator.clipboard.writeText(link.inviteUrl).then(() => {
                toast.show({ message: t('admin.copied'), tone: 'success' });
              });
            }}
          >
            {t('admin.copy')}
          </Button>
          <a
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full border-[1.5px] border-primary-700 px-5 type-subhead-strong text-primary-700"
            href={`https://wa.me/?text=${encodeURIComponent(t('admin.whatsAppMessage', { name: adminName, url: link.inviteUrl }))}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ShareIcon />
            {t('admin.shareWhatsApp')}
          </a>
        </div>
      ) : null}
    </Sheet>
  );
}

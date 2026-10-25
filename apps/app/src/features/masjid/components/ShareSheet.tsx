// Share a masjid (07 A5) or a post (07 A7–A9): the system share sheet where the browser has one (Web Share); otherwise
// a sheet with WhatsApp and Copy link. Shares the follow link (`/m/:code`) or the post link (`/p/:publicId`) — no
// tracking parameters.
import { useTranslation } from '@mc/i18n/react';
import { Button, Sheet, useToast } from '@mc/ui/components';
import { CopyIcon, ShareIcon } from '@mc/ui/icons';

import { whatsappLink } from '../lib/detail-view.ts';

export interface ShareTarget {
  readonly name: string;
  readonly url: string;
  /** The message that goes with the link ("Follow Test Masjid Alpha on …"). */
  readonly text: string;
}

/**
 * Opens the system share sheet when available.
 *
 * @returns `false` when the browser has no Web Share (the caller shows `ShareSheet`); `true` otherwise, including when
 *   the person closed the system sheet.
 */
export async function shareNatively(target: ShareTarget): Promise<boolean> {
  if (typeof navigator.share !== 'function') return false;
  try {
    await navigator.share({ title: target.name, text: target.text, url: target.url });
  } catch {
    // Cancelled, or not allowed here: nothing to do.
  }
  return true;
}

export function ShareSheet({
  target,
  onClose,
  title,
}: {
  readonly target: ShareTarget | null;
  readonly onClose: () => void;
  /** Sheet title (default "Share masjid"). */
  readonly title?: string;
}) {
  const { t } = useTranslation('masjid');
  const toast = useToast();
  const text = target?.text ?? '';
  return (
    <Sheet open={target !== null} onClose={onClose} title={title ?? t('shareTitle')}>
      {target ? (
        <div className="flex flex-col gap-2 pb-2">
          <Button
            size="lg"
            fullWidth
            leadingIcon={<ShareIcon />}
            onPress={() => {
              window.open(whatsappLink(`${text}: ${target.url}`), '_blank', 'noopener,noreferrer');
              onClose();
            }}
          >
            {t('whatsapp')}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            fullWidth
            leadingIcon={<CopyIcon />}
            onPress={() => {
              void navigator.clipboard
                .writeText(target.url)
                .then(() => {
                  toast.show({ message: t('copied'), tone: 'success' });
                })
                .catch(() => undefined);
              onClose();
            }}
          >
            {t('copy')}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

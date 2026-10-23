// Share a masjid (07 A5): the system share sheet where the browser has one (Web Share); otherwise a sheet with
// WhatsApp and Copy link. Shares the follow link (`/m/:code`) — no tracking parameters.
import { useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { Button, Sheet, useToast } from '@mc/ui/components';
import { CopyIcon, ShareIcon } from '@mc/ui/icons';

import { whatsappLink } from '../lib/detail-view.ts';

export interface ShareTarget {
  readonly name: string;
  readonly url: string;
}

/**
 * Opens the system share sheet when available.
 *
 * @returns `false` when the browser has no Web Share (the caller shows `ShareSheet`); `true` otherwise, including when
 *   the person closed the system sheet.
 */
export async function shareNatively(target: ShareTarget, text: string): Promise<boolean> {
  if (typeof navigator.share !== 'function') return false;
  try {
    await navigator.share({ title: target.name, text, url: target.url });
  } catch {
    // Cancelled, or not allowed here: nothing to do.
  }
  return true;
}

export function ShareSheet({ target, onClose }: { readonly target: ShareTarget | null; readonly onClose: () => void }) {
  const { t } = useTranslation('masjid');
  const toast = useToast();
  const text = target ? t('shareText', { name: target.name, app: BRAND.name }) : '';
  return (
    <Sheet open={target !== null} onClose={onClose} title={t('shareTitle')}>
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

// "Message" / "Contact on WhatsApp" (07 A21, A22): opens WhatsApp's click-to-chat link with "Assalamu alaikum" in the
// app language. A button, not a link: the number is in no text and no attribute — only in the URL handed to
// `window.open` (DECISIONS #131).
import { whatsappChatUrl } from '@mc/domain/phone';
import { useTranslation } from '@mc/i18n/react';

import { Button } from '../components/Button.tsx';
import { ChatCircleIcon } from '../icons/glyph/ChatCircleIcon.tsx';

export interface WhatsAppButtonProps {
  /** E.164. */
  readonly number: string;
  /** The visible label. */
  readonly label: string;
  /** A fuller accessible name that starts with the visible label (WCAG 2.5.3). */
  readonly accessibleLabel?: string;
  /** Admin preview: shows, opens nothing. */
  readonly preview?: boolean;
}

export function WhatsAppButton({ number, label, accessibleLabel, preview = false }: WhatsAppButtonProps) {
  const { t } = useTranslation();
  const url = whatsappChatUrl(number, t('ui.ilm.greeting'));
  return (
    <Button
      variant="secondary"
      fullWidth
      leadingIcon={<ChatCircleIcon />}
      {...(accessibleLabel ? { 'aria-label': accessibleLabel } : {})}
      disabled={url === null}
      onPress={() => {
        if (url && !preview) window.open(url, '_blank', 'noopener,noreferrer');
      }}
    >
      {label}
    </Button>
  );
}

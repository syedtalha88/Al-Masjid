// An Ilm contact (07 A21, DECISIONS #104): initial, name, role, topics and a "Message" button that opens a WhatsApp chat
// with "Assalamu alaikum" in the app language pre-filled. The number is never rendered — not as text, not in an
// attribute: it exists only in the URL handed to `window.open` (it is still in that public link; the admin's consent
// text says so). Shared by the musalli screen and the admin B17 preview (T3.11: the preview renders the real component).
import { useTranslation } from '@mc/i18n/react';
import type { IlmContact } from '@mc/shared/contracts/public';

import { Card } from '../components/Card.tsx';
import { IconCircle } from '../components/IconCircle.tsx';
import { WhatsAppButton } from './WhatsAppButton.tsx';

export interface IlmContactCardProps {
  readonly contact: Pick<IlmContact, 'name' | 'role' | 'topics' | 'whatsapp'>;
  /** Admin preview: the button shows but opens nothing. */
  readonly preview?: boolean;
}

/** The first letter as a reader sees it (a grapheme — Devanagari / Telugu letters with their vowel signs). */
function initialOf(name: string): string {
  const trimmed = name.trim();
  const first =
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next().value
          ?.segment
      : Array.from(trimmed)[0];
  return (first ?? '').toLocaleUpperCase();
}

export function IlmContactCard({ contact, preview = false }: IlmContactCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col gap-4" data-ilm-contact>
      <div className="flex items-start gap-3">
        <IconCircle tone="primary" size={44}>
          <span className="type-headline">{initialOf(contact.name)}</span>
        </IconCircle>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p dir="auto" className="type-headline text-text break-words">
            {contact.name}
          </p>
          {contact.role ? (
            <p dir="auto" className="type-subhead text-text-secondary break-words">
              {contact.role}
            </p>
          ) : null}
          {contact.topics ? (
            <p dir="auto" className="type-footnote text-text-secondary break-words">
              {contact.topics}
            </p>
          ) : null}
        </div>
      </div>
      <WhatsAppButton
        number={contact.whatsapp}
        label={t('ui.ilm.message')}
        accessibleLabel={t('ui.ilm.messageLabel', { name: contact.name })}
        preview={preview}
      />
    </Card>
  );
}

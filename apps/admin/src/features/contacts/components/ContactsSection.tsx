// B17 in B13 Masjid Profile (07 B17, PHASE_03 T3.16): the masjid's Ilm contacts (≤ 10), each with "For brothers" /
// "For sisters", opening the editor; "Add contact" until the limit. The number is not listed — the editor shows it.
import { useTranslation } from '@mc/i18n/react';
import { CONTACTS_MAX } from '@mc/shared/contracts';
import { Button, ListRow, SkeletonText, Tag } from '@mc/ui/components';
import { ChatCircleIcon, PlusIcon } from '@mc/ui/icons';
import { useNavigator } from '@mc/ui/navigation';

import { useErrorText } from '../../auth/hooks/use-session.ts';
import { useContacts } from '../hooks/use-contacts.ts';

export function ContactsSection({ masjidId }: { readonly masjidId: string | undefined }) {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const errorText = useErrorText();
  const list = useContacts(masjidId);
  const contacts = list.data?.contacts ?? [];
  const full = contacts.length >= CONTACTS_MAX;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="profile-contacts" data-contacts-admin>
      <div className="flex items-center justify-between gap-3">
        <h2 id="profile-contacts" className="type-headline text-text">
          {t('contacts.title')}
        </h2>
        {list.data ? (
          <Tag tone="neutral">{t('contacts.count', { count: contacts.length, max: CONTACTS_MAX })}</Tag>
        ) : null}
      </div>
      <p className="type-callout text-text-secondary">{t('contacts.intro')}</p>
      {list.isError ? (
        <div className="flex flex-col gap-3">
          <p className="type-callout text-text-secondary">{errorText(list.error)}</p>
          <Button
            variant="secondary"
            size="lg"
            onPress={() => {
              void list.refetch();
            }}
          >
            {tc('appError.retry')}
          </Button>
        </div>
      ) : !list.data ? (
        <div aria-busy>
          <SkeletonText lines={3} />
        </div>
      ) : contacts.length > 0 ? (
        <ul className="flex flex-col rounded-md bg-surface px-4 shadow-e1">
          {contacts.map((contact) => (
            <li key={contact.id} data-contact-row={contact.id}>
              <ListRow
                leading={<ChatCircleIcon size={28} />}
                title={contact.name}
                {...(contact.role ? { subtitle: contact.role } : {})}
                trailing={
                  <Tag tone={contact.audience === 'sisters' ? 'rose' : 'info'}>
                    {t(`contacts.for.${contact.audience}`)}
                  </Tag>
                }
                chevron
                onPress={() => {
                  navigator.push(`/contacts/${contact.id}`);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {list.data ? (
        <>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            leadingIcon={<PlusIcon />}
            disabled={full}
            onPress={() => {
              navigator.push('/contacts/new');
            }}
          >
            {t('contacts.add')}
          </Button>
          {full ? (
            <p className="type-footnote text-text-secondary">{t('contacts.full', { max: CONTACTS_MAX })}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

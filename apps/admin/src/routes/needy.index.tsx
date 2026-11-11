import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { type AdminBeneficiary, BENEFICIARIES_ACTIVE_MAX } from '@mc/shared/contracts';
import {
  Button,
  ChipGroup,
  Dialog,
  EmptyState,
  InfoNote,
  NumberPad,
  ProgressBar,
  Sheet,
  SkeletonText,
  Tag,
  useToast,
} from '@mc/ui/components';
import { PlusIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useNeedy, useNeedyWrites } from '../features/needy/hooks/use-needy.ts';
import { needyActions, needyPercent, type NeedyStatus, peopleWithStatus } from '../features/needy/lib/needy.ts';

export const Route = createFileRoute('/needy/')({
  component: NeedyScreen,
});

const STATUSES = ['active', 'fulfilled', 'closed'] as const;
const STATUS_TONE = { active: 'primary', fulfilled: 'info', closed: 'neutral' } as const;

/**
 * B19 Needy people (07 B19, 00 §4.14, PHASE_05 T5.8): the people the masjid has verified, by status chip (Active ·
 * Fulfilled · Closed), each with progress and a big "Update received" (NumberPad sheet with the live percentage —
 * reaching the amount needed says "Fulfilled — hidden from the app"), "Edit details", and Close / Remove with a
 * confirmation. "Add person" until 100 are active.
 */
function NeedyScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const format = formatters(locale);
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const list = useNeedy(masjid?.id);
  const { received, end } = useNeedyWrites(masjid?.id);
  const [status, setStatus] = useState<NeedyStatus>('active');
  const [updating, setUpdating] = useState<AdminBeneficiary | null>(null);
  const [amount, setAmount] = useState(0);
  const [ending, setEnding] = useState<{ person: AdminBeneficiary; as: 'closed' | 'deleted' } | null>(null);

  const people = list.data?.people ?? [];
  const shown = peopleWithStatus(people, status);
  const activeCount = peopleWithStatus(people, 'active').length;
  const canAdd = activeCount < BENEFICIARIES_ACTIVE_MAX;
  const livePercent = updating ? needyPercent(amount, updating.capPaise) : 0;
  const reachesCap = updating !== null && amount >= updating.capPaise;

  return (
    <Screen title={t('needy.title')}>
      <div className="flex flex-col gap-4 pb-6" data-needy>
        <p className="type-callout text-text-secondary">{t('needy.intro')}</p>
        <ChipGroup
          label={t('needy.statusFilter')}
          chips={STATUSES.map((id) => ({ id, label: t(`needy.status.${id}`) }))}
          value={status}
          onChange={setStatus}
        />
        {list.isError ? (
          <EmptyState
            className="mt-8"
            title={errorText(list.error)}
            action={
              <Button
                size="lg"
                onPress={() => {
                  void list.refetch();
                }}
              >
                {tc('appError.retry')}
              </Button>
            }
          />
        ) : !list.data ? (
          <div aria-busy>
            <SkeletonText lines={6} />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            className="mt-4"
            title={t(`needy.empty.${status}`)}
            {...(status === 'active' ? { body: t('needy.emptyBody') } : {})}
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {shown.map((person) => {
              const actions = needyActions(person);
              const percent = needyPercent(person.receivedPaise, person.capPaise);
              return (
                <li key={person.id}>
                  <article
                    className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1"
                    data-person={person.id}
                    data-person-status={person.status}
                  >
                    <header className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <h2 className="type-headline text-text" dir="auto">
                          {person.displayName}
                        </h2>
                        <p className="type-footnote text-text-secondary">
                          {t(`needy.category.${person.category}`)}
                          {person.zakatEligible ? ` · ${t('needy.zakat')}` : ''}
                        </p>
                      </div>
                      <Tag tone={STATUS_TONE[person.status]}>{t(`needy.status.${person.status}`)}</Tag>
                    </header>
                    <p className="line-clamp-2 type-callout text-text-secondary" dir="auto">
                      {person.reason}
                    </p>
                    <ProgressBar
                      value={person.capPaise > 0 ? person.receivedPaise / person.capPaise : 0}
                      label={t('needy.receivedLabel')}
                      valueText={`${String(percent)}%`}
                    />
                    <p className="type-body text-text">
                      {t('needy.amounts', {
                        received: format.money(person.receivedPaise),
                        target: format.money(person.capPaise),
                      })}{' '}
                      <span className="text-text-secondary">· {`${String(percent)}%`}</span>
                    </p>
                    {person.status === 'fulfilled' ? <InfoNote>{t('needy.fulfilledNote')}</InfoNote> : null}
                    {actions.updateReceived ? (
                      <Button
                        size="lg"
                        fullWidth
                        onPress={() => {
                          setAmount(person.receivedPaise);
                          setUpdating(person);
                        }}
                      >
                        {t('needy.updateReceived')}
                      </Button>
                    ) : null}
                    {actions.edit ? (
                      <Button
                        variant="outline"
                        size="lg"
                        fullWidth
                        onPress={() => {
                          navigator.push(`/needy/${person.id}`);
                        }}
                      >
                        {t('needy.edit')}
                      </Button>
                    ) : null}
                    {actions.end ? (
                      <div className="grid grid-cols-2 gap-3">
                        <Button
                          variant="outline"
                          size="lg"
                          fullWidth
                          onPress={() => {
                            setEnding({ person, as: 'closed' });
                          }}
                        >
                          {t('needy.close')}
                        </Button>
                        <Button
                          variant="danger"
                          size="lg"
                          fullWidth
                          onPress={() => {
                            setEnding({ person, as: 'deleted' });
                          }}
                        >
                          {t('needy.remove')}
                        </Button>
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
        {list.data ? (
          <>
            <Button
              size="lg"
              fullWidth
              leadingIcon={<PlusIcon />}
              disabled={!canAdd}
              onPress={() => {
                navigator.push('/needy/new');
              }}
            >
              {t('needy.add')}
            </Button>
            {canAdd ? null : <InfoNote>{t('needy.full', { max: BENEFICIARIES_ACTIVE_MAX })}</InfoNote>}
            <p className="type-footnote text-text-secondary">{t('needy.retention')}</p>
          </>
        ) : null}
      </div>

      <Sheet
        open={updating !== null}
        onClose={() => {
          setUpdating(null);
        }}
        title={t('needy.updateTitle')}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={received.isPending}
            disabled={updating === null || amount === updating.receivedPaise}
            onPress={() => {
              if (!updating) return;
              received.mutate(
                { personId: updating.id, receivedPaise: amount },
                {
                  onSuccess: (result) => {
                    setUpdating(null);
                    toast.show({
                      message: t(result.status === 'fulfilled' ? 'needy.fulfilledNote' : 'needy.saved'),
                      tone: 'success',
                    });
                  },
                  onError: (error) => {
                    toast.show({ message: errorText(error), tone: 'error' });
                  },
                },
              );
            }}
          >
            {t('needy.save')}
          </Button>
        }
      >
        {updating ? (
          <div className="flex flex-col gap-4 pb-2" data-update-received>
            <p className="type-title2 text-center text-text" aria-live="polite">
              {format.money(amount)}{' '}
              <span className="type-headline text-text-secondary">· {`${String(livePercent)}%`}</span>
            </p>
            <ProgressBar
              value={updating.capPaise > 0 ? amount / updating.capPaise : 0}
              label={t('needy.receivedLabel')}
              valueText={`${String(livePercent)}%`}
            />
            <p className="type-footnote text-center text-text-secondary">
              {t('needy.needed', { amount: format.money(updating.capPaise) })}
            </p>
            {reachesCap ? (
              <InfoNote>
                <span data-will-fulfil>{t('needy.fulfilledNote')}</span>
              </InfoNote>
            ) : updating.status === 'fulfilled' ? (
              <InfoNote>{t('needy.relistNote')}</InfoNote>
            ) : null}
            <NumberPad value={amount} onChange={setAmount} label={t('needy.updateTitle')} />
          </div>
        ) : null}
      </Sheet>

      <Dialog
        open={ending !== null}
        destructive
        loading={end.isPending}
        onClose={() => {
          setEnding(null);
        }}
        title={t(ending?.as === 'deleted' ? 'needy.removeTitle' : 'needy.closeTitle')}
        body={t(ending?.as === 'deleted' ? 'needy.removeBody' : 'needy.closeBody')}
        confirmLabel={t(ending?.as === 'deleted' ? 'needy.remove' : 'needy.close')}
        onConfirm={() => {
          if (!ending) return;
          const { person, as } = ending;
          end.mutate(
            { personId: person.id, as },
            {
              onSuccess: () => {
                setEnding(null);
                toast.show({ message: t(as === 'deleted' ? 'needy.removed' : 'needy.closed'), tone: 'success' });
              },
              onError: (error) => {
                setEnding(null);
                toast.show({ message: errorText(error), tone: 'error' });
              },
            },
          );
        }}
      />
    </Screen>
  );
}

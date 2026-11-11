// A24 My zakat (07 A24, 00 §4.15, DECISIONS #104, PHASE_05 T5.9) — Settings → "My zakat": a private tracker that
// exists only on this phone. The person enters what they owe (the app does not calculate zakat) and a label for the
// year, logs each payment (amount, date, a note or the needy person paid), and sees what remains — never below ₹0.
// Nothing here is sent anywhere (05 §1): the device document is the only copy, and "Clear all data" removes it.
import { useLocale, useTranslation } from '@mc/i18n/react';
import {
  Button,
  Dialog,
  Divider,
  IconButton,
  InfoNote,
  NumberPad,
  ProgressBar,
  Sheet,
  TextField,
  useToast,
} from '@mc/ui/components';
import { DeviceMobileIcon, PencilIcon, PlusIcon, XIcon } from '@mc/ui/icons';
import { Screen } from '@mc/ui/navigation';
import { Fragment, useState } from 'react';

import { MAX_ZAKAT_LABEL } from '../../lib/device/store.ts';
import { ZakatLogSheet } from './components/ZakatLogSheet.tsx';
import { useZakat } from './hooks/useZakat.ts';
import { paymentsNewestFirst } from './lib/zakat.ts';

export function ZakatScreen() {
  const { ready } = useTranslation('settings');
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <MyZakat />;
}

type Confirm = { readonly kind: 'remove'; readonly index: number; readonly text: string } | { readonly kind: 'reset' };

function MyZakat() {
  const { t } = useTranslation('settings');
  const { format } = useLocale();
  const toast = useToast();
  const { zakat, summary, defaultLabel, setOwed, removePayment, reset } = useZakat();
  const [sheet, setSheet] = useState<'owed' | 'log' | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Kept while the dialog closes, so its text does not vanish mid-fade.
  const [lastConfirm, setLastConfirm] = useState<Confirm | null>(null);
  const payments = paymentsNewestFirst(zakat);
  const label = zakat?.label ?? '';

  const open = (which: 'owed' | 'log') => {
    if (which === 'log' && summary.full) {
      toast.show({ message: t('zakat.full') });
      return;
    }
    setFormKey((key) => key + 1);
    setSheet(which);
  };
  const close = () => {
    setSheet(null);
  };
  const ask = (next: Confirm) => {
    setLastConfirm(next);
    setConfirm(next);
  };
  const shown = confirm ?? lastConfirm;

  return (
    <Screen title={t('zakat.title')}>
      <div className="flex flex-col gap-5 pt-2 pb-8" data-zakat>
        <InfoNote icon={<DeviceMobileIcon size={20} />}>
          <span data-zakat-notice>{t('zakat.notice')}</span>
        </InfoNote>

        <section
          aria-label={t('zakat.title')}
          className="flex flex-col gap-4 rounded-md bg-surface p-4 shadow-e1"
          data-zakat-summary
        >
          <div className="flex flex-col gap-1">
            <p className="type-footnote text-text-secondary">
              {t('zakat.remaining')}
              {label === '' ? null : (
                <>
                  {' · '}
                  <bdi data-zakat-label>{label}</bdi>
                </>
              )}
            </p>
            <p className="type-amount-large tabular-nums text-text" data-zakat-remaining>
              {format.money(summary.remainingPaise)}
            </p>
          </div>
          <ProgressBar
            value={summary.fraction}
            label={t('zakat.given')}
            valueText={t('zakat.givenOf', {
              given: format.money(summary.paidPaise),
              owed: format.money(summary.owedPaise),
            })}
          />
          <dl className="flex flex-col gap-1 type-callout">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-text-secondary">{t('zakat.given')}</dt>
              <dd className="tabular-nums text-text" data-zakat-given>
                {format.money(summary.paidPaise)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-text-secondary">{t('zakat.owed')}</dt>
              <dd className="tabular-nums text-text" data-zakat-owed>
                {format.money(summary.owedPaise)}
              </dd>
            </div>
          </dl>
          <Button
            variant="secondary"
            fullWidth
            leadingIcon={<PencilIcon />}
            data-zakat-set
            onPress={() => {
              open('owed');
            }}
          >
            {t(summary.owedPaise > 0 ? 'zakat.changeOwed' : 'zakat.setOwed')}
          </Button>
        </section>

        <section aria-labelledby="zakat-payments" className="flex flex-col gap-3">
          <h2 id="zakat-payments" className="type-headline text-text">
            {t('zakat.payments')}
          </h2>
          {payments.length === 0 ? (
            <p className="rounded-md bg-surface p-4 type-callout text-text-secondary shadow-e1">
              {t('zakat.noPayments')}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-md bg-surface shadow-e1">
              {payments.map(({ index, payment }, row) => {
                const amount = format.money(payment.amountPaise);
                const date = format.date(new Date(payment.at), 'medium');
                return (
                  <Fragment key={`${payment.at}/${String(index)}`}>
                    {row > 0 ? <Divider /> : null}
                    <li className="flex items-center gap-3 py-2 ps-4 pe-2" data-zakat-payment>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="type-headline tabular-nums text-text">{amount}</span>
                        <span className="type-footnote text-text-secondary">
                          {date}
                          {payment.note === undefined ? null : (
                            <>
                              {' · '}
                              <bdi>{payment.note}</bdi>
                            </>
                          )}
                        </span>
                      </span>
                      <IconButton
                        label={t('zakat.removeLabel', { amount })}
                        icon={<XIcon />}
                        onPress={() => {
                          ask({ kind: 'remove', index, text: t('zakat.removeBody', { amount, date }) });
                        }}
                      />
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          )}
          <Button
            size="lg"
            fullWidth
            leadingIcon={<PlusIcon />}
            data-zakat-add
            onPress={() => {
              open('log');
            }}
          >
            {t('zakat.add')}
          </Button>
        </section>

        {zakat ? (
          <Button
            variant="ghost"
            fullWidth
            onPress={() => {
              ask({ kind: 'reset' });
            }}
          >
            {t('zakat.reset')}
          </Button>
        ) : null}
      </div>

      <Sheet open={sheet === 'owed'} onClose={close} title={t('zakat.owed')}>
        <OwedForm
          key={formKey}
          label={zakat ? zakat.label : defaultLabel}
          owedPaise={summary.owedPaise}
          onSave={async (nextLabel, owedPaise) => {
            if ((await setOwed(nextLabel, owedPaise)) === 'saved') {
              toast.show({ message: t('zakat.owedSaved'), tone: 'success' });
            }
            close();
          }}
        />
      </Sheet>

      <ZakatLogSheet open={sheet === 'log'} onClose={close} formKey={formKey} />

      <Dialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
        }}
        title={t(shown?.kind === 'reset' ? 'zakat.resetTitle' : 'zakat.removeTitle')}
        body={shown?.kind === 'remove' ? shown.text : t('zakat.resetBody')}
        confirmLabel={t(shown?.kind === 'reset' ? 'zakat.resetConfirm' : 'zakat.removeConfirm')}
        destructive
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action?.kind === 'remove') {
            void removePayment(action.index).then(() => {
              toast.show({ message: t('zakat.removed') });
            });
          } else if (action?.kind === 'reset') {
            void reset();
          }
        }}
      />
    </Screen>
  );
}

interface OwedFormProps {
  readonly label: string;
  readonly owedPaise: number;
  readonly onSave: (label: string, owedPaise: number) => Promise<void>;
}

function OwedForm({ label: initialLabel, owedPaise, onSave }: OwedFormProps) {
  const { t } = useTranslation('settings');
  const [label, setLabel] = useState(initialLabel);
  const [amount, setAmount] = useState(owedPaise);
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex flex-col gap-4 pb-4" data-zakat-owed-form>
      <p className="type-footnote text-text-secondary">{t('zakat.owedHint')}</p>
      <NumberPad value={amount} onChange={setAmount} label={t('zakat.owed')} />
      <TextField
        label={t('zakat.label')}
        hint={t('zakat.labelHint')}
        dir="auto"
        maxLength={MAX_ZAKAT_LABEL}
        value={label}
        onChange={(event) => {
          setLabel(event.target.value);
        }}
      />
      <Button
        size="lg"
        fullWidth
        loading={saving}
        data-save
        onPress={() => {
          setSaving(true);
          void onSave(label, amount).finally(() => {
            setSaving(false);
          });
        }}
      >
        {t('zakat.save')}
      </Button>
    </div>
  );
}

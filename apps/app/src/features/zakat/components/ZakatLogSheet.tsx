// "Add payment" for My zakat (07 A24) — also what "Log this in My zakat?" opens after a payment to a needy person
// (07 A23): the amount on the NumberPad (the app never knows what was paid — the person types it), an optional note
// (the person's name is filled in), Save. Stored only in the device document (00 §4.15); no network.
import { useTranslation } from '@mc/i18n/react';
import { Button, NumberPad, Sheet, TextField, useToast } from '@mc/ui/components';
import { useState } from 'react';

import { MAX_ZAKAT_NOTE } from '../../../lib/device/store.ts';
import { useZakat } from '../hooks/useZakat.ts';

export interface ZakatLogSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Changes each time the sheet is opened: the form starts empty again. */
  readonly formKey: number;
  /** The needy person (A23) the payment went to: their name becomes the note, their public id is kept with it. */
  readonly person?: { readonly publicId: string; readonly displayName: string } | undefined;
}

export function ZakatLogSheet(props: ZakatLogSheetProps) {
  // The Help the needy screen opens this without the Settings strings loaded yet: wait for them, never show raw keys.
  const { ready } = useTranslation('settings');
  if (!ready) return null;
  return <LogSheet {...props} />;
}

function LogSheet({ open, onClose, formKey, person }: ZakatLogSheetProps) {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const { summary, addPayment } = useZakat();

  const save = async (amountPaise: number, note: string) => {
    const result = await addPayment({
      at: new Date(),
      amountPaise,
      note,
      ...(person ? { beneficiaryPublicId: person.publicId } : {}),
    });
    if (result === 'saved') toast.show({ message: t('zakat.paymentSaved'), tone: 'success' });
    else toast.show({ message: t('zakat.full') });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('zakat.add')}>
      <PaymentForm key={formKey} room={summary.roomPaise} defaultNote={person?.displayName ?? ''} onSave={save} />
    </Sheet>
  );
}

interface PaymentFormProps {
  /** The most this payment may be. */
  readonly room: number;
  readonly defaultNote: string;
  readonly onSave: (amountPaise: number, note: string) => Promise<void>;
}

function PaymentForm({ room, defaultNote, onSave }: PaymentFormProps) {
  const { t } = useTranslation('settings');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState(defaultNote);
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex flex-col gap-4 pb-4" data-zakat-log>
      <NumberPad value={amount} onChange={setAmount} label={t('zakat.amount')} max={room} />
      <TextField
        label={t('zakat.note')}
        optional
        dir="auto"
        maxLength={MAX_ZAKAT_NOTE}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <p className="type-footnote text-text-secondary">{t('zakat.onlyHereLong')}</p>
      <Button
        size="lg"
        fullWidth
        disabled={amount < 1}
        loading={saving}
        data-save
        onPress={() => {
          setSaving(true);
          void onSave(amount, note).finally(() => {
            setSaving(false);
          });
        }}
      >
        {t('zakat.save')}
      </Button>
    </div>
  );
}

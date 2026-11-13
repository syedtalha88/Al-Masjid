import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { slaProgress } from '@mc/shared/compliance';
import { LEGAL_ORDER_STATUSES, LEGAL_TARGET_TYPES, type LegalOrderList } from '@mc/shared/contracts/legal-orders';
import {
  Button,
  Dialog,
  EmptyState,
  Select,
  SkeletonText,
  Spinner,
  Tag,
  TextArea,
  TextField,
  type Tone,
  useToast,
} from '@mc/ui/components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { type ChangeEvent, useRef, useState } from 'react';

import { StepUpCancelled, useStepUp } from '../features/auth/components/StepUpProvider.tsx';
import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/legal-orders')({
  component: LegalOrdersScreen,
});

type Row = LegalOrderList['orders'][number];
type Status = Row['status'];
type TargetType = Row['targetType'];
const KEY = ['super', 'legal-orders'] as const;
/** PDF, JPEG or PNG — the server checks the content; this only narrows the picker. */
const DOCUMENT_TYPES = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

const STATUS_KEY = {
  received: 'legal.status.received',
  actioned: 'legal.status.actioned',
  contested: 'legal.status.contested',
  closed: 'legal.status.closed',
} as const satisfies Readonly<Record<Status, string>>;
const TARGET_KEY = {
  items: 'legal.target.items',
  masjids: 'legal.target.masjids',
  other: 'legal.target.other',
} as const satisfies Readonly<Record<TargetType, string>>;

/** IST is UTC+5:30 all year: the received time is entered and shown as Indian time. */
const IST_MS = 330 * 60 * 1000;
/** `YYYY-MM-DDTHH:mm` in IST for a `datetime-local` field. */
const istInput = (at: Date) => new Date(at.getTime() + IST_MS).toISOString().slice(0, 16);
/** "13 Nov 2026 · 12:00 PM" in IST. */
const stamp = (format: ReturnType<typeof formatters>, iso: string) => {
  const at = new Date(iso);
  return `${format.date(at, 'medium')} · ${format.time(istInput(at).slice(11)).text}`;
};

/**
 * C7 Legal orders (07 C7, 05 §3, PHASE_08 T8.5): open orders first with the 3-hour timer (red under 20 % left), then
 * closed ones. ★ Record an order (received time as entered, IST), ★ update its status / action taken / a log note,
 * ★ attach the document (encrypted on the server) and ★ download it. The action log is the audit trail on the card.
 */
function LegalOrdersScreen() {
  const { t } = useTranslation('super');
  const { t: tc } = useTranslation();
  const errorText = useErrorText();
  const list = useQuery({ queryKey: KEY, queryFn: ({ signal }) => superApi.legalOrders(signal) });
  const [creating, setCreating] = useState(false);
  return (
    <SuperFrame title={t('legal.title')} section="legal">
      <div className="mb-4 flex">
        <Button
          size="lg"
          onPress={() => {
            setCreating(true);
          }}
        >
          {`${t('legal.new')} ★`}
        </Button>
      </div>
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
        <SkeletonText lines={8} />
      ) : list.data.orders.length === 0 ? (
        <EmptyState className="mt-8" title={t('legal.empty')} />
      ) : (
        <ul className="flex flex-col gap-4">
          {list.data.orders.map((row) => (
            <li key={row.id}>
              <OrderCard row={row} />
            </li>
          ))}
        </ul>
      )}
      <CreateDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
    </SuperFrame>
  );
}

function CreateDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const { t } = useTranslation('super');
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const [authority, setAuthority] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [received, setReceived] = useState(() => istInput(new Date()));
  const [targetType, setTargetType] = useState<TargetType | null>(null);
  const [target, setTarget] = useState('');
  const [summary, setSummary] = useState('');
  const [tried, setTried] = useState(false);
  const missing = (value: string) => (tried && value.trim() === '' ? t('legal.required') : undefined);
  const create = useMutation({
    mutationFn: (type: TargetType) =>
      run(() =>
        superApi.createLegalOrder({
          authority: authority.trim(),
          referenceNo: referenceNo.trim(),
          receivedAt: `${received}:00+05:30`,
          targetType: type,
          target: target.trim(),
          summary: summary.trim(),
        }),
      ),
    onSuccess: async () => {
      toast.show({ message: t('legal.created'), tone: 'success' });
      setAuthority('');
      setReferenceNo('');
      setTarget('');
      setSummary('');
      setTried(false);
      onClose();
      await queryClient.invalidateQueries({ queryKey: KEY });
      await queryClient.invalidateQueries({ queryKey: ['super', 'dashboard'] });
    },
    onError: (error) => {
      if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  return (
    <Dialog
      open={open}
      loading={create.isPending}
      onClose={onClose}
      title={t('legal.newTitle')}
      body={
        <div className="flex flex-col gap-4" data-legal-form>
          <TextField
            label={t('legal.authority')}
            maxLength={200}
            value={authority}
            error={missing(authority)}
            onChange={(event) => {
              setAuthority(event.target.value);
            }}
          />
          <TextField
            label={t('legal.referenceNo')}
            maxLength={120}
            dir="auto"
            value={referenceNo}
            error={missing(referenceNo)}
            onChange={(event) => {
              setReferenceNo(event.target.value);
            }}
          />
          <TextField
            label={t('legal.receivedAt')}
            hint={t('legal.receivedHint')}
            type="datetime-local"
            dir="ltr"
            value={received}
            max={istInput(new Date())}
            error={missing(received)}
            onChange={(event) => {
              setReceived(event.target.value);
            }}
          />
          <Select
            label={t('legal.targetType')}
            value={targetType}
            onChange={setTargetType}
            options={LEGAL_TARGET_TYPES.map((value) => ({ value, label: t(TARGET_KEY[value]) }))}
          />
          <TextField
            label={t('legal.targetRef')}
            hint={targetType ? t(`legal.targetHint.${targetType}`) : undefined}
            maxLength={300}
            dir="ltr"
            value={target}
            error={missing(target)}
            onChange={(event) => {
              setTarget(event.target.value);
            }}
          />
          <TextArea
            label={t('legal.summary')}
            dir="auto"
            maxLength={2000}
            value={summary}
            error={missing(summary)}
            onChange={(event) => {
              setSummary(event.target.value);
            }}
          />
        </div>
      }
      confirmLabel={`${t('legal.save')} ★`}
      onConfirm={() => {
        setTried(true);
        const filled = [authority, referenceNo, received, target, summary].every((value) => value.trim() !== '');
        if (filled && targetType) create.mutate(targetType);
      }}
    />
  );
}

function OrderCard({ row }: { readonly row: Row }) {
  const { t } = useTranslation('super');
  const { locale } = useLocale();
  const format = formatters(locale);
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const file = useRef<HTMLInputElement>(null);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: KEY });
    await queryClient.invalidateQueries({ queryKey: ['super', 'dashboard'] });
  };
  const onError = (error: unknown) => {
    if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
  };
  const update = useMutation({
    mutationFn: () =>
      run(() =>
        superApi.updateLegalOrder(row.id, {
          ...(status && status !== row.status ? { status } : {}),
          ...(action.trim() && action.trim() !== row.actionTaken ? { actionTaken: action.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      ),
    onSuccess: async () => {
      setUpdating(false);
      toast.show({ message: t('legal.updated'), tone: 'success' });
      await refresh();
    },
    onError,
  });
  const upload = useMutation({
    mutationFn: (chosen: File) => run(() => superApi.uploadLegalDocument(row.id, chosen, chosen.name)),
    onSuccess: async () => {
      toast.show({ message: t('legal.documentSaved'), tone: 'success' });
      await refresh();
    },
    onError,
  });
  const download = useMutation({
    mutationFn: () => run(() => superApi.legalDocument(row.id)),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    },
    onError,
  });
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (chosen) upload.mutate(chosen);
  };

  const now = new Date();
  const progress = slaProgress(new Date(row.receivedAt), new Date(row.dueAt), now);
  const dueTone: Tone = progress.overdue ? 'danger' : progress.red ? 'sun' : 'info';
  const closed = row.status === 'closed';
  const changed =
    (status !== null && status !== row.status) ||
    (action.trim() !== '' && action.trim() !== row.actionTaken) ||
    note.trim() !== '';

  return (
    <article className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1" data-legal-order={row.referenceNo}>
      <header className="flex flex-wrap items-center gap-2">
        <bdi dir="auto" className="type-headline text-text">
          {row.referenceNo}
        </bdi>
        <Tag tone={closed ? 'neutral' : 'slate'}>{t(STATUS_KEY[row.status])}</Tag>
        <Tag tone="neutral">{t(TARGET_KEY[row.targetType])}</Tag>
        {row.status === 'received' ? (
          <span data-due>
            <Tag tone={dueTone}>
              {t(progress.overdue ? 'legal.overdue' : 'legal.due', { when: format.relative(new Date(row.dueAt), now) })}
            </Tag>
          </span>
        ) : null}
        {row.hasDocument ? <Tag tone="info">{t('legal.hasDocument')}</Tag> : null}
      </header>
      <p className="type-callout text-text" dir="auto">
        {row.authority}
      </p>
      <p className="type-caption text-text-tertiary">
        {t('legal.receivedLine', { when: stamp(format, row.receivedAt) })}
      </p>
      <p className="type-footnote break-all text-text-secondary" dir="ltr">
        {row.targetId}
      </p>
      <p className="type-body whitespace-pre-line text-text" dir="auto">
        {row.summary}
      </p>
      {row.actionTaken ? (
        <p className="rounded-sm bg-surface-muted p-3 type-footnote whitespace-pre-line text-text" dir="auto">
          {row.actionTaken}
        </p>
      ) : null}
      <section aria-label={t('legal.log')}>
        <h3 className="mb-1 type-subhead text-text-secondary">{t('legal.log')}</h3>
        <ol className="flex flex-col gap-1 border-s-2 border-border ps-3" data-legal-log>
          {row.actionLog.map((entry, index) => (
            <li key={`${entry.at}-${String(index)}`} className="type-footnote text-text">
              <span className="text-text-tertiary">{stamp(format, entry.at)}</span> <span dir="auto">{entry.note}</span>
            </li>
          ))}
        </ol>
      </section>
      <input
        ref={file}
        type="file"
        accept={DOCUMENT_TYPES}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={choose}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {closed ? null : (
          <Button
            size="lg"
            onPress={() => {
              setStatus(null);
              setAction(row.actionTaken ?? '');
              setNote('');
              setUpdating(true);
            }}
          >
            {`${t('legal.update')} ★`}
          </Button>
        )}
        {upload.isPending ? (
          <p className="flex min-h-14 items-center gap-3 type-callout text-text-secondary" aria-live="polite">
            <Spinner size={24} />
            {t('legal.uploading')}
          </p>
        ) : (
          <Button
            variant="outline"
            size="lg"
            onPress={() => {
              file.current?.click();
            }}
          >
            {`${t(row.hasDocument ? 'legal.replaceDocument' : 'legal.attachDocument')} ★`}
          </Button>
        )}
        {row.hasDocument ? (
          <Button
            variant="secondary"
            size="lg"
            loading={download.isPending}
            onPress={() => {
              download.mutate();
            }}
          >
            {`${t('legal.downloadDocument')} ★`}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={updating}
        loading={update.isPending}
        onClose={() => {
          setUpdating(false);
        }}
        title={t('legal.updateTitle')}
        body={
          <div className="flex flex-col gap-4">
            <Select
              label={t('legal.statusLabel')}
              value={status ?? row.status}
              onChange={setStatus}
              options={LEGAL_ORDER_STATUSES.map((value) => ({ value, label: t(STATUS_KEY[value]) }))}
            />
            <TextArea
              label={t('legal.actionTaken')}
              optional
              dir="auto"
              maxLength={2000}
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
              }}
            />
            <TextArea
              label={t('legal.note')}
              optional
              dir="auto"
              maxLength={500}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </div>
        }
        confirmLabel={`${t('legal.save')} ★`}
        onConfirm={() => {
          if (changed) update.mutate();
          else setUpdating(false);
        }}
      />
    </article>
  );
}

import { formatters } from '@mc/i18n/format';
import type { Locale } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { MODERATION_CATEGORIES, type ModerationCategory } from '@mc/shared/compliance';
import type { QueueTargetView, REPORT_STATUS_VALUES } from '@mc/shared/contracts';
import { PreviewFrame } from '@mc/ui/admin';
import {
  Button,
  Dialog,
  EmptyState,
  SegmentedControl,
  Select,
  SkeletonText,
  Tag,
  TextArea,
  type Tone,
  useToast,
} from '@mc/ui/components';
import { FeedItemCard } from '@mc/ui/content';
import { useNavigator } from '@mc/ui/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { StepUpCancelled, useStepUp } from '../features/auth/components/StepUpProvider.tsx';
import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/reports')({
  component: ReportsScreen,
});

type Status = (typeof REPORT_STATUS_VALUES)[number];
const KEY = ['super', 'reports'] as const;
/** Under this much time left, the due pill turns amber (05 §3 timers). */
const SOON_MS = 6 * 60 * 60 * 1000;

const REASON_KEY = {
  misleading: 'report.reason.misleading',
  hateful: 'report.reason.hateful',
  off_topic: 'report.reason.off_topic',
  fraud: 'report.reason.fraud',
  private_info: 'report.reason.private_info',
  copyright: 'report.reason.copyright',
  other: 'report.reason.other',
} as const;
const CATEGORY_KEY = {
  misleading: 'posts.category.misleading',
  hateful: 'posts.category.hateful',
  off_topic: 'posts.category.off_topic',
  fraud: 'posts.category.fraud',
  private_info: 'posts.category.private_info',
  copyright: 'posts.category.copyright',
  other: 'posts.category.other',
  legal_order: 'posts.category.legal_order',
} as const satisfies Readonly<Record<ModerationCategory, string>>;
const STATUS_KEY = {
  published: 'reports.status.published',
  hidden: 'reports.status.hidden',
  removed: 'reports.status.removed',
  deleted: 'reports.status.deleted',
} as const;
const isReason = (value: string): value is keyof typeof REASON_KEY => value in REASON_KEY;
const isStatus = (value: string): value is keyof typeof STATUS_KEY => value in STATUS_KEY;
const isCategory = (value: string): value is ModerationCategory => value in CATEGORY_KEY;

/**
 * C5 Moderation (07 C5, 05 §3, PHASE_08 T8.2): reports grouped by the post or masjid they are about, urgent first, then
 * by the earliest due time, each with its countdown; the post exactly as musallis see it; the masjid and its removals in
 * 90 days. ★ Remove (category the masjid sees + private note: "Hidden for everyone now; preserved privately for 180
 * days"), ★ Restore, Dismiss a report; Suspend masjid / Revoke admin are on the masjid's page ("Open masjid").
 */
function ReportsScreen() {
  const { t } = useTranslation('super');
  const { t: tc } = useTranslation();
  const errorText = useErrorText();
  const [status, setStatus] = useState<Status>('open');
  const list = useQuery({ queryKey: [...KEY, status], queryFn: ({ signal }) => superApi.reports(status, signal) });
  return (
    <SuperFrame title={t('reports.title')} section="reports">
      <SegmentedControl
        className="mb-4"
        label={t('reports.filter.label')}
        value={status}
        onChange={setStatus}
        segments={[
          { id: 'open', label: t('reports.filter.open') },
          { id: 'actioned', label: t('reports.filter.actioned') },
          { id: 'dismissed', label: t('reports.filter.dismissed') },
        ]}
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
        <SkeletonText lines={8} />
      ) : list.data.targets.length === 0 ? (
        <EmptyState className="mt-8" title={t('reports.empty')} />
      ) : (
        <ul className="flex flex-col gap-4" data-report-queue={status}>
          {list.data.targets.map((target) => (
            <li key={`${target.targetType}-${target.targetId}`}>
              <TargetCard target={target} open={status === 'open'} />
            </li>
          ))}
        </ul>
      )}
    </SuperFrame>
  );
}

function TargetCard({ target, open }: { readonly target: QueueTargetView; readonly open: boolean }) {
  const { t } = useTranslation('super');
  const { t: tc } = useTranslation();
  const { t: ta } = useTranslation('admin');
  const { locale } = useLocale();
  const format = formatters(locale);
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const [removing, setRemoving] = useState(false);
  const [category, setCategory] = useState<ModerationCategory | null>(null);
  const [note, setNote] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [purgeLost, setPurgeLost] = useState(false);
  // T8.5: a removal for a legal order names the order (open ones only) — logged on it, which stops its clock.
  const orders = useQuery({
    queryKey: ['super', 'legal-orders'],
    queryFn: ({ signal }) => superApi.legalOrders(signal),
    enabled: removing && category === 'legal_order',
  });
  const openOrders = (orders.data?.orders ?? []).filter((order) => order.status !== 'closed');
  // The post exactly as musallis see it, in each language (C5, PHASE_08 T8.2): a template notice needs its template —
  // every template, retired ones too (the C9 list), so an old post still shows its text.
  const templates = useQuery({
    queryKey: ['super', 'templates'],
    queryFn: ({ signal }) => superApi.templates(signal),
    enabled: target.item?.templateKey !== undefined,
    staleTime: 5 * 60 * 1000,
  });
  const [shown, setShown] = useState<Locale>(target.item?.contentLocale ?? locale);
  const now = new Date();
  const due = new Date(target.dueAt);
  const left = due.getTime() - now.getTime();
  const dueTone: Tone = left < 0 ? 'danger' : left < SOON_MS ? 'sun' : 'info';
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const onError = (error: unknown) => {
    if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
  };

  const remove = useMutation({
    mutationFn: (chosen: ModerationCategory) =>
      run(() =>
        superApi.removeItem(target.targetId, {
          category: chosen,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(chosen === 'legal_order' && orderId ? { legalOrderId: orderId } : {}),
        }),
      ),
    onSuccess: async (result) => {
      setRemoving(false);
      setPurgeLost(!result.cdnPurgeQueued);
      toast.show({
        message: result.cdnPurgeQueued ? t('reports.removed') : t('reports.purgeFailed'),
        tone: result.cdnPurgeQueued ? 'success' : 'error',
      });
      await refresh();
    },
    onError,
  });
  const restore = useMutation({
    mutationFn: () => run(() => superApi.restoreItem(target.targetId)),
    onSuccess: async () => {
      toast.show({ message: t('reports.restored'), tone: 'success' });
      await refresh();
    },
    onError,
  });
  const purge = useMutation({
    mutationFn: () => superApi.purgeAgain(target.targetId),
    onSuccess: (result) => {
      setPurgeLost(!result.cdnPurgeQueued);
      toast.show({
        message: result.cdnPurgeQueued ? t('reports.cacheCleared') : t('reports.purgeFailed'),
        tone: result.cdnPurgeQueued ? 'success' : 'error',
      });
    },
    onError,
  });
  const dismiss = useMutation({
    // ★ for an urgent report (DECISIONS 180 L3): the server asks for the step-up only then.
    mutationFn: (reportId: string) => run(() => superApi.dismissReport(reportId)),
    onSuccess: async () => {
      toast.show({ message: t('reports.dismissed'), tone: 'success' });
      await refresh();
    },
    onError,
  });

  const itemStatus = target.itemStatus;
  return (
    <article
      className="flex flex-col gap-4 rounded-md bg-surface p-4 shadow-e1"
      data-report-target={target.targetId}
      data-item-status={itemStatus}
    >
      <header className="flex flex-wrap items-center gap-2">
        {target.urgent ? <Tag tone="danger">{t('reports.urgent')}</Tag> : null}
        {open ? (
          <span data-due>
            <Tag tone={dueTone}>
              {t(left < 0 ? 'reports.overdue' : 'reports.due', { when: format.relative(due, now) })}
            </Tag>
          </span>
        ) : null}
        <Tag tone="neutral">{t('reports.reportCount', { count: target.reports.length })}</Tag>
        {itemStatus && isStatus(itemStatus) ? <Tag tone="slate">{t(STATUS_KEY[itemStatus])}</Tag> : null}
      </header>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-headline text-text" dir="auto">
          {target.masjid.name}
        </h2>
        <span className={`type-footnote ${target.masjid.removals90d > 0 ? 'text-danger' : 'text-text-secondary'}`}>
          {t('reports.removals', { count: format.number(target.masjid.removals90d) })}
        </span>
      </div>
      {target.item ? (
        <div data-report-preview>
          <PreviewFrame
            locale={shown}
            onLocaleChange={setShown}
            label={ta('notice.preview')}
            languageLabel={ta('notice.showIn')}
          >
            <FeedItemCard item={target.item} templates={templates.data?.templates} now={now} />
          </PreviewFrame>
        </div>
      ) : (
        <p className="type-callout text-text-secondary">{t('reports.aboutMasjid')}</p>
      )}
      {target.removedReason ? (
        <p className="type-footnote text-text-secondary">
          {ta('posts.removedReason', {
            reason: ta(CATEGORY_KEY[isCategory(target.removedReason) ? target.removedReason : 'other']),
          })}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {target.reports.map((report) => (
          <li key={report.id} className="flex flex-col gap-1 py-2" data-report-row={report.id}>
            <p className="flex flex-wrap items-center gap-2 type-callout text-text">
              {isReason(report.reason) ? tc(REASON_KEY[report.reason]) : report.reason}
              <span className="type-caption text-text-tertiary">
                {format.relative(new Date(report.createdAt), now)}
              </span>
            </p>
            {report.details ? (
              <p className="type-footnote whitespace-pre-line text-text-secondary" dir="auto">
                {report.details}
              </p>
            ) : null}
            {open ? (
              <Button
                variant="ghost"
                size="lg"
                className="self-start"
                loading={dismiss.isPending && dismiss.variables === report.id}
                onPress={() => {
                  dismiss.mutate(report.id);
                }}
              >
                {t('reports.dismiss')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {target.item && (itemStatus === 'published' || itemStatus === 'hidden') ? (
          <Button
            variant="danger"
            size="lg"
            onPress={() => {
              setCategory(null);
              setNote('');
              setRemoving(true);
            }}
          >
            {`${t('reports.remove')} ★`}
          </Button>
        ) : null}
        {target.item && (itemStatus === 'removed' || itemStatus === 'hidden') ? (
          <Button
            variant="outline"
            size="lg"
            loading={restore.isPending}
            onPress={() => {
              restore.mutate();
            }}
          >
            {`${t('reports.restore')} ★`}
          </Button>
        ) : null}
        {purgeLost && target.item ? (
          <Button
            variant="secondary"
            size="lg"
            loading={purge.isPending}
            onPress={() => {
              purge.mutate();
            }}
          >
            {t('reports.clearCache')}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          onPress={() => {
            navigator.push(`/super/masjids/${target.masjid.id}`);
          }}
        >
          {t('reports.openMasjid')}
        </Button>
      </div>
      <Dialog
        open={removing}
        destructive
        loading={remove.isPending}
        onClose={() => {
          setRemoving(false);
        }}
        title={t('reports.removeTitle')}
        body={
          <div className="flex flex-col gap-4">
            <p className="type-body text-text">{t('reports.removeBody')}</p>
            <Select
              label={t('reports.removeCategory')}
              value={category}
              onChange={setCategory}
              options={MODERATION_CATEGORIES.map((value) => ({ value, label: ta(CATEGORY_KEY[value]) }))}
            />
            {category === 'legal_order' ? (
              <Select
                label={t('reports.legalOrder')}
                placeholder={orders.isPending ? t('reports.legalOrderLoading') : t('reports.legalOrderNone')}
                value={orderId}
                onChange={setOrderId}
                options={openOrders.map((order) => ({
                  value: order.id,
                  label: `${order.referenceNo} · ${order.authority}`,
                }))}
              />
            ) : null}
            <TextArea
              label={t('reports.removeNote')}
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
        confirmLabel={`${t('reports.remove')} ★`}
        onConfirm={() => {
          if (category) remove.mutate(category);
        }}
      />
    </article>
  );
}

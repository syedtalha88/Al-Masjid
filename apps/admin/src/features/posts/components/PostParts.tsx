// B12 parts (07 B12, PHASE_03 T3.9): one post as a card — its icon, title, when, status and the edit window; a removed
// post's reason; the View / Edit / Delete actions — and the View sheet with the musalli card.
import { wallClockInZone } from '@mc/domain/time';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { MODERATION_CATEGORIES, type ModerationCategory } from '@mc/shared/compliance';
import type { AdminItem, NoticeTemplate } from '@mc/shared/contracts';
import { Button, Card, Sheet, Tag, type Tone } from '@mc/ui/components';
import { FeedItemCard, ItemIcon, itemTitle } from '@mc/ui/content';

import { ltr } from '../../timings/lib/text.ts';
import { POST_TYPES } from '../lib/posts.ts';

const STATUS_TONE: Readonly<Record<AdminItem['status'], Tone>> = {
  published: 'primary',
  hidden: 'sun',
  deleted: 'neutral',
  removed: 'danger',
};

/** The moderation category's label key (`MODERATION_CATEGORIES`); an unknown value reads as "against the policy". */
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
const isCategory = (value: string): value is ModerationCategory =>
  (MODERATION_CATEGORIES as readonly string[]).includes(value);

export interface PostCardProps {
  readonly row: AdminItem;
  readonly templates: readonly NoticeTemplate[] | undefined;
  readonly now: Date;
  readonly editable: boolean;
  readonly deletable: boolean;
  readonly onView: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}

/** One of the masjid's posts with its actions (Edit only within 24 h, Delete only while published). */
export function PostCard({ row, templates, now, editable, deletable, onView, onEdit, onDelete }: PostCardProps) {
  const { t } = useTranslation('admin');
  const { locale, format } = useLocale();
  const { item } = row;
  const type = POST_TYPES.find((entry) => entry === item.type) ?? 'all';
  const fallback = t(`posts.types.${type}`);
  return (
    <Card className="flex flex-col gap-3" data-post={row.id} data-status={row.status}>
      <div className="flex items-start gap-3">
        <ItemIcon item={item} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p dir="auto" className="line-clamp-2 type-headline text-text">
            {row.status === 'removed' ? fallback : itemTitle(item, locale, templates, fallback)}
          </p>
          <p className="flex flex-wrap items-center gap-2 type-caption text-text-tertiary">
            <Tag tone={STATUS_TONE[row.status]}>{t(`posts.status.${row.status}`)}</Tag>
            <span>{format.relative(new Date(item.publishedAt), now)}</span>
          </p>
        </div>
      </div>
      {editable && row.editableUntil ? (
        <p className="type-footnote text-text-secondary">
          {t('posts.editUntil', { time: ltr(format.time(wallClockInZone(new Date(row.editableUntil))).text) })}
        </p>
      ) : null}
      {row.status === 'removed' ? (
        <div className="flex flex-col gap-1 rounded-md bg-danger-bg p-3 type-footnote text-text">
          {row.removedReason ? (
            <p>
              {t('posts.removedReason', {
                reason: t(CATEGORY_KEY[isCategory(row.removedReason) ? row.removedReason : 'other']),
              })}
            </p>
          ) : null}
          <p className="text-text-secondary">{t('posts.removedHint')}</p>
        </div>
      ) : null}
      {row.status === 'hidden' ? (
        <p className="rounded-md bg-surface-muted p-3 type-footnote text-text-secondary" data-post-hidden>
          {t('posts.hiddenHint')}
        </p>
      ) : null}
      {row.status === 'published' ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="lg" onPress={onView}>
            {t('posts.view')}
          </Button>
          {editable ? (
            <Button variant="outline" size="lg" onPress={onEdit}>
              {t('posts.edit')}
            </Button>
          ) : null}
          {deletable ? (
            <Button variant="ghost" size="lg" onPress={onDelete}>
              {t('posts.delete')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** "View": the post exactly as followers see it (`@mc/ui/content`). */
export function ViewSheet({
  row,
  templates,
  now,
  onClose,
}: {
  readonly row: AdminItem | null;
  readonly templates: readonly NoticeTemplate[] | undefined;
  readonly now: Date;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <Sheet open={row !== null} onClose={onClose} title={t('posts.view')}>
      {row ? (
        <div className="pb-4">
          <FeedItemCard item={row.item} templates={templates} now={now} />
        </div>
      ) : null}
    </Sheet>
  );
}

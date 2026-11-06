import { useTranslation } from '@mc/i18n/react';
import type { SuperTemplate } from '@mc/shared/contracts';
import { Button, EmptyState, ListRow, SkeletonText, Tag, type Tone, useToast } from '@mc/ui/components';
import { MegaphoneIcon, PlusIcon, TemplateIcon } from '@mc/ui/icons';
import { useNavigator } from '@mc/ui/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/templates/')({
  component: Templates,
});

const TONE: Readonly<Record<SuperTemplate['status'], Tone>> = { draft: 'sun', active: 'primary', retired: 'neutral' };

/** C9 Templates: drafts first; add the starter set; open one to edit, review and activate. */
function Templates() {
  const { t } = useTranslation('super');
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['super', 'templates'], queryFn: ({ signal }) => superApi.templates(signal) });
  const starters = useMutation({
    mutationFn: () => superApi.addStarterTemplates(),
    onSuccess: async ({ added }) => {
      toast.show({ message: t('templates.startersAdded', { count: added }), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['super', 'templates'] });
    },
    onError: (error) => {
      toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  const rows = list.data?.templates ?? [];

  return (
    <SuperFrame title={t('nav.templates')} section="templates">
      <div className="flex flex-col gap-3">
        <Button
          leadingIcon={<PlusIcon />}
          fullWidth
          onPress={() => {
            navigator.push('/super/templates/new');
          }}
        >
          {t('templates.new')}
        </Button>
        <Button
          variant="outline"
          fullWidth
          loading={starters.isPending}
          onPress={() => {
            starters.mutate();
          }}
        >
          {t('templates.addStarters')}
        </Button>
      </div>
      <div className="mt-4">
        {list.isPending ? (
          <SkeletonText lines={6} />
        ) : rows.length === 0 ? (
          <EmptyState illustration={<MegaphoneIcon size={48} />} title={t('templates.empty')} className="mt-8" />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
            {rows.map((template) => (
              <li key={template.key}>
                <ListRow
                  className="px-4"
                  leading={<TemplateIcon name={template.icon} className="text-primary-700" />}
                  title={<span dir="auto">{template.title.en}</span>}
                  subtitle={t(`templates.categories.${template.category}`)}
                  meta={template.system ? t('templates.system') : undefined}
                  trailing={<Tag tone={TONE[template.status]}>{t(`templates.statuses.${template.status}`)}</Tag>}
                  onPress={() => {
                    navigator.push(`/super/templates/${template.key}`);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SuperFrame>
  );
}

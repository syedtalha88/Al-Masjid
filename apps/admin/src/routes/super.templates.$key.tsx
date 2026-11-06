import { useTranslation } from '@mc/i18n/react';
import type { SuperTemplate, SuperTemplatePatch } from '@mc/shared/contracts';
import { Button, Dialog, EmptyState, SkeletonText, Tag, type Tone, useToast } from '@mc/ui/components';
import { useScreen } from '@mc/ui/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';
import { iconOf, type TemplateDraft, TemplateForm } from '../features/super/components/TemplateForm.tsx';

export const Route = createFileRoute('/super/templates/$key')({
  component: TemplatePage,
});

const TONE: Readonly<Record<SuperTemplate['status'], Tone>> = { draft: 'sun', active: 'primary', retired: 'neutral' };

const draftOf = (template: SuperTemplate): TemplateDraft => ({
  key: template.key,
  category: template.category,
  icon: iconOf(template.icon),
  isImportantDefault: template.isImportantDefault,
  title: { ...template.title },
  body: { ...template.body },
  params: template.params.map((param) => ({ ...param })),
  translationReviewed: template.translationReviewed,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only what changed — an unchanged text never asks for a new review (DECISIONS #111). */
function patchOf(original: TemplateDraft, draft: TemplateDraft): SuperTemplatePatch {
  return {
    ...(draft.category === original.category ? {} : { category: draft.category }),
    ...(draft.icon === original.icon ? {} : { icon: draft.icon }),
    ...(draft.isImportantDefault === original.isImportantDefault
      ? {}
      : { isImportantDefault: draft.isImportantDefault }),
    ...(same(draft.title, original.title) ? {} : { title: draft.title }),
    ...(same(draft.body, original.body) ? {} : { body: draft.body }),
    ...(same(draft.params, original.params) ? {} : { params: [...draft.params] }),
    ...(draft.translationReviewed === original.translationReviewed
      ? {}
      : { translationReviewed: draft.translationReviewed }),
  };
}

/** C9 editor: edit, then Activate (needs reviewed translations) or Retire (not system templates). */
function TemplatePage() {
  const { t } = useTranslation('super');
  const { params } = useScreen();
  const key = params['key'] ?? '';
  const errorText = useErrorText();
  const detail = useQuery({
    queryKey: ['super', 'templates', key],
    queryFn: ({ signal }) => superApi.template(key, signal),
  });
  return (
    <SuperFrame title={detail.data?.template.title.en ?? t('nav.templates')} section="templates">
      {detail.data ? (
        <Editor key={detail.data.template.updatedAt} template={detail.data.template} />
      ) : detail.isError ? (
        <EmptyState title={errorText(detail.error)} className="mt-8" />
      ) : (
        <SkeletonText lines={10} />
      )}
    </SuperFrame>
  );
}

function Editor({ template }: { readonly template: SuperTemplate }) {
  const { t } = useTranslation('super');
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const original = draftOf(template);
  const [draft, setDraft] = useState(original);
  const [retiring, setRetiring] = useState(false);
  const patch = patchOf(original, draft);
  const dirty = Object.keys(patch).length > 0;

  const save = useMutation({
    mutationFn: (body: SuperTemplatePatch) => superApi.updateTemplate(template.key, body),
    onSuccess: async (_, body) => {
      toast.show({
        message:
          body.status === 'active'
            ? t('templates.activated')
            : body.status === 'retired'
              ? t('templates.retired')
              : t('templates.saved'),
        tone: 'success',
      });
      setRetiring(false);
      await queryClient.invalidateQueries({ queryKey: ['super', 'templates'] });
    },
    onError: (error) => {
      toast.show({ message: errorText(error), tone: 'error' });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={TONE[template.status]}>{t(`templates.statuses.${template.status}`)}</Tag>
        {template.system ? <Tag tone="neutral">{t('templates.system')}</Tag> : null}
        <span className="type-caption text-text-tertiary">{template.key}</span>
      </div>
      <TemplateForm
        draft={draft}
        onChange={setDraft}
        keyEditable={false}
        paramsEditable={template.status === 'draft'}
      />
      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          disabled={!dirty}
          loading={save.isPending && save.variables.status === undefined}
          onPress={() => {
            save.mutate(patch);
          }}
        >
          {t('templates.save')}
        </Button>
        {template.status !== 'active' ? (
          <Button
            size="lg"
            fullWidth
            variant="outline"
            disabled={!draft.translationReviewed}
            loading={save.isPending && save.variables.status === 'active'}
            onPress={() => {
              save.mutate({ ...patch, status: 'active' });
            }}
          >
            {t('templates.activate')}
          </Button>
        ) : template.system ? null : (
          <Button
            size="lg"
            fullWidth
            variant="outline"
            onPress={() => {
              setRetiring(true);
            }}
          >
            {t('templates.retire')}
          </Button>
        )}
      </div>
      <Dialog
        open={retiring}
        onClose={() => {
          setRetiring(false);
        }}
        title={t('templates.retireTitle')}
        body={t('templates.retireBody')}
        confirmLabel={t('templates.retire')}
        destructive
        loading={save.isPending}
        onConfirm={() => {
          save.mutate({ status: 'retired' });
        }}
      />
    </div>
  );
}

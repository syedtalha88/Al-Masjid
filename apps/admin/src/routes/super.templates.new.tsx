import { useTranslation } from '@mc/i18n/react';
import { Button, useToast } from '@mc/ui/components';
import { useNavigator } from '@mc/ui/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';
import { EMPTY_DRAFT, TemplateForm } from '../features/super/components/TemplateForm.tsx';

export const Route = createFileRoute('/super/templates/new')({
  component: NewTemplate,
});

/** C9: a new template — created as a draft (DECISIONS #111); activation happens on its page after review. */
function NewTemplate() {
  const { t } = useTranslation('super');
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const create = useMutation({
    mutationFn: () => superApi.createTemplate({ ...draft, params: [...draft.params] }),
    onSuccess: async ({ template }) => {
      toast.show({ message: t('templates.saved'), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['super', 'templates'] });
      navigator.replace(`/super/templates/${template.key}`);
    },
    onError: (error) => {
      toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  return (
    <SuperFrame title={t('templates.new')} section="templates">
      <div className="flex flex-col gap-6">
        <TemplateForm draft={draft} onChange={setDraft} keyEditable paramsEditable />
        <Button
          size="lg"
          fullWidth
          disabled={draft.key.length < 3}
          loading={create.isPending}
          onPress={() => {
            create.mutate();
          }}
        >
          {t('templates.create')}
        </Button>
      </div>
    </SuperFrame>
  );
}

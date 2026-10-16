import { loadLegalDoc } from '@mc/i18n/legal';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { ProblemError } from '@mc/shared/http';
import { Button, Checkbox, IconCircle, InfoNote, SkeletonText, type Tone } from '@mc/ui/components';
import {
  BookOpenIcon,
  CheckCircleIcon,
  DeviceMobileIcon,
  HandsPrayingIcon,
  HeartIcon,
  InfoIcon,
  MegaphoneIcon,
  ShieldCheckIcon,
} from '@mc/ui/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { authApi } from '../api/auth-api.ts';
import { ME_KEY, useErrorText } from '../hooks/use-session.ts';
import { FlowLayout } from './FlowLayout.tsx';

/** One icon per point of the undertaking (07 B2 "icons per point"), in the order of the text. */
const POINT_ICONS: readonly (readonly [ReactNode, Tone])[] = [
  [<CheckCircleIcon key="truth" />, 'primary'],
  [<MegaphoneIcon key="respect" />, 'danger'],
  [<HandsPrayingIcon key="consent" />, 'rose'],
  [<BookOpenIcon key="library" />, 'info'],
  [<HeartIcon key="money" />, 'heart'],
  [<InfoIcon key="media" />, 'sun'],
  [<DeviceMobileIcon key="phone" />, 'slate'],
  [<ShieldCheckIcon key="enforcement" />, 'purple'],
];

/**
 * B2 Undertaking: plain-language points with icons, "I agree", Continue. The text is bundled per locale; its version
 * is sent with the acceptance and the server refuses an outdated one (UNDERTAKING_VERSION_MISMATCH).
 */
export function UndertakingScreen() {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const doc = useQuery({
    queryKey: ['legal', 'undertaking', locale],
    queryFn: () => loadLegalDoc('undertaking', locale),
    staleTime: Infinity,
  });
  const accept = useMutation({
    mutationFn: (version: string) => authApi.acceptUndertaking(version),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
  });
  const failure = accept.error
    ? accept.error instanceof ProblemError && accept.error.problem.code === 'UNDERTAKING_VERSION_MISMATCH'
      ? t('undertaking.outdated')
      : errorText(accept.error)
    : null;
  const version = doc.data?.version;

  return (
    <FlowLayout
      {...(version
        ? {
            footer: (
              <>
                <Checkbox checked={agreed} onChange={setAgreed} label={t('undertaking.agree')} />
                <Button
                  size="lg"
                  fullWidth
                  disabled={!agreed}
                  loading={accept.isPending}
                  onPress={() => {
                    accept.mutate(version);
                  }}
                >
                  {t('undertaking.continue')}
                </Button>
              </>
            ),
          }
        : {})}
    >
      <div className="flex flex-col gap-2">
        <h1 className="type-large-title text-text">{t('undertaking.title')}</h1>
        <p className="type-body text-text-secondary">{t('undertaking.lead')}</p>
      </div>
      {doc.data ? (
        <>
          <ul className="mt-6 flex flex-col gap-4">
            {doc.data.points.map((point, index) => {
              const [icon, tone] = POINT_ICONS[index % POINT_ICONS.length] ?? [null, 'primary' as const];
              return (
                <li key={point} className="flex items-start gap-3">
                  <IconCircle tone={tone}>{icon}</IconCircle>
                  <p className="pt-2 type-body text-text">{point}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 type-caption text-text-tertiary">
            {t('undertaking.version', { version: doc.data.version })}
          </p>
        </>
      ) : (
        <SkeletonText lines={8} className="mt-6" />
      )}
      <div aria-live="polite" className="mt-4">
        {failure ? <InfoNote>{failure}</InfoNote> : null}
      </div>
    </FlowLayout>
  );
}

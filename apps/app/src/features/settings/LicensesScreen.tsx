// Settings → About → Licenses (05 §10, PHASE_08 T8.6): the open-source packages, fonts and texts the app ships with,
// from `/licenses.json` (generated at build by `mcLicenses`). Package names and licence ids stay as published (Latin).
import { useTranslation } from '@mc/i18n/react';
import { Button, EmptyState, SkeletonText } from '@mc/ui/components';
import { Screen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import * as z from 'zod/mini';

const licensesSchema = z.object({
  packages: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      license: z.string(),
      homepage: z.optional(z.string().check(z.regex(/^https:\/\//u))),
    }),
  ),
});

export function LicensesScreen() {
  const { t, ready } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const list = useQuery({
    queryKey: ['licenses'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/licenses.json', { signal });
      if (!response.ok) throw new Error(`licenses: HTTP ${String(response.status)}`);
      return licensesSchema.parse(await response.json());
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return (
    <Screen title={t('licenses')}>
      <div className="flex flex-col gap-4 pt-2 pb-8">
        <p className="type-callout text-text-secondary">{t('licensesLead')}</p>
        {list.data ? (
          <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1" data-licenses>
            {list.data.packages.map((entry) => (
              <li key={`${entry.name}@${entry.version}`} className="flex flex-col gap-0.5 px-4 py-3">
                {entry.homepage ? (
                  // Each package's own page — also the keyboard stops of this long list (axe).
                  <a
                    href={entry.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="ltr"
                    className="self-start type-subhead-strong text-primary-700 underline-offset-2 hover:underline"
                  >
                    {entry.name}
                  </a>
                ) : (
                  <bdi dir="ltr" className="type-subhead-strong text-text">
                    {entry.name}
                  </bdi>
                )}
                <bdi dir="ltr" className="type-footnote text-text-secondary">
                  {`${entry.version} · ${entry.license}`}
                </bdi>
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <EmptyState
            title={tc('appError.title')}
            action={
              <Button variant="outline" onPress={() => void list.refetch()}>
                {tc('appError.retry')}
              </Button>
            }
          />
        ) : (
          <SkeletonText lines={10} />
        )}
      </div>
    </Screen>
  );
}

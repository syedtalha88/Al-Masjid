import { type Locale, LOCALES } from '@mc/i18n/locales';
import { LocaleScope, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import type { SuperMasjidDetail } from '@mc/shared/contracts';
import { Button, EmptyState, SegmentedControl, SkeletonText } from '@mc/ui/components';
import { CameraIcon, CheckCircleIcon, DownloadIcon, MosqueIcon, QrCodeIcon } from '@mc/ui/icons';
import { Screen, useScreen } from '@mc/ui/navigation';
import { QR_QUIET_MODULES, qrMatrix, qrPath, qrPng, qrSvgText } from '@mc/ui/qr';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { superApi } from '../features/super/api/super-api.ts';

export const Route = createFileRoute('/super/masjids/$id/poster')({
  component: PosterScreen,
});

type Size = 'a4' | 'a5';
type Masjid = SuperMasjidDetail['masjid'];

/** The follow link the poster's QR opens (04 §6: only `https://<app origin>/m/<code>` is accepted by the app). */
export const followUrl = (appOrigin: string, code: string): string => new URL(`/m/${code}`, appOrigin).toString();

const APP_ORIGIN = import.meta.env.VITE_PUBLIC_APP_ORIGIN;
const RTL = new Set<Locale>(['ur']);

/**
 * Print geometry (07 C3). Physical units on purpose — this is a printed sheet, not a screen (DECISIONS #177): the QR is
 * 10 cm on A4 (07 C3: ≥ 10 cm) and 7.2 cm on A5; type in points.
 */
const SHEET: Record<Size, { page: string; qr: string; name: string; code: string; pad: string; block: string }> = {
  a4: {
    page: 'w-[210mm] h-[297mm]',
    qr: 'size-[100mm]',
    name: 'text-[24pt]',
    code: 'text-[26pt]',
    pad: 'px-[12mm] py-[8mm] gap-[3mm]',
    block: 'text-[10pt]',
  },
  a5: {
    page: 'w-[148mm] h-[210mm]',
    qr: 'size-[72mm]',
    name: 'text-[18pt]',
    code: 'text-[18pt]',
    pad: 'px-[8mm] py-[6mm] gap-[2mm]',
    block: 'text-[7pt]',
  },
};

/**
 * C3 Poster generator (07 C3, PHASE_08 T8.8): an A4 / A5 print page rendered by the browser (complex scripts shape
 * correctly), saved as PDF or printed; plus the QR alone as SVG or PNG. The QR (error correction Q, quiet zone) opens
 * `https://<app>/m/<CODE>`; the follow code is printed under it; 3-step instructions in all four languages.
 */
function PosterScreen() {
  const { t } = useTranslation('super');
  const { t: tc } = useTranslation();
  const { params } = useScreen();
  const masjidId = params['id'] ?? '';
  const detail = useQuery({
    queryKey: ['super', 'masjid', masjidId],
    queryFn: ({ signal }) => superApi.masjid(masjidId, signal),
  });
  const [size, setSize] = useState<Size>('a4');
  const masjid = detail.data?.masjid;
  return (
    <Screen title={t('poster.title')}>
      <div className="flex flex-col gap-4 pb-10">
        {detail.isError ? (
          <EmptyState
            className="mt-8"
            title={tc('appError.title')}
            action={
              <Button size="lg" variant="outline" onPress={() => void detail.refetch()}>
                {tc('appError.retry')}
              </Button>
            }
          />
        ) : !masjid ? (
          <SkeletonText lines={8} />
        ) : (
          <PosterTools masjid={masjid} size={size} onSize={setSize} />
        )}
      </div>
    </Screen>
  );
}

/**
 * The printed page size while the poster screen is open: one `@page` rule in a constructable stylesheet (allowed by the
 * CSP, which forbids inline <style>), replaced on an A4 / A5 change and removed when the screen closes.
 */
function usePrintPage(size: Size): void {
  useEffect(() => {
    if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`@page { size: ${size === 'a4' ? 'A4' : 'A5'}; margin: 0; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((adopted) => adopted !== sheet);
    };
  }, [size]);
}

function PosterTools({
  masjid,
  size,
  onSize,
}: {
  readonly masjid: Masjid;
  readonly size: Size;
  readonly onSize: (size: Size) => void;
}) {
  const { t } = useTranslation('super');
  usePrintPage(size);
  const url = followUrl(APP_ORIGIN, masjid.followCode);
  const matrix = useMemo(() => qrMatrix(url, 'Q'), [url]);
  const download = (blob: Blob, name: string) => {
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = name;
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(href);
    }, 1000);
  };
  const code = displayCode(masjid.followCode);
  return (
    <>
      <p className="type-callout text-text-secondary">{t('poster.lead')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<Size>
          label={t('poster.size')}
          segments={[
            { id: 'a4', label: 'A4' },
            { id: 'a5', label: 'A5' },
          ]}
          value={size}
          onChange={onSize}
        />
        <Button
          size="lg"
          onPress={() => {
            // The other scripts' fonts load on first use: wait for them, or the print shows fallback glyphs.
            void document.fonts.ready.then(() => {
              window.print();
            });
          }}
        >
          {t('poster.print')}
        </Button>
        <Button
          variant="outline"
          size="lg"
          leadingIcon={<DownloadIcon />}
          onPress={() => {
            download(new Blob([qrSvgText(matrix)], { type: 'image/svg+xml' }), `qr-${masjid.followCode}.svg`);
          }}
        >
          {t('poster.downloadSvg')}
        </Button>
        <Button
          variant="outline"
          size="lg"
          leadingIcon={<DownloadIcon />}
          onPress={() => {
            void qrPng(matrix, { caption: [masjid.name, code], scale: 20 }).then((png) => {
              if (png) download(png, `qr-${masjid.followCode}.png`);
            });
          }}
        >
          {t('poster.downloadPng')}
        </Button>
      </div>
      <p className="type-footnote text-text-secondary">{t('poster.printHint')}</p>
      {/* On screen: the sheet at its real size, scrolling sideways on a phone. */}
      {/* A labelled, focusable region: keyboard users can scroll it too (axe scrollable-region-focusable). */}
      <div
        role="region"
        aria-label={t('poster.preview')}
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- a scrolling region must be keyboard-reachable (axe scrollable-region-focusable)
        tabIndex={0}
        className="overflow-x-auto rounded-md bg-surface-muted p-4 focus-visible:outline-2 focus-visible:outline-primary-700"
      >
        <div className="mx-auto w-max">
          <PosterSheet masjid={masjid} size={size} path={qrPath(matrix)} modules={matrix.size} />
        </div>
      </div>
      {/* The copy that prints (styles.css hides everything else on paper). */}
      {createPortal(
        <div data-poster-print={size}>
          <PosterSheet masjid={masjid} size={size} path={qrPath(matrix)} modules={matrix.size} />
        </div>,
        document.body,
      )}
    </>
  );
}

const displayCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
/** Word joiner (keeps "ABCD-EFGH" on one line), left-to-right isolate and its end (the code inside Urdu text). */
const WJ = String.fromCodePoint(0x2060);
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

function PosterSheet({
  masjid,
  size,
  path,
  modules,
}: {
  readonly masjid: Masjid;
  readonly size: Size;
  readonly path: string;
  readonly modules: number;
}) {
  const sheet = SHEET[size];
  const side = modules + QR_QUIET_MODULES * 2;
  const names = (['hi', 'ur', 'te'] as const).flatMap((locale) => {
    const name = masjid.nameI18n[locale];
    return name ? [{ locale, name }] : [];
  });
  const host = new URL(APP_ORIGIN).host;
  return (
    <article
      data-poster={size}
      className={`${sheet.page} ${sheet.pad} flex shrink-0 flex-col items-center overflow-hidden bg-surface text-text`}
    >
      <header className="flex items-center gap-[3mm] self-stretch">
        {/* The brand mark as a vector (prints crisp; the musalli app's icon is another origin — CSP img-src). */}
        <span className="flex size-[11mm] items-center justify-center rounded-full bg-primary-700 text-on-primary">
          <MosqueIcon size={26} />
        </span>
        <span className="text-[14pt] font-bold text-primary-700">{BRAND.name}</span>
      </header>
      <div className="flex flex-col items-center gap-[1.5mm] text-center">
        <h1 className={`${sheet.name} leading-[1.2] font-bold`}>{masjid.name}</h1>
        {names.map(({ locale, name }) => (
          <p
            key={locale}
            lang={locale}
            dir={RTL.has(locale) ? 'rtl' : 'ltr'}
            className="mc-preview text-[13pt] leading-normal font-semibold"
          >
            {name}
          </p>
        ))}
        <p className="text-[11pt] text-text-secondary">{[masjid.area, masjid.city].filter(Boolean).join(', ')}</p>
      </div>
      <svg
        viewBox={`0 0 ${String(side)} ${String(side)}`}
        className={`${sheet.qr} shrink-0`}
        role="img"
        aria-label={displayCode(masjid.followCode)}
        shapeRendering="crispEdges"
        data-poster-qr
      >
        <rect width={side} height={side} className="fill-surface" />
        <path
          d={path}
          fillRule="evenodd"
          className="fill-text"
          transform={`translate(${String(QR_QUIET_MODULES)} ${String(QR_QUIET_MODULES)})`}
        />
      </svg>
      <p dir="ltr" className={`${sheet.code} font-bold tracking-[0.15em]`} data-poster-code>
        {displayCode(masjid.followCode)}
      </p>
      <ul className={`grid grid-cols-2 gap-[3mm] self-stretch ${sheet.block}`}>
        {LOCALES.map((locale) => (
          <li
            key={locale}
            lang={locale}
            dir={RTL.has(locale) ? 'rtl' : 'ltr'}
            className="mc-preview rounded-sm border border-border px-[2.5mm] py-[1.5mm]"
            data-poster-steps={locale}
          >
            <LocaleScope locale={locale} namespaces={['super']}>
              {/* Never broken across lines, and kept left-to-right inside Urdu (word joiners around the hyphen — Nastaliq has no U+2011 glyph; isolate). */}
              <Steps code={`${LRI}${displayCode(masjid.followCode).replace('-', `${WJ}-${WJ}`)}${PDI}`} />
            </LocaleScope>
          </li>
        ))}
      </ul>
      <footer className="mt-auto flex flex-col items-center gap-[1mm] text-center text-[10pt] text-text-secondary">
        <span dir="ltr">{host}</span>
      </footer>
    </article>
  );
}

function Steps({ code }: { readonly code: string }) {
  const { t } = useTranslation('super');
  const steps = [
    { Icon: CameraIcon, text: t('poster.step1') },
    { Icon: QrCodeIcon, text: t('poster.step2', { code }) },
    { Icon: CheckCircleIcon, text: t('poster.step3') },
  ];
  return (
    <div className="flex flex-col gap-[0.8mm]">
      <p className="font-bold">{t('poster.howTo')}</p>
      <ol className="flex flex-col gap-[0.5mm]">
        {steps.map(({ Icon, text }, index) => (
          <li key={text} className="flex items-center gap-[1.5mm]">
            <Icon size={14} className="shrink-0 text-primary-700" />
            <span>{`${String(index + 1)}. ${text}`}</span>
          </li>
        ))}
      </ol>
      <p className="font-semibold text-primary-700">{t('poster.free')}</p>
    </div>
  );
}

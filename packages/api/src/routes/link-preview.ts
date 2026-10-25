// Link previews for shared links (03 §3): WhatsApp and other crawlers read OpenGraph tags from `/m/:code` and
// `/p/:publicId`. Caddy serves the app shell for those two paths as a template (og.html) that includes this fragment
// (DECISIONS #91) — so the API never needs a copy of the built index.html. Only the masjid name / area or an item's
// generic title leave the server, HTML-escaped; unknown codes and ids get the uniform generic tags.
import type { DbHandle } from '@mc/db';
import { getPublicItem, listTemplates, type PublicItem, resolveMasjidByCode } from '@mc/db/repos';
import { normalizeFollowCode } from '@mc/domain/follow-code';
import { BRAND } from '@mc/shared/brand';
import { ICON_FILES } from '@mc/shared/pwa';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  // Caddy renders this fragment as a template (`httpInclude` inside og.html): a raw `{{ … }}` in a masjid name or
  // title would run there (env, includes, a meta refresh…). Braces as entities read the same to crawlers.
  '{': '&#123;',
  '}': '&#125;',
};
/** Escapes text for an HTML attribute value inside a Caddy template (also `{` / `}` — security review H1). */
export const escapeHtml = (text: string): string => text.replace(/[&<>"'{}]/g, (char) => ESCAPES[char] ?? char);

const GENERIC = {
  title: BRAND.name,
  description: 'Prayer times, notices and dua requests from your masjid. Free, no ads, no account.',
} as const;

const DAILY_TITLES = { hadith: 'Hadith of the day', ayah: 'Ayah of the day' } as const;

/** The OpenGraph + Twitter tags (one per line); never a raw `{` or `}` (Caddy template delimiters — escaped). */
export function previewTags(input: { title: string; description: string; url?: string; appOrigin?: string }): string {
  const meta = (key: 'property' | 'name', name: string, content: string) =>
    `<meta ${key}="${name}" content="${escapeHtml(content)}">`;
  return [
    meta('property', 'og:site_name', BRAND.name),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', input.title),
    meta('property', 'og:description', input.description),
    ...(input.url ? [meta('property', 'og:url', input.url)] : []),
    ...(input.appOrigin ? [meta('property', 'og:image', `${input.appOrigin}/${ICON_FILES.any512}`)] : []),
    meta('name', 'twitter:card', 'summary'),
    meta('name', 'description', input.description),
  ].join('\n');
}

/** A neutral title per item type — never message text, names or religious content. */
function itemTitle(item: PublicItem, templateTitles: ReadonlyMap<string, string>): string {
  if (item.templateKey) return templateTitles.get(item.templateKey) ?? GENERIC.title;
  switch (item.type) {
    case 'daily_content':
      return item.daily ? DAILY_TITLES[item.daily.kind] : GENERIC.title;
    case 'dua_request':
      return 'Request for Dua';
    case 'chanda_update':
      return 'Weekly chanda update';
    case 'announcement':
    case 'timing_update':
    case 'campaign':
    case 'video':
      return item.title ?? GENERIC.title;
  }
}

/**
 * `GET /og/m/:code` and `GET /og/p/:publicId` — HTML fragments included by Caddy's og.html template.
 *
 * @param deps.appOrigin - the app's origin for absolute `og:url` / `og:image` (absent in tests → omitted).
 */
export function linkPreviewRoutes(deps: { readonly db: DbHandle; readonly appOrigin?: string }): RouteDefinition[] {
  const { db, appOrigin } = deps;
  const origin = appOrigin ? { appOrigin } : {};
  const cache = 'public, s-maxage=300';
  return [
    defineRoute({
      method: 'get',
      path: '/og/m/:code',
      summary: 'Link-preview tags for a follow link',
      tags: ['link-preview'],
      auth: 'none',
      htmlFragment: true,
      cacheControl: cache,
      request: { params: z.object({ code: z.string().max(32) }) },
      responses: { 200: z.string() },
      handler: async ({ params, reply }) => {
        const code = normalizeFollowCode(params.code);
        const masjid = code ? await resolveMasjidByCode(db, code) : null;
        if (!masjid) return reply(200, previewTags({ ...GENERIC, ...origin }));
        return reply(
          200,
          previewTags({
            title: `${masjid.name} · ${BRAND.name}`,
            description: `Follow ${masjid.name}, ${masjid.area}, ${masjid.city} for prayer times and notices.`,
            ...(appOrigin ? { url: `${appOrigin}/m/${masjid.followCode}` } : {}),
            ...origin,
          }),
        );
      },
    }),
    defineRoute({
      method: 'get',
      path: '/og/p/:publicId',
      summary: 'Link-preview tags for a shared post',
      tags: ['link-preview'],
      auth: 'none',
      htmlFragment: true,
      cacheControl: cache,
      request: { params: z.object({ publicId: z.string().max(32) }) },
      responses: { 200: z.string() },
      handler: async ({ params, reply }) => {
        // Only posts for everyone get specific tags (a crawler has no audience preference).
        const found = /^[A-Za-z0-9_-]{12}$/.test(params.publicId)
          ? await getPublicItem(db, params.publicId, ['everyone'])
          : null;
        if (!found) return reply(200, previewTags({ ...GENERIC, ...origin }));
        const titles = new Map((await listTemplates(db)).map((template) => [template.key, template.title.en]));
        return reply(
          200,
          previewTags({
            title: itemTitle(found.item, titles),
            description: `${found.masjid.name}, ${found.masjid.city} · ${BRAND.name}`,
            ...(appOrigin ? { url: `${appOrigin}/p/${found.item.publicId}` } : {}),
            ...origin,
          }),
        );
      },
    }),
  ];
}

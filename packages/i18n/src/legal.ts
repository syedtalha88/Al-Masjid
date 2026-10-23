// Legal documents (09 §9): `packages/i18n/legal/<locale>/<name>.md` — front matter (`version`, `status`) and, for the
// admin undertaking (07 B2), a plain bullet list. Each file is its own lazy chunk; a device downloads its locale only.
import { DEFAULT_LOCALE, type Locale } from './locales.ts';

export type LegalDocName = 'undertaking' | 'privacy';

export interface LegalDoc {
  /** Must equal the server's current version (`app_settings.undertaking_version`) to be accepted. */
  readonly version: string;
  /** Production builds refuse `draft` (05 §10). */
  readonly status: 'draft' | 'reviewed';
  readonly points: readonly string[];
}

/**
 * Parses a legal document: `---` front matter with `version` and `status`, then `- ` bullet lines.
 *
 * @throws Error when the front matter or the bullets are missing or malformed (a build-time content bug).
 */
export function parseLegalDoc(text: string): LegalDoc {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text.replace(/^\uFEFF/, ''));
  if (!match) throw new Error('legal document: missing front matter');
  const meta = new Map(
    (match[1] ?? '')
      .split(/\r?\n/)
      .map((line) => /^([a-z]+):\s*(.+?)\s*$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] ?? '', m[2] ?? '']),
  );
  const version = meta.get('version');
  const status = meta.get('status');
  if (!version || !/^[A-Za-z0-9._-]{1,20}$/.test(version)) throw new Error('legal document: bad version');
  if (status !== 'draft' && status !== 'reviewed') throw new Error('legal document: bad status');
  const lines = (match[2] ?? '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines.some((line) => !line.startsWith('- '))) {
    throw new Error('legal document: body must be a bullet list');
  }
  return { version, status, points: lines.map((line) => line.slice(2).trim()) };
}

const FILES = import.meta.glob<string>('../legal/*/*.md', { query: '?raw', import: 'default' });

/**
 * Loads a legal document in the locale (English when the locale has none).
 *
 * @throws Error when neither file exists or the content is malformed.
 */
export async function loadLegalDoc(name: LegalDocName, locale: Locale): Promise<LegalDoc> {
  const load = FILES[`../legal/${locale}/${name}.md`] ?? FILES[`../legal/${DEFAULT_LOCALE}/${name}.md`];
  if (!load) throw new Error(`legal document ${name} missing`);
  return parseLegalDoc(await load());
}

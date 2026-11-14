// Legal documents (09 §9, 05 §10, PHASE_08 T8.6): `packages/i18n/legal/<locale>/<name>.md` — front matter (`version`,
// `status`, and `translation: draft` on machine-drafted translations) and a plain bullet list. Each file is its own lazy
// chunk; a device downloads its locale only. Production builds refuse any `status: draft` (`mcLegalGate`, vite plugin).
// This module is pure (no bundler globs): the build-time gate imports it in Node.
export const LEGAL_DOC_NAMES = ['privacy', 'terms', 'content-policy', 'grievance', 'undertaking'] as const;
export type LegalDocName = (typeof LEGAL_DOC_NAMES)[number];

export interface LegalDoc {
  /** Must equal the server's current version (`app_settings.undertaking_version`) to be accepted. */
  readonly version: string;
  /** Production builds refuse `draft` (05 §10). */
  readonly status: 'draft' | 'reviewed';
  /** A machine-drafted translation, shown with a "DRAFT TRANSLATION" mark until a human translator reviews it. */
  readonly draftTranslation?: true;
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
  const translation = meta.get('translation');
  if (translation !== undefined && translation !== 'draft' && translation !== 'reviewed') {
    throw new Error('legal document: bad translation');
  }
  if (!version || !/^[A-Za-z0-9._-]{1,20}$/.test(version)) throw new Error('legal document: bad version');
  if (status !== 'draft' && status !== 'reviewed') throw new Error('legal document: bad status');
  const lines = (match[2] ?? '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines.some((line) => !line.startsWith('- '))) {
    throw new Error('legal document: body must be a bullet list');
  }
  return {
    version,
    status,
    ...(translation === 'draft' ? { draftTranslation: true as const } : {}),
    points: lines.map((line) => line.slice(2).trim()),
  };
}

/**
 * The documents a production build must refuse (05 §10): every file whose `status` is `draft`.
 *
 * @param files - path → file text.
 * @returns the offending paths, sorted (empty = ready for production).
 * @throws Error for a malformed document (a content bug fails every build).
 */
export function draftLegalDocs(files: Readonly<Record<string, string>>): string[] {
  return Object.entries(files)
    .filter(([, text]) => parseLegalDoc(text).status === 'draft')
    .map(([path]) => path)
    .sort();
}

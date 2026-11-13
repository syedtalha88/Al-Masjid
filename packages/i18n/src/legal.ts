// Legal documents loader (09 §9, PHASE_08 T8.6): one lazy chunk per `legal/<locale>/<name>.md`; parsing lives in
// `legal-parse.ts` (pure, also used by the build-time gate).
import { type LegalDoc, type LegalDocName, parseLegalDoc } from './legal-parse.ts';
import { DEFAULT_LOCALE, type Locale } from './locales.ts';

export { draftLegalDocs, LEGAL_DOC_NAMES, type LegalDoc, type LegalDocName, parseLegalDoc } from './legal-parse.ts';

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

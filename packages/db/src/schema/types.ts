// Shared shapes for collection specs (02 §2, PHASE_01 T1.2).
import type { z } from 'zod';

import type { CollectionName } from '../collections.ts';
import type { BsonSchema } from './dsl.ts';

export type IndexDirection = 1 | -1 | 'text';

/** One index exactly as migrations create it and `db:schema:check` compares it (names are fixed). */
export interface IndexSpec {
  readonly name: string;
  readonly key: Readonly<Record<string, IndexDirection>>;
  readonly unique?: boolean;
  readonly partialFilterExpression?: Readonly<Record<string, unknown>>;
  readonly default_language?: string;
}

export interface CollectionSpec {
  readonly name: CollectionName;
  /** Zod schema of a stored document (the data layer parses with it). */
  readonly zod: z.ZodType;
  /** The `$jsonSchema` validator (validationLevel strict, validationAction error — 02 §0). */
  readonly jsonSchema: BsonSchema;
  readonly indexes: readonly IndexSpec[];
}

export const ascending = (field: string): IndexSpec['key'] => ({ [field]: 1 });

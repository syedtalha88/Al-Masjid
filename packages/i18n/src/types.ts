// Typed translation keys (09 §2): keys come from the English source files, so `t('common:unknown')` or a
// misspelled key fails typecheck. Adding a namespace = add its JSON in all four locales + list it here.
import type common from '../locales/en/common.json';
import type errors from '../locales/en/errors.json';

export interface Resources {
  common: typeof common;
  errors: typeof errors;
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Resources;
  }
}

// Typed translation keys (09 §2): keys come from the English source files, so `t('common:unknown')` or a
// misspelled key fails typecheck. Adding a namespace = add its JSON in all four locales + list it here.
import type admin from '../locales/en/admin.json';
import type common from '../locales/en/common.json';
import type errors from '../locales/en/errors.json';
import type follow from '../locales/en/follow.json';
import type masjid from '../locales/en/masjid.json';
import type onboarding from '../locales/en/onboarding.json';
import type superAdmin from '../locales/en/super.json';

export interface Resources {
  admin: typeof admin;
  common: typeof common;
  errors: typeof errors;
  follow: typeof follow;
  masjid: typeof masjid;
  onboarding: typeof onboarding;
  super: typeof superAdmin;
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Resources;
  }
}

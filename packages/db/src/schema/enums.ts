// Enums of 02 §1 — the only allowed values; validators and Zod both come from these tuples.

export const MASJID_STATUS = ['pending', 'active', 'suspended', 'deleted'] as const;
export const ADMIN_ROLE = ['super_admin', 'masjid_admin'] as const;
export const MASJID_ADMIN_ROLE = ['owner', 'editor'] as const;
export const ADMIN_STATUS = ['invited', 'active', 'disabled'] as const;
export const INVITE_PURPOSE = ['register', 'add_device', 'recovery'] as const;
export const CALC_METHOD = ['karachi', 'mwl', 'isna', 'egypt', 'umm_al_qura', 'other_custom'] as const;
export const ASR_MADHAB = ['hanafi', 'shafi'] as const;
export const PRAYER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export const ADHAN_MODE = ['auto', 'manual'] as const;
export const JAMAAT_MODE = ['fixed', 'offset', 'none'] as const;
export const SPECIAL_TYPE = ['eid_ul_fitr', 'eid_ul_adha', 'taraweeh', 'shab_e_barat', 'shab_e_qadr', 'other'] as const;
export const ITEM_TYPE = [
  'announcement',
  'daily_content',
  'dua_request',
  'campaign',
  'chanda_update',
  'video',
  'timing_update',
] as const;
export const ITEM_STATUS = ['draft', 'published', 'hidden', 'deleted', 'removed'] as const;
export const AUDIENCE = ['everyone', 'brothers', 'sisters'] as const;
export const AUDIENCE_PREF = ['brothers', 'sisters'] as const;
export const LOCALE = ['en', 'hi', 'ur', 'te'] as const;
export const ANNOUNCEMENT_CATEGORY = ['general', 'event', 'facilities', 'timing'] as const;
export const DUA_CATEGORY = ['illness', 'inteqal', 'other'] as const;
export const LIBRARY_KIND = ['hadith', 'ayah', 'dua', 'dhikr'] as const; // dhikr: DECISIONS #104
/** When a `dhikr` library entry is said (DECISIONS #104). */
export const DHIKR_OCCASION = ['after_salah', 'morning', 'evening'] as const;
export const LIBRARY_STATUS = ['draft', 'verified', 'retired'] as const;
export const TEMPLATE_STATUS = ['active', 'retired'] as const;
export const CAMPAIGN_PURPOSE = ['renovation', 'repair', 'utilities', 'welfare', 'other'] as const;
export const CAMPAIGN_STATUS = ['active', 'completed', 'closed'] as const;
export const PAYMENT_STATUS = ['pending', 'approved_on_hold', 'active', 'rejected', 'superseded'] as const;
export const PUSH_STATUS = ['active', 'dead', 'none'] as const;
export const JOB_STATUS = ['pending', 'running', 'completed', 'failed'] as const;
export const REPORT_REASON = [
  'misleading',
  'hateful',
  'off_topic',
  'fraud',
  'private_info',
  'copyright',
  'other',
] as const;
export const REPORT_STATUS = ['open', 'actioned', 'dismissed'] as const;
export const GRIEVANCE_STATUS = ['open', 'acknowledged', 'resolved', 'rejected'] as const;
export const LEGAL_ORDER_STATUS = ['received', 'actioned', 'contested', 'closed'] as const;
export const ACTOR_TYPE = ['admin', 'super_admin', 'system', 'device'] as const;

// Not named as enums in 02 §1 but closed sets in 02 §2:
export const PLATFORM = ['android', 'ios', 'desktop', 'other'] as const;
export const REPORT_TARGET = ['item', 'masjid'] as const;
export const GRIEVANCE_CATEGORY = ['privacy', 'content', 'technical', 'feedback', 'other'] as const;
export const TEMPLATE_PARAM_TYPE = [
  'time',
  'date',
  'date_range',
  'time_range',
  'prayer',
  'number',
  'short_text',
  'phone', // E.164, rendered as a WhatsApp button (blood camp — DECISIONS #104)
] as const;

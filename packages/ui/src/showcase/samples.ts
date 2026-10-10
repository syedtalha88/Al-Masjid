// DEV-ONLY sample text for the component showcase (`/_dev/showcase`, never in production builds). Fake
// content per locale so screenshots show each script; masjid names follow 10 §5 ("Test Masjid Alpha"), the
// Arabic/translation strings are the 10 §5 religious-content placeholders verbatim, terms follow glossary.md.
import type { Locale } from '@mc/i18n';

export interface Samples {
  readonly masjid: string;
  readonly location: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  /** Relative time; the meta line is composed as <bdi>masjid</bdi> • time (09 §5). */
  readonly ago: string;
  readonly recentUpdates: string;
  readonly important: string;
  readonly general: string;
  readonly event: string;
  readonly facilities: string;
  readonly all: string;
  readonly illness: string;
  readonly inteqal: string;
  readonly overview: string;
  readonly prayerTimings: string;
  readonly announcements: string;
  readonly hadith: string;
  readonly quran: string;
  readonly donateNow: string;
  readonly showQr: string;
  readonly share: string;
  readonly readFull: string;
  readonly addMasjid: string;
  readonly notifications: string;
  readonly directions: string;
  readonly raised: string;
  readonly infoNote: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly scan: string;
  readonly notify: string;
  readonly notifyHint: string;
  readonly ownPhoto: string;
  readonly brother: string;
  readonly sister: string;
  readonly iAm: string;
  readonly nameLabel: string;
  readonly nameHint: string;
  readonly nameError: string;
  readonly message: string;
  readonly search: string;
  readonly prayer: string;
  readonly prayers: readonly [string, string, string, string, string];
  readonly sheetTitle: string;
  readonly sheetBody: string;
  readonly dialogTitle: string;
  readonly dialogBody: string;
  readonly dialogConfirm: string;
  readonly toast: string;
  readonly saved: string;
  readonly failed: string;
  readonly chooseDate: string;
  readonly jamaatTime: string;
  readonly targetAmount: string;
  readonly translation: string;
}

/** 10 §5 placeholders — the only "religious" text allowed in code. */
export const ARABIC_SAMPLE = 'نص تجريبي للعرض فقط';
export const TRANSLITERATION_SAMPLE = 'Sample transliteration — DEV ONLY';

export const SAMPLES: Readonly<Record<Locale, Samples>> = {
  en: {
    masjid: 'Test Masjid Alpha',
    location: 'Banjara Hills, Hyderabad',
    noticeTitle: 'Water will not be available today',
    noticeBody: 'Due to maintenance work, water will not be available from 10 AM to 2 PM.',
    ago: '2 hours ago',
    recentUpdates: 'Recent Updates',
    important: 'Important',
    general: 'General',
    event: 'Event',
    facilities: 'Facilities',
    all: 'All',
    illness: 'Illness',
    inteqal: 'Inteqal',
    overview: 'Overview',
    prayerTimings: 'Prayer Timings',
    announcements: 'Announcements',
    hadith: 'Hadith',
    quran: 'Quran',
    donateNow: 'Donate Now',
    showQr: 'Show UPI QR Code',
    share: 'Share',
    readFull: 'Read Full',
    addMasjid: 'Add Another Masjid',
    notifications: 'Notifications',
    directions: 'Directions',
    raised: 'Raised so far',
    infoNote: 'Timings may change due to weather or special occasions. Please check announcements.',
    emptyTitle: 'No masjids yet',
    emptyBody: 'Scan the QR code on your masjid’s poster to follow it.',
    scan: 'Scan QR code',
    notify: 'Notify followers',
    notifyHint: '6 of 8 left today',
    ownPhoto: 'I took this photo or have permission to use it',
    brother: 'Brother',
    sister: 'Sister',
    iAm: 'I am a',
    nameLabel: 'Masjid name',
    nameHint: 'As written on the masjid board',
    nameError: 'Please enter the masjid name',
    message: 'Message',
    search: 'Search masjids',
    prayer: 'Prayer',
    prayers: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'],
    sheetTitle: 'Donate via UPI',
    sheetBody: 'Payments go directly to the masjid’s verified UPI account.',
    dialogTitle: 'Clear all data?',
    dialogBody: 'This removes all your masjids and settings from this phone.',
    dialogConfirm: 'Clear data',
    toast: 'Opening your UPI app…',
    saved: 'Timings saved',
    failed: 'Could not save. Please try again.',
    chooseDate: 'Choose date',
    jamaatTime: 'Isha jamaat time',
    targetAmount: 'Target amount',
    translation: 'Sample translation text for development. Not a real hadith.',
  },
  hi: {
    masjid: 'Test Masjid Alpha',
    location: 'बंजारा हिल्स, हैदराबाद',
    noticeTitle: 'आज पानी उपलब्ध नहीं रहेगा',
    noticeBody: 'मरम्मत के कारण सुबह 10 बजे से दोपहर 2 बजे तक पानी नहीं रहेगा।',
    ago: '2 घंटे पहले',
    recentUpdates: 'हाल के अपडेट',
    important: 'ज़रूरी',
    general: 'सामान्य',
    event: 'कार्यक्रम',
    facilities: 'सुविधाएँ',
    all: 'सभी',
    illness: 'बीमारी',
    inteqal: 'इंतक़ाल',
    overview: 'जानकारी',
    prayerTimings: 'नमाज़ के समय',
    announcements: 'घोषणाएँ',
    hadith: 'हदीस',
    quran: 'क़ुरआन',
    donateNow: 'अभी दान करें',
    showQr: 'UPI QR कोड दिखाएँ',
    share: 'शेयर करें',
    readFull: 'पूरा पढ़ें',
    addMasjid: 'एक और मस्जिद जोड़ें',
    notifications: 'सूचनाएँ',
    directions: 'रास्ता',
    raised: 'अब तक जमा',
    infoNote: 'मौसम या खास मौक़ों पर समय बदल सकते हैं। कृपया घोषणाएँ देखें।',
    emptyTitle: 'अभी कोई मस्जिद नहीं',
    emptyBody: 'फ़ॉलो करने के लिए मस्जिद के पोस्टर पर QR कोड स्कैन करें।',
    scan: 'QR कोड स्कैन करें',
    notify: 'फ़ॉलोअर्स को सूचना दें',
    notifyHint: 'आज 8 में से 6 बाक़ी',
    ownPhoto: 'यह फ़ोटो मैंने ली है या इसकी अनुमति है',
    brother: 'भाई',
    sister: 'बहन',
    iAm: 'मैं हूँ',
    nameLabel: 'मस्जिद का नाम',
    nameHint: 'जैसा मस्जिद के बोर्ड पर लिखा है',
    nameError: 'कृपया मस्जिद का नाम लिखें',
    message: 'संदेश',
    search: 'मस्जिद खोजें',
    prayer: 'नमाज़',
    prayers: ['फ़ज्र', 'ज़ुहर', 'अस्र', 'मग़रिब', 'इशा'],
    sheetTitle: 'UPI से दान करें',
    sheetBody: 'भुगतान सीधे मस्जिद के सत्यापित UPI खाते में जाता है।',
    dialogTitle: 'सारा डेटा मिटाएँ?',
    dialogBody: 'इससे इस फ़ोन से आपकी सभी मस्जिदें और सेटिंग्स हट जाएँगी।',
    dialogConfirm: 'डेटा मिटाएँ',
    toast: 'आपका UPI ऐप खुल रहा है…',
    saved: 'समय सहेजे गए',
    failed: 'सहेजा नहीं जा सका। फिर कोशिश करें।',
    chooseDate: 'तारीख़ चुनें',
    jamaatTime: 'इशा जमात का समय',
    targetAmount: 'लक्ष्य राशि',
    translation: 'विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।',
  },
  ur: {
    masjid: 'Test Masjid Alpha',
    location: 'بنجارہ ہلز، حیدرآباد',
    noticeTitle: 'آج پانی دستیاب نہیں ہوگا',
    noticeBody: 'مرمت کی وجہ سے صبح 10 بجے سے دوپہر 2 بجے تک پانی نہیں ہوگا۔',
    ago: '2 گھنٹے پہلے',
    recentUpdates: 'حالیہ اپڈیٹس',
    important: 'اہم',
    general: 'عام',
    event: 'پروگرام',
    facilities: 'سہولیات',
    all: 'سب',
    illness: 'بیماری',
    inteqal: 'انتقال',
    overview: 'تفصیل',
    prayerTimings: 'نماز کے اوقات',
    announcements: 'اعلانات',
    hadith: 'حدیث',
    quran: 'قرآن',
    donateNow: 'ابھی عطیہ دیں',
    showQr: 'UPI QR کوڈ دکھائیں',
    share: 'شیئر کریں',
    readFull: 'پورا پڑھیں',
    addMasjid: 'ایک اور مسجد شامل کریں',
    notifications: 'اطلاعات',
    directions: 'راستہ',
    raised: 'اب تک جمع',
    infoNote: 'موسم یا خاص مواقع پر اوقات بدل سکتے ہیں۔ براہ کرم اعلانات دیکھیں۔',
    emptyTitle: 'ابھی کوئی مسجد نہیں',
    emptyBody: 'فالو کرنے کے لیے مسجد کے پوسٹر پر QR کوڈ اسکین کریں۔',
    scan: 'QR کوڈ اسکین کریں',
    notify: 'فالوورز کو اطلاع دیں',
    notifyHint: 'آج 8 میں سے 6 باقی',
    ownPhoto: 'یہ تصویر میں نے لی ہے یا اس کی اجازت ہے',
    brother: 'بھائی',
    sister: 'بہن',
    iAm: 'میں ہوں',
    nameLabel: 'مسجد کا نام',
    nameHint: 'جیسا مسجد کے بورڈ پر لکھا ہے',
    nameError: 'براہ کرم مسجد کا نام لکھیں',
    message: 'پیغام',
    search: 'مسجد تلاش کریں',
    prayer: 'نماز',
    prayers: ['فجر', 'ظہر', 'عصر', 'مغرب', 'عشاء'],
    sheetTitle: 'UPI سے عطیہ دیں',
    sheetBody: 'ادائیگی براہ راست مسجد کے تصدیق شدہ UPI اکاؤنٹ میں جاتی ہے۔',
    dialogTitle: 'سارا ڈیٹا مٹائیں؟',
    dialogBody: 'اس سے اس فون سے آپ کی تمام مساجد اور سیٹنگز ہٹ جائیں گی۔',
    dialogConfirm: 'ڈیٹا مٹائیں',
    toast: 'آپ کی UPI ایپ کھل رہی ہے…',
    saved: 'اوقات محفوظ ہو گئے',
    failed: 'محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
    chooseDate: 'تاریخ منتخب کریں',
    jamaatTime: 'عشاء جماعت کا وقت',
    targetAmount: 'ہدف رقم',
    translation: 'ترقی کے لیے نمونہ ترجمہ۔ یہ اصل حدیث نہیں ہے۔',
  },
  te: {
    masjid: 'Test Masjid Alpha',
    location: 'బంజారా హిల్స్, హైదరాబాద్',
    noticeTitle: 'ఈరోజు నీరు అందుబాటులో ఉండదు',
    noticeBody: 'మరమ్మతుల కారణంగా ఉదయం 10 నుండి మధ్యాహ్నం 2 వరకు నీరు ఉండదు.',
    ago: '2 గంటల క్రితం',
    recentUpdates: 'ఇటీవలి అప్‌డేట్లు',
    important: 'ముఖ్యం',
    general: 'సాధారణం',
    event: 'కార్యక్రమం',
    facilities: 'సౌకర్యాలు',
    all: 'అన్నీ',
    illness: 'అనారోగ్యం',
    inteqal: 'ఇంతెకాల్',
    overview: 'సమాచారం',
    prayerTimings: 'నమాజ్ సమయాలు',
    announcements: 'ప్రకటనలు',
    hadith: 'హదీస్',
    quran: 'ఖురాన్',
    donateNow: 'ఇప్పుడే దానం చేయండి',
    showQr: 'UPI QR కోడ్ చూపించు',
    share: 'షేర్ చేయండి',
    readFull: 'పూర్తిగా చదవండి',
    addMasjid: 'మరో మస్జిద్ జోడించండి',
    notifications: 'నోటిఫికేషన్లు',
    directions: 'దారి',
    raised: 'ఇప్పటివరకు సేకరించింది',
    infoNote: 'వాతావరణం లేదా ప్రత్యేక సందర్భాల్లో సమయాలు మారవచ్చు. ప్రకటనలు చూడండి.',
    emptyTitle: 'ఇంకా మస్జిద్‌లు లేవు',
    emptyBody: 'ఫాలో చేయడానికి మస్జిద్ పోస్టర్‌పై QR కోడ్ స్కాన్ చేయండి.',
    scan: 'QR కోడ్ స్కాన్ చేయండి',
    notify: 'ఫాలోవర్లకు తెలియజేయండి',
    notifyHint: 'ఈరోజు 8లో 6 మిగిలాయి',
    ownPhoto: 'ఈ ఫోటో నేను తీశాను లేదా అనుమతి ఉంది',
    brother: 'సోదరుడు',
    sister: 'సోదరి',
    iAm: 'నేను',
    nameLabel: 'మస్జిద్ పేరు',
    nameHint: 'మస్జిద్ బోర్డుపై రాసినట్లు',
    nameError: 'దయచేసి మస్జిద్ పేరు రాయండి',
    message: 'సందేశం',
    search: 'మస్జిద్‌లను వెతకండి',
    prayer: 'నమాజ్',
    prayers: ['ఫజ్ర్', 'జుహర్', 'అస్ర్', 'మగ్రిబ్', 'ఇషా'],
    sheetTitle: 'UPI ద్వారా దానం',
    sheetBody: 'చెల్లింపులు నేరుగా మస్జిద్ ధృవీకరించిన UPI ఖాతాకు వెళ్తాయి.',
    dialogTitle: 'మొత్తం డేటా తొలగించాలా?',
    dialogBody: 'ఈ ఫోన్ నుండి మీ మస్జిద్‌లు, సెట్టింగ్‌లు అన్నీ తొలగిపోతాయి.',
    dialogConfirm: 'డేటా తొలగించు',
    toast: 'మీ UPI యాప్ తెరుచుకుంటోంది…',
    saved: 'సమయాలు సేవ్ అయ్యాయి',
    failed: 'సేవ్ కాలేదు. మళ్లీ ప్రయత్నించండి.',
    chooseDate: 'తేదీ ఎంచుకోండి',
    jamaatTime: 'ఇషా జమాత్ సమయం',
    targetAmount: 'లక్ష్య మొత్తం',
    translation: 'అభివృద్ధి కోసం నమూనా అనువాదం. ఇది నిజమైన హదీస్ కాదు.',
  },
};

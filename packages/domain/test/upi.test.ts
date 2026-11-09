import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildUpiUri, isValidVpa, normalizeVpa, parseUpiUri, UPI_TEXT_MAX, VPA_MAX_LENGTH } from '../src/upi.ts';

// PHASE_05 T5.1 · 01 §5.7 · 04 R1 / §6: a VPA as the database accepts it (02 payment_profiles: the pattern and ≤ 100
// characters); `upi://pay?pa=…&pn=…&tn=…&cu=INR` with RFC 3986 percent-encoding, payee name and note ≤ 50 characters,
// non-ASCII kept as UTF-8; an admin's UPI-QR scan accepts only `upi://pay` and takes `pa` / `pn` (never `am`, `mc` …).

const localChars = fc.constantFrom(...Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_'));
const handleHead = fc.constantFrom(...Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'));
const handleChars = fc.constantFrom(...Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-'));
/** Any VPA the database pattern accepts, ≤ 100 characters. */
const vpa = fc
  .tuple(
    fc.string({ unit: localChars, minLength: 2, maxLength: 60 }),
    handleHead,
    fc.string({ unit: handleChars, minLength: 1, maxLength: 30 }),
  )
  .map(([local, head, rest]) => `${local}@${head}${rest}`);
/** A name or note as the build keeps it: printable text in any script, single spaces, ≤ 50 characters. */
const text = fc
  .array(
    fc.constantFrom(...Array.from('abcXYZ09 &=?#%+/@:;,\'"!()*~'), 'मस्जिद', 'کمیٹی', 'మసీదు', 'é', '👍🏽', 'क्ष', 'ज़'),
    {
      minLength: 1,
      maxLength: 12,
    },
  )
  .map((parts) => parts.join('').replace(/\s+/g, ' ').trim())
  .filter((value) => value.length > 0 && Array.from(value).length <= UPI_TEXT_MAX);

describe('isValidVpa', () => {
  it('accepts what the database accepts', () => {
    for (const ok of ['ab@ybl', 'masjid.committee@okhdfcbank', 'MASJID-01_x@paytm', 'a.b-c_d@oksbi.in']) {
      expect(isValidVpa(ok)).toBe(true);
    }
    fc.assert(fc.property(vpa, (value) => isValidVpa(value)));
  });

  it('refuses everything else', () => {
    for (const bad of [
      '',
      'a@ybl', // local part ≥ 2
      'ab@', // no handle
      'ab@1bank', // handle starts with a letter
      'ab@y', // handle ≥ 2
      '@ybl',
      'ab ybl',
      'ab@@ybl',
      'a b@ybl',
      'ab@yb l',
      'ab@ybl\n',
      ' ab@ybl',
      'ab@ybl&am=1',
      'javascript:alert(1)',
      `${'a'.repeat(VPA_MAX_LENGTH - 3)}@ybl`, // 101 characters
    ]) {
      expect(isValidVpa(bad), bad).toBe(false);
    }
    expect(isValidVpa(`${'a'.repeat(VPA_MAX_LENGTH - 4)}@ybl`)).toBe(true); // exactly 100
    expect(isValidVpa(42)).toBe(false);
    expect(isValidVpa(null)).toBe(false);
  });
});

describe('normalizeVpa', () => {
  it('trims and lowercases the handle; the user part keeps its case', () => {
    expect(normalizeVpa('  Masjid.Ali@OKHDFCBank \n')).toBe('Masjid.Ali@okhdfcbank');
    expect(normalizeVpa('no-at-sign ')).toBe('no-at-sign');
  });

  it('is idempotent and keeps valid VPAs valid', () => {
    fc.assert(
      fc.property(vpa, (value) => {
        const once = normalizeVpa(value);
        return normalizeVpa(once) === once && isValidVpa(once);
      }),
    );
  });
});

describe('buildUpiUri', () => {
  it('builds pa, pn, tn, cu=INR in that order', () => {
    expect(buildUpiUri({ vpa: 'masjid@okhdfcbank', payeeName: 'Masjid Committee', note: 'Renovation' })).toBe(
      'upi://pay?pa=masjid@okhdfcbank&pn=Masjid%20Committee&tn=Renovation&cu=INR',
    );
  });

  it('leaves the note out when there is none (or only spaces)', () => {
    expect(buildUpiUri({ vpa: 'ab@ybl', payeeName: 'A' })).toBe('upi://pay?pa=ab@ybl&pn=A&cu=INR');
    expect(buildUpiUri({ vpa: 'ab@ybl', payeeName: 'A', note: '   ' })).toBe('upi://pay?pa=ab@ybl&pn=A&cu=INR');
  });

  it('normalizes the VPA', () => {
    expect(buildUpiUri({ vpa: ' ab@YBL ', payeeName: 'A' })).toBe('upi://pay?pa=ab@ybl&pn=A&cu=INR');
  });

  it("percent-encodes RFC 3986 reserved characters, including encodeURIComponent's !'()*", () => {
    const uri = buildUpiUri({ vpa: 'ab@ybl', payeeName: "A&B=C?D#E%F+G/H!I'J(K)L*M~N", note: 'x' });
    expect(uri).toBe('upi://pay?pa=ab@ybl&pn=A%26B%3DC%3FD%23E%25F%2BG%2FH%21I%27J%28K%29L%2AM~N&tn=x&cu=INR');
  });

  it('keeps non-ASCII names as UTF-8, never transliterated', () => {
    expect(buildUpiUri({ vpa: 'ab@ybl', payeeName: 'मस्जिद' })).toBe(
      `upi://pay?pa=ab@ybl&pn=${encodeURIComponent('मस्जिद')}&cu=INR`,
    );
    expect(buildUpiUri({ vpa: 'ab@ybl', payeeName: 'مسجد کمیٹی' })).toContain('pn=%D9%85%D8%B3%D8%AC%D8%AF%20');
  });

  it('neutralizes injection: no raw &, newline, control or bidi-override character reaches the URI', () => {
    const uri = buildUpiUri({
      vpa: 'ab@ybl',
      payeeName: 'Thief&pa=evil@ybl&am=99999\r\nX\u202Eevil\u0000',
      note: 'tn\n&mc=0000\u2066x',
    });
    expect(uri).toBe(
      'upi://pay?pa=ab@ybl&pn=Thief%26pa%3Devil%40ybl%26am%3D99999%20Xevil&tn=tn%20%26mc%3D0000x&cu=INR',
    );
    expect(parseUpiUri(uri)).toEqual({
      vpa: 'ab@ybl',
      payeeName: 'Thief&pa=evil@ybl&am=99999 Xevil',
      note: 'tn &mc=0000x',
    });
  });

  it('keeps joiners that Indic and Arabic scripts need (ZWJ / ZWNJ)', () => {
    expect(parseUpiUri(buildUpiUri({ vpa: 'ab@ybl', payeeName: 'क्\u200Dष \u200Cی' }))?.payeeName).toBe(
      'क्\u200Dष \u200Cی',
    );
  });

  it('cuts payee name and note to 50 characters without splitting a letter', () => {
    const long = 'ab'.repeat(40);
    expect(parseUpiUri(buildUpiUri({ vpa: 'ab@ybl', payeeName: long, note: long }))).toEqual({
      vpa: 'ab@ybl',
      payeeName: long.slice(0, UPI_TEXT_MAX),
      note: long.slice(0, UPI_TEXT_MAX),
    });
    // 49 × "a" then "क्ष" (3 code points): the conjunct does not fit, so it is dropped whole.
    const name = `${'a'.repeat(49)}क्ष`;
    expect(parseUpiUri(buildUpiUri({ vpa: 'ab@ybl', payeeName: name }))?.payeeName).toBe('a'.repeat(49));
    // An emoji with a skin tone is one letter of two code points: it fits exactly.
    const emoji = `${'a'.repeat(48)}👍🏽`;
    expect(parseUpiUri(buildUpiUri({ vpa: 'ab@ybl', payeeName: emoji }))?.payeeName).toBe(emoji);
  });

  it('refuses an invalid VPA or an empty payee name', () => {
    expect(() => buildUpiUri({ vpa: 'not a vpa', payeeName: 'A' })).toThrow(RangeError);
    expect(() => buildUpiUri({ vpa: 'ab@ybl&am=1', payeeName: 'A' })).toThrow(RangeError);
    expect(() => buildUpiUri({ vpa: 'ab@ybl', payeeName: ' \n\u202E ' })).toThrow(RangeError);
  });

  it('round-trips: parse(build(x)) ⊇ x', () => {
    fc.assert(
      fc.property(vpa, text, fc.option(text, { nil: undefined }), (pa, payeeName, note) => {
        const parsed = parseUpiUri(buildUpiUri({ vpa: pa, payeeName, ...(note === undefined ? {} : { note }) }));
        expect(parsed).toEqual({ vpa: normalizeVpa(pa), payeeName, note: note ?? null });
      }),
    );
  });
});

describe('parseUpiUri', () => {
  it('reads pa, pn and tn from a bank QR; ignores am, mc, tr, cu …', () => {
    expect(
      parseUpiUri('upi://pay?pa=Masjid.Ali@OKSBI&pn=Masjid%20Committee&am=500.00&mc=8661&tr=123&cu=INR&mode=02'),
    ).toEqual({ vpa: 'Masjid.Ali@oksbi', payeeName: 'Masjid Committee', note: null });
  });

  it("accepts '+' as a space, any case of the scheme, surrounding spaces, and a missing pn", () => {
    expect(parseUpiUri('  UPI://Pay?pn=Jama+Masjid&pa=ab@ybl \n')).toEqual({
      vpa: 'ab@ybl',
      payeeName: 'Jama Masjid',
      note: null,
    });
    expect(parseUpiUri('upi://pay?pa=ab@ybl')).toEqual({ vpa: 'ab@ybl', payeeName: null, note: null });
    expect(parseUpiUri('upi://pay?pa=ab%40ybl&pn=&tn=')).toEqual({ vpa: 'ab@ybl', payeeName: null, note: null });
  });

  it('cleans names: control and bidi characters gone, spaces collapsed, ≤ 100 characters', () => {
    expect(parseUpiUri('upi://pay?pa=ab@ybl&pn=%E2%80%AEA%0A%0A%20B%00')?.payeeName).toBe('A B');
    expect(parseUpiUri(`upi://pay?pa=ab@ybl&pn=${'x'.repeat(150)}`)?.payeeName).toBe('x'.repeat(100));
  });

  it('refuses anything that is not a upi://pay link with exactly one valid pa', () => {
    for (const bad of [
      '',
      'javascript:alert(1)//upi://pay?pa=ab@ybl',
      'https://evil.example/upi://pay?pa=ab@ybl',
      'upi://mandate?pa=ab@ybl',
      'upi://payx?pa=ab@ybl',
      'upi:pay?pa=ab@ybl',
      'upi://pay',
      'upi://pay?',
      'upi://pay?pn=NoVpa',
      'upi://pay?pa=not%20a%20vpa',
      'upi://pay?pa=ab@ybl%26am=1', // an encoded & inside pa is part of the value → invalid VPA
      'upi://pay?pa=ab@ybl&pa=evil@ybl', // ambiguous
      'upi://pay?pa=ab@ybl&pn=%E0%A4', // malformed UTF-8
      'upi://pay?pa=%ZZ',
      `upi://pay?pa=ab@ybl&pn=${'x'.repeat(5000)}`, // absurdly long QR text
    ]) {
      expect(parseUpiUri(bad), bad).toBeNull();
    }
  });

  it('never throws, whatever the text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (value) => {
        const parsed = parseUpiUri(`upi://pay?${value}`);
        return parsed === null || isValidVpa(parsed.vpa);
      }),
    );
  });
});

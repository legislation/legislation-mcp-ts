/**
 * Roman numeral parsing and formatting.
 *
 * Ported from Roman.java in the lgu2 API project.
 */

const NUMERALS = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'] as const;
const VALUES   = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1] as const;

const CHAR_VALUES: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};

export function toUpperRoman(n: number): string {
  if (n < 1 || n > 3999)
    throw new RangeError('value must be between 1 and 3999');
  let result = '';
  for (let i = 0; i < VALUES.length; i++) {
    while (n >= VALUES[i]) {
      n -= VALUES[i];
      result += NUMERALS[i];
    }
  }
  return result;
}

/**
 * Parses a roman numeral string, returning its integer value,
 * or 0 if the string is not a valid roman numeral.
 * Uses roundtrip validation via {@link toUpperRoman}.
 */
export function parse(s: string): number {
  const upper = s.toUpperCase();
  let result = 0;
  let prev = 0;
  for (let i = upper.length - 1; i >= 0; i--) {
    const value = CHAR_VALUES[upper[i]] || 0;
    if (value === 0) return 0;
    if (value < prev)
      result -= value;
    else
      result += value;
    prev = value;
  }
  if (result <= 0 || result > 3999) return 0;
  if (toUpperRoman(result) !== upper) return 0;
  return result;
}

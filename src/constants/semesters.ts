/**
 * Canonical semester values.
 *
 * A subject's semester is always one of these eight values. Nothing else may
 * be stored, which is why both the API (server/routes/masterDataRoutes.ts) and
 * the Subject Management UI read this same list instead of free text.
 *
 * Note: academic years, departments and subjects are never listed here — those
 * are always resolved from the database.
 */
export const SEMESTER_OPTIONS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII'
] as const;

export type Semester = (typeof SEMESTER_OPTIONS)[number];

const SEMESTER_SET: ReadonlySet<string> = new Set<string>(SEMESTER_OPTIONS);

/** True when `value` is one of the canonical semester values. */
export function isValidSemester(value: unknown): value is Semester {
  return typeof value === 'string' && SEMESTER_SET.has(value.trim());
}

/**
 * Maps a stored semester onto a dropdown option.
 *
 * Historical rows may hold lowercase, padded or "Semester IV" style values, so
 * those are normalized to the canonical form. Anything unrecognised (including
 * a subject that has never had a semester set) returns '' so the select falls
 * back to its "Select Semester" placeholder instead of inventing a value.
 */
export function normalizeSemester(value: string | null | undefined): Semester | '' {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/^semester\s*/i, '');
  const upper = cleaned.toUpperCase();
  if (SEMESTER_SET.has(upper)) return upper as Semester;
  // Tolerate stored numerals such as "1".."8" so those rows stay selectable.
  const asNumber = Number.parseInt(upper, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= SEMESTER_OPTIONS.length) {
    return SEMESTER_OPTIONS[asNumber - 1];
  }
  return '';
}
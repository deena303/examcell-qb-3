/**
 * Canonical semester values accepted for a subject.
 *
 * The subject's semester is a closed set: I..VIII. Free text is rejected so
 * Subject Management, Generate Paper and every other consumer agree on what a
 * semester is.
 *
 * Mirrors src/constants/semesters.ts, which drives the dropdown. The two copies
 * exist because the Express API and the Vite SPA are compiled separately
 * (server/tsconfig.json has its own rootDir); keep them in step.
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
 * Normalizes a stored semester onto a canonical option so legacy values
 * ("iv", " Semester IV", "4") keep round-tripping through the dropdown.
 * Unrecognised input returns '' (nothing selected) rather than guessing.
 */
export function normalizeSemester(value: unknown): Semester | '' {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/^semester\s*/i, '');
  const upper = cleaned.toUpperCase();
  if (SEMESTER_SET.has(upper)) return upper as Semester;
  const asNumber = Number.parseInt(upper, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= SEMESTER_OPTIONS.length) {
    return SEMESTER_OPTIONS[asNumber - 1];
  }
  return '';
}
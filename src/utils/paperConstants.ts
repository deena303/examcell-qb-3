/**
 * Shared constants for every generated academic document.
 *
 * The institution name, the question typeface and the PI display convention are
 * used by the on-screen preview, the printable HTML, the PDF renderer and the
 * DOCX writer. Keeping them here means one change applies everywhere and the
 * outputs can never drift apart.
 */

/**
 * The official institution name.
 * Used in: Question Paper PDF, IAT PDF, End Semester PDF, DOCX export and the
 * Question Bank export header.
 */
export const COLLEGE_NAME = 'MOHAMED SATHAK AJ COLLEGE OF ENGINEERING AND ARCHITECTURE';

/** Title-case variant for places that already set their own casing. */
export const COLLEGE_NAME_TITLE = 'Mohamed Sathak AJ College of Engineering and Architecture';

/** Official affiliation line shown under the college name. */
export const COLLEGE_SUBTITLE =
  'Affiliated to Anna University | Approved by AICTE | NBA Accredited';

/** Location line used by the End Semester header. */
export const COLLEGE_LOCATION = 'Chennai - 603103';

/**
 * The question typeface and size.
 *
 * `pt` is used by the printable/PDF/DOCX renderers and `px` by the on-screen
 * tables, so a question reads identically in every output.
 */
export const QUESTION_FONT_FAMILY = '"Times New Roman", Times, Georgia, serif';
export const QUESTION_FONT_SIZE_PT = 12;
export const QUESTION_FONT_SIZE_PX = 12;

/**
 * PI display convention.
 *
 * A PI value is NEVER invented. When the stored value is missing the existing
 * convention is a dash, so the column is never blank and never guessed.
 */
export const EMPTY_METADATA = '-';

/** Returns the stored PI, or the empty marker when the record has none. */
export function formatPi(pi: string | null | undefined): string {
  const value = String(pi ?? '').trim();
  return value ? value : EMPTY_METADATA;
}

/** Returns the stored CO, or the empty marker when the record has none. */
export function formatCo(co: string | null | undefined): string {
  const value = String(co ?? '').trim();
  return value ? value : EMPTY_METADATA;
}

/** Returns the stored BTL/BL level, or the empty marker when the record has none. */
export function formatBtl(btl: string | null | undefined): string {
  const value = String(btl ?? '').trim();
  return value ? value : EMPTY_METADATA;
}

/**
 * The metadata column order every generated paper must use:
 *   Q.NO | QUESTION | MARKS | BL/BTL | CO | PI
 * PI is always the final metadata column.
 */
export const METADATA_COLUMNS = ['Q.No', 'Question', 'Marks', 'BL', 'CO', 'PI'] as const;

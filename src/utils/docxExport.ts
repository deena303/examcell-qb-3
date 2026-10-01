/**
 * Real Microsoft Word (.docx) generation.
 *
 * The previous implementation wrote an HTML file with a `.docx` extension and
 * a WordprocessingML MIME type. Word would open it, but it was not a valid
 * OOXML package: it could not be opened by strict viewers, mobile Word, Google
 * Docs import, or any ZIP/OOXML validator.
 *
 * This module builds a genuine WordprocessingML package with the `docx`
 * library, so the output is a real ZIP containing `[Content_Types].xml`,
 * `word/document.xml`, styles, and relationships.
 *
 * Typography contract (shared with the on-screen and PDF renderers):
 *   - Question text : Times New Roman, 12pt, FULLY JUSTIFIED
 *   - Metadata      : Times New Roman, 10pt, centred, never justified
 *   - Column order  : Q.No | Question | Marks | BL/BTL | CO | PI (PI last)
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

import type { GeneratedPaper, IatGeneratedBankDetail, PaperQuestionItem, SelectedIatQuestion } from '../types';
import {
  COLLEGE_NAME,
  QUESTION_FONT_FAMILY,
  QUESTION_FONT_SIZE_PT,
  formatBtl,
  formatCo,
  formatPi,
} from './paperConstants';

/** docx wants the family name without the CSS fallback list. */
const WORD_FONT = 'Times New Roman';
/** The `QUESTION_FONT_FAMILY` constant keeps the HTML/PDF renderers in sync. */
if (!QUESTION_FONT_FAMILY.includes(WORD_FONT)) {
  throw new Error('paperConstants QUESTION_FONT_FAMILY must be Times New Roman');
}

const META_FONT_SIZE_PT = 10;
const HEADER_FONT_SIZE_PT = 9;

const THIN_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: '000000',
} as const;

const CELL_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
};

const TABLE_WIDTH = { size: 100, type: WidthType.PERCENTAGE } as const;

/** Column widths, in percent, for Q.No | Question | Marks | BL | CO | PI. */
const PAPER_COL_WIDTHS = [6, 62, 8, 8, 8, 8];
/** Same contract for the IAT bank export. */
const BANK_COL_WIDTHS = [6, 62, 8, 8, 8, 8];

function esc(text: string): string {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Question text cell: Times New Roman 12pt, justified.
 * This is the ONLY justified content in the document.
 */
function questionCell(text: string): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    width: { size: PAPER_COL_WIDTHS[1], type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [
      new Paragraph({
        // Justified question text - the single justified element in the paper.
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 0, before: 0 },
        children: [
          new TextRun({
            text: String(text ?? ''),
            font: WORD_FONT,
            size: QUESTION_FONT_SIZE_PT * 2,
          }),
        ],
      }),
    ],
  });
}

/**
 * Metadata cell (Q.No / Marks / BL / CO / PI): centred, never justified.
 * `value` is written exactly as produced by the format helpers in
 * paperConstants, so an absent PI renders as "-" rather than an invented code.
 */
function metaCell(value: string, widthPct: number, bold = false): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, before: 0 },
        children: [
          new TextRun({
            text: String(value ?? ''),
            font: WORD_FONT,
            size: META_FONT_SIZE_PT * 2,
            bold,
          }),
        ],
      }),
    ],
  });
}

function headerCell(label: string, widthPct: number): TableCell {
  return new TableCell({
    borders: CELL_BORDERS,
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { fill: 'F1F1F1' },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, before: 0 },
        children: [
          new TextRun({
            text: label,
            font: WORD_FONT,
            size: META_FONT_SIZE_PT * 2,
            bold: true,
          }),
        ],
      }),
    ],
  });
}

function headerRow(labels: string[], widths: number[]): TableRow {
  return new TableRow({
    tableHeader: true,
    children: labels.map((label, i) => headerCell(label, widths[i])),
  });
}

/** "(OR)" separator row spanning the whole table. */
function orRow(columnCount: number): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: columnCount,
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 0, before: 0 },
            children: [
              new TextRun({ text: '(OR)', font: WORD_FONT, size: META_FONT_SIZE_PT * 2, bold: true }),
            ],
          }),
        ],
      }),
    ],
  });
}

function heading(text: string, sizePt = 11): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 80 },
    children: [
      new TextRun({ text, font: WORD_FONT, size: sizePt * 2, bold: true }),
    ],
  });
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [
      new TextRun({ text, font: WORD_FONT, size: HEADER_FONT_SIZE_PT * 2, italics: true }),
    ],
  });
}

/**
 * One paper question row. Metadata is read from that question's OWN record -
 * never from a neighbour, never invented.
 */
function paperRow(item: PaperQuestionItem, qnoLabel: string, marks: string): TableRow {
  const q = item.question;
  return new TableRow({
    children: [
      metaCell(qnoLabel, PAPER_COL_WIDTHS[0], true),
      questionCell(q.questionText),
      metaCell(marks, PAPER_COL_WIDTHS[2], true),
      metaCell(formatBtl(q.bloomsLevel), PAPER_COL_WIDTHS[3]),
      metaCell(formatCo(q.co), PAPER_COL_WIDTHS[4]),
      metaCell(formatPi(q.pi), PAPER_COL_WIDTHS[5]),
    ],
  });
}

/** Header block shared by both exports. */
function collegeHeaderBlock(subtitle?: string): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 0, before: 0 },
      children: [
        new TextRun({ text: COLLEGE_NAME, font: WORD_FONT, size: 13 * 2, bold: true }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 0, before: 0 },
      children: [
        new TextRun({ text: '(AUTONOMOUS)', font: WORD_FONT, size: 10 * 2 }),
      ],
    }),
    ...(subtitle
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120, before: 0 },
            children: [
              new TextRun({ text: subtitle, font: WORD_FONT, size: 12 * 2, bold: true }),
            ],
          }),
        ]
      : [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120, before: 0 },
            children: [new TextRun({ text: '', font: WORD_FONT, size: 12 * 2 })],
          }),
        ]),
  ];
}

function metaLine(label: string, value: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0, before: 0 },
    children: [
      new TextRun({ text: `${label}: `, font: WORD_FONT, size: 11 * 2, bold: true }),
      new TextRun({ text: value, font: WORD_FONT, size: 11 * 2 }),
    ],
  });
}

/**
 * Builds a genuine .docx for a generated question paper.
 * Returns a Blob so the caller can trigger a download.
 */
export async function buildPaperDocx(paper: GeneratedPaper): Promise<Blob> {
  const isEndSem = paper.examType === 'End Semester Examination';
  const iatTestNum = paper.examType === 'Internal Assessment II' ? 'II' : 'I';

  const partA = paper.partAQuestions ?? [];
  const partB = paper.partBQuestions ?? [];
  const partC = paper.partCQuestions ?? [];

  const body: (Paragraph | Table)[] = [
    ...collegeHeaderBlock(
      isEndSem
        ? `${esc(paper.examType).toUpperCase()}`
        : `INTERNAL ASSESSMENT ${iatTestNum}`
    ),
  ];

  if (isEndSem) {
    body.push(
      metaLine('Register Number', '________________________'),
      metaLine('Degree / Branch', paper.departmentName || paper.department),
      metaLine('Subject', `${paper.subjectCode} - ${paper.subjectName}`),
      metaLine('Semester', paper.semester),
      metaLine('Regulation', paper.regulation),
      metaLine('Academic Year', paper.academicYear),
      metaLine('Date', paper.examDate),
      metaLine('Session', paper.examMonth || ''),
      metaLine('Time', paper.duration),
      metaLine('Maximum Marks', String(paper.maxMarks))
    );
  } else {
    body.push(
      metaLine('Subject', `${paper.subjectCode} - ${paper.subjectName}`),
      metaLine('Semester', paper.semester),
      metaLine('Department', paper.departmentName || paper.department),
      ...(paper.commonToLabel || (paper.commonDepartments ?? []).length
        ? [metaLine('Common To', paper.commonToLabel || (paper.commonDepartments ?? []).join(', '))]
        : []),
      metaLine('Date', paper.examDate),
      metaLine('Time', paper.duration),
      metaLine('Maximum Marks', String(paper.maxMarks)),
      metaLine('Set', paper.setLetter || 'A')
    );
  }

  // ---------------- PART A ----------------
  body.push(heading('PART A'));
  body.push(
    new Table({
      width: TABLE_WIDTH,
      borders: CELL_BORDERS,
      rows: [
        headerRow(['Q.No', 'Question', isEndSem ? 'M' : 'Marks', isEndSem ? 'RBT' : 'BL', 'CO', 'PI'], PAPER_COL_WIDTHS),
        ...partA.map((item) => paperRow(item, `${item.questionNumber}.`, '2')),
      ],
    })
  );

  // ---------------- PART B ----------------
  body.push(heading('PART B'));
  const partBRows: TableRow[] = [headerRow(['Q.No', 'Question', 'M', 'BL', 'CO', 'PI'], PAPER_COL_WIDTHS)];
  for (const item of partB) {
    if (item.isOrOptionB) partBRows.push(orRow(PAPER_COL_WIDTHS.length));
    partBRows.push(paperRow(item, `${item.questionNumber})`, '13'));
  }
  body.push(
    new Table({
      width: TABLE_WIDTH,
      borders: CELL_BORDERS,
      rows: partBRows,
    })
  );

  // ---------------- PART C ----------------
  if (partC.length > 0) {
    body.push(heading('PART C'));
    const partCRows: TableRow[] = [headerRow(['Q.No', 'Question', 'M', 'RBT', 'CO', 'PI'], PAPER_COL_WIDTHS)];
    for (const item of partC) {
      if (item.isOrOptionB) partCRows.push(orRow(PAPER_COL_WIDTHS.length));
      partCRows.push(paperRow(item, `${item.questionNumber})`, '15'));
    }
    body.push(
      new Table({
        width: TABLE_WIDTH,
        borders: CELL_BORDERS,
        rows: partCRows,
      })
    );
  }

  const doc = new Document({
    creator: paper.createdBy || 'Exam Cell',
    title: `${paper.subjectCode} - ${paper.paperCode}`,
    description: `${paper.subjectCode} ${paper.examType}`,
    styles: {
      default: {
        document: {
          run: { font: WORD_FONT, size: QUESTION_FONT_SIZE_PT * 2 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 850,
              right: 850,
            },
          },
        },
        headers: {
          default: new Header({ children: [] }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Page ', font: WORD_FONT, size: 9 * 2 }),
                  new TextRun({ children: [PageNumber.CURRENT], font: WORD_FONT, size: 9 * 2 }),
                  new TextRun({ text: ' of ', font: WORD_FONT, size: 9 * 2 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: WORD_FONT, size: 9 * 2 }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  return Packer.toBlob(doc);
}

/** One IAT bank question row, metadata from that question's own record. */
function bankRow(q: SelectedIatQuestion, index: number): TableRow {
  return new TableRow({
    children: [
      metaCell(`${index + 1}.`, BANK_COL_WIDTHS[0], true),
      questionCell(q.questionText),
      metaCell(q.marks == null ? '-' : String(q.marks), BANK_COL_WIDTHS[2], true),
      metaCell(formatBtl(q.btl || q.bloomsLevel), BANK_COL_WIDTHS[3]),
      metaCell(formatCo(q.co), BANK_COL_WIDTHS[4]),
      metaCell(formatPi(q.pi), BANK_COL_WIDTHS[5]),
    ],
  });
}

function groupByUnit(questions: SelectedIatQuestion[]): Map<number, SelectedIatQuestion[]> {
  const map = new Map<number, SelectedIatQuestion[]>();
  for (const q of questions) {
    const unit = Number(q.unit ?? 0);
    if (!map.has(unit)) map.set(unit, []);
    map.get(unit)!.push(q);
  }
  return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
}

const UNIT_ROMAN: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

function bankTable(questions: SelectedIatQuestion[]): Table {
  return new Table({
    width: TABLE_WIDTH,
    borders: CELL_BORDERS,
    rows: [
      headerRow(['#', 'Question', 'Marks', 'BTL', 'CO', 'PI'], BANK_COL_WIDTHS),
      ...questions.map((q, i) => bankRow(q, i)),
    ],
  });
}

/**
 * Builds a genuine .docx for a generated IAT question bank, grouped by unit
 * and then by the question's ORIGINAL part (never reclassified).
 */
export async function buildIatBankDocx(
  bank: IatGeneratedBankDetail,
  meta: { subjectCode: string; subjectName: string }
): Promise<Blob> {
  const byUnit = groupByUnit(bank.questions);

  const body: (Paragraph | Table)[] = [
    ...collegeHeaderBlock('QUESTION BANK'),
    metaLine('Subject', `${meta.subjectCode} - ${meta.subjectName}`),
    metaLine('Bank', bank.name),
    metaLine('Academic Year', bank.academicYear || ''),
    metaLine('Department', bank.department || ''),
    metaLine('Total Questions', String(bank.questions.length))
  ];

  for (const [unit, questions] of byUnit.entries()) {
    if (unit < 1 || unit > 5) continue;
    body.push(heading(`UNIT - ${UNIT_ROMAN[unit] ?? String(unit)}`, 12));

    const partA = questions.filter((q) => q.originalPart === 'Part A');
    const partB = questions.filter((q) => q.originalPart === 'Part B');
    const partC = questions.filter((q) => q.originalPart === 'Part C');

    if (partA.length) {
      body.push(subHeading('Short Answer Questions'), bankTable(partA));
    }
    if (partB.length) {
      body.push(subHeading('Long Answer Questions'), bankTable(partB));
    }
    if (partC.length) {
      body.push(subHeading('Application / Case Study Questions'), bankTable(partC));
    }
  }

  const doc = new Document({
    creator: 'Exam Cell',
    title: `${meta.subjectCode} - ${bank.name}`,
    description: `Question Bank - ${meta.subjectCode}`,
    styles: {
      default: {
        document: {
          run: { font: WORD_FONT, size: QUESTION_FONT_SIZE_PT * 2 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 850, right: 850 } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Page ', font: WORD_FONT, size: 9 * 2 }),
                  new TextRun({ children: [PageNumber.CURRENT], font: WORD_FONT, size: 9 * 2 }),
                  new TextRun({ text: ' of ', font: WORD_FONT, size: 9 * 2 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: WORD_FONT, size: 9 * 2 }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  return Packer.toBlob(doc);
}

/** Triggers a browser download for a generated Blob. */
export function downloadBlob(blob: Blob, filename: string, mimeType: string): void {
  const typed = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  const url = URL.createObjectURL(typed);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
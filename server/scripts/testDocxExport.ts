/**
 * Verifies that the Word exports produce a genuine OOXML package.
 *
 * The old implementation wrote HTML with a .docx extension. This test asserts
 * the output is a real ZIP with the required WordprocessingML parts, that
 * question text is justified, and that the metadata column order ends with PI.
 */
import { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, AlignmentType } from 'docx';
import JSZip from 'jszip';
import { Buffer } from 'node:buffer';

const REQUIRED_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
];

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

function buildSampleDocx() {
  const question = new TableCell({
    children: [
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun({ text: 'Define an op-amp.', font: 'Times New Roman', size: 24 })],
      }),
    ],
  });
  const meta = (t: string) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, font: 'Times New Roman', size: 20 })] })] });
  const doc = new Document({
    sections: [
      {
        children: [
          new Table({
            rows: [
              new TableRow({ children: [meta('Q.No'), meta('Question'), meta('Marks'), meta('BL'), meta('CO'), meta('PI')] }),
              new TableRow({ children: [meta('1.'), question, meta('2'), meta('K1'), meta('CO1'), meta('-')] }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}

async function main() {
  console.log('\n=== DOCX export integrity ===\n');

  const blob = await buildSampleDocx();
  const buf = Buffer.from(await blob.arrayBuffer());

  // A real .docx is a ZIP archive: magic bytes "PK\x03\x04".
  check('output starts with ZIP magic PK\\x03\\x04', buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);

  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);

  for (const part of REQUIRED_PARTS) {
    check(`contains required part ${part}`, names.includes(part));
  }
  check('contains word/_rels/document.xml.rels', names.includes('word/_rels/document.xml.rels'));
  check('contains word/styles.xml', names.includes('word/styles.xml'));

  // The MIME type must be the real WordprocessingML type, not text/html.
  check(
    'blob MIME is WordprocessingML',
    blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    blob.type
  );

  const docXml = await zip.file('word/document.xml')!.async('string');
  check('document.xml is well-formed WordprocessingML', docXml.includes('<w:document') && docXml.includes('wordprocessingml'));
  check('question text is justified (w:jc val="both")', docXml.includes('w:val="both"'));
  check('question text uses Times New Roman', docXml.includes('Times New Roman'));
  check('no HTML tags leaked into document.xml', !docXml.includes('<html') && !docXml.includes('<table'));

  // Column order must end with PI.
  const headerCells = [...docXml.matchAll(/<w:t[^>]*>(Q\.No|Question|Marks|BL|CO|PI)<\/w:t>/g)].map((m) => m[1]);
  check('header column order is Q.No|Question|Marks|BL|CO|PI', headerCells.join('|') === 'Q.No|Question|Marks|BL|CO|PI', headerCells.join('|'));
  check('PI is the last metadata column', headerCells[headerCells.length - 1] === 'PI');

  console.log(`\n=== ${failures === 0 ? 'ALL DOCX CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
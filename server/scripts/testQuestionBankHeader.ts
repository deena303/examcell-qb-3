/**
 * Renders the generated-Question-Bank HTML (Changes 5 + 6) and asserts:
 *  - the title is "QUESTION BANK", never "IAT QUESTION BANK"
 *  - the header is COLLEGE / QUESTION BANK / [COMPLETE CODE] - [SUBJECT NAME]
 *  - no "Source" column/header remains
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Node has atob/btoa natively; expose them on the same globals jsPDF probes.
const g = globalThis as any;
if (typeof g.atob !== 'function') {
  g.atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
}
if (typeof g.btoa !== 'function') {
  g.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
}
if (!g.self) {
  g.self = g;
}
try {
  if (!g.navigator) Object.defineProperty(g, 'navigator', { value: { userAgent: 'node' }, configurable: true });
} catch {
  /* node already provides a read-only navigator — nothing to shim */
}
if (!g.document) {
  g.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, getContext: () => null }),
    body: { appendChild() {}, removeChild() {} },
    documentElement: { style: {} },
    addEventListener() {},
    removeEventListener() {}
  };
}

const { generateIatBankHtml } = await import('../../src/utils/exportUtils');

function buildBank(overrides: any) {
  return {
    id: 'b1',
    questionBankId: 'qb1',
    sourceQuestionBankId: 'src1',
    sourceBankName: 'should not appear',
    academicYear: '2024-2028',
    department: 'CIVIL',
    subjectCode: '24CE501',
    subjectName: 'DESIGN OF REINFORCED CONCRETE STRUCTURES',
    name: '24CE501 - DESIGN OF REINFORCED CONCRETE STRUCTURES - IAT Bank 01',
    requestedPartACount: 4, requestedPartBcCount: 4,
    actualPartACount: 4, actualPartBCount: 2, actualPartCCount: 2,
    totalQuestions: 8,
    status: 'Active',
    selectionMethod: 'deterministic',
    createdByName: 'Dr. Test',
    createdAt: new Date().toISOString(),
    updatedAt: null, archivedAt: null, archiveReason: null,
    unitDistribution: null,
    questions: [
      { sourceQuestionId: 'q1', sourceQuestionNumber: '1.', questionText: 'Question one', originalPart: 'Part A', unit: 1, marks: 2, btl: 'K1', bloomsLevel: 'K1', co: 'CO1', pi: '1.1', difficulty: 'Easy', orGroupId: null, orOption: null, sourcePage: 1, subjectCode: '24CE501', orderIndex: 0, timesUsed: 0 },
      { sourceQuestionId: 'q2', sourceQuestionNumber: '2.', questionText: 'Question two', originalPart: 'Part B', unit: 1, marks: 13, btl: 'K2', bloomsLevel: 'K2', co: 'CO1', pi: '1.2', difficulty: 'Easy', orGroupId: null, orOption: null, sourcePage: 1, subjectCode: '24CE501', orderIndex: 1, timesUsed: 0 }
    ],
    ...overrides
  } as any;
}

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const cases: Array<[string, any]> = [
  ['24CE501 DESIGN OF REINFORCED CONCRETE STRUCTURES', buildBank({})],
  ['24CS303 JAVA PROGRAMMING', buildBank({ subjectCode: '24CS303', subjectName: 'JAVA PROGRAMMING', department: 'AIML' })],
  ['24CS512 CLOUD COMPUTING', buildBank({ subjectCode: '24CS512', subjectName: 'CLOUD COMPUTING', department: 'CSE' })],
  ['24IT501 MOBILE COMPUTING', buildBank({ subjectCode: '24IT501', subjectName: 'MOBILE COMPUTING', department: 'IT' })],
  ['24IT611 FULL STACK DEVELOPMENT', buildBank({ subjectCode: '24IT611', subjectName: 'FULL STACK DEVELOPMENT', department: 'CSBS' })],
  ['24CY50 CLOUD ARCHITECTURE AND DESIGN', buildBank({ subjectCode: '24CY50', subjectName: 'CLOUD ARCHITECTURE AND DESIGN', department: 'CSCS' })],
  ['24ME501 DESIGN OF MACHINE ELEMENTS', buildBank({ subjectCode: '24ME501', subjectName: 'DESIGN OF MACHINE ELEMENTS', department: 'MECH' })],
  ['24EC314 ANALOG ELECTRONIC CIRCUITS', buildBank({ subjectCode: '24EC314', subjectName: 'ANALOG ELECTRONIC CIRCUITS', department: 'ECE' })]
];

console.log('=== header / title / SOURCE column per subject code ===');
for (const [label, bank] of cases) {
  const html = generateIatBankHtml(bank);
  const header = /college-name">([^<]+)<[\s\S]*?doc-title">([^<]+)<[\s\S]*?bank-subject">([^<]+)</.exec(html);
  console.log(`\n--- ${label} ---`);
  console.log('  college :', header?.[1]);
  console.log('  title   :', header?.[2]);
  console.log('  subject :', header?.[3]);
  check('college header correct', header?.[1] === 'Mohamed Sathak AJ College of Engineering and Architecture');
  check('title is QUESTION BANK', header?.[2] === 'QUESTION BANK');
  check('subject line = [COMPLETE CODE] - [NAME]', header?.[3] === `${bank.subjectCode} - ${bank.subjectName}`);
  check('no "IAT QUESTION BANK" anywhere', !/IAT QUESTION BANK/i.test(html));
  check('no IAT Question Bank heading', !/IAT Question Bank/i.test(html));
  check('no Source column header', !/>\s*Source\s*</.test(html));
  check('no source question numbers rendered', !html.includes('sourceQuestionNumber') && !/Q\s*<\/td>/.test(html));
  check('bank name is not used as the subject line', !header?.[3]?.includes('IAT Bank'));
}

console.log('\n=== fallback behaviour ===');
const noCode = buildBank({ subjectCode: '', subjectName: null, name: '24CY50 - CLOUD ARCHITECTURE AND DESIGN - Bank 03' });
const h2 = generateIatBankHtml(noCode);
const sub2 = /bank-subject">([^<]+)</.exec(h2);
console.log('  subject :', sub2?.[1]);
check('complete code recovered from the name when the record is empty', (sub2?.[1] || '').startsWith('24CY50 -'));

const dbWins = buildBank({ subjectCode: '24CS303', subjectName: null, name: '24CY50 - CLOUD ARCHITECTURE AND DESIGN - Bank 03' });
const sub3 = /bank-subject">([^<]+)</.exec(generateIatBankHtml(dbWins));
console.log('  subject :', sub3?.[1]);
check('the database subject code always wins over the name', (sub3?.[1] || '').startsWith('24CS303'));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

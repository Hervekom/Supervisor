// Phase P2: Word Check runs entirely in the student's browser.
// The .docx is read here, its text, structure and formatting are extracted here, and the same university rules
// (`checkDocument`, the same code the server used before) are applied here, to the complete document. Nothing about
// the file is sent to the server: only the public university profile is downloaded. So there is no upload size limit,
// whole-document rules (length, order of parts, keywords, references…) see the whole thesis, and images inside the
// file are never read: the Word file is a ZIP, and only its text parts are opened.
import type { Doc } from './docx';
import type { Options, Report } from './check';
import { MESSAGES } from './messages';
import type { Profile } from './types';

/** Above this, a browser may run out of memory reading the file. Real theses are far below it. */
export const MAX_BROWSER_DOCX_BYTES = 250_000_000;
export const MAX_BROWSER_DOCX_LABEL = '250 MB';

export type Stage = 'reading' | 'extracting' | 'checking';
export type StageState = 'pending' | 'active' | 'done' | 'failed';
export type Stages = Record<Stage, StageState>;

export type Extraction = {
  fileBytes: number;
  paragraphs: number;
  tables: number;
  words: number;
  characters: number;
  figures: number;
  chapters: { title: string; words: number; paragraphs: number }[];
};

/** A problem the student can act on. The message is shown as it is. */
export class CheckProblem extends Error {
  constructor(message: string, public stage: Stage) {
    super(message);
  }
}

export const EMPTY_DOCX = 'This Word file has no text Supervisor can read. Check that it is your thesis and not an empty or scanned document.';
export const TOO_LARGE_FOR_BROWSER = `This file is larger than ${MAX_BROWSER_DOCX_LABEL}, too large for a browser to read safely. In Word, use Compress Pictures and save again.`;

/** Words in any script: Latin words, numbers, and each Chinese, Japanese or Korean character. */
export const countWords = (t: string) => (t.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []).length;

/** Lets the page show progress between steps. */
const yieldToPage = () => new Promise<void>((r) => setTimeout(r, 0));

export function extractionOf(doc: Doc, fileBytes: number, chapterRanges: { title: string; start: number; end: number }[]): Extraction {
  const texts = doc.paragraphs.map((p) => p.text);
  return {
    fileBytes,
    paragraphs: doc.paragraphs.filter((p) => p.text.trim()).length,
    tables: doc.tables.length,
    words: texts.reduce((n, t) => n + countWords(t), 0),
    characters: texts.reduce((n, t) => n + t.length, 0),
    figures: doc.paragraphs.filter((p) => p.hasImage).length,
    chapters: chapterRanges.map((c) => {
      const part = doc.paragraphs.slice(c.start, c.end);
      return { title: c.title, words: part.reduce((n, p) => n + countWords(p.text), 0), paragraphs: part.filter((p) => p.text.trim()).length };
    }),
  };
}

/**
 * Reads the file, extracts the document and applies the profile's rules, reporting each stage.
 * The file itself is only read, never changed. Throws `CheckProblem` with a message for the student.
 */
export async function checkInBrowser(
  file: Blob,
  profile: Profile,
  opts: Options,
  onStage: (s: Stages, extraction?: Extraction) => void = () => {},
): Promise<{ report: Report; extraction: Extraction }> {
  const stages: Stages = { reading: 'active', extracting: 'pending', checking: 'pending' };
  const set = (s: Stage, v: StageState, x?: Extraction) => {
    stages[s] = v;
    onStage({ ...stages }, x);
  };
  onStage({ ...stages });
  await yieldToPage();

  // 1. Read the bytes. A .docx is a ZIP file, which starts with "PK".
  if (file.size > MAX_BROWSER_DOCX_BYTES) {
    set('reading', 'failed');
    throw new CheckProblem(TOO_LARGE_FOR_BROWSER, 'reading');
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    set('reading', 'failed');
    throw new CheckProblem(MESSAGES.documentUnreadable, 'reading');
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    set('reading', 'failed');
    // Not a ZIP, so not a .docx (for example an old .doc file): the same plain message as before.
    throw new CheckProblem(MESSAGES.documentUnreadable, 'reading');
  }
  set('reading', 'done');
  set('extracting', 'active');
  await yieldToPage();

  // 2. Extract text, structure and formatting. Images inside the file are not opened.
  const [{ parseDocx }, { checkDocument, layoutOf }] = await Promise.all([import('./docx'), import('./check')]);
  let doc: Doc;
  try {
    doc = await parseDocx(bytes);
  } catch {
    set('extracting', 'failed');
    throw new CheckProblem(MESSAGES.documentUnreadable, 'extracting');
  }
  if (!doc.paragraphs.some((p) => p.text.trim())) {
    set('extracting', 'failed');
    throw new CheckProblem(EMPTY_DOCX, 'extracting');
  }
  const layout = layoutOf(doc);
  const extraction = extractionOf(
    doc,
    bytes.length,
    layout.chapters.map((c) => ({ title: c.title, start: c.start, end: c.end })),
  );
  set('extracting', 'done', extraction);
  set('checking', 'active', extraction);
  await yieldToPage();

  // 3. The same rules as before, on the complete document.
  try {
    const report = checkDocument(doc, profile, opts);
    set('checking', 'done', extraction);
    return { report, extraction };
  } catch {
    set('checking', 'failed', extraction);
    throw new CheckProblem('The rules could not be applied to this document. Nothing was sent anywhere. Try again, and if it happens again, save the file again in Word.', 'checking');
  }
}

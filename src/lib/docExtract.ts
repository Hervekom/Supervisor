// Phase P7: reads a PDF or Word file in the browser (the same code runs in tests). The file is never uploaded.
// The result keeps page numbers (PDF) or paragraph numbers (Word), and the size of each line, to find headings.

export type Line = { text: string; size: number; page?: number; para?: number; heading?: number };
export type Extracted = { kind: 'pdf' | 'docx'; pages: number; lines: Line[]; info: { title?: string; author?: string; year?: string } };

export class DocProblem extends Error {
  constructor(readonly code: 'password' | 'unreadable' | 'too_large' | 'unsupported', message: string) {
    super(message);
  }
}

export const MAX_DOC_BYTES = 100_000_000;
export const DOC_MESSAGES = {
  password: 'This PDF is protected by a password. Save a copy without the password, then import it again.',
  unreadable: 'This file could not be read. Check that it opens on your computer, save it again as PDF or DOCX, and import it again.',
  too_large: 'This file is larger than 100 MB. Save a copy without large images, or split it, then import it again.',
  unsupported: 'Only PDF and Word (.docx) files can be imported. An old .doc file must be saved again as .docx.',
} as const;

/** Where pdf.js finds its character maps (needed for Chinese, Japanese and Korean PDFs). Served from /public. */
export const CMAP_URL = '/pdfjs/cmaps/';

export async function extractFile(name: string, bytes: Uint8Array, cMapUrl = CMAP_URL): Promise<Extracted> {
  if (bytes.length > MAX_DOC_BYTES) throw new DocProblem('too_large', DOC_MESSAGES.too_large);
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head.startsWith('%PDF')) return extractPdf(bytes, cMapUrl);
  if (head.startsWith('PK')) return extractDocx(bytes);
  if (/\.(pdf|docx)$/i.test(name)) throw new DocProblem('unreadable', DOC_MESSAGES.unreadable);
  throw new DocProblem('unsupported', DOC_MESSAGES.unsupported);
}

type PdfItem = { str: string; transform: number[]; height: number; hasEOL?: boolean };

async function loadPdfjs() {
  // Loading the worker module first makes pdf.js run it in this page, so it never looks for a worker file.
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

export async function extractPdf(bytes: Uint8Array, cMapUrl = CMAP_URL): Promise<Extracted> {
  let pdfjs: Awaited<ReturnType<typeof loadPdfjs>>;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    throw new DocProblem('unreadable', 'PDF reading could not start in this browser. Reload the page and try again.');
  }
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    // pdf.js may take over the buffer, so it gets a copy.
    doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, disableFontFace: true, cMapUrl, cMapPacked: true }).promise;
  } catch (e) {
    if ((e as { name?: string })?.name === 'PasswordException') throw new DocProblem('password', DOC_MESSAGES.password);
    throw new DocProblem('unreadable', DOC_MESSAGES.unreadable);
  }
  const lines: Line[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const c = await (await doc.getPage(n)).getTextContent();
    // Items on the same baseline form a line; lines are read top to bottom.
    const rows: { y: number; x: number; size: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of c.items as PdfItem[]) {
      if (!('str' in it) || !it.str) continue;
      const y = it.transform[5];
      const x = it.transform[4];
      const size = Math.abs(it.height || it.transform[3] || 0);
      const row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * 0.4));
      if (row) {
        row.parts.push({ x, s: it.str });
        row.size = Math.max(row.size, size);
      } else rows.push({ y, x, size, parts: [{ x, s: it.str }] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      const text = r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join('').replace(/\s+/g, ' ').trim();
      if (text) lines.push({ text, size: Math.round(r.size * 10) / 10, page: n });
    }
  }
  let info: Extracted['info'] = {};
  try {
    // Only the title and author the file declares. The file's creation date is not the publication year, so it is not used.
    const meta = (await doc.getMetadata()).info as { Title?: string; Author?: string };
    const title = meta.Title?.trim();
    const author = meta.Author?.trim();
    info = {
      title: title && !/^(untitled|microsoft word.*|document\d*|.*\.(docx?|pdf|tex)|scanned)$/i.test(title) ? title : undefined,
      author: author && !/^(anonymous|unknown|user|admin(istrator)?|author|owner)$/i.test(author) ? author : undefined,
    };
  } catch {}
  return { kind: 'pdf', pages: doc.numPages, lines, info };
}

export async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const { parseDocx } = await import('./docx');
  let d: Awaited<ReturnType<typeof parseDocx>>;
  try {
    d = await parseDocx(bytes);
  } catch {
    throw new DocProblem('unreadable', DOC_MESSAGES.unreadable);
  }
  const lines: Line[] = d.paragraphs
    .filter((p) => p.text.trim())
    .map((p) => ({ text: p.text.replace(/\s+/g, ' ').trim(), size: p.sizePt ?? 12, para: p.index + 1, ...(p.level ? { heading: p.level } : {}) }));
  return { kind: 'docx', pages: 0, lines, info: {} };
}

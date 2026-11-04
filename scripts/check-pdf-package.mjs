// Run after `next build`. Copies only the files a route ships with, then reads a PDF from that copy.
// This is how the production failure appears: the code works locally because node_modules is complete.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROUTES = ['extract', 'profiles/import'];
const root = process.cwd();
const fail = (m) => {
  console.error(`PDF package check failed: ${m}`);
  process.exit(1);
};

function shippedFiles(route) {
  const dir = path.join(root, '.next/server/app/api', route);
  const trace = path.join(dir, 'route.js.nft.json');
  if (!fs.existsSync(trace)) fail(`no trace for ${route}. Run the build first.`);
  return JSON.parse(fs.readFileSync(trace, 'utf8')).files.map((f) => path.resolve(dir, f));
}

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 40 700 Td (Fictional page) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);

const READER = `
await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const fs = await import('node:fs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync('sample.pdf')), useSystemFonts: true, disableFontFace: true }).promise;
const page = await doc.getPage(1);
const c = await page.getTextContent();
console.log(c.items.map((x) => x.str).join(' '));
`;

for (const route of ROUTES) {
  const files = shippedFiles(route);
  if (!files.some((f) => f.endsWith('legacy/build/pdf.worker.mjs'))) fail(`${route} does not ship the PDF worker.`);
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-package-'));
  for (const f of files) {
    if (!f.includes(`${path.sep}node_modules${path.sep}`) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    const to = path.join(box, path.relative(root, f));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
  }
  fs.writeFileSync(path.join(box, 'sample.pdf'), PDF);
  fs.writeFileSync(path.join(box, 'read.mjs'), READER);
  const out = execFileSync(process.execPath, ['read.mjs'], { cwd: box, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!out.includes('Fictional page')) fail(`${route} could not read the sample PDF.`);
  fs.rmSync(box, { recursive: true, force: true });
  console.log(`${route}: PDF read from the shipped files only`);
}

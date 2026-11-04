// Checks a deployed Vercel preview with fictional files. Usage: npm run smoke:preview -- <preview-url>
// If the preview has Deployment Protection, set VERCEL_BYPASS to its bypass secret.
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https:\/\//.test(base)) {
  console.error('Usage: npm run smoke:preview -- https://your-preview.vercel.app');
  process.exit(1);
}
const headers = process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {};

const PDF =
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 117 >>\nstream\nBT /F1 12 Tf 40 700 Td (A fictional page of rules with enough readable text to pass the shortest length check.) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';

async function upload(name, body) {
  const form = new FormData();
  form.set('file', new File([body], name));
  const res = await fetch(`${base}/api/extract`, { method: 'POST', body: form, headers });
  return { status: res.status, body: await res.text() };
}

const checks = [
  ['PDF is read', async () => {
    const r = await upload('sample.pdf', PDF);
    return r.status === 200 && r.body.includes('fictional page') && r.body.includes('totalChars');
  }],
  ['Damaged PDF gets a plain message', async () => {
    const r = await upload('bad.pdf', 'not a pdf '.repeat(20));
    return r.status === 422 && r.body.includes("couldn't open this PDF") && !/var\/task|node_modules|worker/i.test(r.body);
  }],
  ['Damaged DOCX gets a plain message', async () => {
    const r = await upload('bad.docx', 'not a zip '.repeat(20));
    return r.status === 422 && r.body.includes("couldn't open this document") && !/jszip|central directory/i.test(r.body);
  }],
  ['Reset page loads', async () => (await fetch(`${base}/account/reset`, { headers })).status === 200],
];

let failed = 0;
for (const [name, run] of checks) {
  const ok = await run().catch(() => false);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);

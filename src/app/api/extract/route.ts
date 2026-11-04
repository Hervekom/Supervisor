import { NextResponse } from 'next/server';
import { fail, handle, openDocx, uploaded } from '@/lib/api';
import { EXTRACT_LIMIT } from '@/lib/limits';
import { pdfPages } from '@/lib/profiles';

export async function POST(req: Request) {
  try {
    const u = await uploaded(await req.formData());
    if ('error' in u) return fail(u.error as string, u.status);
    const name = u.file.name.toLowerCase();
    let text = '';
    if (name.endsWith('.docx')) text = (await openDocx(u.bytes)).paragraphs.map((p) => p.text).filter(Boolean).join('\n');
    else if (name.endsWith('.pdf')) text = (await pdfPages(u.bytes)).join('\n');
    else if (name.endsWith('.txt')) text = new TextDecoder().decode(u.bytes);
    else return fail('Upload a .docx, .pdf or .txt file.');
    if (text.trim().length < 50) return fail('No readable text was found. A scanned file needs OCR first, or paste the text instead.');
    return NextResponse.json({ text: text.slice(0, EXTRACT_LIMIT), totalChars: text.length, extractedChars: Math.min(text.length, EXTRACT_LIMIT), truncated: text.length > EXTRACT_LIMIT });
  } catch (e) {
    return handle(e);
  }
}

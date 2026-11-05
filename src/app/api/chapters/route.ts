import { NextResponse } from 'next/server';
import { fail, handle, openDocx, uploaded } from '@/lib/api';
import { chaptersOf, referencesOf } from '@/lib/check';

export async function POST(req: Request) {
  try {
    const u = await uploaded(await req.formData());
    if ('error' in u) return fail(u.error as string, u.status);
    if (!u.file.name.toLowerCase().endsWith('.docx')) return fail('Save the thesis as .docx, then upload it again.');
    const doc = await openDocx(u.bytes);
    return NextResponse.json({ chapters: chaptersOf(doc), references: referencesOf(doc) });
  } catch (e) {
    return handle(e);
  }
}

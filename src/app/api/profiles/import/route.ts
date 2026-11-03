import { NextResponse } from 'next/server';
import { fail, handle, uploaded } from '@/lib/api';
import { parseDocx } from '@/lib/docx';
import { getProfile, importGuide, pdfPages, saveProfile } from '@/lib/profiles';

export async function POST(req: Request) {
  try {
    const u = await uploaded(await req.formData());
    if ('error' in u) return fail(u.error as string);
    const name = u.file.name.toLowerCase();
    let pages: string[];
    if (name.endsWith('.pdf')) pages = await pdfPages(u.bytes);
    else if (name.endsWith('.docx')) pages = [(await parseDocx(u.bytes)).paragraphs.map((p) => p.text).join('\n')];
    else return fail('Upload the guide as a PDF or .docx file.');
    const result = await importGuide(pages, u.file.name);
    if (!result.kept) return fail('No rule could be matched to the text of this guide.', 422);
    if (await getProfile(result.profile.profile_id)) return fail('A profile for this university already exists. Delete the draft first.', 409);
    await saveProfile(result.profile);
    return NextResponse.json(result);
  } catch (e) {
    return handle(e);
  }
}

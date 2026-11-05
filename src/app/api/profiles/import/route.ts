import { NextResponse } from 'next/server';
import { checkUser } from '@/lib/auth';
import { resolveChoice } from '@/lib/aiChoice';
import { fail, handle, openDocx, uploaded } from '@/lib/api';
import { getProfile, importGuide, pdfPages, saveProfile } from '@/lib/profiles';

export async function POST(req: Request) {
  try {
    const auth = await checkUser(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const form = await req.formData();
    const raw = form.get('llm');
    const { config, error } = resolveChoice(typeof raw === 'string' ? JSON.parse(raw) : undefined);
    if (error) return fail(error);
    const u = await uploaded(form);
    if ('error' in u) return fail(u.error as string, u.status);
    const name = u.file.name.toLowerCase();
    let pages: string[];
    if (name.endsWith('.pdf')) pages = await pdfPages(u.bytes);
    else if (name.endsWith('.docx')) pages = [(await openDocx(u.bytes)).paragraphs.map((p) => p.text).join('\n')];
    else return fail('Upload the guide as a PDF or .docx file.');
    const result = await importGuide(pages, u.file.name, config);
    if (!result.kept) return fail('No rule could be matched to the text of this guide.', 422);
    if (await getProfile(result.profile.profile_id)) return fail('A profile for this university already exists. Delete the draft first.', 409);
    await saveProfile(result.profile);
    return NextResponse.json(result);
  } catch (e) {
    return handle(e);
  }
}

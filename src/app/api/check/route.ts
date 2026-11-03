import { NextResponse } from 'next/server';
import { fail, handle, uploaded } from '@/lib/api';
import { checkDocument } from '@/lib/check';
import { parseDocx } from '@/lib/docx';
import { getProfile } from '@/lib/profiles';
import type { DegreeType } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const u = await uploaded(form);
    if ('error' in u) return fail(u.error as string);
    if (!u.file.name.toLowerCase().endsWith('.docx')) return fail('Save the thesis as .docx, then upload it again.');
    const profile = await getProfile(String(form.get('profileId')));
    if (!profile) return fail('Choose a university profile.');
    const degree = String(form.get('degree')) as DegreeType;
    if (!profile.scope.degree_types.includes(degree)) return fail('This profile does not cover that degree.');
    const mode = form.get('mode') === 'blind' ? 'blind' : 'final';
    const names = String(form.get('names') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return NextResponse.json(checkDocument(await parseDocx(u.bytes), profile, { degree, mode, names }));
  } catch (e) {
    return handle(e);
  }
}

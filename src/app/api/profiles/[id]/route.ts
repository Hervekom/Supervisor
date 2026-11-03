import { NextResponse } from 'next/server';
import { fail, handle } from '@/lib/api';
import { getProfile, removeProfile, saveProfile } from '@/lib/profiles';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const p = await getProfile((await params).id);
    if (!p) return fail('This profile no longer exists.', 404);
    if (p.status === 'institution_verified') return fail('Verified profiles cannot change here.', 409);
    const b = (await req.json()) as { removeRules?: string[] };
    const remove = new Set(b.removeRules ?? []);
    p.rules = p.rules.filter((r) => !remove.has(r.id)).map((r) => ({ ...r, status: 'confirmed' as const }));
    p.status = 'student_confirmed';
    await saveProfile(p);
    return NextResponse.json(p);
  } catch (e) {
    return handle(e);
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    return (await removeProfile((await params).id)) ? NextResponse.json({ ok: true }) : fail('This profile no longer exists.', 404);
  } catch (e) {
    return handle(e);
  }
}

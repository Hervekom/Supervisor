import { NextResponse } from 'next/server';
import { fail, handle } from '@/lib/api';
import { verifyReferences } from '@/lib/references';

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { entries?: unknown };
    const entries = Array.isArray(b.entries) ? b.entries.filter((x): x is string => typeof x === 'string' && x.trim().length > 5) : [];
    if (!entries.length) return fail('Paste at least one reference.');
    return NextResponse.json({ results: await verifyReferences(entries) });
  } catch (e) {
    return handle(e);
  }
}

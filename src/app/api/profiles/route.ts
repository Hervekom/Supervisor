import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { listProfiles } from '@/lib/profiles';

export async function GET() {
  try {
    return NextResponse.json({ profiles: await listProfiles() });
  } catch (e) {
    return handle(e);
  }
}

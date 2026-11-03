import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PathState } from './path';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;
export function supabase() {
  if (!url || !key) return null;
  client ??= createClient(url, key);
  return client;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = (await supabase()?.auth.getSession()) ?? { data: { session: null } };
  return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
}

export async function loadCloudPath(userId: string): Promise<PathState | null> {
  const db = supabase();
  if (!db) return null;
  const { data, error } = await db.from('thesis_paths').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.data as PathState) ?? null;
}

export async function saveCloudPath(userId: string, path: PathState) {
  const db = supabase();
  if (!db) return;
  const { error } = await db.from('thesis_paths').upsert({ user_id: userId, data: path, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CloudApi } from './pathSync';
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

/** `updated_at` is the version: a save only lands on the version it was based on. */
export const cloudPaths: CloudApi = {
  async load(userId) {
    const db = supabase();
    if (!db) return null;
    const { data, error } = await db.from('thesis_paths').select('data, updated_at').eq('user_id', userId).maybeSingle();
    if (error) throw new Error('load failed');
    return data ? { data: data.data as PathState, version: data.updated_at as string } : null;
  },
  async save(userId, path, baseVersion) {
    const db = supabase();
    if (!db) throw new Error('not configured');
    const row = { data: path, updated_at: new Date().toISOString() };
    if (baseVersion === null) {
      const { data, error } = await db.from('thesis_paths').insert({ user_id: userId, ...row }).select('updated_at').single();
      if (error?.code === '23505') return { status: 'conflict' };
      if (error) throw new Error('save failed');
      return { status: 'saved', version: data.updated_at as string };
    }
    const { data, error } = await db.from('thesis_paths').update(row).eq('user_id', userId).eq('updated_at', baseVersion).select('updated_at');
    if (error) throw new Error('save failed');
    return data.length ? { status: 'saved', version: data[0].updated_at as string } : { status: 'conflict' };
  },
};

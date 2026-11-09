// Fictional Supabase: only what the app calls, with the same compare-and-save behavior.
// Two fictional accounts exist. The first one is the default for every older test.
import http from 'node:http';

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const makeUser = (id, email) => ({ id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
const USERS = {
  'student@example.test': makeUser('00000000-0000-4000-8000-000000000001', 'student@example.test'),
  'second@example.test': makeUser('00000000-0000-4000-8000-000000000002', 'second@example.test'),
};
const first = USERS['student@example.test'];
const byId = (id) => Object.values(USERS).find((x) => x.id === id) ?? first;
const token = (user) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated', email: user.email, session_id: 'x' })}.sig`;
/** The account named by a request's bearer token. */
const caller = (q) => {
  try {
    const t = (q.headers.authorization ?? '').replace(/^Bearer /, '').split('.')[1];
    return byId(JSON.parse(Buffer.from(t, 'base64url').toString()).sub);
  } catch {
    return first;
  }
};

let rows = {};
let writes = 0;
let down = false;
let recover = [];
let newPassword = null;

http
  .createServer((q, r) => {
    let d = '';
    q.on('data', (x) => (d += x));
    q.on('end', () => {
      r.setHeader('access-control-allow-origin', '*');
      r.setHeader('access-control-allow-headers', '*');
      r.setHeader('access-control-allow-methods', '*');
      r.setHeader('content-type', 'application/json');
      const u = new URL(q.url, 'http://x');
      const send = (o, s = 200) => { r.statusCode = s; r.end(JSON.stringify(o)); };
      if (q.method === 'OPTIONS') { r.statusCode = 204; return r.end(); }
      // `row` is the first account's row, as before. `rows` holds every account's row.
      if (u.pathname === '/__state') return send({ row: rows[first.id] ?? null, rows, writes, recover, newPassword });
      if (u.pathname === '/__reset') { rows = {}; writes = 0; down = false; recover = []; newPassword = null; return send({}); }
      if (u.pathname === '/__down') { down = u.searchParams.get('on') === '1'; return send({}); }
      if (u.pathname === '/__row') { rows[(USERS[u.searchParams.get('email')] ?? first).id] = JSON.parse(d); return send({}); }
      if (u.pathname === '/auth/v1/token') {
        let email = first.email;
        try { email = JSON.parse(d).email ?? email; } catch {}
        const user = USERS[email] ?? first;
        return send({ access_token: token(user), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
      }
      if (u.pathname === '/auth/v1/recover') { recover.push(JSON.parse(d).email); return send({}); }
      if (u.pathname === '/auth/v1/logout') { r.statusCode = 204; return r.end(); }
      if (u.pathname === '/auth/v1/user') {
        if (q.method === 'PUT') { newPassword = JSON.parse(d).password; return send(caller(q)); }
        return send(caller(q));
      }
      if (u.pathname === '/rest/v1/thesis_paths') {
        if (down) { r.destroy(); return; }
        // Owner-only access, as with row level security: each request sees only its own account's row.
        const id = caller(q).id;
        const row = rows[id] ?? null;
        if (q.method === 'GET') return send(row ? [{ data: row.data, updated_at: row.updated_at }] : []);
        const j = JSON.parse(d);
        const body = Array.isArray(j) ? j[0] : j;
        if (q.method === 'POST') {
          if (row) return send({ code: '23505', message: 'duplicate key' }, 409);
          writes++;
          rows[id] = body;
          return send([{ updated_at: body.updated_at }], 201);
        }
        const base = u.searchParams.get('updated_at')?.replace(/^eq\./, '');
        if (!row || row.updated_at !== base) return send([]);
        writes++;
        rows[id] = { ...row, ...body };
        return send([{ updated_at: rows[id].updated_at }]);
      }
      send({}, 404);
    });
  })
  .listen(4120, '127.0.0.1');

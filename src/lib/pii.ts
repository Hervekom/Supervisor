// Personal and device details that students should not share, in English and French.
// Each rule replaces only the identifying part, so scientific values and metric results stay as they are.

type Rule = { re: RegExp; to: string | ((...m: string[]) => string); kind: 'device' | 'phone' | 'user_name' };

export const PII_RULES: Rule[] = [
  // Network paths: \\server\share\... and smb://server/share
  { re: /\\\\[A-Za-z0-9._$-]+\\[^\\\s]+/g, to: '\\\\[host]\\[share]', kind: 'device' },
  { re: /\bsmb:\/\/[^/\s]+\/[^/\s]+/gi, to: 'smb://[host]/[share]', kind: 'device' },
  // A terminal prompt such as student@lab-pc:~$
  { re: /\b[a-z_][a-z0-9_.-]*@([A-Za-z0-9-]+)(?=:)/g, to: '[user]@[host]', kind: 'user_name' },
  // Internal host names and Windows default computer names
  { re: /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:local|lan|internal|intranet|corp|localdomain|home\.arpa)\b/gi, to: '[host]', kind: 'device' },
  { re: /\b(?:DESKTOP|LAPTOP|WIN|PC)-[A-Z0-9]{5,}\b/g, to: '[host]', kind: 'device' },
  { re: /\b(host(?:name)?|computer(?: name)?|machine(?: name)?|hôte|nom de l['’]ordinateur|nom de la machine)(\s*[=:]\s*)[^\s,;]+/gi, to: (_m, k, sep) => `${k}${sep}[host]`, kind: 'device' },
  // user=student, login: student, utilisateur=…
  { re: /\b(user(?:name)?|login|uid|owner|utilisateur|nom d['’]utilisateur|identifiant)(\s*[=:]\s*)[^\s,;]+/gi, to: (_m, k, sep) => `${k}${sep}[user]`, kind: 'user_name' },
  // Serial numbers, GPU IDs and MAC addresses
  { re: /\b(serial(?: number| no\.?)?|s\/n|numéro de série|n° de série)(\s*[:=#]?\s*)[A-Za-z0-9-]{4,}/gi, to: (_m, k, sep) => `${k}${sep}[serial]`, kind: 'device' },
  { re: /\bGPU-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, to: '[gpu-id]', kind: 'device' },
  { re: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, to: '[mac]', kind: 'device' },
  // Phone numbers: international, Chinese mobile, French
  { re: /(?<![\w.])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}\d(?![\w.])/g, to: '[phone]', kind: 'phone' },
  { re: /(?<![\w.])1[3-9]\d(?:[\s-]?\d{4}){2}(?![\w.])/g, to: '[phone]', kind: 'phone' },
  { re: /(?<![\w.])0[1-9](?:[\s.-]?\d{2}){4}(?![\w.])/g, to: '[phone]', kind: 'phone' },
];

export function findPii(text: string): ('device' | 'phone' | 'user_name')[] {
  const found = new Set<'device' | 'phone' | 'user_name'>();
  for (const r of PII_RULES) {
    r.re.lastIndex = 0;
    if (r.re.test(text)) found.add(r.kind);
    r.re.lastIndex = 0;
  }
  return [...found];
}

export function redactPii(text: string): string {
  let t = text;
  for (const r of PII_RULES) t = t.replace(r.re, r.to as never);
  return t;
}

/** Words of the account's email name ("li.wei@…" gives "li" is too short, "wei" is kept only if 3+ letters). */
export function identityWords(email?: string): string[] {
  const local = (email ?? '').split('@')[0] ?? '';
  const generic = new Set(['student', 'user', 'admin', 'test', 'info', 'contact', 'mail', 'email', 'master', 'phd', 'thesis']);
  return [...new Set(local.toLowerCase().split(/[._+\-\d]+/).filter((w) => w.length >= 3 && /^[a-z\u00c0-\u024f]+$/.test(w) && !generic.has(w)))];
}

/** Replaces the student's own name, taken from the account's email, as a whole word. */
export function redactIdentity(text: string, words: string[]): string {
  let t = text;
  for (const w of words) t = t.replace(new RegExp(`(^|[^\\p{L}])${w}(?=$|[^\\p{L}])`, 'giu'), '$1[name]');
  return t;
}

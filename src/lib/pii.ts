// Personal and device details that students should not share, in English and French.
// Each rule replaces only the identifying part, so scientific values and metric results stay as they are.
// Number patterns that are also common in scientific text (phone-like digit groups, MAC-like hex pairs)
// are replaced only next to a word that says what they are. Otherwise they are kept, and flagged.
// None of this is exhaustive: it reduces what is shared, it cannot guarantee that nothing personal remains.

type Kind = 'device' | 'phone' | 'user_name';
type Replace = string | ((...m: string[]) => string);
type Rule = { re: RegExp; to: Replace; kind: Kind };

/** Replaces a match only when one of the context words comes shortly before it. */
const after = (context: RegExp, to: string) => (...a: unknown[]) => {
  const m = a[0] as string;
  const all = a[a.length - 1] as string;
  const off = a[a.length - 2] as number;
  return context.test(all.slice(Math.max(0, off - 40), off)) ? to : m;
};
const PHONE_WORDS = /(phone|\btel\b|\btél|téléphone|mobile|portable|\bcell|\bcall|appel|joignable|contact|whatsapp|wechat|weixin|\bsms\b|fax|手机|电话|联系)[^\n]{0,30}$/i;
const MAC_WORDS = /(\bmac\b|ether|hwaddr|\bwlan|\beth\d|wi-?fi|bluetooth|physical address|adresse physique|adresse mac|bssid)[^\n]{0,30}$/i;
const MAC = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const FR_PHONE = /(?<![\w.])0[1-9](?:[\s.-]?\d{2}){4}(?!\w|\.\d)/g;
const CN_MOBILE = /(?<![\w.])1[3-9]\d(?:[\s-]?\d{4}){2}(?!\w|\.\d)/g;

export const PII_RULES: Rule[] = [
  // Whole network paths: \\server\share\folders, //server/share/folders, smb://server/share/folders.
  { re: /\\\\[A-Za-z0-9._$-]+\\(?:[^\s"'<>|]*[^\s"'<>|.,;:)])?/g, to: '[network-path]', kind: 'device' },
  { re: /\b(?:smb|cifs|afp|nfs):\/\/[^\s"'<>]*[^\s"'<>.,;:)]/gi, to: '[network-path]', kind: 'device' },
  { re: /(?<![:\w/.])\/\/[A-Za-z][A-Za-z0-9._-]*\/[^\s"'<>]*[^\s"'<>.,;:)]/g, to: '[network-path]', kind: 'device' },
  // A terminal prompt such as student@lab-pc:~$
  { re: /\b[a-z_][a-z0-9_.-]*@([A-Za-z0-9-]+)(?=:)/g, to: '[user]@[host]', kind: 'user_name' },
  // Internal host names, university cluster nodes and Windows default computer names
  { re: /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:local|lan|internal|intranet|corp|localdomain|home\.arpa)\b/gi, to: '[host]', kind: 'device' },
  // A machine-style first label (gpu03, node12, cn001) on a university domain. Public sites such as cs231n.stanford.edu stay.
  { re: /\b(?:gpu|node|cn|cpu|compute|login|worker|srv|server|hpc|mgmt|n|c|g)\d+[a-z0-9-]*(?:\.[a-z0-9-]+)+\.(?:edu|ac)(?:\.[a-z]{2})?\b/gi, to: '[host]', kind: 'device' },
  { re: /\b[a-z0-9-]+\.(?:hpc|cluster|grid|compute)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\b/gi, to: '[host]', kind: 'device' },
  { re: /\b(?:DESKTOP|LAPTOP|WIN|PC)-[A-Z0-9]{5,}\b/g, to: '[host]', kind: 'device' },
  { re: /\b(host(?:name)?|computer(?: name)?|machine(?: name)?|hôte|nom de l['’]ordinateur|nom de la machine)(\s*[=:]\s*)[^\s,;]+/gi, to: (_m, k, sep) => `${k}${sep}[host]`, kind: 'device' },
  // user=student, login: student, utilisateur=…
  { re: /\b(user(?:name)?|login|uid|owner|utilisateur|nom d['’]utilisateur|identifiant)(\s*[=:]\s*)[^\s,;]+/gi, to: (_m, k, sep) => `${k}${sep}[user]`, kind: 'user_name' },
  // Serial numbers, GPU IDs, Windows account IDs, MAC addresses
  { re: /\b(serial(?: number| no\.?)?|s\/n|numéro de série|n° de série)(\s*[:=#]?\s*)[A-Za-z0-9-]{4,}/gi, to: (_m, k, sep) => `${k}${sep}[serial]`, kind: 'device' },
  // A vendor prefix and a long mixed code, such as a disk serial "WD-WCC4N1234567".
  { re: /\b[A-Z]{2,4}-(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,}\b/g, to: '[serial]', kind: 'device' },
  { re: /\bGPU-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, to: '[gpu-id]', kind: 'device' },
  { re: /\bS-1-\d{1,2}(?:-\d+){2,}\b/g, to: '[sid]', kind: 'device' },
  { re: MAC, to: after(MAC_WORDS, '[mac]'), kind: 'device' },
  // Phone numbers. International ("+…") and formats with area-code punctuation are clear on their own.
  { re: /(?<![\w.])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}\d(?!\w|\.\d)/g, to: '[phone]', kind: 'phone' },
  { re: /(?<![\w.])\(\d{3}\)\s?\d{3}[\s.-]\d{4}(?!\w|\.\d)/g, to: '[phone]', kind: 'phone' },
  { re: /(?<![\w.:-])0\d{2,3}-\d{4}-\d{4}(?!\w|-|\.\d)|(?<![\w.:-])0\d{2,3}-\d{7,8}(?!\w|-|\.\d)/g, to: '[phone]', kind: 'phone' },
  // Digit groups that may be epochs, counts or IDs are phones only next to a word such as "phone" or "joignable".
  { re: CN_MOBILE, to: after(PHONE_WORDS, '[phone]'), kind: 'phone' },
  { re: FR_PHONE, to: after(PHONE_WORDS, '[phone]'), kind: 'phone' },
];

const apply = (text: string, r: Rule) => {
  r.re.lastIndex = 0;
  return text.replace(r.re, r.to as never);
};

export function findPii(text: string): Kind[] {
  const found = new Set<Kind>();
  for (const r of PII_RULES) if (apply(text, r) !== text) found.add(r.kind);
  return [...found];
}

export function redactPii(text: string): string {
  let t = text;
  for (const r of PII_RULES) t = apply(t, r);
  return t;
}

/**
 * Values that look like a phone number or a device address but were kept, because without a word
 * saying what they are they may be scientific data (epochs, sample counts, checkpoint IDs).
 * The student is told, and decides.
 */
export function maybePii(text: string): boolean {
  const kept = redactPii(text);
  return [MAC, FR_PHONE, CN_MOBILE].some((re) => {
    re.lastIndex = 0;
    const hit = re.test(kept);
    re.lastIndex = 0;
    return hit;
  });
}

// ---------- The student's own name ----------

/** Lower case, without accents: "Hélène" and "helene" are the same word. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();

const GENERIC = new Set(['student', 'students', 'etudiant', 'user', 'admin', 'test', 'info', 'contact', 'mail', 'email', 'master', 'phd', 'thesis', 'these', 'lab', 'labo', 'research', 'univ', 'school']);
/**
 * Words that are also names but are common in English, French or scientific writing. They are replaced
 * only when they stand next to another part of the same name ("May Rose", "Dice Chen"), never alone.
 */
const COMMON = new Set([
  'may', 'rose', 'mark', 'will', 'bill', 'grace', 'hope', 'joy', 'faith', 'june', 'april', 'august', 'rich', 'frank', 'art', 'lane', 'dawn', 'summer', 'sky', 'river', 'max', 'min', 'mean', 'long', 'young', 'king', 'gay', 'hall', 'wood', 'stone', 'page', 'bell', 'miles', 'ray', 'iris', 'olive', 'pierre', 'marie', 'claire', 'blanc', 'petit', 'grand', 'bon', 'roux',
  // Metrics, methods and models named after people or sharing a name.
  'dice', 'jaccard', 'adam', 'ada', 'pearson', 'spearman', 'kendall', 'gauss', 'bayes', 'euler', 'newton', 'fisher', 'gini', 'huber', 'poisson', 'laplace', 'markov', 'kalman', 'xavier', 'bert', 'albert', 'roberta', 'ernie', 'elmo', 'lasso', 'ridge', 'nesterov', 'student', 'welch', 'wilcoxon', 'tukey', 'cohen', 'kappa',
]);

/**
 * Parts of the student's own name: from the account's display name when there is one, and from the email.
 * From an email, parts shorter than three letters are left out ("li.wei@…" gives "wei"). A display name
 * may give two-letter parts and names in Chinese or another script.
 */
export function identityWords(email?: string, displayName?: string): string[] {
  const out = new Set<string>();
  const local = fold((email ?? '').split('@')[0] ?? '');
  for (const w of local.split(/[._+\-\d]+/)) if (w.length >= 3 && /^\p{L}+$/u.test(w) && !GENERIC.has(w)) out.add(w);
  for (const w of fold(displayName ?? '').split(/[\s.,_+\-]+/)) {
    if (!w || GENERIC.has(w)) continue;
    if (/^\p{Script=Han}+$|^\p{Script=Hangul}+$|^[\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(w)) out.add(w);
    else if (w.length >= 2 && /^\p{L}+$/u.test(w)) out.add(w);
  }
  return [...out];
}

const CJK = /^[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;

/**
 * Replaces the student's own name as a whole word, with or without accents.
 * Common words and metric names that match a part of the name are kept unless they stand next to another part.
 * Two-letter parts are replaced only when written with a capital ("Li", not "li").
 */
export function redactIdentity(text: string, words: string[]): string {
  if (!words.length) return text;
  const set = new Set(words.map(fold));
  let t = text;
  // Names in Chinese and other scripts without spaces are matched as they are.
  for (const w of set) if (CJK.test(w)) t = t.split(w).join('[name]');
  const latin = [...set].filter((w) => !CJK.test(w));
  if (!latin.length) return t;
  const parts = [...t.matchAll(/\p{L}[\p{L}\p{M}]*/gu)];
  const isName = (i: number) => {
    const p = parts[i];
    if (!p) return false;
    const f = fold(p[0]);
    if (!set.has(f)) return false;
    if (f.length === 2 && !/^\p{Lu}/u.test(p[0])) return false;
    return true;
  };
  const near = (i: number, j: number) => {
    const a = parts[i];
    const b = parts[j];
    if (!a || !b) return false;
    const [x, y] = i < j ? [a, b] : [b, a];
    return /^[\s-]{1,2}$/.test(t.slice((x.index ?? 0) + x[0].length, y.index ?? 0));
  };
  const replace: boolean[] = parts.map((p, i) => {
    if (!isName(i)) return false;
    if (!COMMON.has(fold(p[0]))) return true;
    return (isName(i - 1) && near(i - 1, i) && !COMMON.has(fold(parts[i - 1][0]))) || (isName(i + 1) && near(i, i + 1) && !COMMON.has(fold(parts[i + 1][0]))) || (/^\p{Lu}/u.test(p[0]) && ((isName(i - 1) && near(i - 1, i)) || (isName(i + 1) && near(i, i + 1))));
  });
  let out = '';
  let last = 0;
  parts.forEach((p, i) => {
    if (!replace[i]) return;
    out += t.slice(last, p.index) + '[name]';
    last = (p.index ?? 0) + p[0].length;
  });
  return out + t.slice(last);
}

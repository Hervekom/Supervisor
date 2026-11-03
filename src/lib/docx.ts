import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

export type Para = {
  index: number;
  text: string;
  styleName: string;
  level: number; // 0 = not a heading
  font: string | null;
  sizePt: number | null;
  bold: boolean;
  align: string;
  lineSpacing: number | null;
  firstLineIndent: boolean;
  tableIndex: number | null;
  hasImage: boolean;
  isToc: boolean;
  breakBefore: boolean;
  section: number;
  numbered: boolean;
};

export type Table = {
  index: number;
  paragraphIndex: number; // index of the first paragraph after the table starts
  rows: string[][];
  hasVerticalBorders: boolean;
};

export type Section = {
  index: number;
  widthCm: number;
  heightCm: number;
  margins: { top: number; bottom: number; left: number; right: number };
  hasHeader: boolean;
  headerTexts: string[];
  pageNumberFormat: string | null;
  pageNumberStart: number | null;
};

export type Doc = {
  paragraphs: Para[];
  tables: Table[];
  sections: Section[];
  evenOddHeaders: boolean;
};

type El = Element;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const kids = (e: El | null | undefined, name?: string): El[] => {
  if (!e) return [];
  const out: El[] = [];
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as El).localName === name)) out.push(n as El);
  }
  return out;
};
const kid = (e: El | null | undefined, name: string) => kids(e, name)[0] ?? null;
const attr = (e: El | null, name: string) => (e ? e.getAttributeNS(W, name) || null : null);
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml').documentElement as unknown as El;

const onOff = (e: El | null): boolean | null => {
  if (!e) return null;
  const v = attr(e, 'val');
  return !(v === '0' || v === 'false' || v === 'none');
};

type Props = {
  font?: string | null;
  size?: number | null;
  bold?: boolean | null;
  align?: string | null;
  line?: number | null;
  indent?: boolean | null;
  pageBreak?: boolean | null;
  outline?: number | null;
};

function fontOf(rFonts: El | null, theme: { major: string | null; minor: string | null }) {
  if (!rFonts) return undefined;
  const direct = attr(rFonts, 'ascii') || attr(rFonts, 'hAnsi');
  if (direct) return direct;
  const t = attr(rFonts, 'asciiTheme');
  if (t) return t.startsWith('major') ? theme.major : theme.minor;
  return undefined;
}

function runProps(rPr: El | null, theme: { major: string | null; minor: string | null }): Props {
  const p: Props = {};
  if (!rPr) return p;
  const f = fontOf(kid(rPr, 'rFonts'), theme);
  if (f !== undefined) p.font = f;
  const sz = attr(kid(rPr, 'sz'), 'val');
  if (sz) p.size = Number(sz) / 2;
  const b = onOff(kid(rPr, 'b'));
  if (b !== null) p.bold = b;
  return p;
}

function paraProps(pPr: El | null): Props {
  const p: Props = {};
  if (!pPr) return p;
  const jc = attr(kid(pPr, 'jc'), 'val');
  if (jc) p.align = jc === 'both' ? 'justify' : jc === 'start' ? 'left' : jc;
  const sp = kid(pPr, 'spacing');
  const line = attr(sp, 'line');
  if (line) {
    const rule = attr(sp, 'lineRule');
    p.line = !rule || rule === 'auto' ? Number(line) / 240 : null;
  }
  const ind = kid(pPr, 'ind');
  if (ind) {
    const first = attr(ind, 'firstLine') || attr(ind, 'firstLineChars');
    const hanging = attr(ind, 'hanging');
    if (first !== null) p.indent = Number(first) > 0;
    else if (hanging) p.indent = false;
  }
  const pb = onOff(kid(pPr, 'pageBreakBefore'));
  if (pb !== null) p.pageBreak = pb;
  const ol = attr(kid(pPr, 'outlineLvl'), 'val');
  if (ol !== null) p.outline = Number(ol);
  return p;
}

function textOf(e: El): string {
  let s = '';
  const walk = (n: El) => {
    for (const c of kids(n)) {
      if (c.localName === 'instrText' || c.localName === 'del' || c.localName === 'delText') continue;
      if (c.localName === 't') s += c.textContent ?? '';
      else if (c.localName === 'tab') s += ' ';
      else walk(c);
    }
  };
  walk(e);
  return s;
}

export function headingLevelFromText(text: string): number {
  const t = text.trim();
  if (t.length > 130) return 0;
  if (/^chapter\s+([0-9]+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(t)) return 1;
  if (/^\d+\.\d+\.\d+\.?\s+\S/.test(t)) return 3;
  if (/^\d+\.\d+\.?\s+\S/.test(t)) return 2;
  return 0;
}

export async function parseDocx(buf: ArrayBuffer | Uint8Array | Buffer): Promise<Doc> {
  const zip = await JSZip.loadAsync(buf);
  const read = async (p: string) => (await zip.file(p)?.async('string')) ?? null;
  const main = await read('word/document.xml');
  if (!main) throw new Error('This file has no Word document body. Upload a .docx file.');

  const themeXml = await read('word/theme/theme1.xml');
  const theme = {
    major: themeXml?.match(/<a:majorFont>\s*<a:latin typeface="([^"]*)"/)?.[1] ?? null,
    minor: themeXml?.match(/<a:minorFont>\s*<a:latin typeface="([^"]*)"/)?.[1] ?? null,
  };

  // Styles
  const styleXml = await read('word/styles.xml');
  const styles = new Map<string, { name: string; basedOn: string | null; p: Props; r: Props }>();
  let defaults: Props = {};
  let defaultParaStyle: string | null = null;
  if (styleXml) {
    const root = parse(styleXml);
    const dd = kid(root, 'docDefaults');
    defaults = {
      ...runProps(kid(kid(dd, 'rPrDefault'), 'rPr'), theme),
      ...paraProps(kid(kid(dd, 'pPrDefault'), 'pPr')),
    };
    for (const s of kids(root, 'style')) {
      const id = attr(s, 'styleId');
      if (!id) continue;
      if (attr(s, 'type') === 'paragraph' && attr(s, 'default') === '1') defaultParaStyle = id;
      if (attr(s, 'type') !== 'paragraph') continue;
      styles.set(id, {
        name: attr(kid(s, 'name'), 'val') ?? id,
        basedOn: attr(kid(s, 'basedOn'), 'val'),
        p: paraProps(kid(s, 'pPr')),
        r: runProps(kid(s, 'rPr'), theme),
      });
    }
  }
  const resolved = (id: string | null): Props => {
    const chain: Props[] = [];
    const seen = new Set<string>();
    let cur = id ?? defaultParaStyle;
    while (cur && styles.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const s = styles.get(cur)!;
      chain.unshift({ ...s.p, ...s.r });
      cur = s.basedOn;
    }
    return Object.assign({}, defaults, ...chain);
  };

  // Headers
  const relsXml = await read('word/_rels/document.xml.rels');
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const r of kids(parse(relsXml), 'Relationship')) {
      rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
    }
  }
  const settingsXml = await read('word/settings.xml');
  const evenOddHeaders = !!settingsXml && /<w:evenAndOddHeaders(?:\s[^>]*)?\/>/.test(settingsXml);

  const makeSection = async (sect: El | null, index: number): Promise<Section> => {
    const sz = kid(sect, 'pgSz');
    const mar = kid(sect, 'pgMar');
    const cm = (v: string | null) => Math.round((Number(v ?? 0) / 567) * 100) / 100;
    const headerTexts: string[] = [];
    for (const h of kids(sect, 'headerReference')) {
      const target = rels.get(h.getAttributeNS(R, 'id') ?? '');
      const xml = target ? await read(`word/${target.replace(/^\/?word\//, '')}`) : null;
      if (xml) headerTexts.push(textOf(parse(xml)).trim());
    }
    const num = kid(sect, 'pgNumType');
    return {
      index,
      widthCm: cm(attr(sz, 'w')),
      heightCm: cm(attr(sz, 'h')),
      margins: {
        top: Math.abs(cm(attr(mar, 'top'))),
        bottom: Math.abs(cm(attr(mar, 'bottom'))),
        left: cm(attr(mar, 'left')),
        right: cm(attr(mar, 'right')),
      },
      hasHeader: headerTexts.some(Boolean),
      headerTexts,
      pageNumberFormat: attr(num, 'fmt'),
      pageNumberStart: attr(num, 'start') ? Number(attr(num, 'start')) : null,
    };
  };

  const root = parse(main);
  const body = kid(root, 'body');
  const paragraphs: Para[] = [];
  const tables: Table[] = [];
  const sectEls: El[] = [];
  let pendingBreak = false;

  const addPara = (p: El, tableIndex: number | null) => {
    const pPr = kid(p, 'pPr');
    const styleId = attr(kid(pPr, 'pStyle'), 'val');
    const base = resolved(styleId);
    const own = paraProps(pPr);
    const merged: Props = { ...base, ...own };
    const styleName = (styleId && styles.get(styleId)?.name) || (defaultParaStyle && styles.get(defaultParaStyle)?.name) || 'Normal';

    // The run with the most characters decides font, size and weight.
    const tally = new Map<string, { len: number; p: Props }>();
    const collect = (n: El) => {
      for (const c of kids(n)) {
        if (c.localName === 'r') {
          const len = textOf(c).length;
          if (!len) continue;
          const rp = { ...base, ...runProps(kid(c, 'rPr'), theme) };
          const k = `${rp.font}|${rp.size}|${rp.bold}`;
          const cur = tally.get(k);
          tally.set(k, { len: (cur?.len ?? 0) + len, p: rp });
        } else if (['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'fldSimple'].includes(c.localName ?? '')) collect(c);
      }
    };
    collect(p);
    const top = [...tally.values()].sort((a, b) => b.len - a.len)[0]?.p ?? base;

    const text = textOf(p).replace(/\s+/g, ' ').trim();
    const name = styleName.toLowerCase();
    const styleLevel = name.match(/^(?:heading|标题)\s*(\d)$/)?.[1];
    const isToc = /^(toc|目录)\s*\d/.test(name) || /^table of (figures|contents)$/.test(name);
    let level = styleLevel ? Number(styleLevel) : 0;
    if (!level && merged.outline != null && merged.outline < 9) level = merged.outline + 1;
    if (!level && tableIndex === null && !isToc) level = headingLevelFromText(text);

    const xml = p.toString();
    const hardBreak = /<w:br\b[^>]*w:type="page"/.test(xml);
    const index = paragraphs.length;
    paragraphs.push({
      index,
      text,
      styleName,
      level: isToc ? 0 : level,
      font: top.font ?? null,
      sizePt: top.size ?? null,
      bold: !!top.bold,
      align: merged.align ?? 'left',
      lineSpacing: merged.line ?? null,
      firstLineIndent: !!merged.indent,
      tableIndex,
      hasImage: /<(w:drawing|w:pict|v:imagedata)\b/.test(xml),
      isToc,
      breakBefore: pendingBreak || !!merged.pageBreak,
      section: sectEls.length,
      numbered: !!kid(pPr, 'numPr'),
    });
    pendingBreak = false;
    if (hardBreak) pendingBreak = true;
    const inner = kid(pPr, 'sectPr');
    if (inner) {
      sectEls.push(inner);
      pendingBreak = true;
    }
  };

  const walkBlock = (e: El) => {
    for (const c of kids(e)) {
      if (c.localName === 'p') addPara(c, null);
      else if (c.localName === 'sdt') walkBlock(kid(c, 'sdtContent') as El);
      else if (c.localName === 'tbl') {
        const index = tables.length;
        const start = paragraphs.length;
        const rows: string[][] = [];
        for (const tr of kids(c, 'tr')) {
          const row: string[] = [];
          for (const tc of kids(tr, 'tc')) {
            const vm = kid(kid(tc, 'tcPr'), 'vMerge');
            let s = vm && attr(vm, 'val') !== 'restart' ? '—' : '';
            for (const p of kids(tc, 'p')) {
              addPara(p, index);
              s += paragraphs[paragraphs.length - 1].text;
            }
            row.push(s.trim());
          }
          rows.push(row);
        }
        const b = kid(kid(c, 'tblPr'), 'tblBorders');
        const vert = ['left', 'right', 'insideV'].some((n) => {
          const v = attr(kid(b, n), 'val');
          return !!v && v !== 'none' && v !== 'nil';
        });
        tables.push({ index, paragraphIndex: start, rows, hasVerticalBorders: vert });
      }
    }
  };
  walkBlock(body as El);
  const last = kid(body, 'sectPr');
  if (last) sectEls.push(last);

  const sections: Section[] = [];
  for (let i = 0; i < sectEls.length; i++) sections.push(await makeSection(sectEls[i], i));
  return { paragraphs, tables, sections, evenOddHeaders };
}

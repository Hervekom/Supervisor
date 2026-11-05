import JSZip from 'jszip';

// Entirely fictional content, so this fixture can stay in a public repository.
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const TNR = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>';
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Run = { size?: number; bold?: boolean; font?: string };
type Para = { pPr?: string; style?: string };

function p(text: string, r: Run = {}, o: Para = {}) {
  const font = r.font ? `<w:rFonts w:ascii="${r.font}" w:hAnsi="${r.font}"/>` : TNR;
  const rPr = `${font}${r.bold ? '<w:b/>' : ''}<w:sz w:val="${(r.size ?? 12) * 2}"/>`;
  const style = o.style ? `<w:pStyle w:val="${o.style}"/>` : '';
  return `<w:p><w:pPr>${style}${o.pPr ?? ''}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

const BODY_PPR = '<w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLine="480"/><w:jc w:val="both"/>';
const body = (t: string, r: Run = {}) => p(t, r, { pPr: BODY_PPR });
const h1 = (t: string) => p(t, { size: 15, bold: true }, { style: 'Heading1', pPr: '<w:pageBreakBefore/><w:jc w:val="center"/>' });
const h2 = (t: string) => p(t, { size: 14, bold: true }, { style: 'Heading2', pPr: '<w:jc w:val="left"/>' });
const h3 = (t: string) => p(t, { size: 12, bold: true }, { style: 'Heading3', pPr: '<w:jc w:val="left"/>' });
const figure = (label: string) =>
  `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing/></w:r></w:p>${p(label, { size: 10.5 }, { pPr: '<w:jc w:val="center"/>' })}`;

function table(rows: string[][]) {
  const cells = rows
    .map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c, { size: 9 }, { pPr: '<w:jc w:val="center"/>' })}</w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl><w:tblPr/>${cells}</w:tbl>`;
}

const section = (fmt: string, header: boolean) =>
  `<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="even" r:id="rIdH2"/>' : ''}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${header ? 1191 : 1418}" w:right="1418" w:bottom="1418" w:left="1418"/><w:pgNumType w:fmt="${fmt}" w:start="1"/></w:sectPr>`;

export type SyntheticOptions = { wrongBodyFont?: boolean; dropAcknowledgments?: boolean; authorName?: string };

const SENTENCE = 'The fictional lantern method measures how quickly a simulated garden responds to changes in light across repeated seasons [1]. ';

export async function buildSyntheticThesis(o: SyntheticOptions = {}) {
  const r: Run = o.wrongBodyFont ? { font: 'Calibri', size: 11 } : {};
  const para = (extra = '') => body(`${SENTENCE.repeat(3)}${extra}`, r);
  const author = o.authorName ?? 'Candidate Example';
  const doc = [
    p('Master Thesis for Academic Degree', { size: 18, bold: true }, { pPr: '<w:jc w:val="center"/>' }),
    p(`Candidate: ${author}`),
    p('Originality Statement', { bold: true }),
    p('This fictional statement exists only for automated tests.'),
    p('ABSTRACT', { size: 18, bold: true }, { pPr: '<w:jc w:val="center"/>' }),
    body('However, simulated gardens lack reliable light models. This thesis proposes a novel lantern method. Results show 91.5% accuracy on the public FICTION-2024 benchmark.'),
    p('Keywords: lantern method; simulated garden; light response'),
    p('摘要', { size: 18, bold: true }, { pPr: '<w:jc w:val="center"/>' }),
    body('本文提出一种虚构的灯笼方法，在公开的 FICTION-2024 基准上准确率为 91.5%。'),
    p('关键词：灯笼方法；模拟花园；光照响应'),
    `<w:p><w:pPr>${section('upperRoman', false)}</w:pPr></w:p>`,
    p('Table of Contents', { bold: true }),
    p('Chapter 1 INTRODUCTION 1', {}, { style: 'TOC1' }),
    h1('Chapter 1 INTRODUCTION'),
    h2('1.1 Background of the Study'),
    para('RQ1 asks how well the lantern method works.'),
    h3('1.1.1 Research Scope'),
    para(),
    h2('1.2 Chapter Summary'),
    para(),
    h1('Chapter 2 METHOD AND RESULTS'),
    h2('2.1 Experiment Design'),
    para('We chose this method because it is simple, rather than a heavier baseline. Figure 2-1 shows the design, and Table 2-1 compares the state-of-the-art baseline.'),
    figure('Figure 2-1 Fictional lantern design'),
    p('Table 2-1 Fictional comparison', { size: 10.5 }, { pPr: '<w:jc w:val="center"/>' }),
    table([['Method', 'Accuracy'], ['Baseline', '80.5'], ['Lantern', '91.5']]),
    h2('2.2 Discussion'),
    para('The method reaches 91.5% accuracy, compared with the baseline, a 11.0 point gain. One limitation is that the dataset is fictional.'),
    h2('2.3 Chapter Summary'),
    para(),
    h1('CONCLUSION'),
    para('RQ1 is answered: the lantern method works on this fictional dataset. Its main contribution is a simple design. One limitation is scale.'),
    `<w:p><w:pPr>${section('decimal', true)}</w:pPr></w:p>`,
    h1('REFERENCES'),
    p('[1] Fiction A, Example B. A fictional lantern method[J]. Journal of Imaginary Studies, 2024, 1(1): 1–9'),
    h1('RESEARCH OUTPUTS OBTAINED DURING THE MASTER’S DEGREE PROGRAM'),
    p('No outputs. This document is fictional.'),
    ...(o.dropAcknowledgments ? [] : [h1('ACKNOWLEDGEMENT'), p('Thanks to the fictional garden.')]),
  ].join('');

  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${doc}${section('decimal', true)}</w:body></w:document>`);
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${TNR}<w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      [1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/></w:style>`).join('') +
      '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>',
  );
  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8"?><w:settings ${NS}><w:evenAndOddHeaders/></w:settings>`);
  zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${NS}>${p('Chapter I INTRODUCTION', { size: 9 })}</w:hdr>`);
  zip.file('word/header2.xml', `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${NS}>${p('NUIST Master’s Thesis', { size: 9 })}</w:hdr>`);
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH1" Target="header1.xml" Type="header"/><Relationship Id="rIdH2" Target="header2.xml" Type="header"/></Relationships>',
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** Builds a small valid PDF with one text line per page. */
export function buildSyntheticPdf(pages: string[]) {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const font = 3 + pages.length * 2;
  pages.forEach((t, i) => {
    const stream = `BT /F1 12 Tf 40 700 Td (${t.replace(/([()\\])/g, '\\$1')}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// Fictional WPS-style Identity-H / embedded CID TrueType / ToUnicode fixture.
// This is not an export from WPS and contains no private learning content.
import fs from 'node:fs';
import { URL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import process from 'node:process';
const root = new URL('../tests/fixtures/', import.meta.url);
const font = fs.readFileSync(new URL('pdf-assets/fictional-cjk.ttf', root));
const map = JSON.parse(fs.readFileSync(new URL('pdf-assets/font-map.json', root), 'utf8'));
const entries = Object.entries(map).filter(([c]) => +c < 65536);
const stream = (bytes, extra = '') => {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const z = deflateSync(b);
  return Buffer.concat([
    Buffer.from(`<< /Length ${z.length} /Filter /FlateDecode ${extra} >>\nstream\n`),
    z,
    Buffer.from('\nendstream'),
  ]);
};
function pdf(objects, extra = '') {
  let data = Buffer.from('%PDF-1.7\n');
  const offsets = [0];
  for (const [i, o] of objects.entries()) {
    offsets.push(data.length);
    data = Buffer.concat([
      data,
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(o) ? o : Buffer.from(o),
      Buffer.from('\nendobj\n'),
    ]);
  }
  const xref = data.length;
  return Buffer.concat([
    data,
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((x) => String(x).padStart(10, '0') + ' 00000 n \n')
        .join(
          '',
        )}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} ${extra} >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  ]);
}
const hex = (n) => n.toString(16).padStart(4, '0');
function chinese(pages, missingMap = false) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${9 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type0 /BaseFont /RecallFictional /Encoding /Identity-H /DescendantFonts [4 0 R] ${missingMap ? '' : '/ToUnicode 8 0 R'} >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /RecallFictional /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 1000 /W [${entries.map(([c, m]) => `${c} [${m.width}]`).join(' ')}] /CIDToGIDMap 7 0 R >>`,
    '<< /Type /FontDescriptor /FontName /RecallFictional /Flags 4 /FontBBox [-100 -300 1200 1100] /ItalicAngle 0 /Ascent 1000 /Descent -250 /CapHeight 800 /StemV 80 /FontFile2 6 0 R >>',
    stream(font, `/Length1 ${font.length}`),
  ];
  const gids = Buffer.alloc((Math.max(...entries.map(([c]) => +c)) + 1) * 2);
  for (const [c, m] of entries) gids.writeUInt16BE(m.gid, +c * 2);
  objects.push(stream(gids));
  const chunks = [];
  for (let i = 0; i < entries.length; i += 80) {
    let a = entries.slice(i, i + 80);
    chunks.push(
      `${a.length} beginbfchar\n${a.map(([c]) => `<${hex(+c)}> <${hex(+c)}>`).join('\n')}\nendbfchar`,
    );
  }
  objects.push(
    stream(
      `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /RecallFictional-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
    ),
  );
  pages.forEach((lines, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${10 + i * 2} 0 R >>`,
    );
    const show = lines
      .map(
        (line, j) =>
          `1 0 0 1 45 ${790 - j * 24} Tm <${Array.from(line)
            .map((c) => hex(c.charCodeAt(0)))
            .join('')}> Tj`,
      )
      .join('\n');
    objects.push(stream(`BT /F1 14 Tf\n${show}\nET`));
  });
  return pdf(objects);
}
const pages = [];
let lines = ['虚构学习资料'];
const counts = [31, 22, 3, 3, 8, 2];
for (let s = 0; s < counts.length; s++) {
  lines.push(`第${'一二三四五六'[s]}部分 虚构单元`);
  for (let n = 1; n <= counts[s]; n++) {
    for (const line of [`${n}．规则名称${s + 1}-${n}：标准答案甲。`, '后续内容乙。']) {
      lines.push(line);
      if (lines.length >= 15) {
        pages.push([...lines, `${pages.length + 1}`]);
        lines = [];
      }
    }
  }
}
if (lines.length) pages.push([...lines, `${pages.length + 1}`]);
const files = {
  'chinese-cid.pdf': chinese(pages),
  'chinese-cross-page.pdf': chinese([
    [
      '虚构学习资料',
      '第一部分 虚构单元',
      '1．跨页长答案：第一段内容甲。',
      '（1）答案内容乙。',
      '1',
    ],
    [
      '后续内容丙。',
      '2．规则名称：标准答案丁。',
      '第二部分 虚构单元',
      '1．规则名称乙：标准答案甲。',
      '2',
    ],
  ]),
  'chinese-missing-map.pdf': chinese([['中文测试', '1．规则名称：标准答案甲。']], true),
  'blank.pdf': chinese([[]]),
};
for (const [name, bytes] of Object.entries(files)) {
  const path = new URL(`import/${name}`, root);
  if (process.argv.includes('--check')) {
    if (!fs.readFileSync(path).equals(bytes)) throw Error(`Fixture differs: ${name}`);
  } else fs.writeFileSync(path, bytes);
}

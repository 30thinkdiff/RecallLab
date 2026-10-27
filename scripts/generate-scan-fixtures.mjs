import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
const root = new URL('../tests/fixtures/', import.meta.url);
const scans = JSON.parse(fs.readFileSync(new URL('pdf-assets/scans.json', root), 'utf8'));
const english = JSON.parse(fs.readFileSync(new URL('pdf-assets/english.json', root), 'utf8'));
const blurred = JSON.parse(fs.readFileSync(new URL('pdf-assets/blurred.json', root), 'utf8'));
function pdf(images) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`,
  ];
  images.forEach((im, i) => {
    const index = 3 + i * 3;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im ${index + 2} 0 R >> ${im.text ? `/Font << /F1 ${3 + images.length * 3} 0 R >>` : ''} >> /Contents ${index + 1} 0 R >>`,
    );
    const content =
      'q 595 0 0 842 0 0 cm /Im Do Q' +
      (im.text ? ` BT /F1 14 Tf 50 60 Td (${im.text}) Tj ET` : '');
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const bytes = fs.readFileSync(new URL(`pdf-assets/${im.asset}`, root));
    objects.push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${bytes.length} >>\nstream\n`,
        ),
        bytes,
        Buffer.from('\nendstream'),
      ]),
    );
  });
  if (images.some((im) => im.text))
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let data = Buffer.from('%PDF-1.7\n');
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(data.length);
    data = Buffer.concat([
      data,
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(obj) ? obj : Buffer.from(obj),
      Buffer.from('\nendobj\n'),
    ]);
  });
  const xref = data.length;
  return Buffer.concat([
    data,
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  ]);
}
for (const [name, images] of Object.entries({
  'chinese-scanned.pdf': scans,
  'blurred-scan.pdf': [blurred],
  'english-scanned.pdf': [english],
  'mixed-inline.pdf': [{ ...scans[0], text: 'Fictional Alpha footer.' }],
})) {
  const bytes = pdf(images),
    path = new URL(`import/${name}`, root);
  if (process.argv.includes('--check')) {
    if (!fs.readFileSync(path).equals(bytes)) throw Error(`Fixture differs: ${name}`);
  } else fs.writeFileSync(path, bytes);
}

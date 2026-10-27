// Minimal valid PDFs authored only from fictional ASCII text and a synthetic red pixel.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
const root = new URL('../tests/fixtures/import/', import.meta.url);
function stream(content) {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}
function pdf(objects) {
  let data = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(data));
    data += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  data += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(data);
}
const image =
  '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream';
const alpha =
  'BT /F1 18 Tf 50 760 Td (Chapter 1 - Fictional Alpha) Tj /F1 12 Tf 0 -28 Td (Alpha source paragraph for public tests.) Tj ET';
const beta =
  'BT /F1 18 Tf 50 760 Td (Chapter 2 - Fictional Beta) Tj /F1 12 Tf 0 -28 Td (Beta source paragraph on page two.) Tj ET';
const page = (content, resources) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${content} 0 R >>`;
const prefix = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
];
const font = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
const files = {
  'text-two-pages.pdf': pdf([
    ...prefix,
    page(4, '/Font << /F1 7 0 R >>'),
    stream(alpha),
    page(6, '/Font << /F1 7 0 R >>'),
    stream(beta),
    font,
  ]),
  'mixed-pages.pdf': pdf([
    ...prefix,
    page(4, '/Font << /F1 7 0 R >>'),
    stream(alpha),
    page(6, '/XObject << /Im0 8 0 R >>'),
    stream('q 100 0 0 100 50 600 cm /Im0 Do Q'),
    font,
    image,
  ]),
  'scanned.pdf': pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(4, '/XObject << /Im0 5 0 R >>'),
    stream('q 100 0 0 100 50 600 cm /Im0 Do Q'),
    image,
  ]),
  'broken.pdf': Buffer.from('%PDF-1.7\nbroken truncated public test fixture'),
};
if (!process.argv.includes('--check')) await mkdir(root, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = new URL(name, root);
  if (process.argv.includes('--check')) {
    if (!(await readFile(path)).equals(content)) throw new Error(`PDF fixture differs: ${name}`);
  } else await writeFile(path, content);
}

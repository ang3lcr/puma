export function createManyPagesPdf(pageCount: number): Buffer {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new RangeError('A PDF fixture must contain at least one page.');
  }

  const contentObjectId = pageCount + 3;
  const infoObjectId = pageCount + 4;
  const pageReferences = Array.from(
    { length: pageCount },
    (_, index) => `${index + 3} 0 R`,
  ).join(' ');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageReferences}] /Count ${pageCount} >>\nendobj\n`,
    ...Array.from({ length: pageCount }, (_, index) => {
      const objectId = index + 3;
      return `${objectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents ${contentObjectId} 0 R >>\nendobj\n`;
    }),
    `${contentObjectId} 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n`,
    `${infoObjectId} 0 obj\n<< /Title (Virtualization fixture) >>\nendobj\n`,
  ];

  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${offsets.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info ${infoObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'ascii');
}

export function createBlankAndTextPdf(): Buffer {
  const contents = ['', 'BT /F1 18 Tf 72 720 Td (Text page) Tj ET'];
  const pageNumbers = contents.map((_, index) => 4 + index * 2);
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageNumbers.map((pageNumber) => `${pageNumber} 0 R`).join(' ')}] /Count ${contents.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  contents.forEach((content, index) => {
    const pageNumber = pageNumbers[index];
    if (pageNumber === undefined) {
      throw new Error(`Missing fixture page number at index ${index}.`);
    }
    const contentNumber = pageNumber + 1;
    objects.push(
      `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>\nendobj\n`,
      `${contentNumber} 0 obj\n<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
  });

  const infoNumber = 4 + contents.length * 2;
  objects.push(
    `${infoNumber} 0 obj\n<< /Title (Blank and text fixture) /Producer (Document Studio test) >>\nendobj\n`,
  );

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
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info ${infoNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

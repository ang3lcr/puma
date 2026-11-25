import { createHash } from 'node:crypto';

const passwordPadding = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);
const documentId = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

export function createPasswordProtectedPdf(): Buffer {
  const userPassword = 'secret';
  const ownerPassword = 'owner';
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const ownerKey = createHash('md5')
    .update(padPassword(ownerPassword))
    .digest()
    .subarray(0, 5);
  const ownerEntry = rc4(ownerKey, padPassword(userPassword));
  const fileKey = createHash('md5')
    .update(
      Buffer.concat([
        padPassword(userPassword),
        ownerEntry,
        permissions,
        documentId,
      ]),
    )
    .digest()
    .subarray(0, 5);
  const userEntry = rc4(fileKey, passwordPadding);

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
    `5 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${ownerEntry.toString('hex')}> /U <${userEntry.toString('hex')}> /P -4 >>\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
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
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Encrypt 5 0 R /ID [<${documentId.toString('hex')}> <${documentId.toString('hex')}>] >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'ascii');
}

function padPassword(password: string): Buffer {
  const bytes = Buffer.from(password, 'utf8').subarray(0, 32);
  return Buffer.concat([bytes, passwordPadding.subarray(0, 32 - bytes.length)]);
}

function rc4(key: Buffer, input: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < state.length; i += 1) {
    j = (j + state[i]! + key[i % key.length]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }

  const output = Buffer.alloc(input.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < input.length; index += 1) {
    i = (i + 1) % 256;
    j = (j + state[i]!) % 256;
    [state[i], state[j]] = [state[j]!, state[i]!];
    output[index] = input[index]! ^ state[(state[i]! + state[j]!) % 256]!;
  }
  return output;
}

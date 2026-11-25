import {
  getDocument,
  GlobalWorkerOptions,
  PasswordException,
  PasswordResponses,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  BlobRangeTransport,
  FullReadConfirmationDeclinedError,
} from '../../pdf/blob-range-transport';
import { PdfImportError, sanitizeText } from './pdf-import-error';
import type {
  ImportedPdf,
  PdfDocumentSession,
  PdfImportOptions,
  PdfMetadata,
} from './pdf-import-types';
export { PdfImportError } from './pdf-import-error';
export type {
  ImportedPdf,
  PdfDocumentSession,
  PdfImportOptions,
  PdfImportProgress,
  PdfMetadata,
  PasswordReason,
} from './pdf-import-types';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const rangeChunkSize = 64 * 1024;

export async function importPdfFile(
  file: File,
  options: PdfImportOptions,
): Promise<ImportedPdf> {
  const session = await openPdfDocument(file, options);

  try {
    const { info } = await session.document.getMetadata();
    return {
      id: crypto.randomUUID(),
      file,
      fileName: sanitizeText(file.name, 255) ?? 'documento.pdf',
      size: file.size,
      lastModified: file.lastModified,
      pageCount: session.document.numPages,
      fingerprint: session.document.fingerprints[0] ?? null,
      metadata: extractPdfMetadata(info, session.document.isPureXfa),
      session,
    };
  } catch (error) {
    await session.loadingTask.destroy();
    throw new PdfImportError('read-failed', { cause: error });
  }
}

export async function openPdfDocument(
  file: File,
  options: PdfImportOptions,
): Promise<PdfDocumentSession> {
  if (file.size === 0) {
    throw new PdfImportError('empty-file');
  }

  if (!Number.isSafeInteger(file.size)) {
    throw new PdfImportError('read-failed');
  }

  const header = new TextDecoder().decode(
    await file.slice(0, Math.min(file.size, 1024)).arrayBuffer(),
  );
  if (!header.includes('%PDF-')) {
    throw new PdfImportError('not-pdf');
  }

  let loadingTask: PDFDocumentLoadingTask | null = null;
  const taskState = {
    rangeError: null as Error | null,
    passwordRequestError: null as Error | null,
    passwordCancelled: false,
  };

  const transport = new BlobRangeTransport(
    file,
    (error) => {
      taskState.rangeError = error;
      stopLoadingTask();
    },
    () => options.confirmFullRead(file.size),
  );

  loadingTask = getDocument({
    range: transport,
    rangeChunkSize,
    disableAutoFetch: true,
    disableStream: true,
  });

  function stopLoadingTask(): void {
    transport.abort();
    if (loadingTask) {
      void loadingTask.destroy().catch((error: unknown) => {
        if (
          !taskState.rangeError &&
          !taskState.passwordCancelled &&
          !taskState.passwordRequestError
        ) {
          taskState.passwordRequestError =
            error instanceof Error
              ? error
              : new Error('Unable to stop the PDF loading task.');
        }
      });
    }
  }

  loadingTask.onProgress = ({
    loaded,
    total,
  }: {
    loaded: number;
    total: number;
  }) => {
    options.onProgress?.({
      loaded,
      total,
      percent:
        total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
    });
  };

  loadingTask.onPassword = (
    updatePassword: (password: string) => void,
    reason: number,
  ) => {
    void options
      .requestPassword(
        reason === PasswordResponses.INCORRECT_PASSWORD
          ? 'incorrect'
          : 'required',
      )
      .then((password) => {
        if (password === null) {
          taskState.passwordCancelled = true;
          stopLoadingTask();
          return;
        }
        updatePassword(password);
      })
      .catch((error: unknown) => {
        taskState.passwordRequestError =
          error instanceof Error
            ? error
            : new Error('Unable to request the PDF password.');
        stopLoadingTask();
      });
  };

  try {
    return {
      document: await loadingTask.promise,
      loadingTask,
    };
  } catch (error) {
    await loadingTask.destroy();
    if (taskState.passwordCancelled) {
      throw new PdfImportError('password-cancelled', { cause: error });
    }
    if (taskState.rangeError) {
      if (taskState.rangeError instanceof FullReadConfirmationDeclinedError) {
        throw new PdfImportError('full-read-cancelled', {
          cause: taskState.rangeError,
        });
      }
      throw new PdfImportError('read-failed', { cause: taskState.rangeError });
    }
    if (taskState.passwordRequestError) {
      throw new PdfImportError('read-failed', {
        cause: taskState.passwordRequestError,
      });
    }
    if (error instanceof PasswordException) {
      throw new PdfImportError(
        error.code === PasswordResponses.NEED_PASSWORD
          ? 'password-required'
          : 'password-incorrect',
        { cause: error },
      );
    }
    if (
      error instanceof Error &&
      (error.name === 'InvalidPDFException' || error.name === 'MissingPDFException')
    ) {
      throw new PdfImportError('invalid-pdf', { cause: error });
    }
    throw new PdfImportError('read-failed', { cause: error });
  }
}

export function extractPdfMetadata(
  info: object,
  isPureXfa: boolean,
): PdfMetadata {
  const read = (key: string): unknown => Reflect.get(info, key);
  const text = (key: string): string | null => sanitizeText(read(key));

  return {
    title: text('Title'),
    author: text('Author'),
    subject: text('Subject'),
    creator: text('Creator'),
    producer: text('Producer'),
    pdfVersion: text('PDFFormatVersion'),
    creationDate: text('CreationDate'),
    modificationDate: text('ModDate'),
    encrypted:
      read('IsEncrypted') === true ||
      (typeof read('EncryptFilterName') === 'string' &&
        read('EncryptFilterName') !== ''),
    hasForms: read('IsAcroFormPresent') === true || isPureXfa,
    hasSignatures: read('IsSignaturesPresent') === true,
  };
}

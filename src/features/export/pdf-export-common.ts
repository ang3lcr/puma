import type { ProjectDocument, ProjectPage } from '../../store/project-store';

const mebibyte = 1024 * 1024;
const memoryOverheadBytes = 300 * mebibyte;
export const pdfExportMemoryBudgetBytes = 1536 * mebibyte;

export interface PdfExportMemoryEstimate {
  readonly pageCount: number;
  readonly sourceDocumentCount: number;
  readonly sourceBytes: number;
  readonly estimatedOutputBytes: number;
  readonly estimatedPeakBytes: number;
  readonly budgetBytes: number;
  readonly withinBudget: boolean;
}

export type PdfExportStage =
  | 'loading'
  | 'copying'
  | 'serializing'
  | 'validating';

export interface PdfExportProgress {
  readonly stage: PdfExportStage;
  readonly current: number;
  readonly total: number;
}

export interface PdfExportResult {
  readonly bytes: ArrayBuffer;
  readonly pageCount: number;
}

export interface PdfExportOptions {
  readonly documents: readonly ProjectDocument[];
  readonly pages: readonly ProjectPage[];
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: PdfExportProgress) => void;
}

export type PdfExportErrorCode =
  | 'cancelled'
  | 'encrypted-source'
  | 'generation-failed'
  | 'invalid-project'
  | 'memory-budget'
  | 'missing-source'
  | 'no-pages'
  | 'validation-failed';

export class PdfExportError extends Error {
  readonly code: PdfExportErrorCode;

  constructor(code: PdfExportErrorCode, options?: ErrorOptions) {
    super(`PDF export failed: ${code}.`, options);
    this.name = 'PdfExportError';
    this.code = code;
  }
}

export function estimatePdfExportMemory(
  documents: readonly ProjectDocument[],
  pages: readonly ProjectPage[],
): PdfExportMemoryEstimate {
  const activePages = pages.filter((page) => !page.isDeleted);
  const documentsById = new Map(
    documents.map((document) => [document.id, document]),
  );
  const usedDocuments = new Map<string, ProjectDocument>();
  let estimatedOutputBytes = 0;

  for (const page of activePages) {
    const document = documentsById.get(page.documentId);
    if (!document) {
      throw new PdfExportError('invalid-project');
    }

    usedDocuments.set(document.id, document);
    estimatedOutputBytes += document.size / Math.max(1, document.pageCount);
  }

  const sourceBytes = [...usedDocuments.values()].reduce(
    (total, document) => total + document.size,
    0,
  );
  const roundedOutputBytes = Math.ceil(estimatedOutputBytes);
  const estimatedPeakBytes =
    activePages.length === 0
      ? 0
      : memoryOverheadBytes +
        3 * Math.max(sourceBytes, roundedOutputBytes);

  return {
    pageCount: activePages.length,
    sourceDocumentCount: usedDocuments.size,
    sourceBytes,
    estimatedOutputBytes: roundedOutputBytes,
    estimatedPeakBytes,
    budgetBytes: pdfExportMemoryBudgetBytes,
    withinBudget: estimatedPeakBytes <= pdfExportMemoryBudgetBytes,
  };
}

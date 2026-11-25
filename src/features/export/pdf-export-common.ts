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
  readonly partIndex?: number;
  readonly partCount?: number;
}

export interface PdfExportResult {
  readonly bytes: ArrayBuffer;
  readonly pageCount: number;
}

export interface PdfExportPartPlan {
  readonly index: number;
  readonly pageIds: readonly string[];
  readonly firstPage: number;
  readonly lastPage: number;
  readonly estimate: PdfExportMemoryEstimate;
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

/** Greedily packs contiguous pages so every independently built PDF stays within
 * the existing heuristic budget. This is a planning estimate, not a memory guarantee. */
export function planPdfExportParts(
  documents: readonly ProjectDocument[],
  pages: readonly ProjectPage[],
  maxPagesPerPart = Number.POSITIVE_INFINITY,
): readonly PdfExportPartPlan[] {
  if (!(maxPagesPerPart === Number.POSITIVE_INFINITY || (Number.isSafeInteger(maxPagesPerPart) && maxPagesPerPart > 0))) {
    throw new PdfExportError('invalid-project');
  }
  const active = pages.filter((page) => !page.isDeleted);
  if (active.length === 0) throw new PdfExportError('no-pages');
  const plans: PdfExportPartPlan[] = [];
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  let partPages: ProjectPage[] = [];
  let partStart = 0;
  let usedDocuments = new Map<string, ProjectDocument>();
  let sourceBytes = 0;
  let estimatedOutputBytes = 0;

  const finishPart = (lastPageIndex: number): void => {
    const roundedOutputBytes = Math.ceil(estimatedOutputBytes);
    const estimatedPeakBytes = memoryOverheadBytes + 3 * Math.max(sourceBytes, roundedOutputBytes);
    plans.push({
      index: plans.length + 1,
      pageIds: partPages.map((page) => page.id),
      firstPage: partStart + 1,
      lastPage: lastPageIndex + 1,
      estimate: {
        pageCount: partPages.length,
        sourceDocumentCount: usedDocuments.size,
        sourceBytes,
        estimatedOutputBytes: roundedOutputBytes,
        estimatedPeakBytes,
        budgetBytes: pdfExportMemoryBudgetBytes,
        withinBudget: estimatedPeakBytes <= pdfExportMemoryBudgetBytes,
      },
    });
    partPages = [];
    usedDocuments = new Map();
    sourceBytes = 0;
    estimatedOutputBytes = 0;
  };

  for (const [pageIndex, page] of active.entries()) {
    const document = documentsById.get(page.documentId);
    if (!document) throw new PdfExportError('invalid-project');
    const addedSourceBytes = usedDocuments.has(document.id) ? 0 : document.size;
    const nextSourceBytes = sourceBytes + addedSourceBytes;
    const nextOutputBytes = estimatedOutputBytes + document.size / Math.max(1, document.pageCount);
    const nextPeakBytes = memoryOverheadBytes + 3 * Math.max(nextSourceBytes, Math.ceil(nextOutputBytes));
    if (nextPeakBytes > pdfExportMemoryBudgetBytes && partPages.length > 0) {
      finishPart(pageIndex - 1);
    }

    const pageSourceBytes = usedDocuments.has(document.id) ? 0 : document.size;
    const pageOutputBytes = document.size / Math.max(1, document.pageCount);
    const pagePeakBytes = memoryOverheadBytes + 3 * Math.max(pageSourceBytes, Math.ceil(pageOutputBytes));
    if (pagePeakBytes > pdfExportMemoryBudgetBytes) throw new PdfExportError('memory-budget');
    if (partPages.length === 0) partStart = pageIndex;
    partPages.push(page);
    if (!usedDocuments.has(document.id)) {
      usedDocuments.set(document.id, document);
      sourceBytes += document.size;
    }
    estimatedOutputBytes += pageOutputBytes;

    if (partPages.length >= maxPagesPerPart) finishPart(pageIndex);
  }
  if (partPages.length > 0) finishPart(active.length - 1);
  return plans;
}

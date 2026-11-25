import { degrees, PDFDocument } from 'pdf-lib';
import type { PdfDocumentSession } from '../documents/pdf-import-types';
import type { ProjectDocument } from '../../store/project-store';
import { isBoxInside, isValidBox } from '../margins/geometry';
import type { PdfBox } from '../margins/types';
import {
  estimatePdfExportMemory,
  PdfExportError,
  type PdfExportOptions,
  type PdfExportProgress,
  type PdfExportResult,
} from './pdf-export-common';

interface ExpectedPageGeometry {
  readonly cropBox: PdfBox;
  readonly rotation: number;
}

export async function exportProjectPdf({
  documents,
  pages,
  signal,
  onProgress,
}: PdfExportOptions): Promise<PdfExportResult> {
  const activePages = pages.filter((page) => !page.isDeleted);
  if (activePages.length === 0) {
    throw new PdfExportError('no-pages');
  }

  const estimate = estimatePdfExportMemory(documents, activePages);
  if (!estimate.withinBudget) {
    throw new PdfExportError('memory-budget');
  }

  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const requiredDocuments = new Map<string, ProjectDocument>();
  for (const page of activePages) {
    const document = documentsById.get(page.documentId);
    if (!document) {
      throw new PdfExportError('invalid-project');
    }
    if (!document.file) {
      throw new PdfExportError('missing-source');
    }
    if (document.metadata.encrypted) {
      throw new PdfExportError('encrypted-source');
    }
    requiredDocuments.set(document.id, document);
  }

  const sourcePdfs = new Map<string, PDFDocument>();
  const outputPdf = await PDFDocument.create();
  const expectedGeometry: ExpectedPageGeometry[] = [];

  try {
    checkCancelled(signal);
    let loadedCount = 0;
    for (const document of requiredDocuments.values()) {
      checkCancelled(signal);
      const file = document.file;
      if (!file) {
        throw new PdfExportError('missing-source');
      }
      try {
        const sourcePdf = await PDFDocument.load(await file.arrayBuffer());
        sourcePdfs.set(document.id, sourcePdf);
      } catch (error) {
        throw new PdfExportError('generation-failed', { cause: error });
      }
      loadedCount += 1;
      onProgress?.({
        stage: 'loading',
        current: loadedCount,
        total: requiredDocuments.size,
      });
    }

    for (const [pageIndex, projectPage] of activePages.entries()) {
      checkCancelled(signal);
      const sourceDocument = documentsById.get(projectPage.documentId);
      const sourcePdf = sourcePdfs.get(projectPage.documentId);
      if (!sourceDocument || !sourcePdf) {
        throw new PdfExportError('invalid-project');
      }

      const sourcePageIndex = projectPage.sourcePageNumber - 1;
      if (
        !Number.isSafeInteger(sourcePageIndex) ||
        sourcePageIndex < 0 ||
        sourcePageIndex >= sourcePdf.getPageCount()
      ) {
        throw new PdfExportError('invalid-project');
      }

      const sourcePage = sourcePdf.getPage(sourcePageIndex);
      const sourceCropBox = toPdfBox(sourcePage.getCropBox());
      const cropBox = projectPage.cropBox ?? sourceCropBox;
      if (
        !isValidBox(cropBox) ||
        !isBoxInside(cropBox, sourceCropBox) ||
        !Number.isInteger(projectPage.rotationDeltaDegrees) ||
        projectPage.rotationDeltaDegrees % 90 !== 0
      ) {
        throw new PdfExportError('invalid-project');
      }

      try {
        const [copiedPage] = await outputPdf.copyPages(sourcePdf, [
          sourcePageIndex,
        ]);
        if (!copiedPage) {
          throw new Error('The source page could not be copied.');
        }

        const rotation =
          normalizeRotation(
            sourcePage.getRotation().angle +
              projectPage.rotationDeltaDegrees,
          );
        copiedPage.setRotation(degrees(rotation));
        if (projectPage.cropBox) {
          copiedPage.setCropBox(
            cropBox.xMin,
            cropBox.yMin,
            cropBox.xMax - cropBox.xMin,
            cropBox.yMax - cropBox.yMin,
          );
        }
        outputPdf.addPage(copiedPage);
        expectedGeometry.push({ cropBox, rotation });
      } catch (error) {
        if (error instanceof PdfExportError) {
          throw error;
        }
        throw new PdfExportError('generation-failed', { cause: error });
      }

      onProgress?.({
        stage: 'copying',
        current: pageIndex + 1,
        total: activePages.length,
      });
    }

    checkCancelled(signal);
    onProgress?.({
      stage: 'serializing',
      current: 0,
      total: 1,
    });

    let bytes: Uint8Array;
    try {
      bytes = await outputPdf.save();
    } catch (error) {
      throw new PdfExportError('generation-failed', { cause: error });
    }

    checkCancelled(signal);
    sourcePdfs.clear();
    await validateExportedPdf(bytes, expectedGeometry, signal, onProgress);
    checkCancelled(signal);
    return {
      bytes: copyToArrayBuffer(bytes),
      pageCount: activePages.length,
    };
  } finally {
    sourcePdfs.clear();
  }
}

async function validateExportedPdf(
  bytes: Uint8Array,
  expectedGeometry: readonly ExpectedPageGeometry[],
  signal: AbortSignal,
  onProgress?: (progress: PdfExportProgress) => void,
): Promise<void> {
  let validationSession: PdfDocumentSession | null = null;

  try {
    checkCancelled(signal);
    const { openPdfDocument } = await import('../documents/pdf-import');
    validationSession = await openPdfDocument(
      new File([copyToArrayBuffer(bytes)], 'document-studio-export.pdf', {
        type: 'application/pdf',
      }),
      {
        requestPassword: async () => null,
        confirmFullRead: async () => true,
      },
    );

    if (validationSession.document.numPages !== expectedGeometry.length) {
      throw new PdfExportError('validation-failed');
    }

    for (const [pageIndex, expected] of expectedGeometry.entries()) {
      checkCancelled(signal);
      const page = await validationSession.document.getPage(pageIndex + 1);
      const actualCropBox = page.view;
      const actualRotation = normalizeRotation(page.rotate);
      if (
        actualCropBox.length !== 4 ||
        !actualCropBox.every(Number.isFinite) ||
        !isNear(actualCropBox[0]!, expected.cropBox.xMin) ||
        !isNear(actualCropBox[1]!, expected.cropBox.yMin) ||
        !isNear(actualCropBox[2]!, expected.cropBox.xMax) ||
        !isNear(actualCropBox[3]!, expected.cropBox.yMax) ||
        actualRotation !== expected.rotation
      ) {
        throw new PdfExportError('validation-failed');
      }
      page.cleanup();
      onProgress?.({
        stage: 'validating',
        current: pageIndex + 1,
        total: expectedGeometry.length,
      });
    }
  } catch (error) {
    if (error instanceof PdfExportError) {
      throw error;
    }
    throw new PdfExportError('validation-failed', { cause: error });
  } finally {
    if (validationSession) {
      await validationSession.loadingTask.destroy();
    }
  }
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new PdfExportError('cancelled');
  }
}

function normalizeRotation(rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(normalized)) {
    throw new PdfExportError('invalid-project');
  }
  return normalized;
}

function toPdfBox(box: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): PdfBox {
  return {
    xMin: box.x,
    yMin: box.y,
    xMax: box.x + box.width,
    yMax: box.y + box.height,
  };
}

function isNear(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.01;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

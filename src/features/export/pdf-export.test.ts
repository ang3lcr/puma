import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { ProjectDocument, ProjectPage } from '../../store/project-store';
import {
  estimatePdfExportMemory,
  pdfExportMemoryBudgetBytes,
  PdfExportError,
} from './pdf-export-common';
import { exportProjectPdf } from './pdf-export';

const MiB = 1024 * 1024;

function createDocument(
  overrides: Partial<ProjectDocument> = {},
): ProjectDocument {
  return {
    id: 'source-a',
    file: new File(['source'], 'source-a.pdf', { type: 'application/pdf' }),
    fileName: 'source-a.pdf',
    size: 100,
    lastModified: 0,
    pageCount: 2,
    fingerprint: null,
    metadata: {
      title: null,
      author: null,
      subject: null,
      creator: null,
      producer: null,
      pdfVersion: null,
      creationDate: null,
      modificationDate: null,
      encrypted: false,
      hasForms: false,
      hasSignatures: false,
    },
    ...overrides,
  };
}

function createPage(overrides: Partial<ProjectPage> = {}): ProjectPage {
  return {
    id: 'page-1',
    documentId: 'source-a',
    sourcePageNumber: 1,
    rotationDeltaDegrees: 0,
    cropBox: null,
    duplicatedFromPageId: null,
    isDeleted: false,
    blankAnalysis: null,
    blankReviewDecision: null,
    orientationAnalysis: null,
    ...overrides,
  };
}

describe('estimatePdfExportMemory', () => {
  it('counts each source once and excludes deleted pages', () => {
    const estimate = estimatePdfExportMemory(
      [createDocument()],
      [
        createPage({ id: 'page-1' }),
        createPage({ id: 'page-2', sourcePageNumber: 2 }),
        createPage({ id: 'deleted-page', isDeleted: true }),
      ],
    );

    expect(estimate).toMatchObject({
      pageCount: 2,
      sourceDocumentCount: 1,
      sourceBytes: 100,
      estimatedOutputBytes: 100,
      estimatedPeakBytes: 300 * MiB + 300,
      withinBudget: true,
    });
  });

  it('rejects estimates above the stage memory budget', () => {
    const document = createDocument({
      size: (pdfExportMemoryBudgetBytes - 300 * MiB) / 3 + 1,
      pageCount: 1,
    });

    expect(estimatePdfExportMemory([document], [createPage()]).withinBudget).toBe(
      false,
    );
  });

  it('allows the exact estimated memory budget boundary', () => {
    const document = createDocument({
      size: (pdfExportMemoryBudgetBytes - 300 * MiB) / 3,
      pageCount: 1,
    });

    expect(estimatePdfExportMemory([document], [createPage()])).toMatchObject({
      estimatedPeakBytes: pdfExportMemoryBudgetBytes,
      withinBudget: true,
    });
  });

  it('returns a zero estimate when no pages remain active', () => {
    expect(
      estimatePdfExportMemory(
        [createDocument()],
        [createPage({ isDeleted: true })],
      ),
    ).toMatchObject({
      pageCount: 0,
      sourceDocumentCount: 0,
      sourceBytes: 0,
      estimatedOutputBytes: 0,
      estimatedPeakBytes: 0,
      withinBudget: true,
    });
  });
});

describe('exportProjectPdf preflight', () => {
  it('rejects projects without active pages', async () => {
    await expect(
      exportProjectPdf({
        documents: [createDocument()],
        pages: [createPage({ isDeleted: true })],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'no-pages' });
  });

  it('rejects encrypted and missing source files before generation', async () => {
    const encryptedDocument = createDocument({
      metadata: {
        ...createDocument().metadata,
        encrypted: true,
      },
    });
    const missingDocument = createDocument({ file: null });

    await expect(
      exportProjectPdf({
        documents: [encryptedDocument],
        pages: [createPage()],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'encrypted-source' });
    await expect(
      exportProjectPdf({
        documents: [missingDocument],
        pages: [createPage()],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'missing-source' });
  });

  it('does not continue when cancellation was requested', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportProjectPdf({
        documents: [createDocument()],
        pages: [createPage()],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'cancelled',
    } satisfies Partial<PdfExportError>);
  });

  it('discards generated pages when cancelled during copying', async () => {
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage([612, 792]);
    const sourceBytes = await sourcePdf.save();
    const sourceBuffer = new ArrayBuffer(sourceBytes.byteLength);
    new Uint8Array(sourceBuffer).set(sourceBytes);
    const sourceFile = new File([sourceBuffer], 'source.pdf', {
      type: 'application/pdf',
    });
    const document = createDocument({
      file: sourceFile,
      size: sourceFile.size,
      pageCount: 1,
    });
    const controller = new AbortController();

    await expect(
      exportProjectPdf({
        documents: [document],
        pages: [createPage()],
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.stage === 'copying') {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { ProjectDocument, ProjectPage } from '../../store/project-store';
import {
  estimatePdfExportMemory,
  pdfExportMemoryBudgetBytes,
  PdfExportError,
  planPdfExportParts,
} from './pdf-export-common';
import { exportProjectPdf, exportProjectPdfParts } from './pdf-export';

vi.mock('../documents/pdf-import', async () => {
  const { PDFDocument } = await import('pdf-lib');
  return {
    openPdfDocument: async (file: File) => {
      const pdf = await PDFDocument.load(await file.arrayBuffer());
      return {
        document: {
          numPages: pdf.getPageCount(),
          getPage: async (number: number) => {
            const page = pdf.getPage(number - 1);
            const box = page.getCropBox();
            return { view: [box.x, box.y, box.x + box.width, box.y + box.height], rotate: page.getRotation().angle, cleanup() {} };
          },
        },
        loadingTask: { destroy: async () => {} },
      };
    },
  };
});

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

describe('planPdfExportParts', () => {
  it('keeps contiguous global order and excludes deleted pages', () => {
    const first = createDocument({ size: 300 * MiB, pageCount: 1 });
    const second = createDocument({ id: 'source-b', size: 300 * MiB, pageCount: 1 });
    const pages = [
      createPage({ id: 'one' }),
      createPage({ id: 'removed', isDeleted: true }),
      createPage({ id: 'two', documentId: 'source-b' }),
      createPage({ id: 'three' }),
    ];
    const plan = planPdfExportParts([first, second], pages);
    expect(plan.map((part) => part.pageIds)).toEqual([['one'], ['two'], ['three']]);
    expect(plan.map((part) => [part.firstPage, part.lastPage])).toEqual([[1, 1], [2, 2], [3, 3]]);
    expect(plan.every((part) => part.estimate.withinBudget)).toBe(true);
  });

  it('rejects a single page that cannot fit the heuristic budget', () => {
    const document = createDocument({ size: pdfExportMemoryBudgetBytes, pageCount: 1 });
    expect(() => planPdfExportParts([document], [createPage()])).toThrowError(
      expect.objectContaining({ code: 'memory-budget' }),
    );
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

describe('exportProjectPdfParts', () => {
  it('generates and validates each ordered part with crop and rotation before yielding', async () => {
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage([612, 792]);
    const sourceBytes = await sourcePdf.save();
    const fileA = new File([sourceBytes.slice().buffer as ArrayBuffer], 'a.pdf', { type: 'application/pdf' });
    const fileB = new File([sourceBytes.slice().buffer as ArrayBuffer], 'b.pdf', { type: 'application/pdf' });
    const docs = [
      createDocument({ id: 'source-a', file: fileA, size: 300 * MiB, pageCount: 1 }),
      createDocument({ id: 'source-b', file: fileB, fileName: 'b.pdf', size: 300 * MiB, pageCount: 1 }),
    ];
    const pages = [
      createPage({ id: 'first', documentId: 'source-a', cropBox: { xMin: 10, yMin: 20, xMax: 500, yMax: 700 }, rotationDeltaDegrees: 90 }),
      createPage({ id: 'second', documentId: 'source-b' }),
    ];
    const parts = [];
    for await (const part of exportProjectPdfParts({ documents: docs, pages, signal: new AbortController().signal })) {
      parts.push(part);
    }
    expect(parts.map(({ index, total, firstPage, lastPage }) => [index, total, firstPage, lastPage])).toEqual([
      [1, 2, 1, 1], [2, 2, 2, 2],
    ]);
    for (const [index, part] of parts.entries()) {
      const reopened = await PDFDocument.load(part.result.bytes);
      expect(reopened.getPageCount()).toBe(1);
      if (index === 0) {
        expect(reopened.getPage(0).getRotation().angle).toBe(90);
        expect(reopened.getPage(0).getCropBox()).toMatchObject({ x: 10, y: 20, width: 490, height: 680 });
      }
    }
  });

  it('stops before the next part on cancellation and can be retried with a fresh signal', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const bytes = await pdf.save();
    const docs = [
      createDocument({ id: 'source-a', file: new File([bytes.slice().buffer as ArrayBuffer], 'a.pdf'), size: 300 * MiB, pageCount: 1 }),
      createDocument({ id: 'source-b', file: new File([bytes.slice().buffer as ArrayBuffer], 'b.pdf'), size: 300 * MiB, pageCount: 1 }),
    ];
    const pages = [createPage({ id: 'a' }), createPage({ id: 'b', documentId: 'source-b' })];
    const controller = new AbortController();
    const generator = exportProjectPdfParts({ documents: docs, pages, signal: controller.signal });
    expect((await generator.next()).done).toBe(false);
    controller.abort();
    await expect(generator.next()).rejects.toMatchObject({ code: 'cancelled' });
    const retry = [];
    for await (const part of exportProjectPdfParts({ documents: docs, pages, signal: new AbortController().signal })) retry.push(part);
    expect(retry).toHaveLength(2);
  });

  it('reports a later source failure without yielding that incomplete part and permits retry', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 100]);
    const bytes = await pdf.save();
    const docs = [
      createDocument({ id: 'source-a', file: new File([bytes.slice().buffer as ArrayBuffer], 'a.pdf'), size: 300 * MiB, pageCount: 1 }),
      createDocument({ id: 'source-b', file: new File(['invalid'], 'b.pdf'), size: 300 * MiB, pageCount: 1 }),
    ];
    const pages = [createPage({ id: 'a' }), createPage({ id: 'b', documentId: 'source-b' })];
    const generator = exportProjectPdfParts({ documents: docs, pages, signal: new AbortController().signal });
    expect((await generator.next()).value?.index).toBe(1);
    await expect(generator.next()).rejects.toMatchObject({ code: 'generation-failed' });
    docs[1] = { ...docs[1]!, file: new File([bytes.slice().buffer as ArrayBuffer], 'b.pdf') };
    const retry = [];
    for await (const part of exportProjectPdfParts({ documents: docs, pages, signal: new AbortController().signal }, 2)) retry.push(part);
    expect(retry.map((part) => part.index)).toEqual([2]);
  });
});

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageRenderQueue } from '../../pdf/page-render-queue';
import type { ProjectPage } from '../../store/project-store';
import { analyzeDocumentPages } from './analyze-document';

class TestWorker {
  terminate = vi.fn();
  postMessage = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

const projectPage: ProjectPage = {
  id: 'document-1:page:1',
  documentId: 'document-1',
  sourcePageNumber: 1,
  rotationDeltaDegrees: 0,
  cropBox: null,
  duplicatedFromPageId: null,
  blankAnalysis: null,
  blankReviewDecision: null,
  orientationAnalysis: null,
  isDeleted: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeDocumentPages', () => {
  it('routes pages with annotations to review without rasterizing them', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const page = {
      getAnnotations: vi.fn().mockResolvedValue([{ subtype: 'Link' }]),
      cleanup: vi.fn(),
    };
    const renderQueue = {
      enqueue: vi.fn(),
    } as unknown as PageRenderQueue;
    const onPageAnalysis = vi.fn();

    await analyzeDocumentPages({
      document: { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy,
      pages: [projectPage],
      renderQueue,
      signal: new AbortController().signal,
      onPageAnalysis,
      onProgress: vi.fn(),
    });

    expect(onPageAnalysis).toHaveBeenCalledWith(projectPage.id, {
      status: 'needs-review',
      reason: 'annotation-present',
      confidence: null,
      foregroundPixelCount: null,
      foregroundPixelRatio: null,
    });
    expect(renderQueue.enqueue).not.toHaveBeenCalled();
    expect(page.cleanup).toHaveBeenCalledOnce();
  });

  it('stops after cancellation while annotations are being read', async () => {
    vi.stubGlobal('Worker', TestWorker);
    let resolveAnnotations: ((value: never[]) => void) | undefined;
    const annotations = new Promise<never[]>((resolve) => {
      resolveAnnotations = resolve;
    });
    const page = {
      getAnnotations: vi.fn(() => annotations),
      cleanup: vi.fn(),
    };
    const controller = new AbortController();
    const onPageAnalysis = vi.fn();

    const result = analyzeDocumentPages({
      document: {
        getPage: vi.fn().mockResolvedValue(page),
      } as unknown as PDFDocumentProxy,
      pages: [projectPage],
      renderQueue: { enqueue: vi.fn() } as unknown as PageRenderQueue,
      signal: controller.signal,
      onPageAnalysis,
      onProgress: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(page.getAnnotations).toHaveBeenCalledOnce();
    });
    controller.abort();
    resolveAnnotations?.([]);

    await expect(result).resolves.toBe('cancelled');
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(onPageAnalysis).not.toHaveBeenCalled();
  });
});

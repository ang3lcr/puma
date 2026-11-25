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
  duplicatedFromPageId: null,
  blankAnalysis: null,
  blankReviewDecision: null,
  isDeleted: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeDocumentPages', () => {
  it('routes pages with annotations to review without rasterizing them', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const page = {
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
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

  it('stops after cancellation while text content is being read', async () => {
    vi.stubGlobal('Worker', TestWorker);
    let resolveText: ((value: { items: never[] }) => void) | undefined;
    const textContent = new Promise<{ items: never[] }>((resolve) => {
      resolveText = resolve;
    });
    const page = {
      getTextContent: vi.fn(() => textContent),
      getAnnotations: vi.fn(),
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
      expect(page.getTextContent).toHaveBeenCalledOnce();
    });
    controller.abort();
    resolveText?.({ items: [] });

    await expect(result).resolves.toBe('cancelled');
    expect(page.getAnnotations).not.toHaveBeenCalled();
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(onPageAnalysis).not.toHaveBeenCalled();
  });
});

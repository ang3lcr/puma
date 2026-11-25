import type { PDFDocumentProxy } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectPage } from '../../store/project-store';
import { analyzeDocumentOrientation } from './analyze-document-orientation';

const projectPage: ProjectPage = {
  id: 'document-1:page:1',
  documentId: 'document-1',
  sourcePageNumber: 1,
  rotationDeltaDegrees: 0,
  cropBox: null,
  duplicatedFromPageId: null,
  isDeleted: false,
  blankAnalysis: null,
  blankReviewDecision: null,
  orientationAnalysis: null,
};

describe('analyzeDocumentOrientation', () => {
  it('records page-level text orientation results and progress', async () => {
    const page = {
      rotate: 0,
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          {
            str: 'Digital text that is long enough to analyze.',
            dir: 'ltr',
            transform: [0, 18, -18, 0, 72, 72],
          },
        ],
      }),
      cleanup: vi.fn(),
    };
    const onPageAnalysis = vi.fn();
    const onProgress = vi.fn();

    await analyzeDocumentOrientation({
      document: {
        getPage: vi.fn().mockResolvedValue(page),
      } as unknown as PDFDocumentProxy,
      pages: [projectPage],
      signal: new AbortController().signal,
      onPageAnalysis,
      onProgress,
    });

    expect(onPageAnalysis).toHaveBeenCalledWith(projectPage.id, {
      status: 'suggestion',
      reason: 'digital-text-direction',
      targetRotationDeltaDegrees: 90,
    });
    expect(onProgress).toHaveBeenCalledWith({ completed: 1, total: 1 });
    expect(page.cleanup).toHaveBeenCalledOnce();
  });

  it('stops after cancellation while reading a page text layer', async () => {
    let resolveText: ((value: { items: [] }) => void) | undefined;
    const textContent = new Promise<{ items: [] }>((resolve) => {
      resolveText = resolve;
    });
    const page = {
      rotate: 0,
      getTextContent: vi.fn(() => textContent),
      cleanup: vi.fn(),
    };
    const controller = new AbortController();
    const onPageAnalysis = vi.fn();

    const result = analyzeDocumentOrientation({
      document: {
        getPage: vi.fn().mockResolvedValue(page),
      } as unknown as PDFDocumentProxy,
      pages: [projectPage],
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
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(onPageAnalysis).not.toHaveBeenCalled();
  });
});

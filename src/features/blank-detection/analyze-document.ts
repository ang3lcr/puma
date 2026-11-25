import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PageRenderQueue } from '../../pdf/page-render-queue';
import type { ProjectPage } from '../../store/project-store';
import { classifyPagePixels } from './classify-page-pixels';
import type { BlankPageAnalysis } from './types';

const sampleCanvasDimension = 256;

export interface BlankDetectionProgress {
  completed: number;
  total: number;
}

interface AnalyzeDocumentOptions {
  document: PDFDocumentProxy;
  pages: readonly ProjectPage[];
  renderQueue: PageRenderQueue;
  signal: AbortSignal;
  onPageAnalysis: (pageId: string, analysis: BlankPageAnalysis) => void;
  onProgress: (progress: BlankDetectionProgress) => void;
}

export async function analyzeDocumentPages({
  document,
  pages,
  renderQueue,
  signal,
  onPageAnalysis,
  onProgress,
}: AnalyzeDocumentOptions): Promise<'completed' | 'cancelled'> {
  if (signal.aborted) {
    return 'cancelled';
  }
  if (pages.length === 0) {
    return 'completed';
  }

  const worker = new Worker(
    new URL('./blank-detection.worker.ts', import.meta.url),
    { type: 'module' },
  );
  try {
    for (let index = 0; index < pages.length; index += 1) {
      if (signal.aborted) {
        return 'cancelled';
      }
      const projectPage = pages[index];
      if (!projectPage) {
        throw new Error(`Blank detection page at index ${index} is missing.`);
      }

      let analysis: BlankPageAnalysis;
      try {
        analysis = await analyzePage(
          document,
          projectPage,
          renderQueue,
          worker,
          signal,
        );
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          return 'cancelled';
        }
        console.error(
          `Unable to analyze project page "${projectPage.id}".`,
          error,
        );
        analysis = {
          status: 'needs-review',
          reason: 'analysis-error',
          confidence: null,
          foregroundPixelCount: null,
          foregroundPixelRatio: null,
        };
      }

      if (signal.aborted) {
        return 'cancelled';
      }
      onPageAnalysis(projectPage.id, analysis);
      onProgress({ completed: index + 1, total: pages.length });
    }

    return 'completed';
  } finally {
    worker.terminate();
  }
}

async function analyzePage(
  document: PDFDocumentProxy,
  projectPage: ProjectPage,
  renderQueue: PageRenderQueue,
  worker: Worker,
  signal: AbortSignal,
): Promise<BlankPageAnalysis> {
  throwIfAborted(signal);
  const page = await document.getPage(projectPage.sourcePageNumber);
  try {
    throwIfAborted(signal);
    const annotations = await page.getAnnotations();
    throwIfAborted(signal);
    if (annotations.length > 0) {
      return {
        status: 'needs-review',
        reason: 'annotation-present',
        confidence: null,
        foregroundPixelCount: null,
        foregroundPixelRatio: null,
      };
    }

    const imageData = await renderPageSample(page, renderQueue, signal);
    return classifyPagePixels(worker, imageData, signal);
  } finally {
    page.cleanup();
  }
}

async function renderPageSample(
  page: PDFPageProxy,
  renderQueue: PageRenderQueue,
  signal: AbortSignal,
): Promise<ImageData> {
  let imageData: ImageData | null = null;
  const renderHandle = renderQueue.enqueue({
    priority: 'analysis',
    run: async (queueSignal) => {
      throwIfAborted(signal);
      if (queueSignal.aborted) {
        throw createAbortError();
      }

      const baseViewport = page.getViewport({
        scale: 1,
        rotation: page.rotate,
      });
      if (
        !Number.isFinite(baseViewport.width) ||
        !Number.isFinite(baseViewport.height) ||
        baseViewport.width <= 0 ||
        baseViewport.height <= 0
      ) {
        throw new Error('The PDF page has invalid dimensions.');
      }
      const scale = Math.min(
        sampleCanvasDimension / baseViewport.width,
        sampleCanvasDimension / baseViewport.height,
        1,
      );
      const viewport = page.getViewport({ scale, rotation: page.rotate });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));

      try {
        const context = canvas.getContext('2d', {
          alpha: false,
          willReadFrequently: true,
        });
        if (!context) {
          throw new Error('Canvas 2D context is unavailable.');
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          background: '#ffffff',
        });
        const cancelRender = (): void => renderTask.cancel();
        queueSignal.addEventListener('abort', cancelRender, { once: true });
        signal.addEventListener('abort', cancelRender, { once: true });
        if (queueSignal.aborted || signal.aborted) {
          cancelRender();
        }
        try {
          await renderTask.promise;
          throwIfAborted(signal);
          if (queueSignal.aborted) {
            throw createAbortError();
          }
          imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        } finally {
          queueSignal.removeEventListener('abort', cancelRender);
          signal.removeEventListener('abort', cancelRender);
        }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  });
  const cancelRender = (): void => renderHandle.cancel();
  signal.addEventListener('abort', cancelRender, { once: true });
  try {
    await renderHandle.promise;
    throwIfAborted(signal);
  } finally {
    signal.removeEventListener('abort', cancelRender);
  }

  if (!imageData) {
    throw new Error('PDF page rendering did not produce image data.');
  }
  return imageData;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error('Blank detection was cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

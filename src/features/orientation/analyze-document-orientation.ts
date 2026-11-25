import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ProjectPage } from '../../store/project-store';
import { analyzeTextOrientation } from './analyze-text-orientation';
import type { OrientationAnalysis, OrientationTextRun } from './types';

export interface OrientationAnalysisProgress {
  completed: number;
  total: number;
}

interface AnalyzeDocumentOrientationOptions {
  document: PDFDocumentProxy;
  pages: readonly ProjectPage[];
  signal: AbortSignal;
  onPageAnalysis: (pageId: string, analysis: OrientationAnalysis) => void;
  onProgress: (progress: OrientationAnalysisProgress) => void;
}

export async function analyzeDocumentOrientation({
  document,
  pages,
  signal,
  onPageAnalysis,
  onProgress,
}: AnalyzeDocumentOrientationOptions): Promise<'completed' | 'cancelled'> {
  if (signal.aborted) {
    return 'cancelled';
  }
  if (pages.length === 0) {
    return 'completed';
  }

  for (let index = 0; index < pages.length; index += 1) {
    if (signal.aborted) {
      return 'cancelled';
    }
    const projectPage = pages[index];
    if (!projectPage) {
      throw new Error(`Orientation analysis page at index ${index} is missing.`);
    }

    let analysis: OrientationAnalysis;
    try {
      const page = await document.getPage(projectPage.sourcePageNumber);
      try {
        if (signal.aborted) {
          return 'cancelled';
        }
        const textContent = await page.getTextContent();
        if (signal.aborted) {
          return 'cancelled';
        }
        const textRuns = getOrientationTextRuns(textContent.items);
        analysis = analyzeTextOrientation(textRuns, page.rotate);
      } finally {
        page.cleanup();
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return 'cancelled';
      }
      console.error(
        `Unable to analyze orientation for project page "${projectPage.id}".`,
        error,
      );
      analysis = {
        status: 'needs-review',
        reason: 'analysis-error',
        targetRotationDeltaDegrees: null,
      };
    }

    if (signal.aborted) {
      return 'cancelled';
    }
    onPageAnalysis(projectPage.id, analysis);
    onProgress({ completed: index + 1, total: pages.length });
  }

  return 'completed';
}

function getOrientationTextRuns(
  items: readonly unknown[],
): OrientationTextRun[] {
  return items.flatMap((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('str' in item) ||
      !('dir' in item) ||
      !('transform' in item) ||
      typeof item.str !== 'string' ||
      typeof item.dir !== 'string' ||
      !Array.isArray(item.transform) ||
      !isFiniteNumberArray(item.transform)
    ) {
      return [];
    }

    return [{
      text: item.str,
      direction: item.dir,
      transform: item.transform,
    }];
  });
}

function isFiniteNumberArray(value: unknown[]): value is number[] {
  return value.every(
    (item) => typeof item === 'number' && Number.isFinite(item),
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

import { es } from '../../i18n/es';
import type {
  BlankPageAnalysis,
  BlankPageReviewDecision,
} from './types';

export function getBlankPageStatusLabel(
  analysis: BlankPageAnalysis | null,
  decision: BlankPageReviewDecision | null,
): string | null {
  if (decision === 'confirmed-blank') {
    return es.blankDetection.confirmed;
  }
  if (decision === 'keep') {
    return es.blankDetection.kept;
  }
  if (!analysis) {
    return null;
  }

  switch (analysis.status) {
    case 'likely-blank':
      return es.blankDetection.possibleBlank;
    case 'content-detected':
      return es.blankDetection.contentDetected;
    case 'needs-review':
      return es.blankDetection.needsReview;
    default:
      return assertNever(analysis.status);
  }
}

export function getBlankPageReasonLabel(
  analysis: BlankPageAnalysis,
): string {
  switch (analysis.reason) {
    case 'annotation-present':
      return es.blankDetection.annotationReason;
    case 'no-visible-content':
      return es.blankDetection.whiteReason;
    case 'visible-content':
      return es.blankDetection.pixelReason;
    case 'sparse-content':
      return es.blankDetection.sparseReason;
    case 'ambiguous-background':
      return es.blankDetection.ambiguousBackgroundReason;
    case 'analysis-error':
      return es.blankDetection.errorReason;
    default:
      return assertNever(analysis.reason);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported blank-detection value: ${value}`);
}

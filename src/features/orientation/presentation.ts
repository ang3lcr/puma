import { es } from '../../i18n/es';
import type { OrientationAnalysis } from './types';

export function getOrientationStatusLabel(
  analysis: OrientationAnalysis | null,
  currentRotationDeltaDegrees: number,
): string | null {
  if (!analysis) {
    return null;
  }
  if (analysis.status === 'needs-review') {
    return es.orientation.needsReview;
  }
  if (
    analysis.targetRotationDeltaDegrees === currentRotationDeltaDegrees
  ) {
    return analysis.targetRotationDeltaDegrees === 0
      ? es.orientation.aligned
      : es.orientation.correctionApplied;
  }

  const delta =
    (analysis.targetRotationDeltaDegrees -
      currentRotationDeltaDegrees +
      360) %
    360;
  return `${es.orientation.suggestion}: ${describeRotation(delta)}.`;
}

export function getOrientationReasonLabel(
  analysis: OrientationAnalysis,
): string {
  const reason = analysis.reason;
  switch (reason) {
    case 'digital-text-direction':
      return es.orientation.reasons.digitalText;
    case 'no-digital-text':
      return es.orientation.reasons.noText;
    case 'insufficient-text':
      return es.orientation.reasons.insufficientText;
    case 'mixed-directions':
      return es.orientation.reasons.mixedDirections;
    case 'non-cardinal-direction':
      return es.orientation.reasons.nonCardinal;
    case 'vertical-writing':
      return es.orientation.reasons.verticalWriting;
    case 'analysis-error':
      return es.orientation.reasons.analysisError;
    default:
      return assertNever(reason);
  }
}

function describeRotation(degrees: number): string {
  switch (degrees) {
    case 90:
      return '90° a la derecha';
    case 180:
      return '180°';
    case 270:
      return '90° a la izquierda';
    default:
      throw new Error(`Unsupported orientation rotation: ${degrees}`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported orientation reason: ${value}`);
}

import type {
  OrientationAnalysis,
  OrientationTextRun,
} from './types';

const minimumTextCharacters = 16;
const dominantTextRatio = 0.9;
const maximumCardinalDeviationDegrees = 8;

export function analyzeTextOrientation(
  textRuns: readonly OrientationTextRun[],
  pageRotation: number,
): OrientationAnalysis {
  if (!isRightAngleRotation(pageRotation)) {
    throw new Error('Orientation analysis requires a right-angle page rotation.');
  }

  const orientations = new Map<number, number>();
  let totalCharacters = 0;
  let hasVerticalWriting = false;

  for (const run of textRuns) {
    const characterCount = run.text.trim().length;
    if (characterCount === 0) {
      continue;
    }
    if (run.direction === 'ttb') {
      hasVerticalWriting = true;
      continue;
    }

    const horizontal = run.transform[0];
    const vertical = run.transform[1];
    if (
      typeof horizontal !== 'number' ||
      typeof vertical !== 'number' ||
      !Number.isFinite(horizontal) ||
      !Number.isFinite(vertical) ||
      (horizontal === 0 && vertical === 0)
    ) {
      continue;
    }

    const angle = normalizeDegrees(
      (Math.atan2(vertical, horizontal) * 180) / Math.PI,
    );
    const cardinalAngle = normalizeDegrees(
      Math.round(angle / 90) * 90,
    );
    if (
      angularDistance(angle, cardinalAngle) >
      maximumCardinalDeviationDegrees
    ) {
      return needsReview('non-cardinal-direction');
    }

    orientations.set(
      cardinalAngle,
      (orientations.get(cardinalAngle) ?? 0) + characterCount,
    );
    totalCharacters += characterCount;
  }

  if (hasVerticalWriting) {
    return needsReview('vertical-writing');
  }
  if (totalCharacters === 0) {
    return needsReview('no-digital-text');
  }
  if (totalCharacters < minimumTextCharacters) {
    return needsReview('insufficient-text');
  }

  const dominant = [...orientations.entries()].sort(
    ([leftAngle, leftWeight], [rightAngle, rightWeight]) =>
      rightWeight - leftWeight || leftAngle - rightAngle,
  )[0];
  if (!dominant) {
    return needsReview('no-digital-text');
  }

  const [textRotation, dominantCharacters] = dominant;
  if (dominantCharacters / totalCharacters < dominantTextRatio) {
    return needsReview('mixed-directions');
  }

  return {
    status: 'suggestion',
    reason: 'digital-text-direction',
    targetRotationDeltaDegrees: normalizeDegrees(
      textRotation - pageRotation,
    ),
  };
}

function isRightAngleRotation(rotation: number): boolean {
  return (
    Number.isSafeInteger(rotation) &&
    rotation >= 0 &&
    rotation < 360 &&
    rotation % 90 === 0
  );
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function angularDistance(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function needsReview(
  reason: Exclude<OrientationAnalysis['reason'], 'digital-text-direction'>,
): OrientationAnalysis {
  return {
    status: 'needs-review',
    reason,
    targetRotationDeltaDegrees: null,
  };
}

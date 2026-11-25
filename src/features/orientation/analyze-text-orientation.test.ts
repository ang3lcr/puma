import { describe, expect, it } from 'vitest';
import { analyzeTextOrientation } from './analyze-text-orientation';
import type { OrientationTextRun } from './types';

describe('analyzeTextOrientation', () => {
  it.each([
    { angle: 0, pageRotation: 0, targetRotation: 0 },
    { angle: 90, pageRotation: 0, targetRotation: 90 },
    { angle: 180, pageRotation: 0, targetRotation: 180 },
    { angle: 270, pageRotation: 0, targetRotation: 270 },
    { angle: 0, pageRotation: 90, targetRotation: 270 },
    { angle: 90, pageRotation: 90, targetRotation: 0 },
  ])(
    'suggests a $targetRotation degree project rotation for text at $angle degrees with page rotation $pageRotation',
    ({ angle, pageRotation, targetRotation }) => {
      expect(
        analyzeTextOrientation([createTextRun('Readable digital text.', angle)], pageRotation),
      ).toEqual({
        status: 'suggestion',
        reason: 'digital-text-direction',
        targetRotationDeltaDegrees: targetRotation,
      });
    },
  );

  it('requires review when digital text directions disagree', () => {
    expect(
      analyzeTextOrientation(
        [
          createTextRun('A sufficiently long line of horizontal text.', 0),
          createTextRun('A different line rotated upside down.', 180),
        ],
        0,
      ),
    ).toEqual({
      status: 'needs-review',
      reason: 'mixed-directions',
      targetRotationDeltaDegrees: null,
    });
  });

  it('requires manual review when text is absent, sparse, vertical, or skewed', () => {
    expect(analyzeTextOrientation([], 0)).toMatchObject({
      status: 'needs-review',
      reason: 'no-digital-text',
    });
    expect(
      analyzeTextOrientation([createTextRun('Short text', 0)], 0),
    ).toMatchObject({
      status: 'needs-review',
      reason: 'insufficient-text',
    });
    expect(
      analyzeTextOrientation(
        [{ ...createTextRun('Vertical writing should not be guessed.', 0), direction: 'ttb' }],
        0,
      ),
    ).toMatchObject({
      status: 'needs-review',
      reason: 'vertical-writing',
    });
    expect(
      analyzeTextOrientation([createTextRun('Skewed text needs inspection.', 15)], 0),
    ).toMatchObject({
      status: 'needs-review',
      reason: 'non-cardinal-direction',
    });
  });

  it('rejects invalid page rotation', () => {
    expect(() => analyzeTextOrientation([], 45)).toThrow(
      'Orientation analysis requires a right-angle page rotation.',
    );
  });
});

function createTextRun(text: string, angle: number): OrientationTextRun {
  const radians = (angle * Math.PI) / 180;
  return {
    text,
    direction: 'ltr',
    transform: [Math.cos(radians), Math.sin(radians), 0, 1, 0, 0],
  };
}

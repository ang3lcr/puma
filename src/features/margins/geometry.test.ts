import { describe, expect, it } from 'vitest';
import {
  createCropBoxFromMargins,
  getPageMarginsMm,
  readPdfBox,
} from './geometry';
import type { PageMarginsMm, PdfBox } from './types';

const viewBox: PdfBox = {
  xMin: 10,
  yMin: 20,
  xMax: 622,
  yMax: 812,
};
const margins: PageMarginsMm = {
  top: 12.3,
  right: 4.7,
  bottom: 9,
  left: 16.5,
};

describe('CropBox geometry', () => {
  it('converts displayed millimeter margins with UserUnit and non-zero page origins', () => {
    const result = createCropBoxFromMargins(
      viewBox,
      2,
      0,
      { top: 25.4, right: 0, bottom: 0, left: 0 },
    );

    expect(result).toEqual({
      ok: true,
      cropBox: {
        xMin: 10,
        yMin: 20,
        xMax: 622,
        yMax: 776,
      },
    });
  });

  it.each([0, 90, 180, 270])(
    'round-trips margins for %i degree rotation',
    (rotation) => {
      const result = createCropBoxFromMargins(
        viewBox,
        1.5,
        rotation,
        margins,
      );
      expect(result.ok).toBe(true);
      if (!result.ok || !result.cropBox) {
        throw new Error('Expected a valid CropBox.');
      }

      const readBack = getPageMarginsMm(
        viewBox,
        result.cropBox,
        1.5,
        rotation,
      );
      expect(readBack.top).toBeCloseTo(margins.top, 8);
      expect(readBack.right).toBeCloseTo(margins.right, 8);
      expect(readBack.bottom).toBeCloseTo(margins.bottom, 8);
      expect(readBack.left).toBeCloseTo(margins.left, 8);
    },
  );

  it('uses the original visible box when no CropBox adjustment exists', () => {
    expect(getPageMarginsMm(viewBox, null, 1, 0)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(
      createCropBoxFromMargins(viewBox, 1, 90, {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }),
    ).toEqual({ ok: true, cropBox: null });
  });

  it('rejects invalid margins, invalid geometry, and a zero-area crop', () => {
    expect(
      createCropBoxFromMargins(viewBox, 1, 0, {
        ...margins,
        left: -1,
      }),
    ).toEqual({ ok: false, reason: 'invalid-margins' });
    expect(
      createCropBoxFromMargins(viewBox, 0, 0, margins),
    ).toEqual({ ok: false, reason: 'invalid-geometry' });
    expect(
      createCropBoxFromMargins(viewBox, 1, 0, {
        top: 0,
        right: 110,
        bottom: 0,
        left: 110,
      }),
    ).toEqual({ ok: false, reason: 'crop-too-small' });
  });

  it('rejects invalid PDF view boxes', () => {
    expect(() => readPdfBox([0, 0, 0, 10])).toThrow(
      'The PDF page has invalid visible bounds.',
    );
    expect(() => readPdfBox([0, 0, 10])).toThrow(
      'The PDF page has invalid visible bounds.',
    );
  });
});

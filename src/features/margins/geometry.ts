import type {
  CropBoxResult,
  PageMarginsMm,
  PdfBox,
} from './types';

const pointsPerInch = 72;
const millimetersPerInch = 25.4;

export function readPdfBox(values: readonly number[]): PdfBox {
  if (
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[0] === undefined ||
    values[1] === undefined ||
    values[2] === undefined ||
    values[3] === undefined
  ) {
    throw new Error('The PDF page has invalid visible bounds.');
  }
  const [xMin, yMin, xMax, yMax] = values;
  if (xMax <= xMin || yMax <= yMin) {
    throw new Error('The PDF page has invalid visible bounds.');
  }
  return { xMin, yMin, xMax, yMax };
}

export function getPageMarginsMm(
  viewBox: PdfBox,
  cropBox: PdfBox | null,
  userUnit: number,
  rotation: number,
): PageMarginsMm {
  if (!isValidGeometry(viewBox, userUnit) || !isValidRotation(rotation)) {
    throw new Error('The PDF page has invalid crop geometry.');
  }
  if (cropBox === null) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (!isBoxInside(cropBox, viewBox)) {
    throw new Error('The CropBox must remain inside the original visible page.');
  }

  const millimetersPerPdfUnit =
    (userUnit * millimetersPerInch) / pointsPerInch;
  const pdfMargins = {
    left: (cropBox.xMin - viewBox.xMin) * millimetersPerPdfUnit,
    right: (viewBox.xMax - cropBox.xMax) * millimetersPerPdfUnit,
    bottom: (cropBox.yMin - viewBox.yMin) * millimetersPerPdfUnit,
    top: (viewBox.yMax - cropBox.yMax) * millimetersPerPdfUnit,
  };

  // Convert PDF-space edges back to the screen-oriented sides used by the editor.
  switch (normalizeRotation(rotation)) {
    case 0:
      return {
        top: pdfMargins.top,
        right: pdfMargins.right,
        bottom: pdfMargins.bottom,
        left: pdfMargins.left,
      };
    case 90:
      return {
        top: pdfMargins.left,
        right: pdfMargins.top,
        bottom: pdfMargins.right,
        left: pdfMargins.bottom,
      };
    case 180:
      return {
        top: pdfMargins.bottom,
        right: pdfMargins.left,
        bottom: pdfMargins.top,
        left: pdfMargins.right,
      };
    case 270:
      return {
        top: pdfMargins.right,
        right: pdfMargins.bottom,
        bottom: pdfMargins.left,
        left: pdfMargins.top,
      };
    default:
      throw new Error('Unsupported page rotation.');
  }
}

export function createCropBoxFromMargins(
  viewBox: PdfBox,
  userUnit: number,
  rotation: number,
  margins: PageMarginsMm,
): CropBoxResult {
  if (!isValidGeometry(viewBox, userUnit) || !isValidRotation(rotation)) {
    return { ok: false, reason: 'invalid-geometry' };
  }
  if (
    ![margins.top, margins.right, margins.bottom, margins.left].every(
      (margin) => Number.isFinite(margin) && margin >= 0,
    )
  ) {
    return { ok: false, reason: 'invalid-margins' };
  }
  if (
    margins.top === 0 &&
    margins.right === 0 &&
    margins.bottom === 0 &&
    margins.left === 0
  ) {
    return { ok: true, cropBox: null };
  }

  const pdfMargins = getPdfMarginsForRotation(margins, rotation);
  const pdfUnitsPerMillimeter =
    pointsPerInch / (userUnit * millimetersPerInch);
  const cropBox: PdfBox = {
    xMin: viewBox.xMin + pdfMargins.left * pdfUnitsPerMillimeter,
    yMin: viewBox.yMin + pdfMargins.bottom * pdfUnitsPerMillimeter,
    xMax: viewBox.xMax - pdfMargins.right * pdfUnitsPerMillimeter,
    yMax: viewBox.yMax - pdfMargins.top * pdfUnitsPerMillimeter,
  };

  if (cropBox.xMax <= cropBox.xMin || cropBox.yMax <= cropBox.yMin) {
    return { ok: false, reason: 'crop-too-small' };
  }
  if (!isBoxInside(cropBox, viewBox)) {
    return { ok: false, reason: 'crop-too-small' };
  }

  return { ok: true, cropBox };
}

export function isBoxInside(inner: PdfBox, outer: PdfBox): boolean {
  return (
    isValidBox(inner) &&
    isValidBox(outer) &&
    inner.xMin >= outer.xMin &&
    inner.yMin >= outer.yMin &&
    inner.xMax <= outer.xMax &&
    inner.yMax <= outer.yMax
  );
}

export function isValidBox(value: PdfBox): boolean {
  return (
    Number.isFinite(value.xMin) &&
    Number.isFinite(value.yMin) &&
    Number.isFinite(value.xMax) &&
    Number.isFinite(value.yMax) &&
    value.xMax > value.xMin &&
    value.yMax > value.yMin
  );
}

function getPdfMarginsForRotation(
  margins: PageMarginsMm,
  rotation: number,
): { left: number; right: number; bottom: number; top: number } {
  switch (normalizeRotation(rotation)) {
    case 0:
      return {
        left: margins.left,
        right: margins.right,
        bottom: margins.bottom,
        top: margins.top,
      };
    case 90:
      return {
        left: margins.top,
        right: margins.bottom,
        bottom: margins.left,
        top: margins.right,
      };
    case 180:
      return {
        left: margins.right,
        right: margins.left,
        bottom: margins.top,
        top: margins.bottom,
      };
    case 270:
      return {
        left: margins.bottom,
        right: margins.top,
        bottom: margins.right,
        top: margins.left,
      };
    default:
      throw new Error('Unsupported page rotation.');
  }
}

function isValidGeometry(viewBox: PdfBox, userUnit: number): boolean {
  return (
    isValidBox(viewBox) &&
    Number.isFinite(userUnit) &&
    userUnit > 0
  );
}

function isValidRotation(rotation: number): boolean {
  return Number.isInteger(rotation) && rotation % 90 === 0;
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((rotation % 360) + 360) % 360;
  if (
    normalized === 0 ||
    normalized === 90 ||
    normalized === 180 ||
    normalized === 270
  ) {
    return normalized;
  }
  throw new Error('Unsupported page rotation.');
}

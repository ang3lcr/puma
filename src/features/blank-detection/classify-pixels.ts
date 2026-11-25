import type { BlankPageAnalysis } from './types';

const strongContrastThreshold = 24;
const weakContrastThreshold = 12;
const contentPixelRatioThreshold = 0.001;
const minimumBackgroundLuminance = 200;
const backgroundPercentile = 0.9;

export function classifyPixelData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): BlankPageAnalysis {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height * 4 !== pixels.length
  ) {
    throw new Error('Blank detection received invalid pixel dimensions.');
  }

  const luminanceHistogram = new Uint32Array(256);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    if (
      alpha !== undefined &&
      red !== undefined &&
      green !== undefined &&
      blue !== undefined
    ) {
      const luminance =
        alpha === 0
          ? 255
          : Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
      luminanceHistogram[luminance] =
        (luminanceHistogram[luminance] ?? 0) + 1;
    }
  }

  const totalPixelCount = width * height;
  const backgroundLuminance = findPercentile(
    luminanceHistogram,
    totalPixelCount,
    backgroundPercentile,
  );
  let foregroundPixelCount = 0;
  let uncertainPixelCount = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    if (
      alpha === undefined ||
      red === undefined ||
      green === undefined ||
      blue === undefined
    ) {
      continue;
    }
    const luminance =
      alpha === 0
        ? 255
        : Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    if (luminance <= backgroundLuminance - weakContrastThreshold) {
      uncertainPixelCount += 1;
    }
    if (luminance <= backgroundLuminance - strongContrastThreshold) {
      foregroundPixelCount += 1;
    }
  }

  const foregroundPixelRatio = foregroundPixelCount / totalPixelCount;
  if (backgroundLuminance < minimumBackgroundLuminance) {
    return {
      status: 'needs-review',
      reason: 'ambiguous-background',
      confidence: null,
      foregroundPixelCount,
      foregroundPixelRatio,
    };
  }
  if (
    foregroundPixelCount > 0 &&
    foregroundPixelRatio >= contentPixelRatioThreshold
  ) {
    return {
      status: 'content-detected',
      reason: 'visible-content',
      confidence: null,
      foregroundPixelCount,
      foregroundPixelRatio,
    };
  }
  if (uncertainPixelCount > 0) {
    return {
      status: 'needs-review',
      reason: 'sparse-content',
      confidence: null,
      foregroundPixelCount: uncertainPixelCount,
      foregroundPixelRatio: uncertainPixelCount / totalPixelCount,
    };
  }
  return {
    status: 'likely-blank',
    reason: 'no-visible-content',
    confidence: null,
    foregroundPixelCount,
    foregroundPixelRatio,
  };
}

function findPercentile(
  histogram: Uint32Array,
  sampleCount: number,
  percentile: number,
): number {
  const targetCount = Math.ceil(sampleCount * percentile);
  let count = 0;
  for (let luminance = 0; luminance < histogram.length; luminance += 1) {
    count += histogram[luminance] ?? 0;
    if (count >= targetCount) {
      return luminance;
    }
  }
  throw new Error('Blank detection could not estimate the page background.');
}

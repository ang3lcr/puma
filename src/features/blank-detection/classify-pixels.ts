import type { BlankPageAnalysis } from './types';

const foregroundChannelThreshold = 254;
const contentPixelRatioThreshold = 0.001;

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

  let foregroundPixelCount = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    if (
      alpha !== undefined &&
      alpha > 0 &&
      red !== undefined &&
      green !== undefined &&
      blue !== undefined &&
      (red < foregroundChannelThreshold ||
        green < foregroundChannelThreshold ||
        blue < foregroundChannelThreshold)
    ) {
      foregroundPixelCount += 1;
    }
  }

  const totalPixelCount = width * height;
  const foregroundPixelRatio = foregroundPixelCount / totalPixelCount;
  if (foregroundPixelCount === 0) {
    return {
      status: 'likely-blank',
      reason: 'no-visible-content',
      confidence: null,
      foregroundPixelCount,
      foregroundPixelRatio,
    };
  }
  if (foregroundPixelRatio >= contentPixelRatioThreshold) {
    return {
      status: 'content-detected',
      reason: 'visible-content',
      confidence: null,
      foregroundPixelCount,
      foregroundPixelRatio,
    };
  }
  return {
    status: 'needs-review',
    reason: 'sparse-content',
    confidence: null,
    foregroundPixelCount,
    foregroundPixelRatio,
  };
}

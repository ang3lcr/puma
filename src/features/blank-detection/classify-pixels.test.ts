import { describe, expect, it } from 'vitest';
import { classifyPixelData } from './classify-pixels';

describe('classifyPixelData', () => {
  it('marks a uniformly white rendering as a likely blank page', () => {
    const pixels = createWhitePixels(100, 100);

    expect(classifyPixelData(pixels, 100, 100)).toEqual({
      status: 'likely-blank',
      reason: 'no-visible-content',
      confidence: null,
      foregroundPixelCount: 0,
      foregroundPixelRatio: 0,
    });
  });

  it('routes sparse marks to manual review instead of calling the page blank', () => {
    const pixels = createWhitePixels(100, 100);
    setForegroundPixels(pixels, [5050]);

    expect(classifyPixelData(pixels, 100, 100)).toMatchObject({
      status: 'needs-review',
      reason: 'sparse-content',
      confidence: null,
      foregroundPixelCount: 1,
      foregroundPixelRatio: 0.0001,
    });
  });

  it('identifies substantial visible content without recommending deletion', () => {
    const pixels = createWhitePixels(100, 100);
    setForegroundPixels(pixels, Array.from({ length: 10 }, (_, index) => index));

    expect(classifyPixelData(pixels, 100, 100)).toMatchObject({
      status: 'content-detected',
      reason: 'visible-content',
      confidence: null,
      foregroundPixelCount: 10,
      foregroundPixelRatio: 0.001,
    });
  });

  it('rejects invalid raster dimensions', () => {
    expect(() => classifyPixelData(new Uint8ClampedArray(4), 0, 1)).toThrow(
      'Blank detection received invalid pixel dimensions.',
    );
    expect(() => classifyPixelData(new Uint8ClampedArray(8), 1, 1)).toThrow(
      'Blank detection received invalid pixel dimensions.',
    );
  });
});

function createWhitePixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 255;
    pixels[offset + 1] = 255;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

function setForegroundPixels(
  pixels: Uint8ClampedArray,
  pixelIndexes: readonly number[],
): void {
  for (const index of pixelIndexes) {
    const offset = index * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
  }
}

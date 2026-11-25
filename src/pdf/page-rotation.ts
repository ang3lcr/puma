export function normalizePageRotation(rotation: number): number {
  if (!Number.isFinite(rotation)) {
    throw new Error('Page rotation must be a finite number.');
  }
  return ((rotation % 360) + 360) % 360;
}

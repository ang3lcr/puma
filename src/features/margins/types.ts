export interface PdfBox {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export interface PageMarginsMm {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface PageGeometry {
  readonly viewBox: PdfBox;
  readonly userUnit: number;
  readonly rotation: number;
  readonly widthMillimeters: number;
  readonly heightMillimeters: number;
}

export type CropBoxResult =
  | { readonly ok: true; readonly cropBox: PdfBox | null }
  | {
      readonly ok: false;
      readonly reason: 'invalid-geometry' | 'invalid-margins' | 'crop-too-small';
    };

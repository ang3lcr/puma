import { useState } from 'react';
import type { FormEvent } from 'react';
import { es } from '../../i18n/es';
import { formatNumber } from '../../i18n/format';
import {
  createCropBoxFromMargins,
  getPageMarginsMm,
  isBoxInside,
} from './geometry';
import type { PageGeometry, PageMarginsMm, PdfBox } from './types';

type MarginSide = keyof PageMarginsMm;

type MarginInputs = Record<MarginSide, string>;

const marginFields: readonly {
  side: MarginSide;
  label: string;
}[] = [
  { side: 'top', label: es.margins.top },
  { side: 'right', label: es.margins.right },
  { side: 'bottom', label: es.margins.bottom },
  { side: 'left', label: es.margins.left },
];

interface MarginEditorProps {
  geometry: PageGeometry | null;
  cropBox: PdfBox | null;
  disabled: boolean;
  onApply: (cropBox: PdfBox | null) => void;
}

export function MarginEditor({
  geometry,
  cropBox,
  ...props
}: MarginEditorProps) {
  const geometryKey = geometry
    ? [
        geometry.viewBox.xMin,
        geometry.viewBox.yMin,
        geometry.viewBox.xMax,
        geometry.viewBox.yMax,
        geometry.userUnit,
        geometry.rotation,
      ].join(':')
    : 'pending';
  const cropBoxKey = cropBox
    ? [cropBox.xMin, cropBox.yMin, cropBox.xMax, cropBox.yMax].join(':')
    : 'original';
  return (
    <MarginEditorForm
      key={`${geometryKey}/${cropBoxKey}`}
      geometry={geometry}
      cropBox={cropBox}
      {...props}
    />
  );
}

function MarginEditorForm({
  geometry,
  cropBox,
  disabled,
  onApply,
}: MarginEditorProps) {
  const currentCropBoxValid =
    geometry !== null &&
    (cropBox === null || isBoxInside(cropBox, geometry.viewBox));
  const initialMargins =
    geometry && currentCropBoxValid
      ? getPageMarginsMm(
          geometry.viewBox,
          cropBox,
          geometry.userUnit,
          geometry.rotation,
        )
      : zeroMargins();
  const [inputs, setInputs] = useState<MarginInputs>(() =>
    toMarginInputs(initialMargins),
  );
  const [showValidation, setShowValidation] = useState(false);

  const margins = parseInputs(inputs);
  const result =
    geometry && margins
      ? createCropBoxFromMargins(
          geometry.viewBox,
          geometry.userUnit,
          geometry.rotation,
          margins,
        )
      : { ok: false as const, reason: 'invalid-margins' as const };
  const unchanged =
    margins !== null &&
    marginFields.every(
      ({ side }) => Math.abs(margins[side] - initialMargins[side]) <= 0.005,
    );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setShowValidation(true);
    if (!result.ok || !geometry || !currentCropBoxValid) {
      return;
    }
    onApply(result.cropBox);
  }

  function reset(): void {
    setInputs(toMarginInputs(zeroMargins()));
    setShowValidation(false);
    onApply(null);
  }

  const errorMessage = !geometry || !currentCropBoxValid
    ? es.margins.invalidGeometry
    : result.ok
      ? null
      : result.reason === 'crop-too-small'
        ? es.margins.cropTooSmall
        : result.reason === 'invalid-geometry'
          ? es.margins.invalidGeometry
          : es.margins.invalidMargins;
  const validationVisible = showValidation || !unchanged;

  const resultWidth =
    geometry && margins
      ? geometry.widthMillimeters - margins.left - margins.right
      : null;
  const resultHeight =
    geometry && margins
      ? geometry.heightMillimeters - margins.top - margins.bottom
      : null;

  return (
    <section
      className="margin-editor"
      aria-label={es.margins.region}
    >
      <h3>{es.margins.heading}</h3>
      <p>{es.margins.description}</p>
      <p>{es.margins.dragInstructions}</p>
      {geometry ? (
        <form onSubmit={submit}>
          <div className="margin-editor-fields">
            {marginFields.map(({ side, label }) => (
              <label key={side} htmlFor={`page-margin-${side}`}>
                <span>{label}</span>
                <input
                  id={`page-margin-${side}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={inputs[side]}
                  disabled={disabled || !currentCropBoxValid}
                  aria-invalid={validationVisible && !result.ok}
                  aria-describedby={
                    validationVisible && errorMessage
                      ? 'margin-editor-error'
                      : undefined
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setInputs((current) => ({
                      ...current,
                      [side]: value,
                    }));
                    setShowValidation(false);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="margin-editor-result" aria-live="polite">
            {es.margins.cropArea}:{' '}
            {resultWidth !== null && resultHeight !== null && result.ok
              ? `${formatNumber(resultWidth, { maximumFractionDigits: 1 })} × ${formatNumber(resultHeight, { maximumFractionDigits: 1 })} mm`
              : '—'}
          </p>
          {validationVisible && errorMessage && (
            <p
              id="margin-editor-error"
              className="margin-editor-error"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
          <div className="margin-editor-actions">
            <button
              className="margin-editor-apply"
              type="submit"
              disabled={
                disabled ||
                !currentCropBoxValid ||
                !result.ok ||
                unchanged
              }
            >
              {es.margins.apply}
            </button>
            <button
              className="margin-editor-reset"
              type="button"
              disabled={disabled || cropBox === null}
              onClick={reset}
            >
              {es.margins.reset}
            </button>
          </div>
        </form>
      ) : (
        <p role="status">{es.margins.loading}</p>
      )}
      {geometry && !currentCropBoxValid && (
        <p className="margin-editor-error" role="alert">
          {es.margins.invalidGeometry}
        </p>
      )}
      {cropBox && (
        <p className="margin-editor-result" role="status">
          {es.margins.applied}
        </p>
      )}
      <p className="margin-editor-note">{es.margins.originalArea}</p>
    </section>
  );
}

function parseInputs(inputs: MarginInputs): PageMarginsMm | null {
  const margins = {
    top: Number(inputs.top),
    right: Number(inputs.right),
    bottom: Number(inputs.bottom),
    left: Number(inputs.left),
  };
  if (
    Object.values(inputs).some((value) => value.trim() === '') ||
    !Object.values(margins).every(Number.isFinite)
  ) {
    return null;
  }
  return margins;
}

function toMarginInputs(margins: PageMarginsMm): MarginInputs {
  return {
    top: formatMargin(margins.top),
    right: formatMargin(margins.right),
    bottom: formatMargin(margins.bottom),
    left: formatMargin(margins.left),
  };
}

function formatMargin(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function zeroMargins(): PageMarginsMm {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export type OrientationAnalysisReason =
  | 'digital-text-direction'
  | 'no-digital-text'
  | 'insufficient-text'
  | 'mixed-directions'
  | 'non-cardinal-direction'
  | 'vertical-writing'
  | 'analysis-error';

export type OrientationAnalysis =
  | {
      readonly status: 'suggestion';
      readonly reason: 'digital-text-direction';
      readonly targetRotationDeltaDegrees: number;
    }
  | {
      readonly status: 'needs-review';
      readonly reason: Exclude<
        OrientationAnalysisReason,
        'digital-text-direction'
      >;
      readonly targetRotationDeltaDegrees: null;
    };

export interface OrientationTextRun {
  readonly text: string;
  readonly direction: string;
  readonly transform: readonly number[];
}

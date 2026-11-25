export type BlankPageAnalysisStatus =
  | 'likely-blank'
  | 'content-detected'
  | 'needs-review';

export type BlankPageAnalysisReason =
  | 'text-content'
  | 'annotation-present'
  | 'no-visible-content'
  | 'visible-content'
  | 'sparse-content'
  | 'analysis-error';

export interface BlankPageAnalysis {
  readonly status: BlankPageAnalysisStatus;
  readonly reason: BlankPageAnalysisReason;
  readonly confidence: number | null;
  readonly foregroundPixelCount: number | null;
  readonly foregroundPixelRatio: number | null;
}

export type BlankPageReviewDecision = 'confirmed-blank' | 'keep';

export interface BlankDetectionWorkerRequest {
  readonly requestId: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayBuffer;
}

export type BlankDetectionWorkerResponse =
  | {
      readonly requestId: number;
      readonly result: BlankPageAnalysis;
    }
  | {
      readonly requestId: number;
      readonly error: string;
    };

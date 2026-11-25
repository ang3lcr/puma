import { PDFDataRangeTransport } from 'pdfjs-dist';

export class FullReadConfirmationDeclinedError extends Error {
  constructor() {
    super('The nearly complete PDF read was declined.');
    this.name = 'FullReadConfirmationDeclinedError';
  }
}

const defaultFullReadWarningThreshold = 400 * 1024 * 1024;
const fullReadCoverageRatio = 0.95;

export class BlobRangeTransport extends PDFDataRangeTransport {
  private aborted = false;
  private readonly source: Blob;
  private readonly onReadError: (error: Error) => void;
  private readonly confirmFullRead: () => Promise<boolean>;
  private readonly fullReadWarningThreshold: number;
  private completedRanges: Array<{ begin: number; end: number }> = [];
  private completedCoverage = 0;
  private fullReadDecision: Promise<boolean> | null = null;
  private fullReadConfirmed = false;

  constructor(
    source: Blob,
    onReadError: (error: Error) => void,
    confirmFullRead: () => Promise<boolean> = async () => false,
    fullReadWarningThreshold = defaultFullReadWarningThreshold,
  ) {
    super(source.size, null);
    this.source = source;
    this.onReadError = onReadError;
    this.confirmFullRead = confirmFullRead;
    this.fullReadWarningThreshold = fullReadWarningThreshold;
  }

  override requestDataRange(begin: number, end: number): void {
    if (this.aborted) {
      return;
    }

    if (
      !Number.isSafeInteger(begin) ||
      !Number.isSafeInteger(end) ||
      begin < 0 ||
      end <= begin ||
      end > this.length
    ) {
      this.onReadError(new RangeError('PDF.js requested an invalid byte range.'));
      return;
    }

    void this.readRange(begin, end);
  }

  override abort(): void {
    this.aborted = true;
  }

  private async readRange(begin: number, end: number): Promise<void> {
    try {
      if (
        !this.fullReadConfirmed &&
        this.source.size >= this.fullReadWarningThreshold &&
        this.coverageIncluding(begin, end) >=
          this.source.size * fullReadCoverageRatio
      ) {
        this.fullReadDecision ??= this.confirmFullRead();
        if (!(await this.fullReadDecision)) {
          this.aborted = true;
          this.onReadError(new FullReadConfirmationDeclinedError());
          return;
        }
        this.fullReadConfirmed = true;
      }

      if (this.aborted) {
        return;
      }

      const bytes = new Uint8Array(
        await this.source.slice(begin, end).arrayBuffer(),
      );
      if (bytes.byteLength !== end - begin) {
        throw new Error('The local PDF source returned an incomplete byte range.');
      }

      if (!this.aborted) {
        this.recordRange(begin, end);
        this.onDataRange(begin, bytes);
      }
    } catch (error) {
      if (!this.aborted) {
        this.onReadError(
          error instanceof Error
            ? error
            : new Error('Unable to read the selected PDF source.'),
        );
      }
    }
  }

  private coverageIncluding(begin: number, end: number): number {
    let additionalCoverage = end - begin;
    for (const range of this.completedRanges) {
      const overlapStart = Math.max(begin, range.begin);
      const overlapEnd = Math.min(end, range.end);
      if (overlapEnd > overlapStart) {
        additionalCoverage -= overlapEnd - overlapStart;
      }
    }
    return this.completedCoverage + additionalCoverage;
  }

  private recordRange(begin: number, end: number): void {
    const mergedRanges: Array<{ begin: number; end: number }> = [];
    let mergedBegin = begin;
    let mergedEnd = end;
    let inserted = false;

    for (const range of this.completedRanges) {
      if (range.end < mergedBegin) {
        mergedRanges.push(range);
      } else if (mergedEnd < range.begin) {
        if (!inserted) {
          mergedRanges.push({ begin: mergedBegin, end: mergedEnd });
          inserted = true;
        }
        mergedRanges.push(range);
      } else {
        mergedBegin = Math.min(mergedBegin, range.begin);
        mergedEnd = Math.max(mergedEnd, range.end);
      }
    }

    if (!inserted) {
      mergedRanges.push({ begin: mergedBegin, end: mergedEnd });
    }
    this.completedRanges = mergedRanges;
    this.completedCoverage = mergedRanges.reduce(
      (coverage, range) => coverage + range.end - range.begin,
      0,
    );
  }
}

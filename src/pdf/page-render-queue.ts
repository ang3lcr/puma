export type RenderPriority = 'visible-page' | 'analysis' | 'thumbnail';
export type RenderJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface PageRenderJob {
  priority: RenderPriority;
  run: (signal: AbortSignal) => Promise<void>;
  onStatus?: (status: RenderJobStatus) => void;
}

export interface PageRenderHandle {
  promise: Promise<void>;
  cancel: () => void;
}

interface QueuedRenderJob extends PageRenderJob {
  controller: AbortController;
  order: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  status: RenderJobStatus;
}

export class PageRenderQueue {
  private readonly jobs: QueuedRenderJob[] = [];
  private activeJob: QueuedRenderJob | null = null;
  private nextOrder = 0;
  private drainScheduled = false;
  private disposed = false;

  enqueue(job: PageRenderJob): PageRenderHandle {
    if (this.disposed) {
      throw new Error('Cannot add a render job to a disposed queue.');
    }

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const queuedJob: QueuedRenderJob = {
      ...job,
      controller: new AbortController(),
      order: this.nextOrder++,
      resolve,
      reject,
      status: 'queued',
    };

    this.jobs.push(queuedJob);
    this.jobs.sort((left, right) => {
      const priorityDifference =
        priorityOrder[left.priority] - priorityOrder[right.priority];
      return priorityDifference || left.order - right.order;
    });
    this.notify(queuedJob, 'queued');
    this.scheduleDrain();

    return {
      promise,
      cancel: () => this.cancel(queuedJob),
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const job of [...this.jobs]) {
      this.cancel(job);
    }
    this.activeJob?.controller.abort();
  }

  private cancel(job: QueuedRenderJob): void {
    if (
      job.status === 'completed' ||
      job.status === 'cancelled' ||
      job.status === 'failed'
    ) {
      return;
    }

    if (job.status === 'queued') {
      const index = this.jobs.indexOf(job);
      if (index >= 0) {
        this.jobs.splice(index, 1);
      }
      this.notify(job, 'cancelled');
      job.resolve();
      this.scheduleDrain();
      return;
    }

    job.controller.abort();
  }

  private scheduleDrain(): void {
    if (this.disposed || this.drainScheduled) {
      return;
    }

    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private drain(): void {
    if (this.disposed || this.activeJob || this.jobs.length === 0) {
      return;
    }

    const job = this.jobs.shift();
    if (!job) {
      return;
    }

    this.activeJob = job;
    this.notify(job, 'running');
    void Promise.resolve()
      .then(() => job.run(job.controller.signal))
      .then(
        () =>
          this.finish(
            job,
            job.controller.signal.aborted ? 'cancelled' : 'completed',
          ),
        (error: unknown) => {
          if (job.controller.signal.aborted) {
            this.finish(job, 'cancelled');
          } else {
            this.finish(job, 'failed', error);
          }
        },
      );
  }

  private finish(
    job: QueuedRenderJob,
    status: 'completed' | 'cancelled' | 'failed',
    error?: unknown,
  ): void {
    if (this.activeJob !== job) {
      return;
    }

    this.activeJob = null;
    this.notify(job, status);
    if (status === 'failed') {
      job.reject(error);
    } else {
      job.resolve();
    }
    this.scheduleDrain();
  }

  private notify(job: QueuedRenderJob, status: RenderJobStatus): void {
    job.status = status;
    if (!job.onStatus) {
      return;
    }

    queueMicrotask(() => job.onStatus?.(status));
  }
}

const priorityOrder: Record<RenderPriority, number> = {
  'visible-page': 0,
  analysis: 1,
  thumbnail: 2,
};

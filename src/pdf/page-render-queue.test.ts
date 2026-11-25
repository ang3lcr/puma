import { describe, expect, it, vi } from 'vitest';
import { PageRenderQueue } from './page-render-queue';

describe('PageRenderQueue', () => {
  it('runs visible pages and analysis before queued thumbnails', async () => {
    const queue = new PageRenderQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStatuses: string[] = [];

    const first = queue.enqueue({
      priority: 'thumbnail',
      onStatus: (status) => firstStatuses.push(status),
      run: () => {
        order.push('first');
        markFirstStarted();
        return blocker;
      },
    });
    await firstStarted;

    const queuedThumbnail = queue.enqueue({
      priority: 'thumbnail',
      run: async () => {
        order.push('thumbnail');
      },
    });
    const visiblePage = queue.enqueue({
      priority: 'visible-page',
      run: async () => {
        order.push('visible-page');
      },
    });
    const analysis = queue.enqueue({
      priority: 'analysis',
      run: async () => {
        order.push('analysis');
      },
    });

    releaseFirst();
    await Promise.all([
      first.promise,
      queuedThumbnail.promise,
      visiblePage.promise,
      analysis.promise,
    ]);
    await Promise.resolve();

    expect(order).toEqual(['first', 'visible-page', 'analysis', 'thumbnail']);
    expect(firstStatuses).toEqual(['queued', 'running', 'completed']);
  });

  it('cancels queued and running jobs and rejects failed jobs', async () => {
    const queue = new PageRenderQueue();
    let markActiveStarted!: () => void;
    const activeStarted = new Promise<void>((resolve) => {
      markActiveStarted = resolve;
    });
    const active = queue.enqueue({
      priority: 'thumbnail',
      run: (signal) => {
        markActiveStarted();
        return new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => resolve(),
            { once: true },
          );
        });
      },
    });
    await activeStarted;

    const queuedRun = vi.fn(async () => {});
    const queued = queue.enqueue({
      priority: 'thumbnail',
      run: queuedRun,
    });
    queued.cancel();
    await queued.promise;
    expect(queuedRun).not.toHaveBeenCalled();

    active.cancel();
    await active.promise;

    const failure = new Error('render failed');
    const failed = queue.enqueue({
      priority: 'visible-page',
      run: async () => {
        throw failure;
      },
    });
    await expect(failed.promise).rejects.toBe(failure);
    queue.dispose();
  });

  it('aborts outstanding work when disposed and prevents future jobs', async () => {
    const queue = new PageRenderQueue();
    let markStarted!: () => void;
    let markAborted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const handle = queue.enqueue({
      priority: 'visible-page',
      run: (signal) =>
        new Promise<void>((resolve) => {
          markStarted();
          signal.addEventListener(
            'abort',
            () => {
              markAborted();
              resolve();
            },
            { once: true },
          );
        }),
    });
    await started;

    queue.dispose();
    await aborted;
    await handle.promise;
    expect(() =>
      queue.enqueue({ priority: 'thumbnail', run: async () => {} }),
    ).toThrow('Cannot add a render job to a disposed queue.');
  });
});

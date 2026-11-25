import { describe, expect, it, vi } from 'vitest';
import {
  BlobRangeTransport,
  FullReadConfirmationDeclinedError,
} from './blob-range-transport';

describe('BlobRangeTransport', () => {
  it('returns only the requested source bytes to PDF.js', async () => {
    const transport = new BlobRangeTransport(new Blob(['abcdef']), vi.fn());
    const onDataRange = vi
      .spyOn(transport, 'onDataRange')
      .mockImplementation(() => {});

    transport.requestDataRange(1, 4);
    await vi.waitFor(() => expect(onDataRange).toHaveBeenCalledOnce());

    expect(onDataRange).toHaveBeenCalledWith(
      1,
      new Uint8Array([98, 99, 100]),
    );
  });

  it('reports invalid ranges instead of silently returning data', () => {
    const onReadError = vi.fn();
    const transport = new BlobRangeTransport(new Blob(['abc']), onReadError);

    transport.requestDataRange(1, 4);

    expect(onReadError).toHaveBeenCalledWith(expect.any(RangeError));
  });

  it('does not deliver pending data after aborting', async () => {
    const transport = new BlobRangeTransport(new Blob(['abcdef']), vi.fn());
    const onDataRange = vi
      .spyOn(transport, 'onDataRange')
      .mockImplementation(() => {});

    transport.requestDataRange(0, 3);
    transport.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onDataRange).not.toHaveBeenCalled();
  });

  it('asks before returning nearly the entire large source', async () => {
    const onReadError = vi.fn();
    const confirmFullRead = vi.fn(async () => false);
    const transport = new BlobRangeTransport(
      new Blob(['abcdefghij']),
      onReadError,
      confirmFullRead,
      5,
    );
    const onDataRange = vi
      .spyOn(transport, 'onDataRange')
      .mockImplementation(() => {});

    transport.requestDataRange(0, 6);
    await vi.waitFor(() => expect(onDataRange).toHaveBeenCalledOnce());
    transport.requestDataRange(5, 10);
    await vi.waitFor(() =>
      expect(onReadError).toHaveBeenCalledOnce(),
    );

    expect(confirmFullRead).toHaveBeenCalledOnce();
    expect(onReadError).toHaveBeenCalledWith(
      expect.any(FullReadConfirmationDeclinedError),
    );
    expect(onDataRange).toHaveBeenCalledOnce();
  });

  it('continues a large source read only after confirmation', async () => {
    const onReadError = vi.fn();
    const confirmFullRead = vi.fn(async () => true);
    const transport = new BlobRangeTransport(
      new Blob(['abcdefghij']),
      onReadError,
      confirmFullRead,
      5,
    );
    const onDataRange = vi
      .spyOn(transport, 'onDataRange')
      .mockImplementation(() => {});

    transport.requestDataRange(0, 10);
    await vi.waitFor(() => expect(onDataRange).toHaveBeenCalledOnce());

    expect(confirmFullRead).toHaveBeenCalledOnce();
    expect(onReadError).not.toHaveBeenCalled();
  });
});

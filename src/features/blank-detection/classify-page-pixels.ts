import type {
  BlankDetectionWorkerRequest,
  BlankDetectionWorkerResponse,
  BlankPageAnalysis,
} from './types';

let nextRequestId = 0;

export function classifyPagePixels(
  worker: Worker,
  imageData: ImageData,
  signal: AbortSignal,
): Promise<BlankPageAnalysis> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  const requestId = nextRequestId++;
  const pixelBuffer = new ArrayBuffer(imageData.data.byteLength);
  new Uint8Array(pixelBuffer).set(imageData.data);
  const request: BlankDetectionWorkerRequest = {
    requestId,
    width: imageData.width,
    height: imageData.height,
    pixels: pixelBuffer,
  };

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      signal.removeEventListener('abort', handleAbort);
    };
    const handleMessage = (
      event: MessageEvent<BlankDetectionWorkerResponse>,
    ): void => {
      if (event.data.requestId !== requestId) {
        return;
      }
      cleanup();
      if ('error' in event.data) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.result);
      }
    };
    const handleError = (event: ErrorEvent): void => {
      cleanup();
      reject(new Error(event.message || 'Blank detection worker failed.'));
    };
    const handleAbort = (): void => {
      cleanup();
      reject(createAbortError());
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError, { once: true });
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
      return;
    }

    try {
      worker.postMessage(request, [pixelBuffer]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function createAbortError(): Error {
  const error = new Error('Blank detection was cancelled.');
  error.name = 'AbortError';
  return error;
}

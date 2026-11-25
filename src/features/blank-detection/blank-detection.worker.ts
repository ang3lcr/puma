import { classifyPixelData } from './classify-pixels';
import type {
  BlankDetectionWorkerRequest,
  BlankDetectionWorkerResponse,
} from './types';

self.addEventListener(
  'message',
  (event: MessageEvent<BlankDetectionWorkerRequest>) => {
    const { requestId, width, height, pixels } = event.data;
    let response: BlankDetectionWorkerResponse;
    try {
      response = {
        requestId,
        result: classifyPixelData(new Uint8ClampedArray(pixels), width, height),
      };
    } catch (error) {
      response = {
        requestId,
        error:
          error instanceof Error
            ? error.message
            : 'Blank detection failed in the analysis worker.',
      };
    }
    self.postMessage(response);
  },
);

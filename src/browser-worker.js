// Web Worker entry: renders off the main thread and transfers the pixels back (zero-copy).
import { renderFrame } from './frame.js';

self.onmessage = ({ data: { id, options } }) => {
  try {
    const f = renderFrame(options);
    self.postMessage({ id, frame: f }, [f.data.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};

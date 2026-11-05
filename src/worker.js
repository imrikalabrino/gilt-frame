// Node worker: pulls row chunks off a shared atomic counter until the phase is done, then
// replies with the job id it was given (so concurrent renders sharing the pool stay separate).
import { parentPort } from 'node:worker_threads';
import { heightRows, shadeRows } from './frame.js';

const CHUNK = 8;
parentPort.on('message', ({ id, S, phase, counter }) => {
  try {
    const fn = phase === 0 ? heightRows : shadeRows;
    for (;;) {
      const y0 = Atomics.add(counter, 0, CHUNK);
      if (y0 >= S.ch) break;
      fn(S, y0, Math.min(S.ch, y0 + CHUNK));
    }
    parentPort.postMessage({ id });
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.stack ?? e) });
  }
});

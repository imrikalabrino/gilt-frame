// Node worker: pulls row chunks off a shared atomic counter until the phase is done.
import { parentPort } from 'node:worker_threads';
import { heightRows, shadeRows } from './frame.js';

const CHUNK = 8;
parentPort.on('message', ({ S, phase, counter }) => {
  const fn = phase === 0 ? heightRows : shadeRows;
  for (;;) {
    const y0 = Atomics.add(counter, 0, CHUNK);
    if (y0 >= S.ch) break;
    fn(S, y0, Math.min(S.ch, y0 + CHUNK));
  }
  parentPort.postMessage(0);
});

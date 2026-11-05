// Multi-core rendering for Node: the row phases run on a worker pool over SharedArrayBuffers.
// Output is bit-identical to renderFrame() — no per-thread randomness, rows are independent.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { setup, heightRows, relief, shadeRows, result } from './frame.js';

let pool = [];
const MIN_PIXELS = 400_000; // below this, thread hand-off costs more than it saves

function workers(n) {
  while (pool.length < n) {
    const w = new Worker(new URL('./worker.js', import.meta.url));
    w.unref();
    pool.push(w);
  }
  return pool.slice(0, n);
}

function phase(ws, S, n) {
  const counter = new Int32Array(new SharedArrayBuffer(4));
  return Promise.all(ws.map((w) => new Promise((resolve, reject) => {
    w.ref();
    const done = () => { w.off('error', fail); w.unref(); resolve(); };
    const fail = (e) => { w.off('message', done); reject(e); };
    w.once('message', done);
    w.once('error', fail);
    w.postMessage({ S, phase: n, counter });
  })));
}

/** Like renderFrame(), but spreads the per-pixel work across CPU cores. */
export async function renderFrameParallel(options = {}) {
  const threads = options.threads ?? Math.max(1, Math.min(8, availableParallelism() - 1));
  const S = setup(options, (bytes) => new SharedArrayBuffer(bytes));
  if (threads < 2 || S.cw * S.ch < MIN_PIXELS) {
    heightRows(S, 0, S.ch); relief(S); shadeRows(S, 0, S.ch);
    return result(S);
  }
  const ws = workers(threads);
  await phase(ws, S, 0);
  relief(S);
  await phase(ws, S, 1);
  return result(S);
}

/** Terminate the worker pool (optional; idle workers never keep the process alive). */
export async function closePool() {
  const p = pool; pool = [];
  await Promise.all(p.map((w) => w.terminate()));
}

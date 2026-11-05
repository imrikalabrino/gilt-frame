// Multi-core rendering for Node: the row phases run on a worker pool over SharedArrayBuffers.
// Output is bit-identical to renderFrame() — no per-thread randomness, rows are independent.
// Safe under concurrency: every job carries an id and replies are routed back by id, so any
// number of renders can share the pool at once.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { setup, heightRows, relief, shadeRows, result } from './frame.js';

let pool = [];
let nextJob = 0;
const MIN_PIXELS = 400_000; // below this, thread hand-off costs more than it saves

function spawn() {
  const w = new Worker(new URL('./worker.js', import.meta.url));
  const slot = { w, pending: new Map() };
  w.on('message', ({ id, error }) => {
    const p = slot.pending.get(id);
    if (!p) return;
    slot.pending.delete(id);
    if (!slot.pending.size) w.unref();
    if (error) p.reject(new Error(error)); else p.resolve();
  });
  const die = (err) => {
    // a dead worker fails only its own in-flight jobs; the next render gets a fresh worker
    pool = pool.filter((s) => s !== slot);
    for (const p of slot.pending.values()) p.reject(err instanceof Error ? err : new Error(`gilt-frame worker exited (${err})`));
    slot.pending.clear();
  };
  w.on('error', die);
  w.on('exit', (code) => { if (slot.pending.size) die(code); else pool = pool.filter((s) => s !== slot); });
  w.unref(); // idle workers never keep the process alive
  return slot;
}

function workers(n) {
  while (pool.length < n) pool.push(spawn());
  return pool.slice(0, n);
}

function run(slot, msg) {
  return new Promise((resolve, reject) => {
    const id = nextJob++;
    slot.pending.set(id, { resolve, reject });
    slot.w.ref(); // keep the process alive while this job is in flight
    slot.w.postMessage({ ...msg, id });
  });
}

function phase(slots, S, n) {
  const counter = new Int32Array(new SharedArrayBuffer(4));
  return Promise.all(slots.map((slot) => run(slot, { S, phase: n, counter })));
}

/** Like renderFrame(), but spreads the per-pixel work across CPU cores. */
export async function renderFrameParallel(options = {}) {
  const threads = options.threads ?? Math.max(1, Math.min(8, availableParallelism() - 1));
  if (!Number.isInteger(threads) || threads < 1) throw new RangeError('gilt-frame: threads must be a positive integer');
  const S = setup(options, (bytes) => new SharedArrayBuffer(bytes));
  if (threads < 2 || S.cw * S.ch < MIN_PIXELS) {
    heightRows(S, 0, S.ch); relief(S); shadeRows(S, 0, S.ch);
    return result(S);
  }
  const slots = workers(threads);
  await phase(slots, S, 0);
  relief(S);
  await phase(slots, S, 1);
  return result(S);
}

/** Terminate the worker pool (optional; idle workers never keep the process alive). */
export async function closePool() {
  const p = pool; pool = [];
  await Promise.all(p.map((s) => s.w.terminate()));
}

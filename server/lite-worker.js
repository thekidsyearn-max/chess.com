// Worker thread hosting the built-in engine so searches never block the event loop.
import { parentPort } from 'node:worker_threads';
import { liteSearch } from './lite-engine.js';

parentPort.on('message', ({ id, opts }) => {
  try {
    parentPort.postMessage({ id, result: liteSearch(opts) });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
});

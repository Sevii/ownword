// Harper engine for Node (tests and the eval harness). Browser code uses the
// worker host instead and must not import this file: it inlines the WASM.

import { LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { createHarperEngine } from './harper.js';

/** @param {{ policy?: boolean }} [options] */
export function createNodeHarperEngine(options) {
  return createHarperEngine(new LocalLinter({ binary: binaryInlined }), options);
}

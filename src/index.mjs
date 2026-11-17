// aux-comprehension-test — public entrypoint: the stable surface only.
//
// Everything else lives behind the `aux-comprehension-test/internal` subpath
// (src/internal.mjs) and may change in any 0.x release.

export { run, RunError, HOST_CAVEAT, VERSION } from "./run.mjs";
export { main, EXIT } from "./cli.mjs";

// aux-comprehension-test/internal — the unstable internals.
//
// Graders, prompt builders, the persona registry, cost functions and provider
// clients. They are exported so the test suite and library callers who pin an
// exact version can reach them; any of them may change shape in any 0.x
// release. The stable surface is the package root (src/index.mjs).

export { writeOutputs } from "./run.mjs";
export { normalizePayload, parseTruth, checkTruthCoverage, normalizeRequests, readerRequests, NO_TOOL } from "./inputs.mjs";
export {
  registerReaderPersonas,
  buildPanel,
  parseModelSpec,
  buildReaderArtifact,
  renderReaderPrompt,
  runReader,
  READER_INSTRUCTION,
  RESPONSE_SCHEMA,
  DEFAULT_PERSONA_IDS,
} from "./reader.mjs";
export { gradeTeachBack, reread } from "./judge.mjs";
export { buildClusters, rereadCandidates, decide, isLengthOnly, lengthPromoted } from "./grade.mjs";
export { measureTokenWeight, renderTokenWeightMd } from "./tokenweight.mjs";
export { loadPrices, priceFor, estimate, meter, actual } from "./cost.mjs";
export { clientFor, anthropicClient, openaiClient, xaiClient, googleClient, KEY_ENV, MAX_RETRIES } from "./clients.mjs";

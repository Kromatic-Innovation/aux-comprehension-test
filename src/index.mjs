// aux-comprehension-test — public entrypoint.

export { run, writeOutputs, RunError, HOST_CAVEAT, VERSION } from "./run.mjs";
export { main, EXIT } from "./cli.mjs";
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
export { clientFor, anthropicClient, openaiClient, xaiClient, googleClient, KEY_ENV } from "./clients.mjs";

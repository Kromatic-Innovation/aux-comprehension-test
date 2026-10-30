// assets.mjs — load the package's own content files (prompts, personas,
// prices). Prompt text lives in prompts/*.md, not in code, so it can be read
// and reviewed as content.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readAsset(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}

export function readJsonAsset(relPath) {
  return JSON.parse(readAsset(relPath));
}

/** Fill `{{key}}` placeholders. Unknown placeholders are an error, not silence. */
export function fillTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return String(values[key]);
  });
}

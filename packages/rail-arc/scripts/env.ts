/**
 * Keys for the e2e scripts. Locally they come from ../../.env (and the core workspace's .env next
 * door); in CI from the job's environment, which wins. Values are never printed.
 */
import fs from "node:fs";

function loadEnv(path: string): Record<string, string> {
  if (!fs.existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[2]) out[m[1] as string] = m[2].trim();
  }
  return out;
}

const fromProcess = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => Boolean(e[1])),
);

export const env: Record<string, string | undefined> = {
  ...loadEnv("../../.env"),
  ...loadEnv("../../../agentgate/.env"),
  ...fromProcess,
};

export const need = (k: string): string => {
  const v = env[k];
  if (!v) throw new Error(`missing ${k} (in .env locally, or in the CI job's environment)`);
  return v;
};

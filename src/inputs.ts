import * as core from "@actions/core";

export type Auto = "auto" | "true" | "false";

export interface Inputs {
  rigVersion: string;
  rVersion: string;
  rArch: string;
  preferBinary: string;
  workingDirectory: string;
  enableCache: Auto;
  cacheDependencyGlob: string[];
  cacheSuffix: string;
  pruneCache: boolean;
  saveCache: Auto;
}

type Getter = (name: string) => string;

/** Split a glob input on newlines, globs may contain commas. */
export function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

export function parseBool(name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(v)) return true;
  if (["false", "no", "off", "0"].includes(v)) return false;
  throw new Error(`Input '${name}' must be true or false, not '${value}'.`);
}

/** `true`, `false` or the number of versions to look back through. */
export function parsePreferBinary(value: string): string {
  const v = (value.trim() || "true").toLowerCase();
  if (v === "true" || v === "false" || /^[0-9]+$/.test(v)) return v;
  throw new Error(
    `Input 'prefer-binary' must be true, false or a number, not '${value}'.`,
  );
}

export function parseAuto(name: string, value: string): Auto {
  const v = (value.trim() || "auto").toLowerCase();
  if (v === "auto" || v === "true" || v === "false") return v;
  throw new Error(
    `Input '${name}' must be auto, true or false, not '${value}'.`,
  );
}

export function parseInputs(get: Getter = core.getInput): Inputs {
  return {
    rigVersion: get("rig-version").trim() || "latest",
    rVersion: get("r-version").trim(),
    rArch: get("r-arch").trim(),
    preferBinary: parsePreferBinary(get("prefer-binary")),
    workingDirectory: get("working-directory").trim() || ".",
    enableCache: parseAuto("enable-cache", get("enable-cache")),
    cacheDependencyGlob: parseLines(get("cache-dependency-glob")),
    cacheSuffix: get("cache-suffix").trim(),
    pruneCache: parseBool("prune-cache", get("prune-cache") || "true"),
    saveCache: parseAuto("save-cache", get("save-cache")),
  };
}

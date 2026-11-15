import * as core from "@actions/core";
import { parseArgsStringToArgv } from "string-argv";

export type Auto = "auto" | "true" | "false";
export type SaveCache = Auto;

export interface Inputs {
  rigVersion: string;
  rVersion: string;
  rArch: string;
  rtools: string;
  pak: string;
  workingDirectory: string;
  installDependencies: Auto;
  devDependencies: boolean;
  needs: string[];
  extraPackages: string[];
  locked: boolean;
  upgrade: boolean;
  repositories: string[];
  useP3m: boolean;
  preferBinary: string;
  excludeNewer: string;
  sysreqs: string;
  lockArgs: string[];
  syncArgs: string[];
  installArgs: string[];
  checkTools: Auto;
  macosFortran: Auto;
  enableCache: Auto;
  cacheDependencyGlob: string[];
  cacheSuffix: string;
  pruneCache: boolean;
  saveCache: SaveCache;
}

type Getter = (name: string) => string;

/** Split a list input on commas and newlines. */
export function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

/** Split a glob input on newlines only, globs may contain commas. */
export function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

export function parseBool(name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(v)) return true;
  if (["false", "no", "off", "0", ""].includes(v)) return false;
  throw new Error(`Input '${name}' must be true or false, not '${value}'.`);
}

export function parseChoice<T extends string>(
  name: string,
  value: string,
  choices: readonly T[],
): T {
  const v = value.trim().toLowerCase();
  if ((choices as readonly string[]).includes(v)) return v as T;
  throw new Error(
    `Input '${name}' must be one of ${choices.join(", ")}, not '${value}'.`,
  );
}

const AUTO = ["auto", "true", "false"] as const;

export function parseInputs(get: Getter = core.getInput): Inputs {
  const inputs: Inputs = {
    rigVersion: get("rig-version").trim() || "latest",
    rVersion: get("r-version").trim(),
    rArch: get("r-arch").trim(),
    rtools: get("rtools").trim().toLowerCase() || "auto",
    pak: get("pak").trim().toLowerCase() || "false",
    workingDirectory: get("working-directory").trim() || ".",
    installDependencies: parseChoice(
      "install-dependencies",
      get("install-dependencies") || "auto",
      AUTO,
    ),
    devDependencies: parseBool(
      "dev-dependencies",
      get("dev-dependencies") || "true",
    ),
    needs: parseList(get("needs")),
    extraPackages: parseList(get("extra-packages")),
    locked: parseBool("locked", get("locked")),
    upgrade: parseBool("upgrade", get("upgrade")),
    repositories: parseList(get("repositories")),
    useP3m: parseBool("use-p3m", get("use-p3m") || "true"),
    preferBinary: get("prefer-binary").trim(),
    excludeNewer: get("exclude-newer").trim(),
    sysreqs: get("sysreqs").trim(),
    lockArgs: parseArgsStringToArgv(get("lock-args")),
    syncArgs: parseArgsStringToArgv(get("sync-args")),
    installArgs: parseArgsStringToArgv(get("install-args")),
    checkTools: parseChoice("check-tools", get("check-tools") || "auto", AUTO),
    macosFortran: parseChoice(
      "macos-fortran",
      get("macos-fortran") || "auto",
      AUTO,
    ),
    enableCache: parseChoice(
      "enable-cache",
      get("enable-cache") || "auto",
      AUTO,
    ),
    cacheDependencyGlob: parseLines(get("cache-dependency-glob")),
    cacheSuffix: get("cache-suffix").trim(),
    pruneCache: parseBool("prune-cache", get("prune-cache") || "true"),
    saveCache: parseChoice("save-cache", get("save-cache") || "auto", AUTO),
  };
  if (inputs.locked && inputs.upgrade) {
    throw new Error("Inputs 'locked' and 'upgrade' cannot both be true.");
  }
  if (!["false", "true", "stable", "devel"].includes(inputs.pak)) {
    throw new Error(
      `Input 'pak' must be false, true, stable or devel, not '${inputs.pak}'.`,
    );
  }
  return inputs;
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as glob from "@actions/glob";
import type { Auto } from "./inputs.js";
import type { CacheInfo } from "./rig.js";

export const KEY_PREFIX = "setup-rig-v1";

/** setup-uv's rules for `enable-cache: auto`. */
export function cacheEnabled(
  mode: Auto,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (mode !== "auto") return mode === "true";
  if (env.RUNNER_ENVIRONMENT !== "github-hosted") return false;
  const event = env.GITHUB_EVENT_NAME ?? "";
  if (["release", "pull_request_target", "workflow_run"].includes(event)) {
    return false;
  }
  return !(env.GITHUB_REF ?? "").startsWith("refs/tags/");
}

/** ISO 8601 week, e.g. `2026w46`. */
export function isoWeek(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}w${String(week).padStart(2, "0")}`;
}

export interface KeyParts {
  platform: string;
  rVersion: string;
  /** R-devel and R-next change all the time. */
  rDevel: boolean;
  filesHash: string;
  unpinned: boolean;
  suffix: string;
  now?: Date;
}

/** The primary key, and the restore keys, most specific first. */
export function cacheKeys(p: KeyParts): { key: string; restoreKeys: string[] } {
  const minor = p.rVersion.split(".").slice(0, 2).join(".");
  const base = `${KEY_PREFIX}-${p.platform}-r${minor}${p.rDevel ? "-devel" : ""}`;
  const suffix = p.suffix !== "" ? `-${p.suffix}` : "";
  const week = p.unpinned || p.rDevel ? `-${isoWeek(p.now ?? new Date())}` : "";
  const key = `${base}-${p.filesHash}${week}${suffix}`;
  const restoreKeys = [
    ...(week !== "" ? [`${base}-${p.filesHash}-`] : []),
    `${base}-`,
  ];
  return { key, restoreKeys };
}

/** sha256 of the files matching the globs, relative to `dir`. */
export async function hashFiles(globs: string[], dir: string): Promise<string> {
  const patterns = globs
    .map((g) => (path.isAbsolute(g) ? g : path.join(dir, g)))
    .join("\n");
  const globber = await glob.create(patterns, { followSymbolicLinks: false });
  const files = (await globber.glob()).sort();
  const hash = createHash("sha256");
  for (const f of files) {
    if (f.split(path.sep).includes("node_modules")) continue;
    try {
      hash.update(path.relative(dir, f));
      hash.update(readFileSync(f));
    } catch {
      // a directory, skip it
    }
  }
  return hash.digest("hex").slice(0, 16);
}

export async function restore(
  dir: string,
  key: string,
  restoreKeys: string[],
): Promise<string | undefined> {
  core.info(`Cache key: ${key}`);
  try {
    const hit = await cache.restoreCache([dir], key, restoreKeys);
    if (hit) core.info(`Restored cache from key ${hit}.`);
    else core.info("No cache found.");
    return hit;
  } catch (e) {
    core.warning(`Failed to restore the cache: ${e}`);
    return undefined;
  }
}

/** Whether the post step should save, before looking at the cache itself. */
export function shouldSave(
  mode: Auto,
  enabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
  defaultBranch?: string,
): boolean {
  if (!enabled || mode === "false") return false;
  if (mode === "true") return true;
  if (!defaultBranch) return false;
  return env.GITHUB_REF === `refs/heads/${defaultBranch}`;
}

/**
 * Whether the cache has anything the restored one did not. With pruning only
 * the packages rig built and the git mirrors are kept, so only those count.
 */
export function cacheChanged(
  before: CacheInfo | undefined,
  after: CacheInfo,
  pruned: boolean,
): boolean {
  if (after.total_count === 0) return false;
  if (!before) return true;
  if (after.built_count !== before.built_count) return true;
  if (after.git_mirrors_count !== before.git_mirrors_count) return true;
  return !pruned && after.total_count !== before.total_count;
}

/** The default branch, from the event payload. */
export function defaultBranch(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const file = env.GITHUB_EVENT_PATH;
  if (!file) return undefined;
  try {
    const event = JSON.parse(readFileSync(file, "utf8"));
    return event?.repository?.default_branch;
  } catch {
    return undefined;
  }
}

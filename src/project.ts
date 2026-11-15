import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

/** The highest `r_version` of the targets of an `rproj.lock`. */
export function lockRVersion(text: string): string | undefined {
  const versions = [...text.matchAll(/^\s*r_version\s*=\s*"([^"]+)"/gm)].map(
    (m) => m[1],
  );
  if (versions.length === 0) return undefined;
  return versions.sort(compareVersions).at(-1);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The R version spec for `rig add`: the input, else the R version of
 * `rproj.lock`, else `renv.lock`, else `release`.
 */
export function resolveRSpec(rVersion: string, dir: string): string {
  if (rVersion !== "") return rVersion;
  const lock = path.join(dir, "rproj.lock");
  if (existsSync(lock)) {
    const v = lockRVersion(readFileSync(lock, "utf8"));
    if (v) return v;
  }
  const renv = path.join(dir, "renv.lock");
  if (existsSync(renv)) return renv;
  return "release";
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

export type ProjectKind = "proj" | "pkg" | "none";

export interface Project {
  dir: string;
  kind: ProjectKind;
  hasLock: boolean;
  hasRenvLock: boolean;
  description?: Record<string, string>;
}

export function detectProject(dir: string): Project {
  const has = (f: string) => existsSync(path.join(dir, f));
  const kind: ProjectKind = has("rproj.toml")
    ? "proj"
    : has("DESCRIPTION")
      ? "pkg"
      : "none";
  return {
    dir,
    kind,
    hasLock: has("rproj.lock"),
    hasRenvLock: has("renv.lock"),
    description: has("DESCRIPTION")
      ? parseDcf(readFileSync(path.join(dir, "DESCRIPTION"), "utf8"))
      : undefined,
  };
}

/** Parse a DCF file (one record), joining continuation lines. */
export function parseDcf(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let current: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      fields[current] += `\n${line.trim()}`;
    } else {
      const m = line.match(/^([^:\s]+):\s*(.*)$/);
      if (m) {
        current = m[1];
        fields[current] = m[2].trim();
      }
    }
  }
  return fields;
}

/**
 * The packages of the `Config/Needs/<name>` fields, for the `needs` input.
 * Version requirements in parentheses are dropped. rig cannot install these
 * groups itself yet, so the action adds them to the install command.
 */
export function needsPackages(
  description: Record<string, string> | undefined,
  needs: string[],
): string[] {
  if (!description) return [];
  const out: string[] = [];
  for (const name of needs) {
    const field = description[`Config/Needs/${name}`];
    if (field === undefined) continue;
    for (const entry of field.split(",")) {
      const ref = entry.replace(/\(.*\)/s, "").trim();
      if (ref !== "" && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

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

/** Whether the package has vignettes or PDFs in `inst/doc`. */
export function hasVignettes(dir: string): boolean {
  if (existsSync(path.join(dir, "vignettes"))) return true;
  const doc = path.join(dir, "inst", "doc");
  return existsSync(doc) && readdirSync(doc).some((f) => f.endsWith(".pdf"));
}

export function hasConfigure(dir: string): boolean {
  return existsSync(path.join(dir, "configure"));
}

export function hasFortran(dir: string): boolean {
  const src = path.join(dir, "src");
  if (!existsSync(src)) return false;
  return readdirSync(src, { recursive: true }).some((f) =>
    /\.(f|f90|f95|for)$/i.test(String(f)),
  );
}

import * as fs from "node:fs";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * The `/opt/R/...` directories in R's `-L` and `-I` compiler flags. CRAN's
 * macOS builds of R have `-L/opt/R/arm64/lib` (or `x86_64`) in `LDFLAGS`.
 */
export function searchDirs(...flags: string[]): string[] {
  const dirs = new Set<string>();
  for (const f of flags) {
    for (const m of f.matchAll(/(?:^|\s)-[LI]\s*(\S+)/g)) {
      const dir = m[1].replace(/\/+$/, "");
      if (dir.startsWith("/opt/R/") && !dir.includes("..")) dirs.add(dir);
    }
  }
  return [...dirs];
}

async function rConfig(rBinary: string, name: string): Promise<string> {
  const out = await exec.getExecOutput(rBinary, ["CMD", "config", name], {
    silent: true,
    ignoreReturnCode: true,
  });
  return out.exitCode === 0 ? out.stdout.trim() : "";
}

/**
 * Create the missing directories that R's compiler flags refer to, otherwise
 * Apple's `ld` warns about them and `R CMD check` reports a WARNING.
 */
export async function createSearchDirs(rBinary: string): Promise<void> {
  const flags = await Promise.all(
    ["LDFLAGS", "CPPFLAGS"].map((n) => rConfig(rBinary, n)),
  );
  const missing = searchDirs(...flags).filter((d) => !fs.existsSync(d));
  if (missing.length === 0) return;

  const failed: string[] = [];
  for (const dir of missing) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      failed.push(dir);
    }
  }
  if (failed.length > 0) {
    const code = await exec
      .exec("sudo", ["-n", "mkdir", "-p", ...failed], {
        ignoreReturnCode: true,
        silent: true,
      })
      .catch(() => 1);
    if (code !== 0) {
      core.warning(
        `Could not create ${failed.join(", ")}. The linker may warn about ` +
          "missing search paths, and R CMD check may report this as a WARNING.",
      );
      return;
    }
  }
  core.info(
    `Created empty directories for R's compiler flags: ${missing.join(", ")}`,
  );
}

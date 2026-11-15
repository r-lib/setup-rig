import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";
import { cacheEnabled, cacheKeys, hashFiles, restore } from "./cache.js";
import { parseInputs } from "./inputs.js";
import { resolveRSpec } from "./project.js";
import { installR } from "./r-install.js";
import {
  type CacheInfo,
  type LibraryInfo,
  type Platform,
  type RigDirs,
  rigJson,
} from "./rig.js";
import { installRig } from "./rig-install.js";
import { STATE } from "./state.js";

/** Set an environment variable for this and later steps, unless set. */
function setDefaultEnv(name: string, value: string) {
  if (process.env[name]) return;
  core.exportVariable(name, value);
}

async function run() {
  const inputs = parseInputs();
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const dir = path.resolve(workspace, inputs.workingDirectory);
  const tmp = process.env.RUNNER_TEMP ?? path.join(workspace, "..");

  setDefaultEnv("RIG_MODE", "user");
  setDefaultEnv("RIG_CACHE_DIR", path.join(tmp, "setup-rig-cache"));
  setDefaultEnv("RIG_PREFER_BINARY", "true");
  setDefaultEnv("NOT_CRAN", "true");
  setDefaultEnv("TZ", "UTC");
  setDefaultEnv("_R_CHECK_SYSTEM_CLOCK_", "FALSE");

  const rigInst = await core.group("Installing rig", () =>
    installRig(inputs.rigVersion),
  );
  core.setOutput("rig-version", rigInst.version);
  core.setOutput("rig-path", rigInst.path);
  core.saveState(STATE.rigPath, rigInst.path);

  const dirs = await rigJson<RigDirs>(["system", "dirs"]);
  core.addPath(dirs.binary_dir);
  core.setOutput("cache-dir", dirs.cache_dir);

  const spec = resolveRSpec(inputs.rVersion, dir);
  const r = await installR(spec, inputs.rArch);
  core.setOutput("r-version", r.version);
  core.setOutput("r-path", r.binary);
  const lib = await rigJson<LibraryInfo>(["library", "default"]);
  core.setOutput("library", lib.path);

  // The cache key needs the platform and the R version, so this comes after
  // installing R. The packages are installed by the workflow's own steps,
  // and the post step saves the cache.
  const enabled = cacheEnabled(inputs.enableCache);
  core.saveState(STATE.enabled, String(enabled));
  core.saveState(STATE.saveMode, inputs.saveCache);
  core.saveState(STATE.prune, String(inputs.pruneCache));
  core.saveState(STATE.cacheDir, dirs.cache_dir);
  core.setOutput("cache-hit", "false");
  if (enabled) {
    const platform = await rigJson<Platform>(["system", "detect-platform"]);
    const { key, restoreKeys } = cacheKeys({
      platform: platform.platform,
      rVersion: r.version,
      rDevel:
        ["devel", "next"].includes(spec) || ["devel", "next"].includes(r.name),
      filesHash: await hashFiles(inputs.cacheDependencyGlob, dir),
      suffix: inputs.cacheSuffix,
    });
    const hit = await restore(dirs.cache_dir, key, restoreKeys);
    core.saveState(STATE.key, key);
    core.saveState(STATE.matchedKey, hit ?? "");
    core.setOutput("cache-key", key);
    core.setOutput("cache-hit", String(hit === key));
    const info = await rigJson<CacheInfo>(["cache", "info"]);
    core.saveState(STATE.restoredInfo, JSON.stringify(info));
  }

  const matchers = fileURLToPath(new URL("../../matchers/", import.meta.url));
  for (const m of ["rcmdcheck.json", "testthat.json", "r.json"]) {
    core.info(`::add-matcher::${path.join(matchers, m)}`);
  }
}

run().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));

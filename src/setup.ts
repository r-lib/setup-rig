import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { cacheEnabled, cacheKeys, hashFiles, restore } from "./cache.js";
import { dependencyCommands, isUnpinned } from "./deps.js";
import { parseInputs } from "./inputs.js";
import { detectProject, hasFortran, needsPackages } from "./project.js";
import {
  installR,
  installRtools,
  resolveRSpec,
  setupRepositories,
} from "./r-install.js";
import {
  type CacheInfo,
  type LibraryInfo,
  type Platform,
  type RigDirs,
  rig,
  rigJson,
} from "./rig.js";
import { installRig } from "./rig-install.js";
import { STATE } from "./state.js";
import { installCheckTools, installFortranMacOS } from "./tools.js";

/** Set an environment variable for this and later steps, unless set. */
function setDefaultEnv(name: string, value: string) {
  if (value === "" || process.env[name]) return;
  core.exportVariable(name, value);
}

async function run() {
  const inputs = parseInputs();
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const dir = path.resolve(workspace, inputs.workingDirectory);
  const tmp = process.env.RUNNER_TEMP ?? path.join(workspace, "..");

  setDefaultEnv("RIG_MODE", "user");
  setDefaultEnv("RIG_CACHE_DIR", path.join(tmp, "setup-rig-cache"));
  setDefaultEnv("RIG_PREFER_BINARY", inputs.preferBinary);
  setDefaultEnv("RIG_EXCLUDE_NEWER", inputs.excludeNewer);
  setDefaultEnv("RIG_SYSREQS", inputs.sysreqs);
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

  const project = detectProject(dir);
  const spec = resolveRSpec(inputs, project);
  const r = await installR(spec, inputs);
  core.setOutput("r-version", r.version);
  core.setOutput("r-path", r.binary);
  await installRtools(inputs);
  await setupRepositories(inputs);

  // Cache. The key needs the platform and the R version, so this comes
  // after installing R.
  const enabled = cacheEnabled(inputs.enableCache);
  core.saveState(STATE.enabled, String(enabled));
  core.saveState(STATE.saveMode, inputs.saveCache);
  core.saveState(STATE.prune, String(inputs.pruneCache));
  core.saveState(STATE.cacheDir, dirs.cache_dir);
  if (enabled) {
    const platform = await rigJson<Platform>(["system", "detect-platform"]);
    const rDevel =
      ["devel", "next"].includes(spec) || ["devel", "next"].includes(r.name);
    const { key, restoreKeys } = cacheKeys({
      platform: platform.platform,
      rVersion: r.version,
      rDevel,
      filesHash: await hashFiles(inputs.cacheDependencyGlob, dir),
      unpinned: isUnpinned(inputs, project),
      suffix: inputs.cacheSuffix,
    });
    const hit = await restore(dirs.cache_dir, key, restoreKeys);
    core.saveState(STATE.key, key);
    core.saveState(STATE.matchedKey, hit ?? "");
    core.setOutput("cache-key", key);
    core.setOutput("cache-hit", String(hit === key));
    const info = await rigJson<CacheInfo>(["cache", "info"]);
    core.saveState(STATE.restoredInfo, JSON.stringify(info));
  } else {
    core.setOutput("cache-hit", "false");
  }

  await installCheckTools(inputs.checkTools, dir);
  if (
    process.platform === "darwin" &&
    (inputs.macosFortran === "true" ||
      (inputs.macosFortran === "auto" && hasFortran(dir)))
  ) {
    await installFortranMacOS(r.version);
  }

  const needs = needsPackages(project.description, inputs.needs);
  const cmds = dependencyCommands(inputs, project, needs);
  for (const cmd of cmds) {
    await core.group(`rig ${cmd.join(" ")}`, () => rig(cmd, { cwd: dir }));
  }
  if (cmds.length > 0) {
    await core.group("Installed packages", () =>
      exec.exec("rig", ["pkg", "list"], { cwd: dir, ignoreReturnCode: true }),
    );
  }

  const lib = await rigJson<LibraryInfo>(["library", "default"]);
  core.setOutput("library", lib.path);

  const matchers = fileURLToPath(new URL("../../matchers/", import.meta.url));
  for (const m of ["rcmdcheck.json", "testthat.json", "r.json"]) {
    core.info(`::add-matcher::${path.join(matchers, m)}`);
  }
}

run().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));

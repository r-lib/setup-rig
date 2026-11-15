import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { cacheChanged, defaultBranch, shouldSave } from "./cache.js";
import type { Auto } from "./inputs.js";
import type { CacheInfo } from "./rig.js";
import { STATE } from "./state.js";

async function cacheInfo(rigPath: string): Promise<CacheInfo> {
  const out = await exec.getExecOutput(rigPath, ["cache", "info", "--json"], {
    silent: true,
  });
  return JSON.parse(out.stdout) as CacheInfo;
}

async function run() {
  const enabled = core.getState(STATE.enabled) === "true";
  const mode = (core.getState(STATE.saveMode) || "auto") as Auto;
  if (!shouldSave(mode, enabled, process.env, defaultBranch())) {
    core.info("Not saving the cache, see the save-cache input.");
    return;
  }
  const key = core.getState(STATE.key);
  if (core.getState(STATE.matchedKey) === key) {
    core.info(`Cache hit on ${key}, not saving it again.`);
    return;
  }

  const rigPath = core.getState(STATE.rigPath) || "rig";
  const dir = core.getState(STATE.cacheDir);
  const pruned = core.getState(STATE.prune) === "true";
  if (pruned) {
    for (const category of ["packages", "metadata"]) {
      await exec.exec(rigPath, ["cache", "clean", "--category", category], {
        ignoreReturnCode: true,
      });
    }
  }

  const restored = core.getState(STATE.restoredInfo);
  const before =
    restored && core.getState(STATE.matchedKey)
      ? (JSON.parse(restored) as CacheInfo)
      : undefined;
  if (!cacheChanged(before, await cacheInfo(rigPath), pruned)) {
    core.info("Nothing new in the cache, not saving it.");
    return;
  }

  try {
    await cache.saveCache([dir], key);
    core.info(`Saved the cache with key ${key}.`);
  } catch (e) {
    // e.g. another job saved the same key first
    core.warning(`Failed to save the cache: ${e}`);
  }
}

run().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));

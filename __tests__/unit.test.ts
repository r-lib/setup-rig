import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cacheChanged,
  cacheEnabled,
  cacheKeys,
  isoWeek,
  shouldSave,
} from "../src/cache.js";
import { type Inputs, parseInputs } from "../src/inputs.js";
import { searchDirs } from "../src/macos.js";
import { lockRVersion, resolveRSpec } from "../src/project.js";
import { rAddArgs } from "../src/r-install.js";
import type { CacheInfo } from "../src/rig.js";
import {
  findChecksum,
  parseRigVersion,
  rigAssetName,
  rigAssetUrl,
} from "../src/rig-install.js";

const fixtures = path.join(import.meta.dirname, "fixtures");

function inputs(values: Record<string, string> = {}): Inputs {
  return parseInputs((name) => values[name] ?? "");
}

describe("inputs", () => {
  it("has defaults", () => {
    const i = inputs();
    expect(i.rigVersion).toBe("latest");
    expect(i.rVersion).toBe("");
    expect(i.workingDirectory).toBe(".");
    expect(i.enableCache).toBe("auto");
    expect(i.saveCache).toBe("auto");
    expect(i.pruneCache).toBe(true);
  });
  it("splits globs on lines", () => {
    expect(
      inputs({ "cache-dependency-glob": "a\n b \n\n" }).cacheDependencyGlob,
    ).toEqual(["a", "b"]);
  });
  it("rejects bad values", () => {
    expect(() => inputs({ "save-cache": "always" })).toThrow(/save-cache/);
    expect(() => inputs({ "prune-cache": "maybe" })).toThrow(/prune-cache/);
  });
});

describe("rig download", () => {
  it("names assets", () => {
    expect(rigAssetName("linux", "x64", "latest")).toBe(
      "rig-linux-x86_64-latest.tar.gz",
    );
    expect(rigAssetName("linux", "arm64", "0.11.1")).toBe(
      "rig-linux-aarch64-0.11.1.tar.gz",
    );
    expect(rigAssetName("darwin", "arm64", "latest")).toBe(
      "rig-macos-arm64-latest.tar.gz",
    );
    expect(rigAssetName("win32", "x64", "latest")).toBe(
      "rig-windows-x86_64-latest.zip",
    );
  });
  it("builds URLs", () => {
    expect(rigAssetUrl("linux", "x64", "latest")).toBe(
      "https://github.com/r-lib/rig/releases/download/latest/rig-linux-x86_64-latest.tar.gz",
    );
    expect(rigAssetUrl("win32", "arm64", "nightly")).toBe(
      "https://github.com/r-lib/rig/releases/download/nightly/rig-windows-arm64-nightly.zip",
    );
    expect(rigAssetUrl("darwin", "x64", "v0.11.1")).toBe(
      "https://github.com/r-lib/rig/releases/download/v0.11.1/rig-macos-x86_64-0.11.1.tar.gz",
    );
  });
  it("parses versions and checksums", () => {
    expect(
      parseRigVersion("RIG -- The R Installation Manager 0.11.2-dev"),
    ).toBe("0.11.2-dev");
    expect(
      parseRigVersion(
        "RIG -- The R Installation Manager 0.11.2-dev.20261116.g31ea212",
      ),
    ).toBe("0.11.2-dev.20261116.g31ea212");
    expect(parseRigVersion("RIG -- The R Installation Manager 0.11.1")).toBe(
      "0.11.1",
    );
    const sums =
      "abc123  rig-linux-x86_64-latest.tar.gz\ndef  *rig-macos-arm64-latest.tar.gz\n";
    expect(findChecksum(sums, "rig-macos-arm64-latest.tar.gz")).toBe("def");
    expect(findChecksum(sums, "nope")).toBeUndefined();
  });
});

describe("R version", () => {
  it("reads the R version of rproj.lock", () => {
    const lock = `version = 5\n[[targets]]\nr_version = "4.5.2"\n[[targets]]\nr_version = "4.10.0"\n`;
    expect(lockRVersion(lock)).toBe("4.10.0");
    expect(lockRVersion("version = 5\n")).toBeUndefined();
  });
  it("resolves the spec", () => {
    expect(resolveRSpec("devel", fixtures)).toBe("devel");
    expect(resolveRSpec("", path.join(fixtures, "pkg"))).toBe("release");
  });
  it("builds rig add arguments", () => {
    expect(rAddArgs("release", "")).toEqual([
      "add",
      "release",
      "--without-path",
      "--without-pak",
    ]);
    expect(rAddArgs("4.5", "x86_64")).toEqual([
      "add",
      "4.5",
      "--without-path",
      "--without-pak",
      "--arch",
      "x86_64",
    ]);
  });
});

describe("cache", () => {
  it("follows the enable-cache rules", () => {
    const hosted = {
      RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
    };
    expect(cacheEnabled("auto", hosted)).toBe(true);
    expect(
      cacheEnabled("auto", { ...hosted, RUNNER_ENVIRONMENT: "self-hosted" }),
    ).toBe(false);
    expect(
      cacheEnabled("auto", { ...hosted, GITHUB_EVENT_NAME: "release" }),
    ).toBe(false);
    expect(
      cacheEnabled("auto", { ...hosted, GITHUB_REF: "refs/tags/v1" }),
    ).toBe(false);
    expect(cacheEnabled("true", {})).toBe(true);
  });
  it("computes ISO weeks", () => {
    expect(isoWeek(new Date("2026-11-15T12:00:00Z"))).toBe("2026w46");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026w53");
  });
  it("composes keys", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const p = "x86_64-unknown-linux-gnu-ubuntu-24.04";
    const base = {
      platform: p,
      rVersion: "4.6.1",
      rDevel: false,
      filesHash: "abc",
      suffix: "",
      now,
    };
    expect(cacheKeys(base)).toEqual({
      key: `setup-rig-v1-${p}-r4.6-abc-2026w46`,
      restoreKeys: [`setup-rig-v1-${p}-r4.6-abc-`, `setup-rig-v1-${p}-r4.6-`],
    });
    expect(cacheKeys({ ...base, suffix: "x" }).restoreKeys).toEqual([
      `setup-rig-v1-${p}-r4.6-x-abc-`,
      `setup-rig-v1-${p}-r4.6-x-`,
    ]);
    expect(cacheKeys({ ...base, rDevel: true }).key).toBe(
      `setup-rig-v1-${p}-r4.6-devel-abc-2026w46`,
    );
  });
  it("saves only on the default branch by default", () => {
    const env = { GITHUB_REF: "refs/heads/main" };
    expect(shouldSave("auto", true, env, "main")).toBe(true);
    expect(
      shouldSave("auto", true, { GITHUB_REF: "refs/pull/1/merge" }, "main"),
    ).toBe(false);
    expect(shouldSave("auto", false, env, "main")).toBe(false);
    expect(
      shouldSave("true", true, { GITHUB_REF: "refs/heads/x" }, "main"),
    ).toBe(true);
    expect(shouldSave("false", true, env, "main")).toBe(false);
  });
  it("detects changes", () => {
    const info = (built: number, total: number): CacheInfo => ({
      cache_dir: "",
      built_count: built,
      total_count: total,
      total_size: 0,
      git_mirrors_count: 0,
    });
    expect(cacheChanged(undefined, info(0, 0), true)).toBe(false);
    expect(cacheChanged(undefined, info(1, 1), true)).toBe(true);
    expect(cacheChanged(info(1, 5), info(1, 9), true)).toBe(false);
    expect(cacheChanged(info(1, 5), info(1, 9), false)).toBe(true);
    expect(cacheChanged(info(1, 5), info(2, 5), true)).toBe(true);
  });
});

describe("searchDirs", () => {
  it("finds /opt/R dirs in arm64 flags", () => {
    expect(searchDirs("-L/opt/R/arm64/lib", "-I/opt/R/arm64/include")).toEqual([
      "/opt/R/arm64/lib",
      "/opt/R/arm64/include",
    ]);
  });

  it("finds /opt/R dirs in x86_64 flags", () => {
    expect(
      searchDirs("-L/opt/R/x86_64/lib", "-I/opt/R/x86_64/include"),
    ).toEqual(["/opt/R/x86_64/lib", "/opt/R/x86_64/include"]);
  });

  it("drops duplicates, other paths and odd paths", () => {
    expect(
      searchDirs(
        "-L/opt/R/arm64/lib -L/usr/local/lib -L/opt/R/arm64/lib/",
        "-I/opt/homebrew/include -I/opt/R/../etc -DNDEBUG",
      ),
    ).toEqual(["/opt/R/arm64/lib"]);
  });

  it("handles empty flags", () => {
    expect(searchDirs("", "")).toEqual([]);
    expect(searchDirs()).toEqual([]);
  });
});

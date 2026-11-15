import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cacheChanged,
  cacheEnabled,
  cacheKeys,
  isoWeek,
  shouldSave,
} from "../src/cache.js";
import { dependencyCommands, isUnpinned } from "../src/deps.js";
import { type Inputs, parseInputs, parseList } from "../src/inputs.js";
import {
  detectProject,
  lockRVersion,
  needsPackages,
  parseDcf,
} from "../src/project.js";
import { rAddArgs, repoCommand, rtoolsArgs } from "../src/r-install.js";
import type { CacheInfo } from "../src/rig.js";
import {
  findChecksum,
  parseRigVersion,
  rigAssetName,
  rigAssetUrl,
} from "../src/rig-install.js";
import { wantedTools } from "../src/tools.js";

const fixtures = path.join(import.meta.dirname, "fixtures");

function inputs(values: Record<string, string> = {}): Inputs {
  return parseInputs((name) => values[name] ?? "");
}

describe("inputs", () => {
  it("has defaults", () => {
    const i = inputs();
    expect(i.rigVersion).toBe("latest");
    expect(i.installDependencies).toBe("auto");
    expect(i.devDependencies).toBe(true);
    expect(i.pak).toBe("false");
    expect(i.saveCache).toBe("auto");
    expect(i.useP3m).toBe(true);
  });
  it("splits lists and args", () => {
    expect(parseList("a, b\nc,,")).toEqual(["a", "b", "c"]);
    const i = inputs({
      "install-args": `--prefer-binary=5 --exclude-newer "7 days"`,
    });
    expect(i.installArgs).toEqual([
      "--prefer-binary=5",
      "--exclude-newer",
      "7 days",
    ]);
  });
  it("rejects bad values", () => {
    expect(() => inputs({ "save-cache": "always" })).toThrow(/save-cache/);
    expect(() => inputs({ locked: "true", upgrade: "true" })).toThrow(/locked/);
    expect(() => inputs({ pak: "maybe" })).toThrow(/pak/);
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
    expect(rigAssetUrl("darwin", "x64", "v0.11.1")).toBe(
      "https://github.com/r-lib/rig/releases/download/v0.11.1/rig-macos-x86_64-0.11.1.tar.gz",
    );
  });
  it("parses versions and checksums", () => {
    expect(
      parseRigVersion("RIG -- The R Installation Manager 0.11.2-dev"),
    ).toBe("0.11.2-dev");
    expect(parseRigVersion("RIG -- The R Installation Manager 0.11.1")).toBe(
      "0.11.1",
    );
    const sums =
      "abc123  rig-linux-x86_64-latest.tar.gz\ndef  *rig-macos-arm64-latest.tar.gz\n";
    expect(findChecksum(sums, "rig-macos-arm64-latest.tar.gz")).toBe("def");
    expect(findChecksum(sums, "nope")).toBeUndefined();
  });
});

describe("project", () => {
  it("parses DESCRIPTION and Config/Needs", () => {
    const p = detectProject(path.join(fixtures, "pkg"));
    expect(p.kind).toBe("pkg");
    expect(needsPackages(p.description, ["website", "check"])).toEqual([
      "pkgdown",
      "tidyverse/tidytemplate",
      "rcmdcheck",
    ]);
    expect(parseDcf("A: 1\nB: x,\n  y\n").B).toBe("x,\ny");
  });
  it("detects rig projects", () => {
    const p = detectProject(path.join(fixtures, "proj"));
    expect(p.kind).toBe("proj");
    expect(p.hasLock).toBe(false);
    expect(detectProject(fixtures).kind).toBe("none");
  });
  it("reads the R version of rproj.lock", () => {
    const lock = `version = 5\n[[targets]]\nr_version = "4.5.2"\n[[targets]]\nr_version = "4.10.0"\n`;
    expect(lockRVersion(lock)).toBe("4.10.0");
    expect(lockRVersion("version = 5\n")).toBeUndefined();
  });
});

describe("dependency commands", () => {
  const pkg = detectProject(path.join(fixtures, "pkg"));
  const proj = detectProject(path.join(fixtures, "proj"));
  const none = detectProject(fixtures);

  it("installs package dependencies", () => {
    const i = inputs({
      "extra-packages": "rcmdcheck",
      "install-args": "--no-cache",
    });
    expect(dependencyCommands(i, pkg, ["pkgdown"])).toEqual([
      [
        "pkg",
        "install",
        "--no-install-self",
        "--dev",
        ".",
        "pkgdown",
        "rcmdcheck",
        "--no-cache",
      ],
    ]);
  });
  it("syncs projects, with upgrade", () => {
    const i = inputs({
      upgrade: "true",
      "dev-dependencies": "false",
      needs: "website",
      repositories: "bioconductor",
      "extra-packages": "rcmdcheck",
    });
    expect(dependencyCommands(i, proj, [])).toEqual([
      ["proj", "lock", "--upgrade", "--with-repos=bioconductor"],
      [
        "proj",
        "sync",
        "--no-dev",
        "--group",
        "website",
        "--with-repos=bioconductor",
      ],
      ["pkg", "install", "rcmdcheck"],
    ]);
  });
  it("only installs extra packages without a project", () => {
    expect(dependencyCommands(inputs(), none, [])).toEqual([]);
    expect(
      dependencyCommands(inputs({ "extra-packages": "cli" }), none, []),
    ).toEqual([["pkg", "install", "cli"]]);
    expect(() =>
      dependencyCommands(inputs({ "install-dependencies": "true" }), none, []),
    ).toThrow();
    expect(
      dependencyCommands(inputs({ "install-dependencies": "false" }), pkg, []),
    ).toEqual([]);
  });
  it("knows when versions are not pinned", () => {
    expect(isUnpinned(inputs(), pkg)).toBe(true);
    expect(isUnpinned(inputs(), proj)).toBe(true);
    expect(isUnpinned(inputs(), { ...proj, hasLock: true })).toBe(false);
    expect(
      isUnpinned(inputs({ upgrade: "true" }), { ...proj, hasLock: true }),
    ).toBe(true);
    expect(isUnpinned(inputs(), none)).toBe(false);
  });
});

describe("R installation", () => {
  it("builds rig add arguments", () => {
    expect(rAddArgs("release", inputs())).toEqual([
      "add",
      "release",
      "--without-path",
      "--without-pak",
    ]);
    expect(
      rAddArgs("4.5", inputs({ pak: "devel", "r-arch": "x86_64" })),
    ).toEqual([
      "add",
      "4.5",
      "--without-path",
      "--arch",
      "x86_64",
      "--pak-version",
      "devel",
    ]);
  });
  it("handles rtools and repositories", () => {
    expect(rtoolsArgs("auto")).toEqual(["add", "rtools"]);
    expect(rtoolsArgs("none")).toBeUndefined();
    expect(rtoolsArgs("45")).toEqual(["add", "rtools45"]);
    expect(repoCommand("bioconductor")).toEqual([
      "repos",
      "enable",
      "bioconductor",
    ]);
    expect(repoCommand("rlib=https://r-lib.r-universe.dev")).toEqual([
      "repos",
      "add",
      "rlib",
      "https://r-lib.r-universe.dev",
      "--enable",
      "--force",
    ]);
    expect(repoCommand("https://r-lib.r-universe.dev/")[2]).toBe(
      "r-lib.r-universe.dev",
    );
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
    const base = {
      platform: "x86_64-unknown-linux-gnu-ubuntu-24.04",
      rVersion: "4.6.1",
      rDevel: false,
      filesHash: "abc",
      suffix: "",
      now,
    };
    expect(cacheKeys({ ...base, unpinned: false })).toEqual({
      key: "setup-rig-v1-x86_64-unknown-linux-gnu-ubuntu-24.04-r4.6-abc",
      restoreKeys: ["setup-rig-v1-x86_64-unknown-linux-gnu-ubuntu-24.04-r4.6-"],
    });
    expect(cacheKeys({ ...base, unpinned: true, suffix: "x" })).toEqual({
      key: "setup-rig-v1-x86_64-unknown-linux-gnu-ubuntu-24.04-r4.6-abc-2026w46-x",
      restoreKeys: [
        "setup-rig-v1-x86_64-unknown-linux-gnu-ubuntu-24.04-r4.6-abc-",
        "setup-rig-v1-x86_64-unknown-linux-gnu-ubuntu-24.04-r4.6-",
      ],
    });
    expect(cacheKeys({ ...base, rDevel: true, unpinned: false }).key).toBe(
      "setup-rig-v1-x86_64-unknown-linux-gnu-ubuntu-24.04-r4.6-devel-abc-2026w46",
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

describe("check tools", () => {
  it("picks tools from the package", () => {
    expect(wantedTools("auto", path.join(fixtures, "pkg"))).toEqual([]);
    expect(wantedTools("true", fixtures)).toEqual([
      "qpdf",
      "ghostscript",
      "checkbashisms",
    ]);
    expect(wantedTools("false", fixtures)).toEqual([]);
  });
});

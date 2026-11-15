import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import type { Inputs } from "./inputs.js";
import { lockRVersion, type Project } from "./project.js";
import { type RInstall, rig } from "./rig.js";

/** The R version spec for `rig add`. */
export function resolveRSpec(inputs: Inputs, project: Project): string {
  if (inputs.rVersion !== "") return inputs.rVersion;
  if (project.kind === "proj" && project.hasLock) {
    const v = lockRVersion(
      readFileSync(path.join(project.dir, "rproj.lock"), "utf8"),
    );
    if (v) return v;
  }
  if (project.hasRenvLock) return path.join(project.dir, "renv.lock");
  return "release";
}

export function rAddArgs(spec: string, inputs: Inputs): string[] {
  const args = ["add", spec, "--without-path"];
  if (inputs.rArch !== "") args.push("--arch", inputs.rArch);
  if (inputs.pak === "false") {
    args.push("--without-pak");
  } else {
    args.push("--pak-version", inputs.pak === "devel" ? "devel" : "stable");
  }
  return args;
}

export async function installR(
  spec: string,
  inputs: Inputs,
): Promise<RInstall> {
  const out = await core.group(`Installing R (${spec})`, () =>
    exec.getExecOutput("rig", [...rAddArgs(spec, inputs), "--json"]),
  );
  let r: RInstall;
  try {
    r = JSON.parse(out.stdout) as RInstall;
  } catch {
    throw new Error(`Could not parse the output of 'rig add':\n${out.stdout}`);
  }
  // rig only makes the first R version the default, make sure it is this one.
  if (!r.default) await rig(["default", r.name]);
  core.addPath(path.dirname(r.binary));
  return r;
}

export function rtoolsArgs(rtools: string): string[] | undefined {
  if (rtools === "none" || rtools === "false") return undefined;
  if (rtools === "auto" || rtools === "true") return ["add", "rtools"];
  return ["add", `rtools${rtools.replace(/^rtools/, "")}`];
}

export async function installRtools(inputs: Inputs): Promise<void> {
  if (process.platform !== "win32") return;
  const args = rtoolsArgs(inputs.rtools);
  if (!args) return;
  await core.group("Installing Rtools", () => rig(args));
}

/** A repository input: a rig name, a URL, or `name=URL`. */
export function repoCommand(repo: string): string[] {
  const eq = repo.match(/^([A-Za-z0-9][A-Za-z0-9._/-]*)=(.+)$/);
  if (eq) return ["repos", "add", eq[1], eq[2], "--enable", "--force"];
  if (/^(https?|file):\/\//.test(repo)) {
    const url = new URL(repo);
    const name = `${url.hostname}${url.pathname}`
      .replace(/[^A-Za-z0-9._/-]/g, "-")
      .replace(/[/-]+$/, "");
    return ["repos", "add", name, repo, "--enable", "--force"];
  }
  return ["repos", "enable", repo];
}

export async function setupRepositories(inputs: Inputs): Promise<void> {
  if (inputs.repositories.length === 0 && inputs.useP3m) return;
  await core.group("Setting up package repositories", async () => {
    for (const repo of inputs.repositories) await rig(repoCommand(repo));
    if (!inputs.useP3m) {
      for (const name of ["P3M", "P3M-manylinux"]) {
        await exec.exec("rig", ["repos", "disable", name], {
          ignoreReturnCode: true,
        });
      }
    }
    await rig(["repos", "list"]);
  });
}

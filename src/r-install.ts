import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { type RInstall, rig } from "./rig.js";

export function rAddArgs(spec: string, arch: string): string[] {
  const args = ["add", spec, "--without-path", "--without-pak"];
  if (arch !== "") args.push("--arch", arch);
  return args;
}

/** Install R with rig, make it the default and put it on the PATH. */
export async function installR(spec: string, arch: string): Promise<RInstall> {
  const out = await core.group(`Installing R (${spec})`, () =>
    exec.getExecOutput("rig", [...rAddArgs(spec, arch), "--json"]),
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

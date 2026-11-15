import * as exec from "@actions/exec";

/** Run rig, streaming its output to the log. Throws on failure. */
export async function rig(
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
  await exec.exec("rig", args, { cwd: options.cwd });
}

/** Run rig with `--json` and parse its standard output. */
export async function rigJson<T>(
  args: string[],
  options: { cwd?: string; silent?: boolean } = {},
): Promise<T> {
  const out = await exec.getExecOutput("rig", [...args, "--json"], {
    cwd: options.cwd,
    silent: options.silent ?? true,
  });
  try {
    return JSON.parse(out.stdout) as T;
  } catch {
    throw new Error(
      `Could not parse the output of 'rig ${args.join(" ")} --json':\n${out.stdout}`,
    );
  }
}

export interface RInstall {
  name: string;
  default: boolean;
  version: string;
  aliases: string[];
  path: string;
  binary: string;
  "new-install"?: boolean;
}

export interface RigDirs {
  mode: string;
  binary_dir: string;
  cache_dir: string;
  r_root: string;
}

export interface Platform {
  platform: string;
  arch: string;
  distribution: string | null;
  version: string | null;
}

export interface LibraryInfo {
  rversion: string;
  name: string;
  path: string;
}

export interface CacheInfo {
  cache_dir: string;
  total_size: number;
  total_count: number;
  built_count: number;
  [key: string]: unknown;
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";

const REPO = "https://github.com/r-lib/rig/releases/download";

/** rig's own name for the OS and architecture in release asset names. */
export function rigAssetName(
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): string {
  const arm = arch === "arm64" || arch === "aarch64";
  switch (platform) {
    case "linux":
      return `rig-linux-${arm ? "aarch64" : "x86_64"}-${version}.tar.gz`;
    case "darwin":
      return `rig-macos-${arm ? "arm64" : "x86_64"}-${version}.tar.gz`;
    case "win32":
      return `rig-windows-${arm ? "arm64" : "x86_64"}-${version}.zip`;
    default:
      throw new Error(`rig does not support this platform: ${platform}`);
  }
}

/**
 * `latest` and `nightly` are release tags that move, the others are fixed
 * versions.
 */
export function isRollingVersion(version: string): boolean {
  return version === "latest" || version === "nightly";
}

export function rigReleaseTag(version: string): string {
  return isRollingVersion(version) ? version : `v${version.replace(/^v/, "")}`;
}

export function rigAssetUrl(
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): string {
  const v = isRollingVersion(version) ? version : version.replace(/^v/, "");
  return `${REPO}/${rigReleaseTag(version)}/${rigAssetName(platform, arch, v)}`;
}

/** Parse the version from the first line of `rig --version`. */
export function parseRigVersion(output: string): string {
  const m = output.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  if (!m) throw new Error(`Could not find the rig version in '${output}'.`);
  return m[1];
}

/** Find the sha256 of `asset` in a `SHA256SUMS` file. */
export function findChecksum(sums: string, asset: string): string | undefined {
  for (const line of sums.split("\n")) {
    const [hash, file] = line.trim().split(/\s+\*?/);
    if (file === asset) return hash.toLowerCase();
  }
  return undefined;
}

async function verifyChecksum(
  file: string,
  version: string,
  asset: string,
): Promise<void> {
  let sumsFile: string;
  try {
    sumsFile = await tc.downloadTool(
      `${REPO}/${rigReleaseTag(version)}/SHA256SUMS`,
    );
  } catch {
    core.info("This rig release has no SHA256SUMS file, skipping checksum.");
    return;
  }
  const expected = findChecksum(readFileSync(sumsFile, "utf8"), asset);
  if (!expected) {
    core.info(`No checksum for ${asset} in SHA256SUMS, skipping checksum.`);
    return;
  }
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}.`,
    );
  }
  core.info(`Checksum of ${asset} is OK.`);
}

async function rigVersionOf(bin: string): Promise<string> {
  const out = await exec.getExecOutput(bin, ["--version"], { silent: true });
  return parseRigVersion(out.stdout.split("\n")[0]);
}

export interface RigInstallation {
  version: string;
  path: string;
}

/** Download rig (or take it from the tool cache) and put it on the PATH. */
export async function installRig(
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<RigInstallation> {
  const exe = platform === "win32" ? "rig.exe" : "rig";
  const v = version.replace(/^v/, "");

  if (!isRollingVersion(v)) {
    const cached = tc.find("rig", v, arch);
    if (cached) {
      core.info(`Found rig ${v} in the tool cache.`);
      core.addPath(path.join(cached, "bin"));
      return { version: v, path: path.join(cached, "bin", exe) };
    }
  }

  const url = rigAssetUrl(platform, arch, v);
  const asset = path.basename(url);
  core.info(`Downloading ${url}`);
  const file = await tc.downloadTool(url);
  await verifyChecksum(file, v, asset);
  const dir =
    platform === "win32"
      ? await tc.extractZip(file)
      : await tc.extractTar(file, undefined, "xz");

  const installed = await rigVersionOf(path.join(dir, "bin", exe));
  if (!isRollingVersion(v) && installed !== v) {
    core.warning(`Asked for rig ${v}, but the download is rig ${installed}.`);
  }
  const cached = await tc.cacheDir(dir, "rig", installed, arch);
  core.addPath(path.join(cached, "bin"));
  return { version: installed, path: path.join(cached, "bin", exe) };
}

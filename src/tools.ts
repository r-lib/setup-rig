// Tools for R CMD build / check, and the Fortran compiler on macOS. Ported
// from r-lib/actions/setup-r (src/installer.ts).
import { existsSync, readdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import type { Auto } from "./inputs.js";
import { compareVersions, hasConfigure, hasVignettes } from "./project.js";

export type Tool = "qpdf" | "ghostscript" | "checkbashisms";

const COMMAND: Record<Tool, string> = {
  qpdf: "qpdf",
  ghostscript: process.platform === "win32" ? "gswin64c" : "gs",
  checkbashisms: "checkbashisms",
};

/** The tools to install for `check-tools`, before looking at the PATH. */
export function wantedTools(mode: Auto, dir: string): Tool[] {
  if (mode === "false") return [];
  if (mode === "true") return ["qpdf", "ghostscript", "checkbashisms"];
  const tools: Tool[] = [];
  if (hasVignettes(dir)) tools.push("qpdf", "ghostscript");
  if (hasConfigure(dir)) tools.push("checkbashisms");
  return tools;
}

async function onPath(cmd: string): Promise<boolean> {
  return (await io.which(cmd, false)) !== "";
}

async function sudo(args: string[]): Promise<void> {
  const root = process.getuid?.() === 0;
  if (root) {
    await exec.exec(args[0], args.slice(1));
  } else {
    await exec.exec("sudo", args);
  }
}

export async function installCheckTools(mode: Auto, dir: string) {
  const wanted = wantedTools(mode, dir);
  const missing: Tool[] = [];
  for (const t of wanted) if (!(await onPath(COMMAND[t]))) missing.push(t);
  if (missing.length === 0) return;

  await core.group(`Installing ${missing.join(", ")}`, async () => {
    if (process.platform === "linux") {
      await installLinux(missing);
    } else if (process.platform === "darwin") {
      try {
        await exec.exec("brew", ["unlink", "pkg-config@0.29.2"], {
          silent: true,
          ignoreReturnCode: true,
        });
      } catch {
        // not installed
      }
      process.env.HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK = "true";
      await exec.exec("brew", ["install", ...missing]);
    } else if (process.platform === "win32") {
      if (missing.includes("ghostscript")) await installGsWindows();
      // qpdf comes with Rtools, checkbashisms is not needed on Windows.
    }
  });
}

async function installLinux(tools: Tool[]) {
  if (await onPath("apt-get")) {
    const pkgs = tools.map((t) => (t === "checkbashisms" ? "devscripts" : t));
    process.env.DEBIAN_FRONTEND = "noninteractive";
    await sudo(["apt-get", "update", "-y"]);
    await sudo([
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      ...pkgs,
    ]);
  } else if (await onPath("dnf")) {
    const pkgs = tools.map((t) =>
      t === "checkbashisms" ? "devscripts-checkbashisms" : t,
    );
    await sudo(["dnf", "install", "-y", ...pkgs]);
  } else if (await onPath("zypper")) {
    await sudo(["zypper", "--non-interactive", "install", ...tools]);
  } else {
    core.warning(`Do not know how to install ${tools.join(", ")} here.`);
  }
}

async function installGsWindows() {
  const zip = await tc.downloadTool(
    "https://github.com/r-lib/actions-files/releases/download/v1.0.0/ghostscript-10.03.0-win.zip",
  );
  const dir = await tc.extractZip(zip);
  const target = "c:/program files/gs";
  await io.cp(dir, target, { recursive: true, force: false });
  core.addPath(path.join(target, readdirSync(target)[0], "bin"));
}

/** The Fortran compiler that matches an R version on macOS. */
export function fortranFor(
  rVersion: string,
  arch: string,
): { url: string; kind: "flang" | "pkg"; bin: string } | undefined {
  if (compareVersions(rVersion, "4.7.0") >= 0 && arch === "arm64") {
    return {
      url: "https://mac.cran.dev/tools/flang-23.1.0-darwin23.tar.xz",
      kind: "flang",
      bin: "/opt/R/flang-23/bin",
    };
  }
  if (compareVersions(rVersion, "4.3.0") < 0) return undefined;
  return {
    url:
      compareVersions(rVersion, "4.5.0") < 0
        ? "https://github.com/r-hub/mac-tools/releases/download/tools/gfortran-12.2-universal.pkg"
        : "https://github.com/R-macos/gcc-14-branch/releases/download/gcc-14.2-darwin-r2.1/gfortran-14.2-universal.pkg",
    kind: "pkg",
    bin: "/opt/gfortran/bin",
  };
}

export async function installFortranMacOS(rVersion: string) {
  const ft = fortranFor(rVersion, os.arch());
  if (!ft) {
    core.warning(`setup-rig cannot install Fortran for R ${rVersion}.`);
    return;
  }
  if (existsSync(ft.bin)) return;
  await core.group("Installing Fortran", async () => {
    const file = await tc.downloadTool(ft.url);
    if (ft.kind === "flang") {
      await sudo(["tar", "-xJf", file, "-C", "/"]);
      if (!process.env.SDKROOT) {
        const sdk = await exec.getExecOutput("xcrun", ["--show-sdk-path"]);
        core.exportVariable("SDKROOT", sdk.stdout.trim());
      }
    } else {
      const pkg = `${file}.pkg`;
      await io.mv(file, pkg);
      await sudo(["installer", "-allowUntrusted", "-pkg", pkg, "-target", "/"]);
    }
    core.addPath(ft.bin);
  });
}

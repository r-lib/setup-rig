import type { Inputs } from "./inputs.js";
import type { Project } from "./project.js";

/**
 * The rig commands that install the dependencies, without the leading
 * `rig`. Pure, so it can be tested without running anything.
 */
export function dependencyCommands(
  inputs: Inputs,
  project: Project,
  needsPkgs: string[],
): string[][] {
  const mode = inputs.installDependencies;
  const extra = inputs.extraPackages;
  const install = (pkgs: string[]) => [
    "pkg",
    "install",
    ...pkgs,
    ...inputs.installArgs,
  ];

  if (mode === "true" && project.kind === "none") {
    throw new Error(
      `install-dependencies is true, but there is no rproj.toml or DESCRIPTION in ${project.dir}.`,
    );
  }

  const cmds: string[][] = [];
  const kind = mode === "false" ? "none" : project.kind;

  if (kind === "proj") {
    const withRepos =
      inputs.repositories.length > 0
        ? [`--with-repos=${inputs.repositories.join(",")}`]
        : [];
    if (inputs.upgrade) {
      cmds.push([
        "proj",
        "lock",
        "--upgrade",
        ...withRepos,
        ...inputs.lockArgs,
      ]);
    }
    cmds.push([
      "proj",
      "sync",
      ...(inputs.locked ? ["--locked"] : []),
      ...(inputs.devDependencies ? [] : ["--no-dev"]),
      ...inputs.needs.flatMap((g) => ["--group", g]),
      ...withRepos,
      ...inputs.syncArgs,
    ]);
    if (extra.length > 0) cmds.push(install(extra));
  } else if (kind === "pkg") {
    cmds.push([
      "pkg",
      "install",
      "--no-install-self",
      ...(inputs.devDependencies ? ["--dev"] : []),
      ".",
      ...needsPkgs,
      ...extra,
      ...inputs.installArgs,
    ]);
  } else if (extra.length > 0) {
    cmds.push(install(extra));
  }
  return cmds;
}

/**
 * Whether the installed versions depend on the day, not only on the
 * dependency files: then the cache key gets the week, see `cache.ts`.
 */
export function isUnpinned(inputs: Inputs, project: Project): boolean {
  if (inputs.installDependencies === "false") {
    return inputs.extraPackages.length > 0;
  }
  if (project.kind === "proj") return inputs.upgrade || !project.hasLock;
  return project.kind === "pkg" || inputs.extraPackages.length > 0;
}

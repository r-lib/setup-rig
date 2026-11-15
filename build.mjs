// Bundle the main and post steps into self-contained ES modules in dist/.
// The @actions/* packages are ES modules, so we bundle as ESM, and add a
// `require` shim for the CommonJS dependencies they pull in.
import { build } from "esbuild";

const banner = [
  "import { createRequire as __setupRigCreateRequire } from 'node:module';",
  "const require = __setupRigCreateRequire(import.meta.url);",
].join("\n");

for (const [entry, out] of [
  ["src/setup.ts", "dist/setup/index.mjs"],
  ["src/save-cache.ts", "dist/save-cache/index.mjs"],
]) {
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: { js: banner },
    legalComments: "none",
    logLevel: "info",
  });
}

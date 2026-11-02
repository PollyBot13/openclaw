import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Native UI is built by the host's plugin builder before this portable package step.
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = process.argv[2];
if (!destination) {
  throw new Error("Usage: node scripts/package.mjs <new-package-directory>");
}
await fs.mkdir(destination, { recursive: false });
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "dist/openclaw.plugin.json"), "utf8"),
);
await build({
  entryPoints: [path.join(root, "index.ts")],
  outfile: path.join(destination, "index.js"),
  platform: "node",
  format: "esm",
  target: "node24",
  bundle: true,
  external: ["openclaw/plugin-sdk/*"],
});
const assets = path.dirname(manifest.controlUi.entry);
await fs.cp(path.join(root, assets), path.join(destination, assets), { recursive: true });
await fs.copyFile(path.join(root, "README.md"), path.join(destination, "README.md"));
await fs.writeFile(
  path.join(destination, "openclaw.plugin.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await fs.writeFile(
  path.join(destination, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      type: "module",
      files: ["index.js", "openclaw.plugin.json", "dist", "README.md"],
      openclaw: { extensions: ["./index.js"] },
    },
    null,
    2,
  ) + "\n",
);
console.log(path.resolve(destination));

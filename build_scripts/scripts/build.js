import * as path from "path";
import * as fs from "fs/promises";
import esbuild from "esbuild";
import { run } from "runish";

const OUT_DIR = path.resolve("./out");
const RELEASE_DIR = path.join(OUT_DIR, "release");
const TSC = path.resolve("node_modules/typescript/bin/tsc");
const { RELEASE } = process.env;
const TARGET_DIR = RELEASE ? RELEASE_DIR : OUT_DIR;

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  if (RELEASE) {
    await fs.rm(RELEASE_DIR, { force: true, recursive: true });
    await fs.mkdir(RELEASE_DIR, { recursive: true });
  }

  await run(TSC, [
    "--declaration",
    "--emitDeclarationOnly",
    "--outDir",
    path.join(OUT_DIR, "types"),
  ]);

  await esbuild.build({
    entryPoints: ["src/index.ts"],
    outdir: TARGET_DIR,
    bundle: true,
    write: true,
    format: "esm",
    target: "es2020",
    minify: !!RELEASE,
  });

  await esbuild.build({
    entryPoints: ["tests/index.ts"],
    outdir: path.join(OUT_DIR, "tests"),
    bundle: true,
    write: true,
    format: "esm",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import * as path from "path";
import * as fs from "fs/promises";
import { run } from "runish";

const OUT_DIR = path.resolve("./out");
const LIB_DIR = path.resolve("./lib");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  await run("pyodide", ["build", "--exports", "whole_archive"], {
    cwd: path.join(LIB_DIR, "PyMuPDF"),
    env: {
      SKIP_EMSCRIPTEN_VERSION_CHECK: "1",
      HAVE_LIBCRYPTO: "no",
      OS: "pyodide",
      PYMUPDF_SETUP_FLAVOUR: "pb",
      PYMUPDF_SETUP_MUPDF_BUILD_TESSERACT: "0",
      PYMUPDF_SETUP_MUPDF_TESSERACT: "0",
      ...process.env,
    },
  });

  const whl = "pymupdf-1.26.1-cp313-none-pyodide_2025_0_wasm32.whl";
  await fs.cp(path.join(LIB_DIR, "PyMuPDF/dist", whl), path.join(OUT_DIR, whl));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

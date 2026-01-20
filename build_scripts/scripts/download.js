import * as path from "path";
import * as fs from "fs/promises";
import { run } from "runish";
import { existsSync } from "fs";

const LIB_DIR = path.resolve("./lib");
const OUT_DIR = path.resolve("./out");

async function main() {
  await fs.mkdir(LIB_DIR, { recursive: true });

  const libs = [
    [
      "PyMuPDF",
      "https://github.com/pymupdf/PyMuPDF",
      "4a53405a51d29f2f620c0c7659b7c4d404a9f9c0",
    ],
  ];
  for (const [name, repo, hash, callback] of libs) {
    process.chdir(LIB_DIR);
    const cloned = await gitClone(name, repo, hash);
    if (cloned && callback) await callback();
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const assets = [
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide.js",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/python_stdlib.zip",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide.asm.wasm",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide-lock.json",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide.asm.js",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/lxml-5.4.0-cp313-cp313-pyodide_2025_0_wasm32.whl",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/typing_extensions-4.12.2-py3-none-any.whl",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/opencv_python-4.11.0.86-cp313-cp313-pyodide_2025_0_wasm32.whl",
    "https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/fonttools-4.56.0-py3-none-any.whl",
    "https://files.pythonhosted.org/packages/d0/00/1e03a4989fa5795da308cd774f05b704ace555a70f9bf9d3be057b680bcf/python_docx-1.2.0-py3-none-any.whl",
    "https://files.pythonhosted.org/packages/b5/f9/6d567df395c0409baf2b4dd9cd30d1e977c70672fe7ec2a684af1e6aa41c/pdf2docx-0.5.8-py3-none-any.whl",
  ];
  for (let url of assets) {
    const name = url.split("/").at(-1);
    if (name === "pyodide.js") url = url.replace(/.js$/, () => ".mjs");
    await download(name, url);
  }
}

async function gitClone(name, repo, hash) {
  if (existsSync(name)) return;

  console.log(`git cloning ${name} - ${repo} - ${hash}`);
  await run("git", ["init", name]);
  process.chdir(path.join(LIB_DIR, name));
  await run("git", ["fetch", "--depth", "1", repo, hash]);
  await run("git", ["checkout", "FETCH_HEAD"]);
  return true;
}

async function download(name, url) {
  const filePath = path.join(OUT_DIR, name);

  if (existsSync(filePath)) return;

  console.log(`downloading ${name} - ${url}`);
  const buf = await fetch(url).then((x) => x.arrayBuffer());
  await fs.writeFile(filePath, Buffer.from(buf));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

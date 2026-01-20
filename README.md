# @bentopdf/pymupdf-wasm

PyMuPDF compiled to WebAssembly for full PDF manipulation in the browser.

## Notice

This package is a modified version of PyMuPDF, originally developed by Artifex Software, Inc.

It has been adapted for WebAssembly (WASM) and dynamic loading.

## Attribution

PyMuPDF is copyright © Artifex Software, Inc.
This package is distributed under the GNU Affero General Public License v3.0.

This project is not affiliated with or endorsed by Artifex Software, Inc.

## Source Code Availability

This program is licensed under the GNU Affero General Public License v3.0.
If you interact with this program over a network, you are entitled to
receive the complete corresponding source code.

The source code for this package is available at:
https://github.com/alam00000/bentopdf-pymupdf-wasm

This package includes the complete **Corresponding Source** (build scripts and configuration) in the `build_scripts/` directory.

### Build Instructions

To rebuild the WASM binary from source:
1. Download the source code from the repository or this package.
2. Navigate to the `build_scripts/` directory.
3. Follow the instructions in `build_scripts/README.md` (uses Docker).

## License

This project is licensed under the [AGPL-3.0-only](LICENSE) license.
See the License section below for details on included components.

## Features

- **Open** PDF, XPS, EPUB, and images
- **Convert** any supported format to PDF
- **Extract** text, images, and tables
- **Merge and Split** PDF documents
- **Page manipulation** - rotate, crop, delete, reorder
- **Annotations** - highlights, notes, shapes
- **Security** - encrypt, decrypt, redact
- **Forms** - read and fill form fields
- **PDF to DOCX** conversion (via pdf2docx)

## Installation

```bash
npm install @bentopdf/pymupdf-wasm
```

## Quick Start

```javascript
import { PyMuPDF } from '@bentopdf/pymupdf-wasm';

const pymupdf = new PyMuPDF({
  assetPath: '/assets/pymupdf/',
  ghostscriptUrl: 'https://cdn.jsdelivr.net/npm/@bentopdf/gs-wasm@0.1.0/' // Optional: for RGB conversion
});

await pymupdf.load();
```

## Credits & Copyrights

- **PyMuPDF**: © Artifex Software, Inc. (AGPL-3.0)
- **Ghostscript**: © Artifex Software, Inc. (AGPL-3.0)
- **Pyodide**: © Mozilla Foundation / Michael Droettboom (MPL-2.0)
- **pdf2docx**: © Artifex Software, Inc. (AGPL-3.0)

This package combines these components and is distributed under AGPL-3.0.

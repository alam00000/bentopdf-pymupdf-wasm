# @bentopdf/pymupdf-wasm

PyMuPDF compiled to WebAssembly for full PDF manipulation in the browser.

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

// Initialize with path to assets
const pymupdf = new PyMuPDF('/assets/pymupdf/');

// Preload (optional, speeds up first operation)
await pymupdf.load();

// Open a PDF
const doc = await pymupdf.open(pdfFile);

// Extract text
const text = doc.getPage(0).getText();

// Save with modifications
const blob = doc.saveAsBlob();
doc.close();
```

## API Reference

### PyMuPDF Class

```javascript
const pymupdf = new PyMuPDF(assetPath);

// Document operations
const doc = await pymupdf.open(file);
const doc = await pymupdf.openUrl('https://example.com/doc.pdf');
const doc = await pymupdf.create(); // Empty PDF

// Utilities
const merged = await pymupdf.merge([pdf1, pdf2, pdf3]);
const [part1, part2] = await pymupdf.split(pdf, [
  { start: 0, end: 4 },
  { start: 5, end: 9 }
]);
const text = await pymupdf.extractText(pdf);
const image = await pymupdf.renderPage(pdf, 0, 150); // 150 DPI

// PDF to DOCX
const docx = await pymupdf.pdfToDocx(pdf);

// File to PDF conversion
// Supports: XPS, EPUB, MOBI, FB2, CBZ, SVG, images (JPEG, PNG, BMP, GIF, TIFF, WEBP)
const pdfFromXps = await pymupdf.xpsToPdf(xpsFile);
const pdfFromEpub = await pymupdf.epubToPdf(epubFile);
const pdfFromImage = await pymupdf.imageToPdf(imageFile);
const pdfFromSvg = await pymupdf.svgToPdf(svgFile);
const pdfFromImages = await pymupdf.imagesToPdf([img1, img2, img3]);
const pdfFromAny = await pymupdf.convertToPdf(file, { filetype: 'svg' });

// PDF to other formats
const images = await pymupdf.pdfToImages(pdf, { format: 'png', dpi: 300 });
const svgs = await pymupdf.pdfToSvg(pdf);
const text = await pymupdf.pdfToText(pdf);
const html = await pymupdf.pdfToHtml(pdf);
const json = await pymupdf.pdfToJson(pdf);
const xml = await pymupdf.pdfToXml(pdf);
```

### Document Operations

```javascript
// Properties
doc.pageCount;
doc.metadata;    // { title, author, ... }
doc.isEncrypted;

// Page access
const page = doc.getPage(0);
for (const page of doc.pages()) { ... }

// Modify
doc.deletePage(5);
doc.insertBlankPage(0);
doc.movePage(3, 0);

// Merge another PDF
const other = await pymupdf.open(otherPdf);
doc.insertPdf(other);

// Save
const pdf = doc.save();
const blob = doc.saveAsBlob();
doc.close();
```

### Page Operations

```javascript
const page = doc.getPage(0);

// Properties
page.width;
page.height;
page.rotation;
page.setRotation(90);

// Text
const text = page.getText();
const rects = page.searchFor("keyword");
page.insertText({ x: 100, y: 100 }, "Hello", { fontsize: 14 });

// Images
const images = page.getImages();
const img = page.extractImage(images[0].xref);
page.insertImage(rect, imageData);

// Annotations
page.addHighlight(rect, { r: 1, g: 1, b: 0 });
page.addTextAnnotation({ x: 100, y: 100 }, "Note");
const annots = page.getAnnotations();

// Render
const png = await page.toImage({ dpi: 300 });
const svg = page.toSvg();

// Redaction
page.addRedaction(rect);
page.applyRedactions();
```

### Security

```javascript
// Encrypt
const pdf = doc.save({
  encryption: {
    ownerPassword: 'secret',
    userPassword: 'user123',
    permissions: {
      print: true,
      copy: false
    }
  }
});

// Decrypt
if (doc.needsPass) {
  doc.authenticate('password');
}
```

### Forms

```javascript
if (doc.isFormPdf) {
  const fields = doc.getFormFields();
  doc.setFormField('name', 'John Doe');
  doc.setFormField('agree', true);
}
```

## Asset Files

Copy the following files to your assets directory:

```
assets/pymupdf/
├── pyodide.js
├── pyodide.asm.js
├── pyodide.asm.wasm
├── pyodide-lock.json
├── python_stdlib.zip
├── pymupdf-*.whl
├── fonttools-*.whl
├── lxml-*.whl
├── numpy-*.whl
├── opencv_python-*.whl
├── pdf2docx-*.whl
├── python_docx-*.whl
└── typing_extensions-*.whl
```

## About

This package was ported to work with [BentoPDF](https://bentopdf.com), an open-source PDF toolkit. Maintenance and updates will be focused on features required by BentoPDF.

- Website: [bentopdf.com](https://bentopdf.com)
- GitHub: [https://github.com/alam00000/bentopdf](https://github.com/alam00000/bentopdf)

## License

AGPL-3.0

## Credits

- [PyMuPDF](https://github.com/pymupdf/PyMuPDF) - Python bindings for MuPDF
- [Pyodide](https://pyodide.org/) - Python in the browser
- [pdf2docx](https://github.com/dothinking/pdf2docx) - PDF to DOCX conversion

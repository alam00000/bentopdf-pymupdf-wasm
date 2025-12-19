import { PyMuPDFDocument } from './document';
import type { PyodideInterface, LlamaIndexDocument } from './types';
import loadGhostscriptWASM from '@okathira/ghostpdl-wasm';

interface GhostscriptModule {
    FS: {
        writeFile(path: string, data: Uint8Array | string): void;
        readFile(path: string, opts?: { encoding?: string }): Uint8Array;
        unlink(path: string): void;
        stat(path: string): { size: number };
    };
    callMain(args: string[]): number;
}

/**
 * Convert PDF to RGB colorspace using Ghostscript
 * This fixes CMYK images that cause issues with pdf2docx
 */
async function convertPdfToRgb(pdfData: Uint8Array): Promise<Uint8Array> {
    console.log('[convertPdfToRgb] Starting Ghostscript RGB conversion...');
    console.log('[convertPdfToRgb] Input size:', pdfData.length);

    const gs = await loadGhostscriptWASM({
        locateFile: (path: string) => {
            if (path.endsWith('.wasm')) {
                return '/ghostscript-wasm/gs.wasm';
            }
            return path;
        },
        print: (text: string) => console.log('[GS RGB]', text),
        printErr: (text: string) => console.error('[GS RGB Error]', text),
    }) as GhostscriptModule;

    const inputPath = '/tmp/cmyk_input.pdf';
    const outputPath = '/tmp/rgb_output.pdf';

    gs.FS.writeFile(inputPath, pdfData);
    console.log('[convertPdfToRgb] Wrote input file');

    const args = [
        '-dBATCH',
        '-dNOPAUSE',
        '-dNOSAFER',
        '-dQUIET',
        '-sDEVICE=pdfwrite',
        '-sColorConversionStrategy=sRGB',
        '-sColorConversionStrategyForImages=sRGB',
        '-dConvertCMYKImagesToRGB=true',
        '-dProcessColorModel=/DeviceRGB',
        '-dAutoFilterColorImages=true',
        '-dAutoFilterGrayImages=true',
        '-dColorImageFilter=/DCTEncode',
        '-dGrayImageFilter=/DCTEncode',
        '-dCompatibilityLevel=1.4',
        `-sOutputFile=${outputPath}`,
        inputPath,
    ];

    console.log('[convertPdfToRgb] Running Ghostscript with args:', args.join(' '));

    let exitCode: number;
    try {
        exitCode = gs.callMain(args);
    } catch (e) {
        console.error('[convertPdfToRgb] Ghostscript exception:', e);
        try { gs.FS.unlink(inputPath); } catch { /* ignore */ }
        throw new Error(`Ghostscript threw exception: ${e}`);
    }

    console.log('[convertPdfToRgb] Ghostscript exit code:', exitCode);

    if (exitCode !== 0) {
        try { gs.FS.unlink(inputPath); } catch { /* ignore */ }
        try { gs.FS.unlink(outputPath); } catch { /* ignore */ }
        throw new Error(`Ghostscript RGB conversion failed with exit code ${exitCode}`);
    }

    let output: Uint8Array;
    try {
        const stat = gs.FS.stat(outputPath);
        console.log('[convertPdfToRgb] Output file size:', stat.size);
        output = gs.FS.readFile(outputPath);
    } catch (e) {
        console.error('[convertPdfToRgb] Failed to read output:', e);
        try { gs.FS.unlink(inputPath); } catch { /* ignore */ }
        throw new Error('Ghostscript did not produce output file');
    }

    try { gs.FS.unlink(inputPath); } catch { /* ignore */ }
    try { gs.FS.unlink(outputPath); } catch { /* ignore */ }

    const copy = new Uint8Array(output.length);
    copy.set(output);

    console.log('[convertPdfToRgb] Conversion complete, output size:', copy.length);
    return copy;
}

const ASSETS = {
    pyodide: 'pyodide.js',
    wheels: [
        'pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl',
        'pymupdf4llm-0.0.27-py3-none-any.whl',
        'fonttools-4.56.0-py3-none-any.whl',
        'lxml-5.4.0-cp313-cp313-pyodide_2025_0_wasm32.whl',
        'numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl',
        'opencv_python-4.11.0.86-cp313-cp313-pyodide_2025_0_wasm32.whl',
        'pdf2docx-0.5.8-py3-none-any.whl',
        'python_docx-1.2.0-py3-none-any.whl',
        'typing_extensions-4.12.2-py3-none-any.whl'
    ]
};

export interface PyMuPDFOptions {
    assetPath?: string;
}

export interface EpubOptions {
    title?: string;
    author?: string;
    toc?: boolean;
    pandocAssetPath?: string; // TODO@ALAM - revisit to implement 
}

export class PyMuPDF {
    private assetPath: string;
    private pyodidePromise: Promise<PyodideInterface> | null = null;
    private pyodide: PyodideInterface | null = null;
    private docCounter = 0;

    constructor(options?: PyMuPDFOptions | string) {
        if (typeof options === 'string') {
            this.assetPath = options;
        } else {
            this.assetPath = options?.assetPath ?? './';
        }
        if (!this.assetPath.endsWith('/')) {
            this.assetPath += '/';
        }
    }

    private getAssetPath(name: string): string {
        return this.assetPath + name;
    }

    async load(): Promise<void> {
        await this.getPyodide();
    }

    private async getPyodide(): Promise<PyodideInterface> {
        if (this.pyodide) return this.pyodide;
        if (this.pyodidePromise) return this.pyodidePromise;
        this.pyodidePromise = this.initPyodide();
        this.pyodide = await this.pyodidePromise;
        return this.pyodide;
    }

    private async initPyodide(): Promise<PyodideInterface> {
        const pyodideUrl = this.getAssetPath(ASSETS.pyodide);
        const pyodideModule = await import(/* @vite-ignore */ pyodideUrl);
        const { loadPyodide } = pyodideModule;
        const pyodide = await loadPyodide({
            indexURL: this.assetPath
        }) as PyodideInterface;

        await Promise.all(
            ASSETS.wheels.map(wheel => pyodide.loadPackage(this.getAssetPath(wheel)))
        );

        pyodide.runPython(`
import pymupdf
pymupdf.TOOLS.store_shrink(100)
`);
        return pyodide;
    }

    async open(input: Blob | File): Promise<PyMuPDFDocument> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const docVar = `_doc${docId}`;
        const inputPath = `/input_${docId}`;

        const buf = await input.arrayBuffer();
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));
        pyodide.runPython(`${docVar} = pymupdf.open("${inputPath}")`);

        return new PyMuPDFDocument(pyodide, docVar, inputPath);
    }

    async openUrl(url: string): Promise<PyMuPDFDocument> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }
        const blob = await response.blob();
        return this.open(blob);
    }

    async create(): Promise<PyMuPDFDocument> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const docVar = `_doc${docId}`;
        const inputPath = `/input_${docId}`;

        pyodide.runPython(`${docVar} = pymupdf.open()`);
        return new PyMuPDFDocument(pyodide, docVar, inputPath);
    }

    async pdfToDocx(pdf: Blob | File, pages?: number[]): Promise<Blob> {
        const pyodide = await this.getPyodide();
        const buf = await pdf.arrayBuffer();
        let pdfData: Uint8Array = new Uint8Array(buf);

        console.log('[pdfToDocx] Converting PDF to RGB colorspace with Ghostscript...');
        try {
            const rgbData = await convertPdfToRgb(pdfData);
            pdfData = rgbData;
            console.log('[pdfToDocx] RGB conversion complete');
        } catch (e) {
            console.warn('[pdfToDocx] Ghostscript RGB conversion failed, trying original:', e);
        }

        pyodide.FS.writeFile('/input.pdf', pdfData);

        const pagesArg = pages ? `[${pages.join(', ')}]` : 'None';

        pyodide.runPython(`
import pymupdf
from pdf2docx import Converter
from pdf2docx.image.ImagesExtractor import ImagesExtractor

# Store original _to_raw_dict static method
_orig_to_raw_dict = ImagesExtractor._to_raw_dict

def _patched_to_raw_dict(image, bbox):
    """Convert non-RGB pixmaps to RGB before processing.
    
    This is a staticmethod that takes (image, bbox).
    PNG format only supports grayscale and RGB, so we need to convert
    CMYK and other colorspaces to RGB.
    """
    pix = image
    
    # Check if pixmap needs conversion to RGB
    # PNG only supports: Grayscale (n=1), Grayscale+Alpha (n=2), RGB (n=3), RGBA (n=4)
    needs_conversion = False
    
    if hasattr(pix, 'colorspace') and pix.colorspace:
        cs_name = pix.colorspace.name.upper() if pix.colorspace.name else ''
        # Convert if not grayscale or RGB
        if 'CMYK' in cs_name or 'DEVICECMYK' in cs_name:
            needs_conversion = True
        elif cs_name not in ('DEVICEGRAY', 'GRAY', 'DEVICERGB', 'RGB', 'SRGB', ''):
            # Unknown colorspace - try to convert to RGB
            needs_conversion = True
    
    # Also check by component count: CMYK has n=4 without alpha
    if not needs_conversion and hasattr(pix, 'n') and hasattr(pix, 'alpha'):
        if pix.n == 4 and not pix.alpha:
            # Likely CMYK (4 components, no alpha)
            needs_conversion = True
        elif pix.n > 4:
            # More than 4 components - definitely needs conversion
            needs_conversion = True
    
    if needs_conversion:
        try:
            # Convert to RGB
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        except Exception as e:
            # If direct conversion fails, try via samples
            try:
                # Create a new RGB pixmap with same dimensions
                new_pix = pymupdf.Pixmap(pymupdf.csRGB, pix.irect)
                new_pix.set_rect(pix.irect, (255, 255, 255))  # White background
                # Insert the original (this handles conversion)
                new_pix.copy(pix, pix.irect)
                pix = new_pix
            except:
                # Last resort: just pass through and hope for the best
                pass
    
    # Call original static method with converted pixmap and bbox
    return _orig_to_raw_dict(pix, bbox)

# Apply patch as staticmethod
ImagesExtractor._to_raw_dict = staticmethod(_patched_to_raw_dict)

cv = Converter("/input.pdf")
cv.convert("/output.docx", pages=${pagesArg})
cv.close()

# Restore original
ImagesExtractor._to_raw_dict = _orig_to_raw_dict
`);

        const outputBuf = pyodide.FS.readFile('/output.docx');
        try {
            pyodide.FS.unlink('/input.pdf');
            pyodide.FS.unlink('/output.docx');
        } catch { /* ignore cleanup errors */ }

        return new Blob([new Uint8Array(outputBuf)], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
    }

    async merge(pdfs: (Blob | File)[]): Promise<Blob> {
        if (pdfs.length === 0) {
            throw new Error('No PDFs provided for merging');
        }

        const result = await this.open(pdfs[0]);
        for (let i = 1; i < pdfs.length; i++) {
            const doc = await this.open(pdfs[i]);
            result.insertPdf(doc);
            doc.close();
        }
        const blob = result.saveAsBlob();
        result.close();
        return blob;
    }

    async split(pdf: Blob | File, ranges: Array<{ start: number; end: number }>): Promise<Blob[]> {
        const results: Blob[] = [];
        const source = await this.open(pdf);
        const pageCount = source.pageCount;

        for (const range of ranges) {
            const start = Math.max(0, range.start);
            const end = Math.min(pageCount - 1, range.end);
            if (start > end) continue;

            const newDoc = await this.create();
            newDoc.insertPdf(source, { fromPage: start, toPage: end });
            results.push(newDoc.saveAsBlob());
            newDoc.close();
        }

        source.close();
        return results;
    }

    async extractText(pdf: Blob | File): Promise<string> {
        const doc = await this.open(pdf);
        let text = '';
        for (const page of doc.pages()) {
            text += page.getText() + '\n';
        }
        doc.close();
        return text.trim();
    }

    async renderPage(pdf: Blob | File, pageIndex: number, dpi = 150): Promise<Uint8Array> {
        const doc = await this.open(pdf);
        const page = doc.getPage(pageIndex);
        const image = await page.toImage({ dpi });
        doc.close();
        return image;
    }

    async convertToPdf(file: Blob | File, options?: { filetype?: string }): Promise<Blob> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const inputPath = `/convert_input_${docId}`;

        const filename = file instanceof File ? file.name : 'document';
        const ext = options?.filetype ?? filename.split('.').pop()?.toLowerCase() ?? '';

        const buf = await file.arrayBuffer();
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

        const result = pyodide.runPython(`
import base64

src = pymupdf.open("${inputPath}"${ext ? `, filetype="${ext}"` : ''})
pdf_bytes = src.convert_to_pdf()
src.close()

pdf = pymupdf.open("pdf", pdf_bytes)
output = pdf.tobytes(garbage=3, deflate=True)
pdf.close()

base64.b64encode(output).decode('ascii')
`) as string;

        try {
            pyodide.FS.unlink(inputPath);
        } catch { /* ignore cleanup errors */ }

        const binary = atob(result);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    }

    /**
     * Repair a PDF by re-opening and re-saving with garbage collection and compression.
     * This fixes stream length issues that can occur from Ghostscript WASM output.
     * @param pdf The PDF to repair
     * @returns Repaired PDF blob
     */
    async repairPdf(pdf: Blob | File): Promise<Blob> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const inputPath = `/repair_input_${docId}`;

        const buf = await pdf.arrayBuffer();
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

        const result = pyodide.runPython(`
import base64

# Open the PDF (this re-parses and fixes internal structure)
doc = pymupdf.open("${inputPath}")

# Re-save with garbage collection and deflate compression
# garbage=4 is the most aggressive cleanup (includes unused objects and duplicate streams)
# deflate=True compresses streams
output = doc.tobytes(garbage=4, deflate=True, clean=True)
doc.close()

base64.b64encode(output).decode('ascii')
`) as string;

        try {
            pyodide.FS.unlink(inputPath);
        } catch { /* ignore cleanup errors */ }

        const binary = atob(result);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    }

    async xpsToPdf(xps: Blob | File): Promise<Blob> {
        return this.convertToPdf(xps, { filetype: 'xps' });
    }

    async epubToPdf(epub: Blob | File): Promise<Blob> {
        return this.convertToPdf(epub, { filetype: 'epub' });
    }

    async imageToPdf(image: Blob | File, options?: { imageType?: string }): Promise<Blob> {
        return this.convertToPdf(image, { filetype: options?.imageType });
    }

    async svgToPdf(svg: Blob | File): Promise<Blob> {
        return this.convertToPdf(svg, { filetype: 'svg' });
    }

    async imagesToPdf(images: (Blob | File)[]): Promise<Blob> {
        if (images.length === 0) {
            throw new Error('No images provided');
        }

        const pyodide = await this.getPyodide();
        pyodide.runPython(`_multi_img_pdf = pymupdf.open()`);

        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const inputPath = `/multi_img_${i}`;
            const buf = await image.arrayBuffer();
            pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

            pyodide.runPython(`
img_doc = pymupdf.open("${inputPath}")
pdf_bytes = img_doc.convert_to_pdf()
img_pdf = pymupdf.open("pdf", pdf_bytes)
_multi_img_pdf.insert_pdf(img_pdf)
img_pdf.close()
img_doc.close()
`);
            try {
                pyodide.FS.unlink(inputPath);
            } catch { /* ignore */ }
        }

        const result = pyodide.runPython(`
import base64
output = _multi_img_pdf.tobytes(garbage=3, deflate=True)
_multi_img_pdf.close()
base64.b64encode(output).decode('ascii')
`) as string;

        const binary = atob(result);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    }

    async pdfToImages(pdf: Blob | File, options?: {
        format?: 'png' | 'jpeg' | 'pnm' | 'pgm' | 'pbm' | 'ppm' | 'pam' | 'psd' | 'ps';
        dpi?: number;
        pages?: number[];
    }): Promise<Uint8Array[]> {
        const pyodide = await this.getPyodide();
        const doc = await this.open(pdf);
        const format = options?.format ?? 'png';
        const dpi = options?.dpi ?? 150;
        const zoom = dpi / 72;
        const pageCount = doc.pageCount;
        const pagesToExport = options?.pages ?? Array.from({ length: pageCount }, (_, i) => i);

        const results: Uint8Array[] = [];
        for (const pageIdx of pagesToExport) {
            if (pageIdx < 0 || pageIdx >= pageCount) continue;

            const result = pyodide.runPython(`
import base64
page = ${doc.docVar}[${pageIdx}]
mat = pymupdf.Matrix(${zoom}, ${zoom})
pix = page.get_pixmap(matrix=mat)
base64.b64encode(pix.tobytes("${format}")).decode('ascii')
`) as string;

            const binary = atob(result);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            results.push(bytes);
        }

        doc.close();
        return results;
    }

    async pdfToSvg(pdf: Blob | File, pages?: number[]): Promise<string[]> {
        const doc = await this.open(pdf);
        const pageCount = doc.pageCount;
        const pagesToExport = pages ?? Array.from({ length: pageCount }, (_, i) => i);

        const results: string[] = [];
        for (const pageIdx of pagesToExport) {
            if (pageIdx < 0 || pageIdx >= pageCount) continue;
            const page = doc.getPage(pageIdx);
            results.push(page.toSvg());
        }

        doc.close();
        return results;
    }

    async pdfToText(pdf: Blob | File): Promise<string> {
        return this.extractText(pdf);
    }

    async pdfToHtml(pdf: Blob | File): Promise<string> {
        const doc = await this.open(pdf);
        let html = '';
        for (const page of doc.pages()) {
            html += page.getText('html') + '\n';
        }
        doc.close();
        return html;
    }

    async pdfToJson(pdf: Blob | File): Promise<object[]> {
        const doc = await this.open(pdf);
        const results: object[] = [];
        for (const page of doc.pages()) {
            const text = page.getText('dict');
            results.push(text as object);
        }
        doc.close();
        return results;
    }

    async pdfToXml(pdf: Blob | File): Promise<string> {
        const doc = await this.open(pdf);
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<document>\n';
        for (const page of doc.pages()) {
            xml += page.getText('xml') + '\n';
        }
        xml += '</document>';
        doc.close();
        return xml;
    }

    private hasRtlCharacters(text: string): boolean {
        const rtlPattern = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/;
        return rtlPattern.test(text);
    }

    async textToPdf(text: string, options?: {
        fontName?: 'helv' | 'tiro' | 'cour' | 'times';
        fontSize?: number;
        pageSize?: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
        margins?: number;
    }): Promise<Blob> {
        const pyodide = await this.getPyodide();

        const isRtl = this.hasRtlCharacters(text);
        const directionStyle = isRtl ? 'direction: rtl; text-align: right;' : '';

        const escapedText = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\\/g, '\\\\')
            .replace(/\n/g, '<br>');

        const fontSize = options?.fontSize ?? 11;
        const pageSize = options?.pageSize ?? 'a4';
        const margins = options?.margins ?? 72;

        const fontMap: Record<string, string> = {
            'helv': 'sans-serif',
            'tiro': 'serif',
            'cour': 'monospace',
            'times': 'serif'
        };
        const fontName = options?.fontName ?? 'helv';
        const fontFamily = fontMap[fontName] || 'sans-serif';

        const result = pyodide.runPython(`
import base64

html_content = '''
<p style="font-family: ${fontFamily}; font-size: ${fontSize}pt; margin: 0; padding: 0; ${directionStyle}">
${escapedText}
</p>
'''

doc = pymupdf.open()
mediabox = pymupdf.paper_rect("${pageSize}")
margin = ${margins}
where = mediabox + (margin, margin, -margin, -margin)

more = True
page_count = 0
max_pages = 100

while more and page_count < max_pages:
    page = doc.new_page(width=mediabox.width, height=mediabox.height)
    more, _ = page.insert_htmlbox(where, html_content, css="* { font-family: ${fontFamily}; font-size: ${fontSize}pt; }")
    page_count += 1

# Subset and embed fonts for PDF/A compatibility
doc.subset_fonts()

pdf_bytes = doc.tobytes(garbage=3, deflate=True)
doc.close()

base64.b64encode(pdf_bytes).decode('ascii')
`) as string;

        const binaryStr = atob(result);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'application/pdf' });
    }

    async htmlToPdf(html: string, options?: {
        css?: string;
        pageSize?: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
        margins?: number | { top: number; right: number; bottom: number; left: number };
    }): Promise<Blob> {
        const pyodide = await this.getPyodide();

        const escapedHtml = html
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n');

        const escapedCss = options?.css
            ?.replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n') ?? '';

        const pageSize = options?.pageSize ?? 'a4';
        let margins = { top: 36, right: 36, bottom: 36, left: 36 };
        if (typeof options?.margins === 'number') {
            margins = { top: options.margins, right: options.margins, bottom: options.margins, left: options.margins };
        } else if (options?.margins) {
            margins = options.margins;
        }

        const result = pyodide.runPython(`
import base64
import io
import re
import json

html_content = '''${escapedHtml}'''
css_content = '''${escapedCss}'''

# Extract links from HTML before processing
link_pattern = r'<a[^>]*href=["\\'](https?://[^"\\'>]+)["\\'"][^>]*>([^<]+)</a>'
links = re.findall(link_pattern, html_content, re.IGNORECASE)
# links is a list of (url, text) tuples

html_content = re.sub(r'<link[^>]*stylesheet[^>]*>', '', html_content, flags=re.IGNORECASE)
html_content = re.sub(r'<link[^>]*href=[^>]*>', '', html_content, flags=re.IGNORECASE)
html_content = re.sub(r'<script[^>]*src=[^>]*>.*?<\\/script>', '', html_content, flags=re.IGNORECASE|re.DOTALL)
html_content = re.sub(r'<script[^>]*src=[^>]*/>', '', html_content, flags=re.IGNORECASE)

mediabox = pymupdf.paper_rect("${pageSize}")
where = mediabox + (${margins.left}, ${margins.top}, -${margins.right}, -${margins.bottom})

story = pymupdf.Story(html=html_content, user_css=css_content if css_content else None)

buffer = io.BytesIO()
writer = pymupdf.DocumentWriter(buffer)

def rectfn(rect_num, filled):
    if rect_num == 0 or filled == 0:
        return mediabox, where, None
    return mediabox, where, None

story.write(writer, rectfn)
writer.close()

# Now open the PDF and add link annotations
buffer.seek(0)
doc = pymupdf.open("pdf", buffer.read())

# For each link found in HTML, search for the text and add a link annotation
for url, text in links:
    text = text.strip()
    if not text:
        continue
    # Search all pages for this text
    for page_num in range(doc.page_count):
        page = doc[page_num]
        # Search for the link text
        text_instances = page.search_for(text)
        for rect in text_instances:
            # Add a link annotation
            link = page.insert_link({
                "kind": pymupdf.LINK_URI,
                "from": rect,
                "uri": url
            })

# Save the modified PDF
output_buffer = io.BytesIO()
doc.save(output_buffer)
doc.close()

pdf_bytes = output_buffer.getvalue()
base64.b64encode(pdf_bytes).decode('ascii')
`) as string;

        const binaryStr = atob(result);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'application/pdf' });
    }

    async pdfToMarkdown(pdf: Blob | File, options?: {
        pageBreaks?: boolean;
        includeImages?: boolean;
        pages?: number[];
    }): Promise<string> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const inputPath = `/md_input_${docId}`;

        const buf = await pdf.arrayBuffer();
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

        const embedImages = options?.includeImages ? 'True' : 'False';
        const pageBreaks = options?.pageBreaks !== false ? 'True' : 'False';
        const pagesArg = options?.pages ? `pages=[${options.pages.join(', ')}]` : '';

        const result = pyodide.runPython(`
import pymupdf4llm

md_text = pymupdf4llm.to_markdown(
    "${inputPath}",
    embed_images=${embedImages},
    page_chunks=${pageBreaks}${pagesArg ? ', ' + pagesArg : ''}
)

if isinstance(md_text, list):
    result = "\\n\\n---\\n\\n".join([chunk.get('text', '') if isinstance(chunk, dict) else str(chunk) for chunk in md_text])
else:
    result = md_text if md_text else ""

result
`) as string;

        try {
            pyodide.FS.unlink(inputPath);
        } catch { /* ignore */ }

        return result;
    }

    async pdfToLlmChunks(pdf: Blob | File): Promise<Array<{
        text: string;
        metadata: { page?: number; heading?: string };
    }>> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const inputPath = `/llm_input_${docId}`;

        const buf = await pdf.arrayBuffer();
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

        const result = pyodide.runPython(`
import pymupdf4llm
import json

chunks = pymupdf4llm.to_markdown(
    "${inputPath}",
    page_chunks=True
)

result = []
for chunk in chunks:
    if isinstance(chunk, dict):
        result.append({
            "text": chunk.get("text", ""),
            "metadata": {
                "page": chunk.get("metadata", {}).get("page", None)
            }
        })
    else:
        result.append({"text": str(chunk), "metadata": {}})

json.dumps(result)
`) as string;

        try {
            pyodide.FS.unlink(inputPath);
        } catch { /* ignore */ }

        return JSON.parse(result);
    }

    /**
     * Extract PDF as LlamaIndex-compatible documents using PyMuPDF4LLM.
     * Uses to_markdown with page_chunks=True to produce LlamaIndex Document format.
     * @param pdf The PDF file to extract
     * @returns Array of LlamaIndex-compatible documents
     */
    async pdfToLlamaIndex(pdf: Blob | File): Promise<LlamaIndexDocument[]> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const inputPath = `/llama_input_${docId}`;
        const filename = pdf instanceof File ? pdf.name : 'document.pdf';

        const buf = await pdf.arrayBuffer();
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

        const result = pyodide.runPython(`
import pymupdf4llm
import pymupdf
import json

# Use to_markdown with page_chunks=True - same output as LlamaMarkdownReader
chunks = pymupdf4llm.to_markdown("${inputPath}", page_chunks=True)

# Get document metadata
doc = pymupdf.open("${inputPath}")
doc_meta = doc.metadata
page_count = doc.page_count
doc.close()

# Convert to LlamaIndex Document format
result = []
for chunk in chunks:
    if isinstance(chunk, dict):
        doc_dict = {
            "text": chunk.get("text", ""),
            "metadata": {
                "file_name": "${filename.replace(/"/g, '\\"')}",
                "total_pages": page_count
            }
        }
        
        # Copy chunk metadata
        chunk_meta = chunk.get("metadata", {})
        if chunk_meta:
            if "page" in chunk_meta:
                doc_dict["metadata"]["page"] = chunk_meta["page"]
            if "page_count" in chunk_meta:
                doc_dict["metadata"]["page_count"] = chunk_meta["page_count"]
            if "file_path" in chunk_meta:
                doc_dict["metadata"]["file_path"] = chunk_meta["file_path"]
        
        # Add document-level metadata
        if doc_meta:
            for key in ["author", "title", "subject", "keywords", "creator", "producer", "creationDate", "modDate"]:
                if doc_meta.get(key):
                    doc_dict["metadata"][key] = doc_meta[key]
        
        # Include tables info if available (convert Rect to list)
        if "tables" in chunk and chunk["tables"]:
            tables_serializable = []
            for t in chunk["tables"]:
                if isinstance(t, dict):
                    t_copy = dict(t)
                    if "bbox" in t_copy and hasattr(t_copy["bbox"], "__iter__"):
                        t_copy["bbox"] = list(t_copy["bbox"])
                    tables_serializable.append(t_copy)
            doc_dict["metadata"]["tables"] = tables_serializable
        
        # Include images info if available (convert Rect to list)
        if "images" in chunk and chunk["images"]:
            images_serializable = []
            for img in chunk["images"]:
                if isinstance(img, dict):
                    img_copy = dict(img)
                    if "bbox" in img_copy and hasattr(img_copy["bbox"], "__iter__"):
                        img_copy["bbox"] = list(img_copy["bbox"])
                    images_serializable.append(img_copy)
            doc_dict["metadata"]["images"] = images_serializable
        
        if "toc_items" in chunk:
            doc_dict["metadata"]["toc_items"] = chunk["toc_items"]
        
        result.append(doc_dict)
    else:
        result.append({"text": str(chunk), "metadata": {"file_name": "${filename.replace(/"/g, '\\"')}"}})

json.dumps(result)
`) as string;

        try {
            pyodide.FS.unlink(inputPath);
        } catch { /* ignore */ }

        return JSON.parse(result);
    }

    /**
     * Rasterize a PDF - convert all pages to images and create a new PDF from those images.
     * This flattens all vector graphics, text, and layers into raster images.
     * Useful for: printing, reducing file complexity, removing selectable text, or creating image-based PDFs.
     */
    async rasterizePdf(pdf: Blob | File, options?: RasterizeOptions): Promise<Blob> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const inputPath = `/rasterize_input_${docId}`;

        const dpi = options?.dpi ?? 150;
        const format = options?.format ?? 'png';
        const quality = options?.quality ?? 95;
        const alpha = options?.alpha ?? false;
        const pages = options?.pages;
        const grayscale = options?.grayscale ?? false;

        const buf = await pdf.arrayBuffer();
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

        const pagesArg = pages ? `[${pages.join(', ')}]` : 'None';

        const result = pyodide.runPython(`
import base64

src_doc = pymupdf.open("${inputPath}")
out_doc = pymupdf.open()

zoom = ${dpi} / 72.0
mat = pymupdf.Matrix(zoom, zoom)

page_indices = ${pagesArg} if ${pagesArg} is not None else range(src_doc.page_count)

for page_idx in page_indices:
    if page_idx < 0 or page_idx >= src_doc.page_count:
        continue
    
    page = src_doc[page_idx]
    
    # Render page to pixmap
    pix = page.get_pixmap(matrix=mat, alpha=${alpha ? 'True' : 'False'})
    
    # Convert to grayscale if requested
    if ${grayscale ? 'True' : 'False'}:
        pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    
    # Get image bytes
    img_bytes = pix.tobytes("${format}"${format === 'jpeg' ? `, jpg_quality=${quality}` : ''})
    
    # Create new page with same dimensions as rendered image
    # Scale back to original page size for the PDF
    orig_rect = page.rect
    new_page = out_doc.new_page(width=orig_rect.width, height=orig_rect.height)
    
    # Insert the rasterized image
    new_page.insert_image(new_page.rect, stream=img_bytes)

src_doc.close()

# Save output PDF
pdf_bytes = out_doc.tobytes(garbage=3, deflate=True)
out_doc.close()

base64.b64encode(pdf_bytes).decode('ascii')
`) as string;

        try {
            pyodide.FS.unlink(inputPath);
        } catch { /* ignore */ }

        const binary = atob(result);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'application/pdf' });
    }

    /**
     * Compress a PDF using multiple optimization techniques.
     * Combines dead-weight removal, image compression, font subsetting, and advanced save options.
     * Based on PyMuPDF's optimization capabilities.
     */
    async compressPdf(pdf: Blob | File, options?: CompressOptions): Promise<CompressResult> {
        const pyodide = await this.getPyodide();
        const docId = ++this.docCounter;
        const inputPath = `/compress_input_${docId}`;

        const buf = await pdf.arrayBuffer();
        const originalSize = buf.byteLength;
        pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

        const scrubOpts = options?.scrub ?? {};
        const scrubMetadata = scrubOpts.metadata !== false;
        const scrubXmlMetadata = scrubOpts.xmlMetadata !== false;
        const scrubAttachedFiles = scrubOpts.attachedFiles ?? false;
        const scrubEmbeddedFiles = scrubOpts.embeddedFiles ?? false;
        const scrubThumbnails = scrubOpts.thumbnails !== false;
        const scrubResetFields = scrubOpts.resetFields ?? false;
        const scrubResetResponses = scrubOpts.resetResponses ?? false;

        const imageOpts = options?.images ?? {};
        const compressImages = imageOpts.enabled !== false;
        const dpiThreshold = imageOpts.dpiThreshold ?? 150;
        const dpiTarget = imageOpts.dpiTarget ?? 96;
        const imageQuality = imageOpts.quality ?? 75;
        const processLossy = imageOpts.lossy !== false;
        const processLossless = imageOpts.lossless !== false;
        const processBitonal = imageOpts.bitonal ?? false;
        const processColor = imageOpts.color !== false;
        const processGray = imageOpts.gray !== false;
        const convertToGray = imageOpts.convertToGray ?? false;

        const subsetFonts = options?.subsetFonts !== false;

        const saveOpts = options?.save ?? {};
        const garbage = saveOpts.garbage ?? 4;
        const deflate = saveOpts.deflate !== false;
        const clean = saveOpts.clean !== false;
        const useObjstms = saveOpts.useObjstms !== false;

        const result = pyodide.runPython(`
import base64
import json

doc = pymupdf.open("${inputPath}")
original_page_count = doc.page_count

# 1. Dead-weight removal (scrub)
doc.scrub(
    metadata=${scrubMetadata ? 'True' : 'False'},
    xml_metadata=${scrubXmlMetadata ? 'True' : 'False'},
    attached_files=${scrubAttachedFiles ? 'True' : 'False'},
    embedded_files=${scrubEmbeddedFiles ? 'True' : 'False'},
    thumbnails=${scrubThumbnails ? 'True' : 'False'},
    reset_fields=${scrubResetFields ? 'True' : 'False'},
    reset_responses=${scrubResetResponses ? 'True' : 'False'},
)

# 2. Image compression
if ${compressImages ? 'True' : 'False'}:
    doc.rewrite_images(
        dpi_threshold=${dpiThreshold},
        dpi_target=${dpiTarget},
        quality=${imageQuality},
        lossy=${processLossy ? 'True' : 'False'},
        lossless=${processLossless ? 'True' : 'False'},
        bitonal=${processBitonal ? 'True' : 'False'},
        color=${processColor ? 'True' : 'False'},
        gray=${processGray ? 'True' : 'False'},
        set_to_gray=${convertToGray ? 'True' : 'False'},
    )

# 3. Font subsetting
if ${subsetFonts ? 'True' : 'False'}:
    doc.subset_fonts()

# 4. Save with optimization options
pdf_bytes = doc.tobytes(
    garbage=${garbage},
    deflate=${deflate ? 'True' : 'False'},
    use_objstms=${useObjstms ? 'True' : 'False'},
    clean=${clean ? 'True' : 'False'}
)

compressed_size = len(pdf_bytes)
doc.close()

json.dumps({
    'data': base64.b64encode(pdf_bytes).decode('ascii'),
    'compressedSize': compressed_size,
    'pageCount': original_page_count
})
`) as string;

        try {
            pyodide.FS.unlink(inputPath);
        } catch { /* ignore */ }

        const parsed = JSON.parse(result);
        const binary = atob(parsed.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        const compressedSize = parsed.compressedSize;
        const savings = originalSize - compressedSize;
        const savingsPercent = originalSize > 0 ? (savings / originalSize) * 100 : 0;

        return {
            blob: new Blob([bytes], { type: 'application/pdf' }),
            originalSize,
            compressedSize,
            savings,
            savingsPercent: Math.round(savingsPercent * 10) / 10,
            pageCount: parsed.pageCount
        };
    }
}

/**
 * Options for rasterizing a PDF
 */
export interface RasterizeOptions {
    dpi?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    alpha?: boolean;
    grayscale?: boolean;
    pages?: number[];
}

/**
 * Options for compressing a PDF
 */
export interface CompressOptions {
    scrub?: {
        metadata?: boolean;
        xmlMetadata?: boolean;
        attachedFiles?: boolean;
        embeddedFiles?: boolean;
        thumbnails?: boolean;
        resetFields?: boolean;
        resetResponses?: boolean;
    };
    images?: {
        enabled?: boolean;
        dpiThreshold?: number;
        dpiTarget?: number;
        quality?: number;
        lossy?: boolean;
        lossless?: boolean;
        bitonal?: boolean;
        color?: boolean;
        gray?: boolean;
        convertToGray?: boolean;
    };
    /** Subset embedded fonts to include only used glyphs (default: true) */
    subsetFonts?: boolean;
    save?: {
        garbage?: 0 | 1 | 2 | 3 | 4;
        deflate?: boolean;
        /** Convert objects to compressible streams (default: true). Can reduce size by 25%+ */
        useObjstms?: boolean;
        /** Clean and sanitize content streams, removing redundant operations (default: true) */
        clean?: boolean;
    };
}

export interface CompressResult {
    /** The compressed PDF is returned as a Blob always */
    blob: Blob;
    originalSize: number;
    compressedSize: number;
    savings: number;
    savingsPercent: number;
    pageCount: number;
}


// TODO@ALAM - Revisitt this pdf to epub functionality

    /**
     * Convert PDF to EPUB using PyMuPDF for HTML extraction with styling and Pandoc WASM for EPUB generation.
     * 
     * Note: Requires pandoc.wasm to be available at the specified pandocAssetPath.
     * The pandoc.wasm file is approximately 35-50MB and is loaded lazily.
     */
//     async pdfToEpub(pdf: Blob | File, options?: EpubOptions): Promise<Blob> {
//         const pyodide = await this.getPyodide();
//         const docId = ++this.docCounter;
//         const inputPath = `/epub_input_${docId}`;

//         const buf = await pdf.arrayBuffer();
//         pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

//         const result = pyodide.runPython(`
// import json
// import base64
// import pymupdf

// doc = pymupdf.open("${inputPath}")
// page_width = doc[0].rect.width if doc.page_count > 0 else 612

// html_pages = []
// images_data = {}

// for page_num in range(doc.page_count):
//     page = doc[page_num]
//     pw = page.rect.width
    
//     # Get text blocks with position info
//     blocks = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)["blocks"]
    
//     page_html = []
    
//     for block in blocks:
//         if block["type"] == 0:  # Text block
//             block_x0 = block["bbox"][0]
//             block_x1 = block["bbox"][2]
//             block_center = (block_x0 + block_x1) / 2
//             block_width = block_x1 - block_x0
            
//             # Determine alignment based on position
//             left_margin = block_x0 / pw
//             right_margin = (pw - block_x1) / pw
//             center_offset = abs(block_center - pw/2) / pw
            
//             align = "left"
//             if center_offset < 0.1 and abs(left_margin - right_margin) < 0.1:
//                 align = "center"
//             elif right_margin < 0.15 and left_margin > 0.3:
//                 align = "right"
            
//             for line in block.get("lines", []):
//                 line_html = []
//                 for span in line.get("spans", []):
//                     text = span["text"]
//                     if not text.strip():
//                         continue
                    
//                     size = span["size"]
//                     flags = span["flags"]
//                     color = span.get("color", 0)
                    
//                     # Build inline styles
//                     styles = []
                    
//                     # Font size (relative)
//                     if size > 16:
//                         styles.append(f"font-size: {size}pt")
                    
//                     # Bold
//                     if flags & 2**4:
//                         styles.append("font-weight: bold")
                    
//                     # Italic
//                     if flags & 2**1:
//                         styles.append("font-style: italic")
                    
//                     # Color (if not black)
//                     if color and color != 0:
//                         r = (color >> 16) & 0xFF
//                         g = (color >> 8) & 0xFF
//                         b = color & 0xFF
//                         if r != 0 or g != 0 or b != 0:
//                             styles.append(f"color: rgb({r},{g},{b})")
                    
//                     style_attr = f' style="{"; ".join(styles)}"' if styles else ""
                    
//                     # Escape HTML
//                     text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    
//                     if styles:
//                         line_html.append(f"<span{style_attr}>{text}</span>")
//                     else:
//                         line_html.append(text)
                
//                 if line_html:
//                     line_text = "".join(line_html)
//                     # Detect if this looks like a heading (large, bold, short)
//                     first_span = line["spans"][0] if line.get("spans") else None
//                     is_heading = first_span and first_span["size"] > 14 and len(line_text) < 100
                    
//                     if is_heading and first_span["size"] > 18:
//                         page_html.append(f'<h1 style="text-align: {align}">{line_text}</h1>')
//                     elif is_heading and first_span["size"] > 14:
//                         page_html.append(f'<h2 style="text-align: {align}">{line_text}</h2>')
//                     else:
//                         page_html.append(f'<p style="text-align: {align}; margin: 0.3em 0">{line_text}</p>')
        
//         elif block["type"] == 1:  # Image block
//             xref = block.get("xref", 0)
//             if xref:
//                 try:
//                     img_data = doc.extract_image(xref)
//                     if img_data:
//                         ext = img_data["ext"]
//                         b64 = base64.b64encode(img_data["image"]).decode("ascii")
//                         mime = f"image/{ext}" if ext != "jpg" else "image/jpeg"
//                         page_html.append(f'<p style="text-align: center"><img src="data:{mime};base64,{b64}" style="max-width: 100%"/></p>')
//                 except:
//                     pass
    
//     if page_html:
//         html_pages.append("\\n".join(page_html))

// # Get metadata
// meta = doc.metadata or {}
// title = meta.get('title', '') or '${options?.title || 'Untitled'}'
// author = meta.get('author', '') or '${options?.author || ''}'
// doc.close()

// # Join pages with page breaks
// full_html = '<div style="page-break-after: always"></div>'.join(html_pages)

// json.dumps({
//     'html': full_html,
//     'title': title,
//     'author': author
// })
// `) as string;

//         try {
//             pyodide.FS.unlink(inputPath);
//         } catch { /* ignore cleanup errors */ }

//         const extracted = JSON.parse(result);

//         const fullHtml = `<!DOCTYPE html>
// <html>
// <head>
// <meta charset="UTF-8">
// <title>${this.escapeHtml(extracted.title)}</title>
// <style>
// body { font-family: Georgia, serif; line-height: 1.6; margin: 1em; }
// h1, h2, h3 { margin-top: 1em; margin-bottom: 0.5em; }
// p { margin: 0.3em 0; }
// img { max-width: 100%; height: auto; }
// </style>
// </head>
// <body>
// ${extracted.html}
// </body>
// </html>`;

//         const pandocAssetPath = options?.pandocAssetPath || this.assetPath + 'pandoc-wasm/';

//         const { Pandoc } = await import(/* @vite-ignore */ pandocAssetPath + 'dist/index.js');
//         const pandoc = new Pandoc(pandocAssetPath);
//         await pandoc.load();

//         const epubBytes = await pandoc.htmlToEpub(fullHtml, {
//             title: extracted.title || options?.title,
//             author: extracted.author || options?.author,
//             toc: options?.toc ?? true
//         });

//         return new Blob([epubBytes], { type: 'application/epub+zip' });
//     }

    /**
     * Convert PDF to EPUB without using Pandoc - generates EPUB structure directly.
     * This is a lighter-weight alternative that doesn't require the ~35MB Pandoc WASM.
     */
//     async pdfToEpubNative(pdf: Blob | File, options?: Omit<EpubOptions, 'pandocAssetPath'>): Promise<Blob> {
//         const pyodide = await this.getPyodide();
//         const docId = ++this.docCounter;
//         const inputPath = `/epub_native_${docId}`;

//         const buf = await pdf.arrayBuffer();
//         pyodide.FS.writeFile(inputPath, new Uint8Array(buf));

//         const result = pyodide.runPython(`
// import json
// import base64
// import pymupdf

// doc = pymupdf.open("${inputPath}")

// chapters = []
// images = {}
// image_counter = 0

// for page_num in range(doc.page_count):
//     page = doc[page_num]
//     pw = page.rect.width
    
//     blocks = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)["blocks"]
    
//     page_content = []
    
//     for block in blocks:
//         if block["type"] == 0:  # Text block
//             block_x0 = block["bbox"][0]
//             block_x1 = block["bbox"][2]
//             block_center = (block_x0 + block_x1) / 2
            
//             left_margin = block_x0 / pw
//             right_margin = (pw - block_x1) / pw
//             center_offset = abs(block_center - pw/2) / pw
            
//             align = "left"
//             if center_offset < 0.1 and abs(left_margin - right_margin) < 0.1:
//                 align = "center"
//             elif right_margin < 0.15 and left_margin > 0.3:
//                 align = "right"
            
//             for line in block.get("lines", []):
//                 spans_html = []
//                 max_size = 0
//                 is_bold = False
                
//                 for span in line.get("spans", []):
//                     text = span["text"]
//                     if not text.strip():
//                         continue
                    
//                     size = span["size"]
//                     flags = span["flags"]
//                     max_size = max(max_size, size)
                    
//                     if flags & 2**4:
//                         is_bold = True
                    
//                     # Escape HTML
//                     text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    
//                     styles = []
//                     if flags & 2**4:
//                         styles.append("font-weight: bold")
//                     if flags & 2**1:
//                         styles.append("font-style: italic")
                    
//                     if styles:
//                         spans_html.append(f'<span style="{"; ".join(styles)}">{text}</span>')
//                     else:
//                         spans_html.append(text)
                
//                 if spans_html:
//                     line_text = "".join(spans_html)
                    
//                     if max_size > 18 and is_bold:
//                         page_content.append(f'<h1 style="text-align: {align}">{line_text}</h1>')
//                     elif max_size > 14 and is_bold:
//                         page_content.append(f'<h2 style="text-align: {align}">{line_text}</h2>')
//                     elif max_size > 12 and is_bold:
//                         page_content.append(f'<h3 style="text-align: {align}">{line_text}</h3>')
//                     else:
//                         page_content.append(f'<p style="text-align: {align}; margin: 0.2em 0">{line_text}</p>')
        
//         elif block["type"] == 1:  # Image
//             xref = block.get("xref", 0)
//             if xref:
//                 try:
//                     img_data = doc.extract_image(xref)
//                     if img_data:
//                         ext = img_data["ext"]
//                         b64 = base64.b64encode(img_data["image"]).decode("ascii")
//                         img_id = f"img_{image_counter}"
//                         image_counter += 1
//                         images[img_id] = {"ext": ext, "data": b64}
//                         page_content.append(f'<p style="text-align: center"><img src="images/{img_id}.{ext}" style="max-width: 100%"/></p>')
//                 except:
//                     pass
    
//     if page_content:
//         chapters.append({
//             "page": page_num + 1,
//             "content": "\\n".join(page_content)
//         })

// # Get metadata
// meta = doc.metadata or {}
// title = meta.get('title', '') or '${options?.title || 'Untitled'}'
// author = meta.get('author', '') or '${options?.author || ''}'

// # Get TOC
// toc_entries = []
// try:
//     for entry in doc.get_toc():
//         toc_entries.append({
//             "level": entry[0],
//             "title": entry[1],
//             "page": entry[2]
//         })
// except:
//     pass

// doc.close()

// json.dumps({
//     "chapters": chapters,
//     "images": images,
//     "title": title,
//     "author": author,
//     "toc": toc_entries
// })
// `) as string;

//         try {
//             pyodide.FS.unlink(inputPath);
//         } catch { /* ignore */ }

//         const extracted = JSON.parse(result);

//         const epub = await this.generateEpub(extracted, options?.toc ?? true);

//         return new Blob([new Uint8Array(epub)], { type: 'application/epub+zip' });
//     }

//     private async generateEpub(
//         data: { chapters: Array<{ page: number, content: string }>, images: Record<string, { ext: string, data: string }>, title: string, author: string, toc: Array<{ level: number, title: string, page: number }> },
//         includeToc: boolean
//     ): Promise<Uint8Array> {

//         const files: Array<{ name: string, content: Uint8Array }> = [];
//         const encoder = new TextEncoder();

//         files.push({
//             name: 'mimetype',
//             content: encoder.encode('application/epub+zip')
//         });

//         files.push({
//             name: 'META-INF/container.xml',
//             content: encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
// <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
//   <rootfiles>
//     <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
//   </rootfiles>
// </container>`)
//         });

//         const chapterIds: string[] = [];
//         for (let i = 0; i < data.chapters.length; i++) {
//             const chapter = data.chapters[i];
//             const chapterId = `chapter${i + 1}`;
//             chapterIds.push(chapterId);

//             const chapterHtml = `<?xml version="1.0" encoding="UTF-8"?>
// <!DOCTYPE html>
// <html xmlns="http://www.w3.org/1999/xhtml">
// <head>
//   <title>${this.escapeHtml(data.title)} - Page ${chapter.page}</title>
//   <link rel="stylesheet" type="text/css" href="style.css"/>
// </head>
// <body>
// ${chapter.content}
// </body>
// </html>`;

//             files.push({
//                 name: `OEBPS/${chapterId}.xhtml`,
//                 content: encoder.encode(chapterHtml)
//             });
//         }

//         const imageIds: Array<{ id: string, href: string, mediaType: string }> = [];
//         for (const [imgId, imgData] of Object.entries(data.images)) {
//             const ext = imgData.ext;
//             const mediaType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
//                 ext === 'png' ? 'image/png' :
//                     ext === 'gif' ? 'image/gif' : 'image/png';

//             const binary = atob(imgData.data);
//             const bytes = new Uint8Array(binary.length);
//             for (let i = 0; i < binary.length; i++) {
//                 bytes[i] = binary.charCodeAt(i);
//             }

//             files.push({
//                 name: `OEBPS/images/${imgId}.${ext}`,
//                 content: bytes
//             });

//             imageIds.push({
//                 id: imgId,
//                 href: `images/${imgId}.${ext}`,
//                 mediaType
//             });
//         }

//         files.push({
//             name: 'OEBPS/style.css',
//             content: encoder.encode(`
// body { font-family: Georgia, serif; line-height: 1.5; margin: 1em; }
// h1, h2, h3 { margin-top: 1em; margin-bottom: 0.5em; }
// p { margin: 0.3em 0; }
// img { max-width: 100%; height: auto; }
// `)
//         });

//         let tocHtml = '';
//         if (includeToc && data.toc.length > 0) {
//             const tocItems = data.toc.map(entry => {
//                 const chapterIdx = Math.min(entry.page - 1, data.chapters.length - 1);
//                 return `<li><a href="chapter${chapterIdx + 1}.xhtml">${this.escapeHtml(entry.title)}</a></li>`;
//             }).join('\n');

//             tocHtml = `<?xml version="1.0" encoding="UTF-8"?>
// <!DOCTYPE html>
// <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
// <head>
//   <title>Table of Contents</title>
//   <link rel="stylesheet" type="text/css" href="style.css"/>
// </head>
// <body>
//   <nav epub:type="toc">
//     <h1>Table of Contents</h1>
//     <ol>
// ${tocItems}
//     </ol>
//   </nav>
// </body>
// </html>`;

//             files.push({
//                 name: 'OEBPS/toc.xhtml',
//                 content: encoder.encode(tocHtml)
//             });
//         }

//         const manifestItems = [
//             '<item id="style" href="style.css" media-type="text/css"/>',
//             ...chapterIds.map(id => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`),
//             ...imageIds.map(img => `<item id="${img.id}" href="${img.href}" media-type="${img.mediaType}"/>`)
//         ];

//         if (includeToc && data.toc.length > 0) {
//             manifestItems.push('<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
//         }

//         const spineItems = chapterIds.map(id => `<itemref idref="${id}"/>`);

//         const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
// <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
//   <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
//     <dc:identifier id="BookId">urn:uuid:${crypto.randomUUID()}</dc:identifier>
//     <dc:title>${this.escapeHtml(data.title)}</dc:title>
//     <dc:creator>${this.escapeHtml(data.author)}</dc:creator>
//     <dc:language>en</dc:language>
//     <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
//   </metadata>
//   <manifest>
// ${manifestItems.join('\n')}
//   </manifest>
//   <spine>
// ${spineItems.join('\n')}
//   </spine>
// </package>`;

//         files.push({
//             name: 'OEBPS/content.opf',
//             content: encoder.encode(contentOpf)
//         });

//         return this.createZip(files);
//     }

    // private async createZip(files: Array<{ name: string, content: Uint8Array }>): Promise<Uint8Array> {
    //     const parts: Uint8Array[] = [];
    //     const centralDirectory: Uint8Array[] = [];
    //     let offset = 0;

    //     for (const file of files) {
    //         const nameBytes = new TextEncoder().encode(file.name);
    //         const isFirst = file.name === 'mimetype';

    //         const localHeader = new Uint8Array(30 + nameBytes.length);
    //         const view = new DataView(localHeader.buffer);

    //         view.setUint32(0, 0x04034b50, true); // Local file header signature
    //         view.setUint16(4, 20, true); // Version needed
    //         view.setUint16(6, 0, true); // General purpose bit flag
    //         view.setUint16(8, isFirst ? 0 : 8, true); // Compression method (0=store, 8=deflate)
    //         view.setUint16(10, 0, true); // Last mod time
    //         view.setUint16(12, 0, true); // Last mod date

    //         let compressedContent: Uint8Array;
    //         if (isFirst) {
    //             compressedContent = file.content;
    //         } else {
    //             compressedContent = await this.deflate(file.content);
    //         }

    //         const crc = this.crc32(file.content);
    //         view.setUint32(14, crc, true); // CRC-32
    //         view.setUint32(18, compressedContent.length, true); // Compressed size
    //         view.setUint32(22, file.content.length, true); // Uncompressed size
    //         view.setUint16(26, nameBytes.length, true); // File name length
    //         view.setUint16(28, 0, true); // Extra field length
    //         localHeader.set(nameBytes, 30);

    //         parts.push(localHeader);
    //         parts.push(compressedContent);

    //         const centralEntry = new Uint8Array(46 + nameBytes.length);
    //         const centralView = new DataView(centralEntry.buffer);

    //         centralView.setUint32(0, 0x02014b50, true); // Central directory signature
    //         centralView.setUint16(4, 20, true); // Version made by
    //         centralView.setUint16(6, 20, true); // Version needed
    //         centralView.setUint16(8, 0, true); // General purpose bit flag
    //         centralView.setUint16(10, isFirst ? 0 : 8, true); // Compression method
    //         centralView.setUint16(12, 0, true); // Last mod time
    //         centralView.setUint16(14, 0, true); // Last mod date
    //         centralView.setUint32(16, crc, true); // CRC-32
    //         centralView.setUint32(20, compressedContent.length, true); // Compressed size
    //         centralView.setUint32(24, file.content.length, true); // Uncompressed size
    //         centralView.setUint16(28, nameBytes.length, true); // File name length
    //         centralView.setUint16(30, 0, true); // Extra field length
    //         centralView.setUint16(32, 0, true); // File comment length
    //         centralView.setUint16(34, 0, true); // Disk number start
    //         centralView.setUint16(36, 0, true); // Internal file attributes
    //         centralView.setUint32(38, 0, true); // External file attributes
    //         centralView.setUint32(42, offset, true); // Relative offset of local header
    //         centralEntry.set(nameBytes, 46);

    //         centralDirectory.push(centralEntry);
    //         offset += localHeader.length + compressedContent.length;
    //     }

    //     const centralDirOffset = offset;
    //     for (const entry of centralDirectory) {
    //         parts.push(entry);
    //         offset += entry.length;
    //     }

    //     const eocd = new Uint8Array(22);
    //     const eocdView = new DataView(eocd.buffer);
    //     eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    //     eocdView.setUint16(4, 0, true); // Disk number
    //     eocdView.setUint16(6, 0, true); // Disk with central directory
    //     eocdView.setUint16(8, files.length, true); // Number of entries on this disk
    //     eocdView.setUint16(10, files.length, true); // Total number of entries
    //     eocdView.setUint32(12, offset - centralDirOffset, true); // Size of central directory
    //     eocdView.setUint32(16, centralDirOffset, true); // Offset of central directory
    //     eocdView.setUint16(20, 0, true); // Comment length
    //     parts.push(eocd);

    //     const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    //     const result = new Uint8Array(totalLength);
    //     let pos = 0;
    //     for (const part of parts) {
    //         result.set(part, pos);
    //         pos += part.length;
    //     }

    //     return result;
    // }

    // private async deflate(data: Uint8Array): Promise<Uint8Array> {
    //     const stream = new CompressionStream('deflate-raw');
    //     const writer = stream.writable.getWriter();
    //     writer.write(new Uint8Array(data));
    //     writer.close();

    //     const chunks: Uint8Array[] = [];
    //     const reader = stream.readable.getReader();

    //     while (true) {
    //         const { done, value } = await reader.read();
    //         if (done) break;
    //         chunks.push(value);
    //     }

    //     const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    //     const result = new Uint8Array(totalLength);
    //     let offset = 0;
    //     for (const chunk of chunks) {
    //         result.set(chunk, offset);
    //         offset += chunk.length;
    //     }

    //     return result;
    // }

    // private crc32(data: Uint8Array): number {
    //     let crc = 0xFFFFFFFF;
    //     const table = this.getCrc32Table();

    //     for (let i = 0; i < data.length; i++) {
    //         crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    //     }

    //     return (crc ^ 0xFFFFFFFF) >>> 0;
    // }

    // private crc32Table: Uint32Array | null = null;

    // private getCrc32Table(): Uint32Array {
    //     if (this.crc32Table) return this.crc32Table;

    //     const table = new Uint32Array(256);
    //     for (let i = 0; i < 256; i++) {
    //         let c = i;
    //         for (let j = 0; j < 8; j++) {
    //             c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    //         }
    //         table[i] = c;
    //     }

    //     this.crc32Table = table;
    //     return table;
    // }

    // private escapeHtml(text: string): string {
    //     return text
    //         .replace(/&/g, '&amp;')
    //         .replace(/</g, '&lt;')
    //         .replace(/>/g, '&gt;')
    //         .replace(/"/g, '&quot;')
    //         .replace(/'/g, '&#039;');
    // }
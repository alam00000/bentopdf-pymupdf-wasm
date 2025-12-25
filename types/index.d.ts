/**
 * Type declarations for @bentopdf/pymupdf-wasm
 */

export interface PyMuPDFOptions {
    assetPath?: string;
}

export interface Point { x: number; y: number; }
export interface Rect { x0: number; y0: number; x1: number; y1: number; }
export interface Color { r: number; g: number; b: number; }

export interface DocumentMetadata {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modDate?: string;
}

export type TextExtractionFormat = 'text' | 'blocks' | 'words' | 'dict' | 'json' | 'html' | 'xhtml' | 'xml';

export interface TextBlock {
    type: 'text' | 'image';
    bbox: Rect;
    text?: string;
}

export interface ImageInfo {
    xref: number;
    width: number;
    height: number;
    bpc: number;
    colorspace: string;
    size: number;
}

export interface ExtractedImage extends ImageInfo {
    data: Uint8Array;
    ext: string;
}

export type AnnotationType = 'Text' | 'FreeText' | 'Line' | 'Square' | 'Circle' | 'Polygon' | 'PolyLine' | 'Highlight' | 'Underline' | 'StrikeOut' | 'Squiggly' | 'Stamp' | 'Caret' | 'Ink' | 'FileAttachment' | 'Link';

export interface AnnotationInfo {
    type: AnnotationType;
    rect: Rect;
    content?: string;
    author?: string;
    color?: Color;
}

export interface FormField {
    name: string;
    type: 'text' | 'checkbox' | 'radio' | 'choice' | 'button' | 'signature';
    value: string | boolean | string[];
    rect: Rect;
    readonly?: boolean;
}

export interface SearchResult {
    page: number;
    rect: Rect;
    text: string;
}

export interface RenderOptions {
    dpi?: number;
    alpha?: boolean;
    rotation?: number;
    clip?: Rect;
}

export interface EncryptionOptions {
    userPassword?: string;
    ownerPassword: string;
    permissions?: {
        print?: boolean;
        copy?: boolean;
        annotate?: boolean;
        modify?: boolean;
    };
}

export interface LinkInfo {
    rect: Rect;
    uri?: string;
    page?: number;
    dest?: Point;
}

export interface TocEntry {
    level: number;
    title: string;
    page: number;
    dest?: Point;
}

export interface TableInfo {
    rows: (string | null)[][];
    markdown: string;
    rowCount: number;
    colCount: number;
    bbox?: Rect;
}

export declare class PyMuPDFPage {
    readonly pageNumber: number;
    readonly rect: Rect;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;

    setRotation(angle: number): void;

    // Text
    getText(format?: TextExtractionFormat): string | TextBlock[];
    searchFor(text: string, quads?: boolean): Rect[];
    insertText(point: Point, text: string, options?: { fontsize?: number; fontname?: string; color?: Color; rotate?: number }): void;

    // Images
    getImages(): ImageInfo[];
    extractImage(xref: number): ExtractedImage | null;
    insertImage(rect: Rect, imageData: Uint8Array, options?: { overlay?: boolean; keepProportion?: boolean }): void;

    // Annotations
    getAnnotations(): AnnotationInfo[];
    addHighlight(rect: Rect, color?: Color): void;
    addTextAnnotation(point: Point, text: string, icon?: string): void;
    addRectAnnotation(rect: Rect, color?: Color, fill?: Color): void;
    deleteAnnotations(): void;

    // Links
    getLinks(): LinkInfo[];
    insertLink(rect: Rect, uri: string): void;

    // Rendering
    toImage(options?: RenderOptions): Promise<Uint8Array>;
    toSvg(): string;

    // Redaction
    addRedaction(rect: Rect, text?: string, fill?: Color): void;
    applyRedactions(): void;

    // Drawing
    drawLine(from: Point, to: Point, color?: Color, width?: number): void;
    drawRect(rect: Rect, color?: Color, fill?: Color, width?: number): void;
    drawCircle(center: Point, radius: number, color?: Color, fill?: Color): void;

    // Table extraction
    findTables(): TableInfo[];
}

export declare class PyMuPDFDocument {
    readonly pageCount: number;
    readonly isPdf: boolean;
    readonly isEncrypted: boolean;
    readonly needsPass: boolean;
    readonly metadata: DocumentMetadata;
    readonly isFormPdf: boolean;

    setMetadata(metadata: Partial<DocumentMetadata>): void;

    // Pages
    getPage(index: number): PyMuPDFPage;
    pages(): Generator<PyMuPDFPage>;
    deletePage(index: number): void;
    deletePages(indices: number[]): void;
    insertBlankPage(index: number, width?: number, height?: number): PyMuPDFPage;
    movePage(from: number, to: number): void;
    copyPage(from: number, to: number): void;
    selectPages(indices: number[]): void;

    // Merging
    insertPdf(sourceDoc: PyMuPDFDocument, options?: { fromPage?: number; toPage?: number; startAt?: number; rotate?: number }): void;

    // Conversion
    convertToPdf(): Uint8Array;

    // Search
    searchText(query: string): SearchResult[];

    // TOC
    getToc(): TocEntry[];
    setToc(toc: TocEntry[]): void;

    // Forms
    getFormFields(): FormField[];
    setFormField(name: string, value: string | boolean): void;

    // Security
    authenticate(password: string): boolean;

    // Save
    save(options?: { garbage?: number; deflate?: boolean; clean?: boolean; encryption?: EncryptionOptions }): Uint8Array;
    saveAsBlob(options?: { garbage?: number; deflate?: boolean; clean?: boolean; encryption?: EncryptionOptions }): Blob;

    // Layers / OCG
    getLayerConfig(): Array<{
        number: number;
        xref?: number;
        text: string;
        on: boolean;
        locked: boolean;
        depth?: number;
        parentXref?: number;
        displayOrder?: number;
    }>;
    addOCG(name: string, options?: { config?: number; on?: boolean; intent?: string; usage?: string }): number;
    addOCGWithParent(name: string, parentXref: number, options?: { config?: number; on?: boolean; intent?: string; usage?: string }): number;
    setLayerVisibility(ocgXref: number, on: boolean): void;
    deleteOCG(number: number): void;

    close(): void;
}

export declare class PyMuPDF {
    constructor(options?: PyMuPDFOptions | string);

    load(): Promise<void>;

    // Document operations
    open(input: Blob | File): Promise<PyMuPDFDocument>;
    openUrl(url: string): Promise<PyMuPDFDocument>;
    create(): Promise<PyMuPDFDocument>;

    // PDF2DOCX conversion
    pdfToDocx(pdf: Blob | File, pages?: number[]): Promise<Blob>;

    // PDF to EPUB conversion (uses Pandoc WASM)
    pdfToEpub(pdf: Blob | File, options?: {
        title?: string;
        author?: string;
        toc?: boolean;
        pandocAssetPath?: string;
    }): Promise<Blob>;

    // Utilities
    merge(pdfs: (Blob | File)[]): Promise<Blob>;
    split(pdf: Blob | File, ranges: Array<{ start: number; end: number }>): Promise<Blob[]>;
    extractText(pdf: Blob | File): Promise<string>;
    renderPage(pdf: Blob | File, pageIndex: number, dpi?: number): Promise<Uint8Array>;

    // File to PDF conversion
    // Supports: XPS, EPUB, MOBI, FB2, CBZ, SVG, images (JPEG, PNG, BMP, GIF, TIFF, WEBP)
    convertToPdf(file: Blob | File, options?: { filetype?: string }): Promise<Blob>;
    xpsToPdf(xps: Blob | File): Promise<Blob>;
    epubToPdf(epub: Blob | File): Promise<Blob>;
    imageToPdf(image: Blob | File, options?: { imageType?: string }): Promise<Blob>;
    svgToPdf(svg: Blob | File): Promise<Blob>;
    imagesToPdf(images: (Blob | File)[]): Promise<Blob>;

    // PDF to other formats
    // Images: PNG, JPEG, PNM, PGM, PBM, PPM, PAM, PSD, PS
    // Vector: SVG | Text: plain, HTML, XML, JSON
    pdfToImages(pdf: Blob | File, options?: {
        format?: 'png' | 'jpeg' | 'pnm' | 'pgm' | 'pbm' | 'ppm' | 'pam' | 'psd' | 'ps';
        dpi?: number;
        pages?: number[];
    }): Promise<Uint8Array[]>;
    pdfToSvg(pdf: Blob | File, pages?: number[]): Promise<string[]>;
    pdfToText(pdf: Blob | File): Promise<string>;
    pdfToHtml(pdf: Blob | File): Promise<string>;
    pdfToJson(pdf: Blob | File): Promise<object[]>;
    pdfToXml(pdf: Blob | File): Promise<string>;

    // LLM / Markdown conversion (pymupdf4llm)
    pdfToMarkdown(pdf: Blob | File, options?: {
        pageBreaks?: boolean;
        includeImages?: boolean;
        pages?: number[];
    }): Promise<string>;
    pdfToLlmChunks(pdf: Blob | File): Promise<Array<{
        text: string;
        metadata: { page?: number; heading?: string };
    }>>;

    // LlamaIndex format extraction
    pdfToLlamaIndex(pdf: Blob | File): Promise<Array<{
        text: string;
        metadata: Record<string, any>;
        extra_info?: Record<string, any>;
    }>>;

    // HTML to PDF conversion
    htmlToPdf(html: string, options?: {
        css?: string;
        pageSize?: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
        margins?: number | { top: number; right: number; bottom: number; left: number };
    }): Promise<Blob>;

    // Text to PDF conversion
    textToPdf(text: string, options?: {
        fontName?: 'helv' | 'tiro' | 'cour' | 'times';
        fontSize?: number;
        pageSize?: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
        textColor?: string;
        margins?: number;
    }): Promise<Blob>;

    // PDF rasterization - convert to image-based PDF
    rasterizePdf(pdf: Blob | File, options?: {
        dpi?: number;
        format?: 'png' | 'jpeg';
        quality?: number;
        alpha?: boolean;
        grayscale?: boolean;
        pages?: number[];
    }): Promise<Blob>;

    // PDF compression
    compressPdf(pdf: Blob | File, options?: {
        scrub?: {
            metadata?: boolean;
            xmlMetadata?: boolean;
            attachedFiles?: boolean;
            embeddedFiles?: boolean;
            thumbnails?: boolean;
        };
        images?: {
            enabled?: boolean;
            dpiThreshold?: number;
            dpiTarget?: number;
            quality?: number;
            convertToGray?: boolean;
        };
        subsetFonts?: boolean;
        save?: {
            garbage?: 0 | 1 | 2 | 3 | 4;
            deflate?: boolean;
            useObjstms?: boolean;
            clean?: boolean;
        };
    }): Promise<{
        blob: Blob;
        originalSize: number;
        compressedSize: number;
        savings: number;
        savingsPercent: number;
        pageCount: number;
    }>;
}

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
    name?: string;
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

export interface TableHeader {
    names: string[];
    cells: (Rect | null)[];
    bbox: Rect | null;
    external: boolean;
}

export interface Table {
    bbox: Rect;
    rowCount: number;
    colCount: number;
    header: TableHeader | null;
    rows: (string | null)[][];
    markdown: string;
}

export interface TableFindOptions {
    clip?: Rect;
    strategy?: 'lines' | 'lines_strict' | 'text' | 'explicit';
    verticalStrategy?: 'lines' | 'lines_strict' | 'text' | 'explicit';
    horizontalStrategy?: 'lines' | 'lines_strict' | 'text' | 'explicit';
    addLines?: number[][];
}

export interface OCGInfo {
    number: number;
    xref: number;
    text: string;
    on: boolean;
    locked: boolean;
    depth: number;
    parentXref: number;
    displayOrder: number;
}

export interface OCGOptions {
    config?: number;
    on?: boolean;
    intent?: 'View' | 'Design';
    usage?: 'Artwork' | 'Print' | 'View';
}

export interface LlamaIndexDocument {
    text: string;
    metadata: {
        page?: number;
        page_number?: number;
        file_path?: string;
        file_name?: string;
        total_pages?: number;
        source?: string;
        author?: string;
        title?: string;
        subject?: string;
        keywords?: string;
        creator?: string;
        producer?: string;
        creation_date?: string;
        mod_date?: string;
        raw?: string;
    };
}

export interface PyodideInterface {
    runPython: (code: string) => unknown;
    loadPackage: (url: string) => Promise<void>;
    FS: {
        writeFile: (path: string, data: Uint8Array) => void;
        readFile: (path: string) => Uint8Array;
        unlink: (path: string) => void;
    };
}

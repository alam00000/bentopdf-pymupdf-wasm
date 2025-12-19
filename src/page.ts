import type {
    Rect,
    Point,
    Color,
    TextExtractionFormat,
    TextBlock,
    ImageInfo,
    ExtractedImage,
    AnnotationInfo,
    LinkInfo,
    RenderOptions,
    Table,
    TableFindOptions
} from './types';

function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
}

export class PyMuPDFPage {
    private runPython: (code: string) => unknown;
    private docVar: string;
    public readonly pageNumber: number;

    constructor(
        runPython: (code: string) => unknown,
        docVar: string,
        pageNumber: number
    ) {
        this.runPython = runPython;
        this.docVar = docVar;
        this.pageNumber = pageNumber;
    }

    get rect(): Rect {
        const result = this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
r = page.rect
[r.x0, r.y0, r.x1, r.y1]
`) as number[];
        return { x0: result[0], y0: result[1], x1: result[2], y1: result[3] };
    }

    get width(): number {
        return this.runPython(`${this.docVar}[${this.pageNumber}].rect.width`) as number;
    }

    get height(): number {
        return this.runPython(`${this.docVar}[${this.pageNumber}].rect.height`) as number;
    }

    get rotation(): number {
        return this.runPython(`${this.docVar}[${this.pageNumber}].rotation`) as number;
    }

    setRotation(angle: number): void {
        this.runPython(`${this.docVar}[${this.pageNumber}].set_rotation(${angle})`);
    }

    getText(format: TextExtractionFormat = 'text'): string | TextBlock[] {
        if (format === 'text') {
            return this.runPython(`${this.docVar}[${this.pageNumber}].get_text()`) as string;
        }
        const result = this.runPython(`
import json
page = ${this.docVar}[${this.pageNumber}]
json.dumps(page.get_text("${format}"))
`) as string;
        return JSON.parse(result);
    }

    searchFor(text: string, quads: boolean = false): Rect[] {
        const result = this.runPython(`
import json
page = ${this.docVar}[${this.pageNumber}]
rects = page.search_for("${text.replace(/"/g, '\\"')}", quads=${quads ? 'True' : 'False'})
json.dumps([[r.x0, r.y0, r.x1, r.y1] for r in rects])
`) as string;
        return JSON.parse(result).map((r: number[]) => ({
            x0: r[0], y0: r[1], x1: r[2], y1: r[3]
        }));
    }

    insertText(
        point: Point,
        text: string,
        options?: {
            fontsize?: number;
            fontname?: string;
            color?: Color;
            rotate?: number;
        }
    ): void {
        const fontsize = options?.fontsize ?? 11;
        const fontname = options?.fontname ?? 'helv';
        const color = options?.color ? `(${options.color.r}, ${options.color.g}, ${options.color.b})` : '(0, 0, 0)';
        const rotate = options?.rotate ?? 0;

        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
page.insert_text(
    (${point.x}, ${point.y}),
    """${text.replace(/"""/g, '\\"\\"\\"')}""",
    fontsize=${fontsize},
    fontname="${fontname}",
    color=${color},
    rotate=${rotate}
)
`);
    }

    getImages(): ImageInfo[] {
        const result = this.runPython(`
import json
page = ${this.docVar}[${this.pageNumber}]
images = page.get_images()
json.dumps([{
    'xref': img[0],
    'width': img[2],
    'height': img[3],
    'bpc': img[4],
    'colorspace': img[5],
    'size': img[6] if len(img) > 6 else 0,
    'name': img[7] if len(img) > 7 else ''
} for img in images])
`) as string;
        return JSON.parse(result);
    }

    extractImage(xref: number): ExtractedImage | null {
        const result = this.runPython(`
import json
import base64
img = ${this.docVar}.extract_image(${xref})
_result = 'null'
if img:
    _result = json.dumps({
        'xref': ${xref},
        'width': img['width'],
        'height': img['height'],
        'bpc': img.get('bpc', 8),
        'colorspace': img.get('colorspace', 'rgb'),
        'size': len(img['image']),
        'ext': img['ext'],
        'data': base64.b64encode(img['image']).decode('ascii')
    })
_result
`) as string;

        if (result === 'null') return null;
        const parsed = JSON.parse(result);
        const binary = atob(parsed.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return { ...parsed, data: bytes };
    }

    insertImage(
        rect: Rect,
        imageData: Uint8Array,
        options?: {
            overlay?: boolean;
            keepProportion?: boolean;
            oc?: number;
        }
    ): number {
        const overlay = options?.overlay ?? true;
        const keepProportion = options?.keepProportion ?? true;
        const oc = options?.oc;
        const base64Image = uint8ArrayToBase64(imageData);

        const ocParam = oc !== undefined ? `, oc=${oc}` : '';

        return this.runPython(`
import base64
img_data = base64.b64decode("${base64Image}")
with open("/tmp_insert_img", "wb") as f:
    f.write(img_data)
page = ${this.docVar}[${this.pageNumber}]
page.insert_image(
    pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}),
    filename="/tmp_insert_img",
    overlay=${overlay ? 'True' : 'False'},
    keep_proportion=${keepProportion ? 'True' : 'False'}${ocParam}
)
`) as number;
    }

    getAnnotations(): AnnotationInfo[] {
        const result = this.runPython(`
import json
page = ${this.docVar}[${this.pageNumber}]
annots = []
for annot in page.annots():
    r = annot.rect
    c = annot.colors.get('stroke', (0, 0, 0)) or (0, 0, 0)
    annots.append({
        'type': annot.type[1],
        'rect': {'x0': r.x0, 'y0': r.y0, 'x1': r.x1, 'y1': r.y1},
        'content': annot.info.get('content', ''),
        'author': annot.info.get('title', ''),
        'color': {'r': c[0], 'g': c[1], 'b': c[2]} if c else None
    })
json.dumps(annots)
`) as string;
        return JSON.parse(result);
    }

    addHighlight(rect: Rect, color?: Color): void {
        const colorStr = color ? `(${color.r}, ${color.g}, ${color.b})` : '(1, 1, 0)';
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
annot = page.add_highlight_annot(pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}))
annot.set_colors(stroke=${colorStr})
annot.update()
`);
    }

    addTextAnnotation(point: Point, text: string, icon?: string): void {
        const iconStr = icon ?? 'Note';
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
annot = page.add_text_annot((${point.x}, ${point.y}), """${text.replace(/"""/g, '\\"\\"\\"')}""", icon="${iconStr}")
annot.update()
`);
    }

    addRectAnnotation(rect: Rect, color?: Color, fill?: Color): void {
        const strokeColor = color ? `(${color.r}, ${color.g}, ${color.b})` : '(1, 0, 0)';
        const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : 'None';
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
annot = page.add_rect_annot(pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}))
annot.set_colors(stroke=${strokeColor}, fill=${fillColor})
annot.update()
`);
    }

    deleteAnnotations(): void {
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
for annot in list(page.annots()):
    page.delete_annot(annot)
`);
    }

    getLinks(): LinkInfo[] {
        const result = this.runPython(`
import json
page = ${this.docVar}[${this.pageNumber}]
links = page.get_links()
json.dumps([{
    'rect': {'x0': l['from'].x0, 'y0': l['from'].y0, 'x1': l['from'].x1, 'y1': l['from'].y1},
    'uri': l.get('uri'),
    'page': l.get('page'),
    'dest': {'x': l['to'].x, 'y': l['to'].y} if l.get('to') else None
} for l in links])
`) as string;
        return JSON.parse(result);
    }

    insertLink(rect: Rect, uri: string): void {
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
page.insert_link({
    'kind': pymupdf.LINK_URI,
    'from': pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}),
    'uri': "${uri}"
})
`);
    }

    async toImage(options?: RenderOptions): Promise<Uint8Array> {
        const dpi = options?.dpi ?? 150;
        const zoom = dpi / 72;
        const alpha = options?.alpha ?? false;
        const rotation = options?.rotation ?? 0;

        let clipStr = 'None';
        if (options?.clip) {
            const c = options.clip;
            clipStr = `pymupdf.Rect(${c.x0}, ${c.y0}, ${c.x1}, ${c.y1})`;
        }

        const result = this.runPython(`
import base64
page = ${this.docVar}[${this.pageNumber}]
mat = pymupdf.Matrix(${zoom}, ${zoom}).prerotate(${rotation})
pix = page.get_pixmap(matrix=mat, alpha=${alpha ? 'True' : 'False'}, clip=${clipStr})
base64.b64encode(pix.tobytes("png")).decode('ascii')
`) as string;

        const binary = atob(result);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    toSvg(): string {
        return this.runPython(`${this.docVar}[${this.pageNumber}].get_svg_image()`) as string;
    }

    addRedaction(rect: Rect, text?: string, fill?: Color): void {
        const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : '(0, 0, 0)';
        const replaceText = text ?? '';
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
page.add_redact_annot(
    pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}),
    text="${replaceText}",
    fill=${fillColor}
)
`);
    }

    applyRedactions(): void {
        this.runPython(`${this.docVar}[${this.pageNumber}].apply_redactions()`);
    }

    drawLine(from: Point, to: Point, color?: Color, width?: number): void {
        const colorStr = color ? `(${color.r}, ${color.g}, ${color.b})` : '(0, 0, 0)';
        const lineWidth = width ?? 1;
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
shape = page.new_shape()
shape.draw_line((${from.x}, ${from.y}), (${to.x}, ${to.y}))
shape.finish(color=${colorStr}, width=${lineWidth})
shape.commit()
`);
    }

    drawRect(rect: Rect, color?: Color, fill?: Color, width?: number): void {
        const strokeColor = color ? `(${color.r}, ${color.g}, ${color.b})` : '(0, 0, 0)';
        const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : 'None';
        const lineWidth = width ?? 1;
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
shape = page.new_shape()
shape.draw_rect(pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}))
shape.finish(color=${strokeColor}, fill=${fillColor}, width=${lineWidth})
shape.commit()
`);
    }

    drawCircle(center: Point, radius: number, color?: Color, fill?: Color): void {
        const strokeColor = color ? `(${color.r}, ${color.g}, ${color.b})` : '(0, 0, 0)';
        const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : 'None';
        this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
shape = page.new_shape()
shape.draw_circle((${center.x}, ${center.y}), ${radius})
shape.finish(color=${strokeColor}, fill=${fillColor})
shape.commit()
`);
    }

    findTables(options?: TableFindOptions): Table[] {
        let optionsStr = '';

        if (options?.clip) {
            const c = options.clip;
            optionsStr += `clip=pymupdf.Rect(${c.x0}, ${c.y0}, ${c.x1}, ${c.y1}), `;
        }
        if (options?.strategy) {
            optionsStr += `strategy="${options.strategy}", `;
        }
        if (options?.verticalStrategy) {
            optionsStr += `vertical_strategy="${options.verticalStrategy}", `;
        }
        if (options?.horizontalStrategy) {
            optionsStr += `horizontal_strategy="${options.horizontalStrategy}", `;
        }
        if (options?.addLines && options.addLines.length > 0) {
            const linesStr = options.addLines.map((l: number[]) => `(${l.join(',')})`).join(',');
            optionsStr += `add_lines=[${linesStr}], `;
        }

        const result = this.runPython(`
import json

page = ${this.docVar}[${this.pageNumber}]
tables = page.find_tables(${optionsStr})

result = []
for table in tables.tables:
    bbox = table.bbox
    header = table.header
    header_data = None
    if header:
        header_bbox = header.bbox
        header_data = {
            'names': list(header.names),
            'cells': [
                {'x0': c[0], 'y0': c[1], 'x1': c[2], 'y1': c[3]} if c else None 
                for c in header.cells
            ],
            'bbox': {'x0': header_bbox[0], 'y0': header_bbox[1], 'x1': header_bbox[2], 'y1': header_bbox[3]} if header_bbox else None,
            'external': header.external
        }
    
    rows = table.extract()
    markdown = table.to_markdown()
    
    result.append({
        'bbox': {'x0': bbox[0], 'y0': bbox[1], 'x1': bbox[2], 'y1': bbox[3]},
        'rowCount': table.row_count,
        'colCount': table.col_count,
        'header': header_data,
        'rows': rows,
        'markdown': markdown
    })

json.dumps(result)
`) as string;

        return JSON.parse(result);
    }

    tablesToMarkdown(options?: TableFindOptions): string[] {
        const tables = this.findTables(options);
        return tables.map(t => t.markdown);
    }
}

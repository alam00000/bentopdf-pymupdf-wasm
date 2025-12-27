// src/page.ts
function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
var PyMuPDFPage = class {
  constructor(runPython, docVar, pageNumber) {
    this.runPython = runPython;
    this.docVar = docVar;
    this.pageNumber = pageNumber;
  }
  get rect() {
    const result = this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
r = page.rect
[r.x0, r.y0, r.x1, r.y1]
`);
    return { x0: result[0], y0: result[1], x1: result[2], y1: result[3] };
  }
  get width() {
    return this.runPython(`${this.docVar}[${this.pageNumber}].rect.width`);
  }
  get height() {
    return this.runPython(`${this.docVar}[${this.pageNumber}].rect.height`);
  }
  get rotation() {
    return this.runPython(`${this.docVar}[${this.pageNumber}].rotation`);
  }
  setRotation(angle) {
    this.runPython(`${this.docVar}[${this.pageNumber}].set_rotation(${angle})`);
  }
  getText(format = "text") {
    if (format === "text") {
      return this.runPython(`${this.docVar}[${this.pageNumber}].get_text()`);
    }
    const result = this.runPython(`
import json
page = ${this.docVar}[${this.pageNumber}]
json.dumps(page.get_text("${format}"))
`);
    return JSON.parse(result);
  }
  searchFor(text, quads = false) {
    const result = this.runPython(`
import json
page = ${this.docVar}[${this.pageNumber}]
rects = page.search_for("${text.replace(/"/g, '\\"')}", quads=${quads ? "True" : "False"})
json.dumps([[r.x0, r.y0, r.x1, r.y1] for r in rects])
`);
    return JSON.parse(result).map((r) => ({
      x0: r[0],
      y0: r[1],
      x1: r[2],
      y1: r[3]
    }));
  }
  insertText(point, text, options) {
    const fontsize = options?.fontsize ?? 11;
    const fontname = options?.fontname ?? "helv";
    const color = options?.color ? `(${options.color.r}, ${options.color.g}, ${options.color.b})` : "(0, 0, 0)";
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
  getImages() {
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
`);
    return JSON.parse(result);
  }
  extractImage(xref) {
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
`);
    if (result === "null") return null;
    const parsed = JSON.parse(result);
    const binary = atob(parsed.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { ...parsed, data: bytes };
  }
  insertImage(rect, imageData, options) {
    const overlay = options?.overlay ?? true;
    const keepProportion = options?.keepProportion ?? true;
    const oc = options?.oc;
    const base64Image = uint8ArrayToBase64(imageData);
    const ocParam = oc !== void 0 ? `, oc=${oc}` : "";
    return this.runPython(`
import base64
img_data = base64.b64decode("${base64Image}")
with open("/tmp_insert_img", "wb") as f:
    f.write(img_data)
page = ${this.docVar}[${this.pageNumber}]
page.insert_image(
    pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}),
    filename="/tmp_insert_img",
    overlay=${overlay ? "True" : "False"},
    keep_proportion=${keepProportion ? "True" : "False"}${ocParam}
)
`);
  }
  getAnnotations() {
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
`);
    return JSON.parse(result);
  }
  addHighlight(rect, color) {
    const colorStr = color ? `(${color.r}, ${color.g}, ${color.b})` : "(1, 1, 0)";
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
annot = page.add_highlight_annot(pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}))
annot.set_colors(stroke=${colorStr})
annot.update()
`);
  }
  addTextAnnotation(point, text, icon) {
    const iconStr = icon ?? "Note";
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
annot = page.add_text_annot((${point.x}, ${point.y}), """${text.replace(/"""/g, '\\"\\"\\"')}""", icon="${iconStr}")
annot.update()
`);
  }
  addRectAnnotation(rect, color, fill) {
    const strokeColor = color ? `(${color.r}, ${color.g}, ${color.b})` : "(1, 0, 0)";
    const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : "None";
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
annot = page.add_rect_annot(pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}))
annot.set_colors(stroke=${strokeColor}, fill=${fillColor})
annot.update()
`);
  }
  deleteAnnotations() {
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
for annot in list(page.annots()):
    page.delete_annot(annot)
`);
  }
  getLinks() {
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
`);
    return JSON.parse(result);
  }
  insertLink(rect, uri) {
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
page.insert_link({
    'kind': pymupdf.LINK_URI,
    'from': pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}),
    'uri': "${uri}"
})
`);
  }
  async toImage(options) {
    const dpi = options?.dpi ?? 150;
    const zoom = dpi / 72;
    const alpha = options?.alpha ?? false;
    const rotation = options?.rotation ?? 0;
    let clipStr = "None";
    if (options?.clip) {
      const c = options.clip;
      clipStr = `pymupdf.Rect(${c.x0}, ${c.y0}, ${c.x1}, ${c.y1})`;
    }
    const result = this.runPython(`
import base64
page = ${this.docVar}[${this.pageNumber}]
mat = pymupdf.Matrix(${zoom}, ${zoom}).prerotate(${rotation})
pix = page.get_pixmap(matrix=mat, alpha=${alpha ? "True" : "False"}, clip=${clipStr})
base64.b64encode(pix.tobytes("png")).decode('ascii')
`);
    const binary = atob(result);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  toSvg() {
    return this.runPython(`${this.docVar}[${this.pageNumber}].get_svg_image()`);
  }
  addRedaction(rect, text, fill) {
    const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : "(0, 0, 0)";
    const replaceText = text ?? "";
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
page.add_redact_annot(
    pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}),
    text="${replaceText}",
    fill=${fillColor}
)
`);
  }
  applyRedactions() {
    this.runPython(`${this.docVar}[${this.pageNumber}].apply_redactions()`);
  }
  drawLine(from, to, color, width) {
    const colorStr = color ? `(${color.r}, ${color.g}, ${color.b})` : "(0, 0, 0)";
    const lineWidth = width ?? 1;
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
shape = page.new_shape()
shape.draw_line((${from.x}, ${from.y}), (${to.x}, ${to.y}))
shape.finish(color=${colorStr}, width=${lineWidth})
shape.commit()
`);
  }
  drawRect(rect, color, fill, width) {
    const strokeColor = color ? `(${color.r}, ${color.g}, ${color.b})` : "(0, 0, 0)";
    const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : "None";
    const lineWidth = width ?? 1;
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
shape = page.new_shape()
shape.draw_rect(pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}))
shape.finish(color=${strokeColor}, fill=${fillColor}, width=${lineWidth})
shape.commit()
`);
  }
  drawCircle(center, radius, color, fill) {
    const strokeColor = color ? `(${color.r}, ${color.g}, ${color.b})` : "(0, 0, 0)";
    const fillColor = fill ? `(${fill.r}, ${fill.g}, ${fill.b})` : "None";
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
shape = page.new_shape()
shape.draw_circle((${center.x}, ${center.y}), ${radius})
shape.finish(color=${strokeColor}, fill=${fillColor})
shape.commit()
`);
  }
  findTables(options) {
    let optionsStr = "";
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
      const linesStr = options.addLines.map((l) => `(${l.join(",")})`).join(",");
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
`);
    return JSON.parse(result);
  }
  tablesToMarkdown(options) {
    const tables = this.findTables(options);
    return tables.map((t) => t.markdown);
  }
  /**
   * Render a page from another document onto this page at a specified rectangle.
   * The source page will be scaled to fit within the target rectangle.
   * @param rect Target rectangle where the page will be rendered
   * @param sourceDocVar Variable name of the source document in Python
   * @param sourcePageNum Page number in the source document (0-indexed)
   * @param options Additional options
   */
  showPdfPage(rect, sourceDocVar, sourcePageNum, options) {
    const keepProportion = options?.keepProportion ?? true;
    const overlay = options?.overlay ?? true;
    const rotate = options?.rotate ?? 0;
    this.runPython(`
page = ${this.docVar}[${this.pageNumber}]
src = ${sourceDocVar}[${sourcePageNum}]
page.show_pdf_page(
    pymupdf.Rect(${rect.x0}, ${rect.y0}, ${rect.x1}, ${rect.y1}),
    ${sourceDocVar},
    ${sourcePageNum},
    keep_proportion=${keepProportion ? "True" : "False"},
    overlay=${overlay ? "True" : "False"},
    rotate=${rotate}
)
`);
  }
};

// src/document.ts
var PyMuPDFDocument = class {
  constructor(pyodide, docVar, inputPath) {
    this.closed = false;
    this.pyodide = pyodide;
    this.docVar = docVar;
    this.inputPath = inputPath;
  }
  runPython(code) {
    return this.pyodide.runPython(code);
  }
  ensureOpen() {
    if (this.closed) {
      throw new Error("Document has been closed");
    }
  }
  get pageCount() {
    this.ensureOpen();
    return this.runPython(`${this.docVar}.page_count`);
  }
  get isPdf() {
    this.ensureOpen();
    return this.runPython(`${this.docVar}.is_pdf`);
  }
  get isEncrypted() {
    this.ensureOpen();
    return this.runPython(`${this.docVar}.is_encrypted`);
  }
  get needsPass() {
    this.ensureOpen();
    return this.runPython(`${this.docVar}.needs_pass`);
  }
  get metadata() {
    this.ensureOpen();
    const result = this.runPython(`
import json
m = ${this.docVar}.metadata
json.dumps(m if m else {})
`);
    return JSON.parse(result);
  }
  setMetadata(metadata) {
    this.ensureOpen();
    const metaJson = JSON.stringify(metadata);
    this.runPython(`${this.docVar}.set_metadata(${metaJson})`);
  }
  getPage(index) {
    this.ensureOpen();
    if (index < 0 || index >= this.pageCount) {
      throw new Error(`Page index ${index} out of range (0-${this.pageCount - 1})`);
    }
    return new PyMuPDFPage(
      (code) => this.runPython(code),
      this.docVar,
      index
    );
  }
  *pages() {
    this.ensureOpen();
    const count = this.pageCount;
    for (let i = 0; i < count; i++) {
      yield this.getPage(i);
    }
  }
  deletePage(index) {
    this.ensureOpen();
    this.runPython(`${this.docVar}.delete_page(${index})`);
  }
  deletePages(indices) {
    this.ensureOpen();
    const sorted = [...indices].sort((a, b) => b - a);
    for (const i of sorted) {
      this.runPython(`${this.docVar}.delete_page(${i})`);
    }
  }
  insertBlankPage(index, width, height) {
    this.ensureOpen();
    const w = width ?? 595;
    const h = height ?? 842;
    this.runPython(`${this.docVar}.insert_page(${index}, width=${w}, height=${h})`);
    return this.getPage(index);
  }
  movePage(from, to) {
    this.ensureOpen();
    this.runPython(`${this.docVar}.move_page(${from}, ${to})`);
  }
  copyPage(from, to) {
    this.ensureOpen();
    this.runPython(`${this.docVar}.copy_page(${from}, ${to})`);
  }
  selectPages(indices) {
    this.ensureOpen();
    this.runPython(`${this.docVar}.select([${indices.join(", ")}])`);
  }
  insertPdf(sourceDoc, options) {
    this.ensureOpen();
    const fromPage = options?.fromPage ?? 0;
    const toPage = options?.toPage ?? -1;
    const startAt = options?.startAt ?? -1;
    const rotate = options?.rotate ?? 0;
    this.runPython(`
${this.docVar}.insert_pdf(
    ${sourceDoc.docVar},
    from_page=${fromPage},
    to_page=${toPage},
    start_at=${startAt},
    rotate=${rotate}
)
`);
  }
  convertToPdf() {
    this.ensureOpen();
    const result = this.runPython(`
import base64
pdf_bytes = ${this.docVar}.convert_to_pdf()
base64.b64encode(pdf_bytes).decode('ascii')
`);
    const binary = atob(result);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  searchText(query) {
    this.ensureOpen();
    const results = [];
    for (let i = 0; i < this.pageCount; i++) {
      const page = this.getPage(i);
      const rects = page.searchFor(query);
      for (const rect of rects) {
        results.push({ page: i, rect, text: query });
      }
    }
    return results;
  }
  getToc() {
    this.ensureOpen();
    const result = this.runPython(`
import json
toc = ${this.docVar}.get_toc()
json.dumps([{
    'level': entry[0],
    'title': entry[1],
    'page': entry[2],
    'dest': {'x': entry[3].x, 'y': entry[3].y} if len(entry) > 3 and entry[3] else None
} for entry in toc])
`);
    return JSON.parse(result);
  }
  setToc(toc) {
    this.ensureOpen();
    const tocData = toc.map((e) => [e.level, e.title, e.page]);
    this.runPython(`${this.docVar}.set_toc(${JSON.stringify(tocData)})`);
  }
  get isFormPdf() {
    this.ensureOpen();
    return this.runPython(`${this.docVar}.is_form_pdf`);
  }
  getFormFields() {
    this.ensureOpen();
    const result = this.runPython(`
import json
fields = []
for page in ${this.docVar}:
    for widget in page.widgets():
        r = widget.rect
        fields.append({
            'name': widget.field_name,
            'type': widget.field_type_string.lower(),
            'value': widget.field_value,
            'rect': {'x0': r.x0, 'y0': r.y0, 'x1': r.x1, 'y1': r.y1},
            'readonly': widget.field_flags & 1 != 0
        })
json.dumps(fields)
`);
    return JSON.parse(result);
  }
  setFormField(name, value) {
    this.ensureOpen();
    const valueStr = typeof value === "boolean" ? value ? "True" : "False" : `"${String(value).replace(/"/g, '\\"')}"`;
    this.runPython(`
for page in ${this.docVar}:
    for widget in page.widgets():
        if widget.field_name == "${name}":
            widget.field_value = ${valueStr}
            widget.update()
            break
`);
  }
  authenticate(password) {
    this.ensureOpen();
    return this.runPython(`${this.docVar}.authenticate("${password}")`);
  }
  save(options) {
    this.ensureOpen();
    let encryptParams = "";
    if (options?.encryption) {
      const enc = options.encryption;
      const perms = enc.permissions ?? {};
      const permValue = (perms.print !== false ? 4 : 0) | (perms.modify !== false ? 8 : 0) | (perms.copy !== false ? 16 : 0) | (perms.annotate !== false ? 32 : 0);
      encryptParams = `, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="${enc.ownerPassword}", user_pw="${enc.userPassword ?? ""}", permissions=${permValue}`;
    }
    const garbage = options?.garbage ?? 1;
    const deflate = options?.deflate !== false;
    const clean = options?.clean !== false;
    const result = this.runPython(`
import base64
output = ${this.docVar}.tobytes(garbage=${garbage}, deflate=${deflate ? "True" : "False"}, clean=${clean ? "True" : "False"}${encryptParams})
base64.b64encode(output).decode('ascii')
`);
    const binary = atob(result);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  saveAsBlob(options) {
    const bytes = this.save(options);
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  }
  getLayerConfig() {
    this.ensureOpen();
    const result = this.runPython(`
import json
import re

# Get basic layer info from layer_ui_configs
layers = ${this.docVar}.layer_ui_configs()

# Build a map of layer number to layer info
layer_map = {}
xref_to_num = {}

for layer in layers:
    num = layer.get('number', 0)
    layer_map[num] = {
        'number': num,
        'text': layer.get('text', ''),
        'on': layer.get('on', False),
        'locked': layer.get('locked', False),
        'depth': 0,
        'xref': 0,
        'parentXref': 0,
        'displayOrder': 0
    }

# Try to parse the Order array to get hierarchy and xrefs
try:
    catalog_xref = ${this.docVar}.pdf_catalog()
    
    # Get OCProperties
    t, ocprop_val = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties")
    
    ocgs_str = None
    order_str = None
    
    if t == "dict":
        t_ocg, ocgs_str = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties/OCGs")
        t2, order_str = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties/D/Order")
    elif t != "null":
        ocprop_match = re.search(r'(\\d+)\\s+\\d+\\s+R', ocprop_val)
        if ocprop_match:
            ocprop_xref = int(ocprop_match.group(1))
            t_ocg, ocgs_str = ${this.docVar}.xref_get_key(ocprop_xref, "OCGs")
            t2, d_val = ${this.docVar}.xref_get_key(ocprop_xref, "D")
            if t2 == "dict":
                t2, order_str = ${this.docVar}.xref_get_key(ocprop_xref, "D/Order")
            elif t2 != "null":
                d_match = re.search(r'(\\d+)\\s+\\d+\\s+R', d_val)
                if d_match:
                    d_xref = int(d_match.group(1))
                    t2, order_str = ${this.docVar}.xref_get_key(d_xref, "Order")
    
    # Parse OCGs array and build xref -> number mapping by matching OCG names to layer text
    if ocgs_str:
        xref_matches = re.findall(r'(\\d+)\\s+0\\s+R', ocgs_str)
        ocg_xrefs = [int(x) for x in xref_matches]
        
        # Build a name-to-layer-number map from layer_ui_configs
        name_to_num = {}
        for num, info in layer_map.items():
            name_to_num[info['text']] = num
        
        # For each OCG xref, look up its Name and match to layer
        for xref in ocg_xrefs:
            # Get the OCG's Name from its dictionary
            t_name, name_val = ${this.docVar}.xref_get_key(xref, "Name")
            if t_name != "null" and name_val:
                # Remove parentheses from PDF string: "(Layer Name)" -> "Layer Name"
                ocg_name = name_val.strip()
                if ocg_name.startswith('(') and ocg_name.endswith(')'):
                    ocg_name = ocg_name[1:-1]
                
                # Find the layer with this name
                if ocg_name in name_to_num:
                    num = name_to_num[ocg_name]
                    layer_map[num]['xref'] = xref
                    xref_to_num[xref] = num
    
    # Parse Order array with state machine to get proper hierarchy
    # Format: ParentRef [Child1 Child2] or [OCG1 OCG2] or just OCG
    if order_str:
        display_order = [0]  # Use list for mutable counter
        
        # Strip outer brackets from Order array - it's always wrapped in []
        inner_order = order_str.strip()
        if inner_order.startswith('[') and inner_order.endswith(']'):
            inner_order = inner_order[1:-1]
        
        def parse_order_array(order_val, depth=0, parent_xref=0):
            i = 0
            last_xref = 0  # Track last OCG xref at current level
            
            while i < len(order_val):
                char = order_val[i]
                
                if char == '[':
                    # Start of nested array - children of last_xref
                    # Find matching closing bracket
                    bracket_depth = 1
                    start = i + 1
                    j = i + 1
                    while j < len(order_val) and bracket_depth > 0:
                        if order_val[j] == '[':
                            bracket_depth += 1
                        elif order_val[j] == ']':
                            bracket_depth -= 1
                        j += 1
                    
                    nested_content = order_val[start:j-1]
                    # Recursively parse with last_xref as parent
                    parse_order_array(nested_content, depth + 1, last_xref)
                    i = j
                elif char == ']':
                    i += 1
                elif char.isdigit():
                    # Parse xref reference
                    ref_match = re.match(r'(\\d+)\\s+0\\s+R', order_val[i:])
                    if ref_match:
                        xref = int(ref_match.group(1))
                        if xref in xref_to_num:
                            num = xref_to_num[xref]
                            layer_map[num]['depth'] = depth
                            layer_map[num]['parentXref'] = parent_xref
                            layer_map[num]['displayOrder'] = display_order[0]
                            display_order[0] += 1
                        last_xref = xref
                        i += len(ref_match.group(0))
                    else:
                        i += 1
                else:
                    i += 1
        
        parse_order_array(inner_order)

except Exception as e:
    # If parsing fails, continue with basic layer info
    pass

# Convert to list and sort by displayOrder
result_list = sorted(layer_map.values(), key=lambda x: x.get('displayOrder', 0))
json.dumps(result_list)
`);
    return JSON.parse(result);
  }
  addOCG(name, options) {
    this.ensureOpen();
    const config = options?.config ?? -1;
    const on = options?.on !== false;
    const intent = options?.intent ?? "View";
    const usage = options?.usage ?? "Artwork";
    return this.runPython(`
${this.docVar}.add_ocg("${name.replace(/"/g, '\\"')}", config=${config}, on=${on ? "True" : "False"}, intent="${intent}", usage="${usage}")
`);
  }
  addOCGWithParent(name, parentXref, options) {
    this.ensureOpen();
    const config = options?.config ?? -1;
    const on = options?.on !== false;
    const intent = options?.intent ?? "View";
    const usage = options?.usage ?? "Artwork";
    return this.runPython(`
import re

# 1. Create the new OCG (automatically added to root of Order array)
child_xref = ${this.docVar}.add_ocg("${name.replace(/"/g, '\\"')}", config=${config}, on=${on ? "True" : "False"}, intent="${intent}", usage="${usage}")

catalog_xref = ${this.docVar}.pdf_catalog()

# 2. Locate OCProperties and Order array
t, ocprop_val = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties")

order_key_path = None
order_xref = None
order_str = None

if t == "dict":
    # Inline OCProperties
    t2, order_str = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties/D/Order")
    order_key_path = "OCProperties/D/Order"
    order_xref = catalog_xref
elif t != "null":
    # Reference to OCProperties
    ocprop_match = re.search(r'(\\d+)\\s+\\d+\\s+R', ocprop_val)
    if ocprop_match:
        ocprop_xref = int(ocprop_match.group(1))
        t2, d_val = ${this.docVar}.xref_get_key(ocprop_xref, "D")
        
        if t2 == "dict":
            # D is inline
            t2, order_str = ${this.docVar}.xref_get_key(ocprop_xref, "D/Order")
            order_key_path = "D/Order"
            order_xref = ocprop_xref
        elif t2 != "null":
            # D is reference
            d_match = re.search(r'(\\d+)\\s+\\d+\\s+R', d_val)
            if d_match:
                d_xref = int(d_match.group(1))
                t2, order_str = ${this.docVar}.xref_get_key(d_xref, "Order")
                order_key_path = "Order"
                order_xref = d_xref

parent_ref = f"{${parentXref}} 0 R"
child_ref = f"{child_xref} 0 R"

def modify_pdf_order(order_string, p_ref, c_ref):
    if not order_string:
        return order_string

    # --- STEP 1: Remove the Child from Root ---
    # add_ocg usually appends to the end of the root array. 
    # We find the child ref that is strictly at depth 1 (root).
    
    cleaned_order = ""
    depth = 0
    i = 0
    removed = False
    
    while i < len(order_string):
        char = order_string[i]
        
        if char == '[':
            depth += 1
            cleaned_order += char
            i += 1
        elif char == ']':
            depth -= 1
            cleaned_order += char
            i += 1
        else:
            # Check if we are looking at the child ref
            # We match strictly "xref 0 R"
            match = None
            if not removed and depth == 1: # Only remove from root
                chunk = order_string[i:]
                # Check if chunk starts with child_ref followed by non-digit
                if chunk.startswith(c_ref):
                    # verify boundary (next char is space, ], or end)
                    if len(chunk) == len(c_ref) or chunk[len(c_ref)] in ' ]':
                        match = True
            
            if match:
                # Skip this ref
                i += len(c_ref)
                removed = True
                # Skip following whitespace if any
                while i < len(order_string) and order_string[i].isspace():
                    i += 1
            else:
                cleaned_order += char
                i += 1

    # --- STEP 2: Insert Child Under Parent ---
    # Logic: Find Parent. Check next non-space char.
    # If '[': Parent already has children. Insert inside that array.
    # If not '[': Create new array [ Child ] after Parent.
    
    final_order = cleaned_order
    
    # Find parent index
    p_idx = final_order.find(p_ref)
    
    if p_idx != -1:
        # Look ahead
        scan_idx = p_idx + len(p_ref)
        insertion_point = -1
        is_existing_array = False
        
        # Scan forward for next significant char
        next_char_idx = -1
        for k in range(scan_idx, len(final_order)):
            if not final_order[k].isspace():
                next_char_idx = k
                break
        
        if next_char_idx != -1 and final_order[next_char_idx] == '[':
            # Parent has existing children array.
            # We must find the closing bracket for THIS array.
            is_existing_array = True
            arr_depth = 1
            for k in range(next_char_idx + 1, len(final_order)):
                if final_order[k] == '[': arr_depth += 1
                elif final_order[k] == ']': arr_depth -= 1
                
                if arr_depth == 0:
                    # Found the closing bracket
                    insertion_point = k
                    break
        else:
            # No existing array, insert after parent
            insertion_point = scan_idx
            
        if insertion_point != -1:
            if is_existing_array:
                # Insert inside existing array (before the closing bracket)
                prefix = final_order[:insertion_point]
                suffix = final_order[insertion_point:]
                final_order = prefix + " " + c_ref + suffix
            else:
                # Create new array after parent
                prefix = final_order[:insertion_point]
                suffix = final_order[insertion_point:]
                final_order = prefix + " [" + c_ref + "]" + suffix

    return final_order

if order_str and order_xref:
    new_order = modify_pdf_order(order_str, parent_ref, child_ref)
    ${this.docVar}.xref_set_key(order_xref, order_key_path, new_order)

child_xref
`);
  }
  setLayerVisibility(ocgXref, on) {
    this.ensureOpen();
    this.runPython(`
import re

catalog_xref = ${this.docVar}.pdf_catalog()
t, ocprop_val = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties")

# Find the D (default config) and its xref/path
d_xref = None
d_path = None
is_inline_d = False

if t == "dict":
    # Inline OCProperties
    t2, d_val = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties/D")
    if t2 == "dict":
        d_xref = catalog_xref
        d_path = "OCProperties/D"
        is_inline_d = True
    elif t2 != "null":
        m = re.search(r'(\\d+)\\s+\\d+\\s+R', d_val)
        if m:
            d_xref = int(m.group(1))
            d_path = ""
elif t != "null":
    m = re.search(r'(\\d+)\\s+\\d+\\s+R', ocprop_val)
    if m:
        ocprop_xref = int(m.group(1))
        t2, d_val = ${this.docVar}.xref_get_key(ocprop_xref, "D")
        if t2 == "dict":
            d_xref = ocprop_xref
            d_path = "D"
            is_inline_d = True
        elif t2 != "null":
            m2 = re.search(r'(\\d+)\\s+\\d+\\s+R', d_val)
            if m2:
                d_xref = int(m2.group(1))
                d_path = ""

if d_xref is None:
    raise ValueError("Could not find OCProperties/D config")

ocg_ref = f"${ocgXref} 0 R"

# Helper to add/remove xref from an array
def add_to_array(arr_str, xref_ref):
    if not arr_str or arr_str == "null":
        return "[" + xref_ref + "]"
    # Check if already in array
    if xref_ref in arr_str:
        return arr_str
    # Add before closing bracket
    return arr_str.rstrip(']') + " " + xref_ref + "]"

def remove_from_array(arr_str, xref_ref):
    if not arr_str or arr_str == "null":
        return arr_str
    # Remove the xref reference
    pattern = r'\\s*' + str(${ocgXref}) + r'\\s+0\\s+R'
    result = re.sub(pattern, '', arr_str)
    # Clean up any double spaces
    result = re.sub(r'\\s+', ' ', result)
    result = result.replace('[ ', '[').replace(' ]', ']')
    return result

# Get current ON and OFF arrays
on_key = d_path + "/ON" if d_path else "ON"
off_key = d_path + "/OFF" if d_path else "OFF"

t_on, on_arr = ${this.docVar}.xref_get_key(d_xref, on_key)
t_off, off_arr = ${this.docVar}.xref_get_key(d_xref, off_key)

if ${on ? "True" : "False"}:
    # Turn ON: add to ON array, remove from OFF array
    new_on = add_to_array(on_arr if t_on != "null" else "", ocg_ref)
    new_off = remove_from_array(off_arr if t_off != "null" else "", ocg_ref)
    ${this.docVar}.xref_set_key(d_xref, on_key, new_on)
    if new_off and new_off != "[]":
        ${this.docVar}.xref_set_key(d_xref, off_key, new_off)
else:
    # Turn OFF: add to OFF array, remove from ON array  
    new_off = add_to_array(off_arr if t_off != "null" else "", ocg_ref)
    new_on = remove_from_array(on_arr if t_on != "null" else "", ocg_ref)
    ${this.docVar}.xref_set_key(d_xref, off_key, new_off)
    if new_on and new_on != "[]":
        ${this.docVar}.xref_set_key(d_xref, on_key, new_on)
`);
  }
  setOC(xref, ocgXref) {
    this.ensureOpen();
    this.runPython(`${this.docVar}.set_oc(${xref}, ${ocgXref})`);
  }
  getOC(xref) {
    this.ensureOpen();
    return this.runPython(`${this.docVar}.get_oc(${xref})`);
  }
  deleteOCG(layerNumber) {
    this.ensureOpen();
    this.runPython(`
import re

# First, get the actual OCG xref from the layer number
# layer_ui_configs returns items with "number" which is an index, not xref
# We need to find the actual OCG xref by looking at the OCProperties

catalog_xref = ${this.docVar}.pdf_catalog()

# Get OCProperties - it might be inline dict or a reference
t, ocprop_val = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties")

# Determine if OCProperties is inline (dict) or a reference
if t == "dict":
    # OCProperties is inline in catalog - we work directly with catalog_xref
    ocprop_xref = catalog_xref
    is_inline = True
else:
    # It's a reference like "X 0 R"
    ocprop_match = re.search(r'(\\d+)\\s+\\d+\\s+R', ocprop_val)
    if not ocprop_match:
        raise ValueError("Cannot find OCProperties")
    ocprop_xref = int(ocprop_match.group(1))
    is_inline = False

# Get the OCGs array to find the actual xref at this index
if is_inline:
    # For inline, we need to get it from the full catalog dict
    t, ocgs_str = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties/OCGs")
else:
    t, ocgs_str = ${this.docVar}.xref_get_key(ocprop_xref, "OCGs")

if t == "null" or not ocgs_str:
    raise ValueError("No OCGs array found")

# Parse all xrefs from the array like "[5 0 R 6 0 R 7 0 R]"
xref_matches = re.findall(r'(\\d+)\\s+0\\s+R', ocgs_str)
ocg_xrefs = [int(x) for x in xref_matches]

# The layer number from layer_ui_configs corresponds to index in this array
if ${layerNumber} < 0 or ${layerNumber} >= len(ocg_xrefs):
    # layerNumber might actually BE the xref in some cases
    target_xref = ${layerNumber}
else:
    target_xref = ocg_xrefs[${layerNumber}]

# Helper to remove xref from array string  
def remove_xref_from_array(arr_str, xref_to_remove):
    # Remove "X 0 R" pattern
    pattern = r'\\s*' + str(xref_to_remove) + r'\\s+0\\s+R'
    return re.sub(pattern, '', arr_str)

# Update the OCGs array
new_ocgs = remove_xref_from_array(ocgs_str, target_xref)
if is_inline:
    ${this.docVar}.xref_set_key(catalog_xref, "OCProperties/OCGs", new_ocgs)
else:
    ${this.docVar}.xref_set_key(ocprop_xref, "OCGs", new_ocgs)

# Get D (default config) and update its arrays
if is_inline:
    t, d_val = ${this.docVar}.xref_get_key(catalog_xref, "OCProperties/D")
else:
    t, d_val = ${this.docVar}.xref_get_key(ocprop_xref, "D")

if t == "dict":
    # D is inline
    d_xref = ocprop_xref if not is_inline else catalog_xref
    d_prefix = "OCProperties/D/" if is_inline else "D/"
    
    # Try to update ON, OFF, Order arrays
    for key in ["ON", "OFF", "Order"]:
        try:
            tk, val = ${this.docVar}.xref_get_key(d_xref, d_prefix.rstrip('/') + '/' + key if d_prefix else key)
            if tk != "null" and val:
                new_val = remove_xref_from_array(val, target_xref)
                ${this.docVar}.xref_set_key(d_xref, d_prefix.rstrip('/') + '/' + key if d_prefix else key, new_val)
        except:
            pass
elif t != "null":
    # D is a reference
    d_match = re.search(r'(\\d+)\\s+\\d+\\s+R', d_val)
    if d_match:
        d_xref = int(d_match.group(1))
        for key in ["ON", "OFF", "Order"]:
            try:
                tk, val = ${this.docVar}.xref_get_key(d_xref, key)
                if tk != "null" and val:
                    new_val = remove_xref_from_array(val, target_xref)
                    ${this.docVar}.xref_set_key(d_xref, key, new_val)
            except:
                pass
`);
  }
  close() {
    if (this.closed) return;
    try {
      this.runPython(`${this.docVar}.close()`);
      this.pyodide.FS.unlink(this.inputPath);
    } catch {
    }
    this.closed = true;
  }
};

// src/pymupdf.ts
import loadGhostscriptWASM from "@bentopdf/gs-wasm";
async function convertPdfToRgb(pdfData) {
  console.log("[convertPdfToRgb] Starting Ghostscript RGB conversion...");
  console.log("[convertPdfToRgb] Input size:", pdfData.length);
  const gs = await loadGhostscriptWASM({
    locateFile: (path) => {
      if (path.endsWith(".wasm")) {
        return "/ghostscript-wasm/gs.wasm";
      }
      return path;
    },
    print: (text) => console.log("[GS RGB]", text),
    printErr: (text) => console.error("[GS RGB Error]", text)
  });
  const inputPath = "/tmp/cmyk_input.pdf";
  const outputPath = "/tmp/rgb_output.pdf";
  gs.FS.writeFile(inputPath, pdfData);
  console.log("[convertPdfToRgb] Wrote input file");
  const args = [
    "-dBATCH",
    "-dNOPAUSE",
    "-dNOSAFER",
    "-dQUIET",
    "-sDEVICE=pdfwrite",
    "-sColorConversionStrategy=sRGB",
    "-sColorConversionStrategyForImages=sRGB",
    "-dConvertCMYKImagesToRGB=true",
    "-dProcessColorModel=/DeviceRGB",
    "-dAutoFilterColorImages=true",
    "-dAutoFilterGrayImages=true",
    "-dColorImageFilter=/DCTEncode",
    "-dGrayImageFilter=/DCTEncode",
    "-dCompatibilityLevel=1.4",
    `-sOutputFile=${outputPath}`,
    inputPath
  ];
  console.log("[convertPdfToRgb] Running Ghostscript with args:", args.join(" "));
  let exitCode;
  try {
    exitCode = gs.callMain(args);
  } catch (e) {
    console.error("[convertPdfToRgb] Ghostscript exception:", e);
    try {
      gs.FS.unlink(inputPath);
    } catch {
    }
    throw new Error(`Ghostscript threw exception: ${e}`);
  }
  console.log("[convertPdfToRgb] Ghostscript exit code:", exitCode);
  if (exitCode !== 0) {
    try {
      gs.FS.unlink(inputPath);
    } catch {
    }
    try {
      gs.FS.unlink(outputPath);
    } catch {
    }
    throw new Error(`Ghostscript RGB conversion failed with exit code ${exitCode}`);
  }
  let output;
  try {
    const stat = gs.FS.stat(outputPath);
    console.log("[convertPdfToRgb] Output file size:", stat.size);
    output = gs.FS.readFile(outputPath);
  } catch (e) {
    console.error("[convertPdfToRgb] Failed to read output:", e);
    try {
      gs.FS.unlink(inputPath);
    } catch {
    }
    throw new Error("Ghostscript did not produce output file");
  }
  try {
    gs.FS.unlink(inputPath);
  } catch {
  }
  try {
    gs.FS.unlink(outputPath);
  } catch {
  }
  const copy = new Uint8Array(output.length);
  copy.set(output);
  console.log("[convertPdfToRgb] Conversion complete, output size:", copy.length);
  return copy;
}
var ASSETS = {
  pyodide: "pyodide.js",
  wheels: [
    "pymupdf-1.26.3-cp313-none-pyodide_2025_0_wasm32.whl",
    "pymupdf4llm-0.0.27-py3-none-any.whl",
    "fonttools-4.56.0-py3-none-any.whl",
    "lxml-5.4.0-cp313-cp313-pyodide_2025_0_wasm32.whl",
    "numpy-2.2.5-cp313-cp313-pyodide_2025_0_wasm32.whl",
    "opencv_python-4.11.0.86-cp313-cp313-pyodide_2025_0_wasm32.whl",
    "pdf2docx-0.5.8-py3-none-any.whl",
    "python_docx-1.2.0-py3-none-any.whl",
    "typing_extensions-4.12.2-py3-none-any.whl"
  ]
};
var PyMuPDF = class {
  constructor(options) {
    this.pyodidePromise = null;
    this.pyodide = null;
    this.docCounter = 0;
    if (typeof options === "string") {
      this.assetPath = options;
    } else {
      this.assetPath = options?.assetPath ?? "./";
    }
    if (!this.assetPath.endsWith("/")) {
      this.assetPath += "/";
    }
  }
  getAssetPath(name) {
    return this.assetPath + name;
  }
  async load() {
    await this.getPyodide();
  }
  async getPyodide() {
    if (this.pyodide) return this.pyodide;
    if (this.pyodidePromise) return this.pyodidePromise;
    this.pyodidePromise = this.initPyodide();
    this.pyodide = await this.pyodidePromise;
    return this.pyodide;
  }
  async initPyodide() {
    const pyodideUrl = this.getAssetPath(ASSETS.pyodide);
    const pyodideModule = await import(
      /* @vite-ignore */
      pyodideUrl
    );
    const { loadPyodide } = pyodideModule;
    const pyodide = await loadPyodide({
      indexURL: this.assetPath
    });
    await Promise.all(
      ASSETS.wheels.map((wheel) => pyodide.loadPackage(this.getAssetPath(wheel)))
    );
    pyodide.runPython(`
import pymupdf
pymupdf.TOOLS.store_shrink(100)

def repair_pdf(doc, save_path=None):
    """
    Repair a PDF by saving with garbage collection and reloading.
    This fixes corrupted cross-reference tables that cause 'cannot find object in xref' errors.
    If save_path is provided, saves the repaired PDF to that path (for use with pymupdf4llm).
    """
    repair_bytes = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    if save_path:
        with open(save_path, 'wb') as f:
            f.write(repair_bytes)
        return None
    return pymupdf.open("pdf", repair_bytes)
`);
    return pyodide;
  }
  async open(input) {
    const pyodide = await this.getPyodide();
    const docId = ++this.docCounter;
    const docVar = `_doc${docId}`;
    const inputPath = `/input_${docId}`;
    const buf = await input.arrayBuffer();
    pyodide.FS.writeFile(inputPath, new Uint8Array(buf));
    pyodide.runPython(`${docVar} = pymupdf.open("${inputPath}")`);
    return new PyMuPDFDocument(pyodide, docVar, inputPath);
  }
  async openUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    const blob = await response.blob();
    return this.open(blob);
  }
  async create() {
    const pyodide = await this.getPyodide();
    const docId = ++this.docCounter;
    const docVar = `_doc${docId}`;
    const inputPath = `/input_${docId}`;
    pyodide.runPython(`${docVar} = pymupdf.open()`);
    return new PyMuPDFDocument(pyodide, docVar, inputPath);
  }
  async pdfToDocx(pdf, pages) {
    const pyodide = await this.getPyodide();
    const buf = await pdf.arrayBuffer();
    let pdfData = new Uint8Array(buf);
    console.log("[pdfToDocx] Converting PDF to RGB colorspace with Ghostscript...");
    try {
      const rgbData = await convertPdfToRgb(pdfData);
      pdfData = rgbData;
      console.log("[pdfToDocx] RGB conversion complete");
    } catch (e) {
      console.warn("[pdfToDocx] Ghostscript RGB conversion failed, trying original:", e);
    }
    pyodide.FS.writeFile("/input.pdf", pdfData);
    const pagesArg = pages ? `[${pages.join(", ")}]` : "None";
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
    const outputBuf = pyodide.FS.readFile("/output.docx");
    try {
      pyodide.FS.unlink("/input.pdf");
      pyodide.FS.unlink("/output.docx");
    } catch {
    }
    return new Blob([new Uint8Array(outputBuf)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  }
  async merge(pdfs) {
    if (pdfs.length === 0) {
      throw new Error("No PDFs provided for merging");
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
  async split(pdf, ranges) {
    const results = [];
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
  async extractText(pdf) {
    const doc = await this.open(pdf);
    let text = "";
    for (const page of doc.pages()) {
      text += page.getText() + "\n";
    }
    doc.close();
    return text.trim();
  }
  async renderPage(pdf, pageIndex, dpi = 150) {
    const doc = await this.open(pdf);
    const page = doc.getPage(pageIndex);
    const image = await page.toImage({ dpi });
    doc.close();
    return image;
  }
  async convertToPdf(file, options) {
    const pyodide = await this.getPyodide();
    const docId = ++this.docCounter;
    const inputPath = `/convert_input_${docId}`;
    const filename = file instanceof File ? file.name : "document";
    const ext = options?.filetype ?? filename.split(".").pop()?.toLowerCase() ?? "";
    const buf = await file.arrayBuffer();
    pyodide.FS.writeFile(inputPath, new Uint8Array(buf));
    const result = pyodide.runPython(`
import base64

src = pymupdf.open("${inputPath}"${ext ? `, filetype="${ext}"` : ""})
pdf_bytes = src.convert_to_pdf()
src.close()

pdf = pymupdf.open("pdf", pdf_bytes)
output = pdf.tobytes(garbage=3, deflate=True)
pdf.close()

base64.b64encode(output).decode('ascii')
`);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
    }
    const binary = atob(result);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  }
  /**
   * Repair a PDF by re-opening and re-saving with garbage collection and compression.
   * This fixes stream length issues that can occur from Ghostscript WASM output.
   * @param pdf The PDF to repair
   * @returns Repaired PDF blob
   */
  async repairPdf(pdf) {
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
`);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
    }
    const binary = atob(result);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  }
  async xpsToPdf(xps) {
    return this.convertToPdf(xps, { filetype: "xps" });
  }
  async epubToPdf(epub) {
    return this.convertToPdf(epub, { filetype: "epub" });
  }
  async imageToPdf(image, options) {
    return this.convertToPdf(image, { filetype: options?.imageType });
  }
  async svgToPdf(svg) {
    return this.convertToPdf(svg, { filetype: "svg" });
  }
  async imagesToPdf(images) {
    if (images.length === 0) {
      throw new Error("No images provided");
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
      } catch {
      }
    }
    const result = pyodide.runPython(`
import base64
output = _multi_img_pdf.tobytes(garbage=3, deflate=True)
_multi_img_pdf.close()
base64.b64encode(output).decode('ascii')
`);
    const binary = atob(result);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  }
  async pdfToImages(pdf, options) {
    const pyodide = await this.getPyodide();
    const doc = await this.open(pdf);
    const format = options?.format ?? "png";
    const dpi = options?.dpi ?? 150;
    const zoom = dpi / 72;
    const pageCount = doc.pageCount;
    const pagesToExport = options?.pages ?? Array.from({ length: pageCount }, (_, i) => i);
    const results = [];
    for (const pageIdx of pagesToExport) {
      if (pageIdx < 0 || pageIdx >= pageCount) continue;
      const result = pyodide.runPython(`
import base64
page = ${doc.docVar}[${pageIdx}]
mat = pymupdf.Matrix(${zoom}, ${zoom})
pix = page.get_pixmap(matrix=mat)
base64.b64encode(pix.tobytes("${format}")).decode('ascii')
`);
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
  async pdfToSvg(pdf, pages) {
    const doc = await this.open(pdf);
    const pageCount = doc.pageCount;
    const pagesToExport = pages ?? Array.from({ length: pageCount }, (_, i) => i);
    const results = [];
    for (const pageIdx of pagesToExport) {
      if (pageIdx < 0 || pageIdx >= pageCount) continue;
      const page = doc.getPage(pageIdx);
      results.push(page.toSvg());
    }
    doc.close();
    return results;
  }
  async pdfToText(pdf) {
    return this.extractText(pdf);
  }
  async pdfToHtml(pdf) {
    const doc = await this.open(pdf);
    let html = "";
    for (const page of doc.pages()) {
      html += page.getText("html") + "\n";
    }
    doc.close();
    return html;
  }
  async pdfToJson(pdf) {
    const doc = await this.open(pdf);
    const results = [];
    for (const page of doc.pages()) {
      const text = page.getText("dict");
      results.push(text);
    }
    doc.close();
    return results;
  }
  async pdfToXml(pdf) {
    const doc = await this.open(pdf);
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<document>\n';
    for (const page of doc.pages()) {
      xml += page.getText("xml") + "\n";
    }
    xml += "</document>";
    doc.close();
    return xml;
  }
  hasRtlCharacters(text) {
    const rtlPattern = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return rtlPattern.test(text);
  }
  async textToPdf(text, options) {
    const pyodide = await this.getPyodide();
    const isRtl = this.hasRtlCharacters(text);
    const directionStyle = isRtl ? "direction: rtl; text-align: right;" : "";
    const escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/\\/g, "\\\\").replace(/\n/g, "<br>");
    const fontSize = options?.fontSize ?? 11;
    const pageSize = options?.pageSize ?? "a4";
    const margins = options?.margins ?? 72;
    const fontMap = {
      "helv": "sans-serif",
      "tiro": "serif",
      "cour": "monospace",
      "times": "serif"
    };
    const fontName = options?.fontName ?? "helv";
    const fontFamily = fontMap[fontName] || "sans-serif";
    const result = pyodide.runPython(`
import base64
import io

html_content = '''
<p style="font-family: ${fontFamily}; font-size: ${fontSize}pt; margin: 0; padding: 0; ${directionStyle}">
${escapedText}
</p>
'''

css_content = "* { font-family: ${fontFamily}; font-size: ${fontSize}pt; }"

mediabox = pymupdf.paper_rect("${pageSize}")
margin = ${margins}
where = mediabox + (margin, margin, -margin, -margin)

story = pymupdf.Story(html=html_content, user_css=css_content)

buffer = io.BytesIO()
writer = pymupdf.DocumentWriter(buffer)

def rectfn(rect_num, filled):
    return mediabox, where, None

story.write(writer, rectfn)
writer.close()

buffer.seek(0)
doc = pymupdf.open("pdf", buffer.read())
doc.subset_fonts()
pdf_bytes = doc.tobytes(garbage=3, deflate=True)
doc.close()

base64.b64encode(pdf_bytes).decode('ascii')
`);
    const binaryStr = atob(result);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: "application/pdf" });
  }
  async htmlToPdf(html, options) {
    const pyodide = await this.getPyodide();
    const escapedHtml = html.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
    const escapedCss = options?.css?.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") ?? "";
    const pageSize = options?.pageSize ?? "a4";
    let margins = { top: 36, right: 36, bottom: 36, left: 36 };
    if (typeof options?.margins === "number") {
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
`);
    const binaryStr = atob(result);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: "application/pdf" });
  }
  async pdfToMarkdown(pdf, options) {
    const pyodide = await this.getPyodide();
    const docId = ++this.docCounter;
    const inputPath = `/md_input_${docId}`;
    const buf = await pdf.arrayBuffer();
    pyodide.FS.writeFile(inputPath, new Uint8Array(buf));
    const embedImages = options?.includeImages ? "True" : "False";
    const pageBreaks = options?.pageBreaks !== false ? "True" : "False";
    const pagesArg = options?.pages ? `pages=[${options.pages.join(", ")}]` : "";
    const result = pyodide.runPython(`
import pymupdf4llm

# Pre-repair: Fix corrupted xrefs in-place
_temp_doc = pymupdf.open("${inputPath}")
repair_pdf(_temp_doc, "${inputPath}")

md_text = pymupdf4llm.to_markdown(
    "${inputPath}",
    embed_images=${embedImages},
    page_chunks=${pageBreaks}${pagesArg ? ", " + pagesArg : ""}
)

if isinstance(md_text, list):
    result = "\\n\\n---\\n\\n".join([chunk.get('text', '') if isinstance(chunk, dict) else str(chunk) for chunk in md_text])
else:
    result = md_text if md_text else ""

result
`);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
    }
    return result;
  }
  async pdfToLlmChunks(pdf) {
    const pyodide = await this.getPyodide();
    const docId = ++this.docCounter;
    const inputPath = `/llm_input_${docId}`;
    const buf = await pdf.arrayBuffer();
    pyodide.FS.writeFile(inputPath, new Uint8Array(buf));
    const result = pyodide.runPython(`
import pymupdf4llm
import json

# Pre-repair: Fix corrupted xrefs in-place
_temp_doc = pymupdf.open("${inputPath}")
repair_pdf(_temp_doc, "${inputPath}")

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
`);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
    }
    return JSON.parse(result);
  }
  /**
   * Extract PDF as LlamaIndex-compatible documents using PyMuPDF4LLM.
   * Uses to_markdown with page_chunks=True to produce LlamaIndex Document format.
   * @param pdf The PDF file to extract
   * @returns Array of LlamaIndex-compatible documents
   */
  async pdfToLlamaIndex(pdf) {
    const pyodide = await this.getPyodide();
    const docId = ++this.docCounter;
    const inputPath = `/llama_input_${docId}`;
    const filename = pdf instanceof File ? pdf.name : "document.pdf";
    const buf = await pdf.arrayBuffer();
    pyodide.FS.writeFile(inputPath, new Uint8Array(buf));
    const result = pyodide.runPython(`
import pymupdf4llm
import pymupdf
import json

# Pre-repair: Fix corrupted xrefs in-place
_temp_doc = pymupdf.open("${inputPath}")
repair_pdf(_temp_doc, "${inputPath}")

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
`);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
    }
    return JSON.parse(result);
  }
  /**
   * Rasterize a PDF - convert all pages to images and create a new PDF from those images.
   * This flattens all vector graphics, text, and layers into raster images.
   * Useful for: printing, reducing file complexity, removing selectable text, or creating image-based PDFs.
   */
  async rasterizePdf(pdf, options) {
    const pyodide = await this.getPyodide();
    const docId = ++this.docCounter;
    const inputPath = `/rasterize_input_${docId}`;
    const dpi = options?.dpi ?? 150;
    const format = options?.format ?? "png";
    const quality = options?.quality ?? 95;
    const alpha = options?.alpha ?? false;
    const pages = options?.pages;
    const grayscale = options?.grayscale ?? false;
    const buf = await pdf.arrayBuffer();
    pyodide.FS.writeFile(inputPath, new Uint8Array(buf));
    const pagesArg = pages ? `[${pages.join(", ")}]` : "None";
    const result = pyodide.runPython(`
import base64

src_doc = pymupdf.open("${inputPath}")
src_doc = repair_pdf(src_doc)
out_doc = pymupdf.open()

zoom = ${dpi} / 72.0
mat = pymupdf.Matrix(zoom, zoom)

page_indices = ${pagesArg} if ${pagesArg} is not None else range(src_doc.page_count)

for page_idx in page_indices:
    if page_idx < 0 or page_idx >= src_doc.page_count:
        continue
    
    page = src_doc[page_idx]
    
    # Render page to pixmap
    pix = page.get_pixmap(matrix=mat, alpha=${alpha ? "True" : "False"})
    
    # Convert to grayscale if requested
    if ${grayscale ? "True" : "False"}:
        pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    
    # Get image bytes
    img_bytes = pix.tobytes("${format}"${format === "jpeg" ? `, jpg_quality=${quality}` : ""})
    
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
`);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
    }
    const binary = atob(result);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: "application/pdf" });
  }
  /**
   * Compress a PDF using multiple optimization techniques.
   * Combines dead-weight removal, image compression, font subsetting, and advanced save options.
   * Based on PyMuPDF's optimization capabilities.
   */
  async compressPdf(pdf, options) {
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

# Pre-repair: Fix corrupted xrefs before processing
doc = repair_pdf(doc)

# 1. Dead-weight removal (scrub)
doc.scrub(
    metadata=${scrubMetadata ? "True" : "False"},
    xml_metadata=${scrubXmlMetadata ? "True" : "False"},
    attached_files=${scrubAttachedFiles ? "True" : "False"},
    embedded_files=${scrubEmbeddedFiles ? "True" : "False"},
    thumbnails=${scrubThumbnails ? "True" : "False"},
    reset_fields=${scrubResetFields ? "True" : "False"},
    reset_responses=${scrubResetResponses ? "True" : "False"},
)

# 2. Image compression
if ${compressImages ? "True" : "False"}:
    doc.rewrite_images(
        dpi_threshold=${dpiThreshold},
        dpi_target=${dpiTarget},
        quality=${imageQuality},
        lossy=${processLossy ? "True" : "False"},
        lossless=${processLossless ? "True" : "False"},
        bitonal=${processBitonal ? "True" : "False"},
        color=${processColor ? "True" : "False"},
        gray=${processGray ? "True" : "False"},
        set_to_gray=${convertToGray ? "True" : "False"},
    )

# 3. Font subsetting
if ${subsetFonts ? "True" : "False"}:
    doc.subset_fonts()

# 4. Save with optimization options
pdf_bytes = doc.tobytes(
    garbage=${garbage},
    deflate=${deflate ? "True" : "False"},
    use_objstms=${useObjstms ? "True" : "False"},
    clean=${clean ? "True" : "False"}
)

compressed_size = len(pdf_bytes)
doc.close()

json.dumps({
    'data': base64.b64encode(pdf_bytes).decode('ascii'),
    'compressedSize': compressed_size,
    'pageCount': original_page_count
})
`);
    try {
      pyodide.FS.unlink(inputPath);
    } catch {
    }
    const parsed = JSON.parse(result);
    const binary = atob(parsed.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const compressedSize = parsed.compressedSize;
    const savings = originalSize - compressedSize;
    const savingsPercent = originalSize > 0 ? savings / originalSize * 100 : 0;
    return {
      blob: new Blob([bytes], { type: "application/pdf" }),
      originalSize,
      compressedSize,
      savings,
      savingsPercent: Math.round(savingsPercent * 10) / 10,
      pageCount: parsed.pageCount
    };
  }
};
export {
  PyMuPDF,
  PyMuPDFDocument,
  PyMuPDFPage
};

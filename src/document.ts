import { PyMuPDFPage } from './page';
import type {
    DocumentMetadata,
    EncryptionOptions,
    FormField,
    TocEntry,
    SearchResult,
    PyodideInterface,
    OCGInfo,
    OCGOptions
} from './types';

export class PyMuPDFDocument {
    private closed = false;
    public readonly docVar: string;
    private pyodide: PyodideInterface;
    private inputPath: string;

    constructor(
        pyodide: PyodideInterface,
        docVar: string,
        inputPath: string
    ) {
        this.pyodide = pyodide;
        this.docVar = docVar;
        this.inputPath = inputPath;
    }

    private runPython(code: string): unknown {
        return this.pyodide.runPython(code);
    }

    private ensureOpen(): void {
        if (this.closed) {
            throw new Error('Document has been closed');
        }
    }

    get pageCount(): number {
        this.ensureOpen();
        return this.runPython(`${this.docVar}.page_count`) as number;
    }

    get isPdf(): boolean {
        this.ensureOpen();
        return this.runPython(`${this.docVar}.is_pdf`) as boolean;
    }

    get isEncrypted(): boolean {
        this.ensureOpen();
        return this.runPython(`${this.docVar}.is_encrypted`) as boolean;
    }

    get needsPass(): boolean {
        this.ensureOpen();
        return this.runPython(`${this.docVar}.needs_pass`) as boolean;
    }

    get metadata(): DocumentMetadata {
        this.ensureOpen();
        const result = this.runPython(`
import json
m = ${this.docVar}.metadata
json.dumps(m if m else {})
`) as string;
        return JSON.parse(result);
    }

    setMetadata(metadata: Partial<DocumentMetadata>): void {
        this.ensureOpen();
        const metaJson = JSON.stringify(metadata);
        this.runPython(`${this.docVar}.set_metadata(${metaJson})`);
    }

    getPage(index: number): PyMuPDFPage {
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

    *pages(): Generator<PyMuPDFPage> {
        this.ensureOpen();
        const count = this.pageCount;
        for (let i = 0; i < count; i++) {
            yield this.getPage(i);
        }
    }

    deletePage(index: number): void {
        this.ensureOpen();
        this.runPython(`${this.docVar}.delete_page(${index})`);
    }

    deletePages(indices: number[]): void {
        this.ensureOpen();
        const sorted = [...indices].sort((a, b) => b - a);
        for (const i of sorted) {
            this.runPython(`${this.docVar}.delete_page(${i})`);
        }
    }

    insertBlankPage(index: number, width?: number, height?: number): PyMuPDFPage {
        this.ensureOpen();
        const w = width ?? 595;
        const h = height ?? 842;
        this.runPython(`${this.docVar}.insert_page(${index}, width=${w}, height=${h})`);
        return this.getPage(index);
    }

    movePage(from: number, to: number): void {
        this.ensureOpen();
        this.runPython(`${this.docVar}.move_page(${from}, ${to})`);
    }

    copyPage(from: number, to: number): void {
        this.ensureOpen();
        this.runPython(`${this.docVar}.copy_page(${from}, ${to})`);
    }

    selectPages(indices: number[]): void {
        this.ensureOpen();
        this.runPython(`${this.docVar}.select([${indices.join(', ')}])`);
    }

    insertPdf(
        sourceDoc: PyMuPDFDocument,
        options?: {
            fromPage?: number;
            toPage?: number;
            startAt?: number;
            rotate?: number;
        }
    ): void {
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

    convertToPdf(): Uint8Array {
        this.ensureOpen();
        const result = this.runPython(`
import base64
pdf_bytes = ${this.docVar}.convert_to_pdf()
base64.b64encode(pdf_bytes).decode('ascii')
`) as string;

        const binary = atob(result);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    searchText(query: string): SearchResult[] {
        this.ensureOpen();
        const results: SearchResult[] = [];

        for (let i = 0; i < this.pageCount; i++) {
            const page = this.getPage(i);
            const rects = page.searchFor(query);
            for (const rect of rects) {
                results.push({ page: i, rect, text: query });
            }
        }

        return results;
    }

    getToc(): TocEntry[] {
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
`) as string;
        return JSON.parse(result);
    }

    setToc(toc: TocEntry[]): void {
        this.ensureOpen();
        const tocData = toc.map(e => [e.level, e.title, e.page]);
        this.runPython(`${this.docVar}.set_toc(${JSON.stringify(tocData)})`);
    }

    get isFormPdf(): boolean {
        this.ensureOpen();
        return this.runPython(`${this.docVar}.is_form_pdf`) as boolean;
    }

    getFormFields(): FormField[] {
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
`) as string;
        return JSON.parse(result);
    }

    setFormField(name: string, value: string | boolean): void {
        this.ensureOpen();
        const valueStr = typeof value === 'boolean'
            ? (value ? 'True' : 'False')
            : `"${String(value).replace(/"/g, '\\"')}"`;

        this.runPython(`
for page in ${this.docVar}:
    for widget in page.widgets():
        if widget.field_name == "${name}":
            widget.field_value = ${valueStr}
            widget.update()
            break
`);
    }

    authenticate(password: string): boolean {
        this.ensureOpen();
        return this.runPython(`${this.docVar}.authenticate("${password}")`) as boolean;
    }

    save(options?: {
        garbage?: number;
        deflate?: boolean;
        clean?: boolean;
        encryption?: EncryptionOptions;
    }): Uint8Array {
        this.ensureOpen();

        let encryptParams = '';
        if (options?.encryption) {
            const enc = options.encryption;
            const perms = enc.permissions ?? {};
            const permValue =
                (perms.print !== false ? 4 : 0) |
                (perms.modify !== false ? 8 : 0) |
                (perms.copy !== false ? 16 : 0) |
                (perms.annotate !== false ? 32 : 0);

            encryptParams = `, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="${enc.ownerPassword}", user_pw="${enc.userPassword ?? ''}", permissions=${permValue}`;
        }

        const garbage = options?.garbage ?? 1;
        const deflate = options?.deflate !== false;
        const clean = options?.clean !== false;

        const result = this.runPython(`
import base64
output = ${this.docVar}.tobytes(garbage=${garbage}, deflate=${deflate ? 'True' : 'False'}, clean=${clean ? 'True' : 'False'}${encryptParams})
base64.b64encode(output).decode('ascii')
`) as string;

        const binary = atob(result);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    saveAsBlob(options?: Parameters<typeof this.save>[0]): Blob {
        const bytes = this.save(options);
        return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    }

    getLayerConfig(): OCGInfo[] {
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
`) as string;
        return JSON.parse(result);
    }

    addOCG(name: string, options?: OCGOptions): number {
        this.ensureOpen();
        const config = options?.config ?? -1;
        const on = options?.on !== false;
        const intent = options?.intent ?? 'View';
        const usage = options?.usage ?? 'Artwork';

        return this.runPython(`
${this.docVar}.add_ocg("${name.replace(/"/g, '\\"')}", config=${config}, on=${on ? 'True' : 'False'}, intent="${intent}", usage="${usage}")
`) as number;
    }

    addOCGWithParent(name: string, parentXref: number, options?: OCGOptions): number {
        this.ensureOpen();
        const config = options?.config ?? -1;
        const on = options?.on !== false;
        const intent = options?.intent ?? 'View';
        const usage = options?.usage ?? 'Artwork';

        return this.runPython(`
import re

# 1. Create the new OCG (automatically added to root of Order array)
child_xref = ${this.docVar}.add_ocg("${name.replace(/"/g, '\\"')}", config=${config}, on=${on ? 'True' : 'False'}, intent="${intent}", usage="${usage}")

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
`) as number;
    }

    setLayerVisibility(ocgXref: number, on: boolean): void {
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

if ${on ? 'True' : 'False'}:
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

    setOC(xref: number, ocgXref: number): void {
        this.ensureOpen();
        this.runPython(`${this.docVar}.set_oc(${xref}, ${ocgXref})`);
    }

    getOC(xref: number): number {
        this.ensureOpen();
        return this.runPython(`${this.docVar}.get_oc(${xref})`) as number;
    }

    deleteOCG(layerNumber: number): void {
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

    close(): void {
        if (this.closed) return;

        try {
            this.runPython(`${this.docVar}.close()`);
            this.pyodide.FS.unlink(this.inputPath);
        } catch { }
        this.closed = true;
    }
}

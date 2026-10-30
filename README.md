# VSCode Omni Viewer

A comprehensive audio, image, PSD, video, font, CSV, Arrow IPC, Feather V2, GeoJSON, DBC, ARXML, A2L, ASC, BLF, MF4, Avro, ROS bag, PCAP, PCAPNG, STEP, DB3, ReqIF, Excel, Word, PowerPoint, PDF, Parquet, HDF5, NumPy, Safetensors, ONNX, TFLite/LiteRT, ExecuTorch, PyTorch Export, OpenVINO IR, Keras, Core ML, GGUF, HAR, JSONL, Jupyter Notebook, LaTeX, HTML, XML, EPUB, Mermaid, PlantUML, and HWP viewer extension for VSCode and Cursor.

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-red)](https://github.com/sponsors/battlecook)

## 🎵 Audio Viewer Features

![Audio Viewer Screenshot](https://eyedealisty-website.web.app/img/omniviewer/audio-screenshot.jpg)

### Advanced Audio Player with WaveSurfer.js
- **Waveform Visualization**: Real-time audio waveform display
- **Spectrogram**: Frequency analysis with spectrogram view
- **Region Selection**: Set start/end times for specific regions
- **Loop Playback**: Repeat playback of selected regions
- **Volume Control**: Real-time volume adjustment
- **Playback Speed**: Multiple playback speed options
- **Audio Information**: Duration, sample rate, channels, bit depth, file size, format display

### Supported Audio Formats
- MP3, WAV, PCM (raw s16le mono 16kHz), AIFF/AIF/AIFC, AMR/AWB, OGG, FLAC, AC3, AAC, M4A

Note: playback still depends on the VS Code webview browser engine supporting the underlying codec.

## 🖼️ Image Viewer Features

![Image Viewer Screenshot](https://eyedealisty-website.web.app/img/omniviewer/image-screenshot.jpg)

### Advanced Image Viewer
- **Zoom Controls**: 10% ~ 500% zoom in/out
- **Rotation**: 90-degree left/right rotation
- **Flip**: Horizontal/vertical flip
- **Fit to Screen**: Automatic screen size fitting
- **Image Filters**: Brightness, contrast, saturation, grayscale adjustments
- **Filter Presets**: Normal, Bright, Dark, Vintage, B&W presets
- **Save Functionality**: Save filtered images to workspace
- **Keyboard Shortcuts**: Quick operation shortcuts
- **Image Information**: Resolution, format, and file size information display

### Supported Image Formats
- JPG, JPEG, PNG, GIF, BMP, WebP, SVG

## 🖼️ PSD Viewer Features

### Adobe Photoshop (PSD) Viewer
- **Layer Panel**: Tree view of layers and groups (folders) with indent by depth
- **Per-Layer Visibility**: Eye button to show/hide each layer independently
- **View Button**: Open a single layer in a modal for closer inspection
- **Composite vs Layer-by-Layer**: When all layers are visible, the full composite is shown; when any layer is hidden, the canvas is redrawn from visible layers only (leaf layers; group merged canvases are skipped to keep visibility correct)
- **Transparency**: Checkerboard background for transparent areas
- **File Information**: File name, file size, and document dimensions (width × height px)
- **Powered by**: [ag-psd](https://github.com/Agamnentzar/ag-psd) for PSD parsing and canvas output

### Supported PSD Formats
- PSD (Adobe Photoshop Document)

## 🎬 Video Viewer Features

![Video Viewer Screenshot](https://eyedealisty-website.web.app/img/omniviewer/video-screenshot.jpg)

### Advanced Video Player
- **Playback Controls**: Play/pause/stop
- **Loop Regions**: Set start/end times and loop playback
- **Playback Speed**: 0.25x ~ 4x playback speed control
- **Skip Controls**: 10-second forward/backward skip
- **Volume Control**: Real-time volume adjustment
- **Keyboard Shortcuts**: Spacebar, arrow keys, etc.
- **Video Information**: Resolution, duration, and file size display

### Supported Video Formats
- MP4, MPEG-TS (TS/MTS/M2TS), AVI, MOV, WMV, FLV, WebM, MKV

Note: `.ts` files share an extension with TypeScript source files, so automatic viewer association may require using Open With instead of a default file binding.

## 📊 CSV Viewer Features

![CSV Viewer Screenshot](https://eyedealisty-website.web.app/img/omniviewer/csv-screenshot.jpg)

### Advanced CSV Viewer
- **Table Display**: Clean, sortable table view of CSV data
- **Search & Filter**: Real-time search across all columns
- **Column Sorting**: Click headers to sort by any column (numeric/text aware)
- **Pagination**: Handle large datasets with page navigation
- **Copy to Clipboard**: Copy filtered data to clipboard (tab-separated format)
- **Statistics View**: Display detailed file and data statistics
- **Keyboard Shortcuts**: Ctrl+F for search, Ctrl+C for copy
- **File Information**: Row count, column count, and file size display
- **Responsive Design**: Works on different screen sizes
- **Delimiter Detection**: Automatically detects comma, semicolon, tab, and pipe-delimited text formats

### Supported CSV Formats
- CSV (Comma-Separated Values)
- TSV (Tab-Separated Values)

## 🚗 DBC Viewer Features

### CAN Database Explorer
- **Message Overview**: Browse CAN messages with ID, hexadecimal ID, DLC, transmitter, and signal count
- **Signal Table**: Inspect start bit, bit length, byte order, signedness, scale, offset, range, unit, and receivers
- **Search & Filter**: Search across messages/signals/comments and filter by CAN node
- **Comments & Value Tables**: Shows `CM_` comments and `VAL_` enumerations when present
- **Raw Source View**: Keep the original DBC text available beside the structured view

### Supported DBC Formats
- DBC (CAN database)

## 🚘 Data Explorer Viewer Features

### ARXML, A2L, ASC, BLF, MF4, Avro, BAG, PCAP, PCAPNG, STEP, DB3, and ReqIF Explorer
- **ARXML Structure View**: Summarizes AUTOSAR packages, named CAN-related elements, and references
- **A2L Block View**: Lists ASAP2 blocks and counts key sections such as `MEASUREMENT`, `CHARACTERISTIC`, and `IF_DATA`
- **ASC Log Preview**: Parses Vector ASCII CAN/CAN FD events into a searchable table
- **BLF Header Preview**: Detects Vector BLF `LOGG` files and shows binary header/hex preview
- **MF4 Header Preview**: Detects ASAM MDF 4 files and summarizes known MDF block markers
- **Avro Metadata Preview**: Reads Avro object container metadata, codec, schema preview, and header bytes
- **ROS Bag Preview**: Detects ROS bag v2 files and summarizes record operation hints with a binary preview
- **PCAP Preview**: Detects classic PCAP files and summarizes global headers, link type, timestamp resolution, and packet records
- **PCAPNG Preview**: Detects PCAPNG section headers and summarizes sections, interfaces, packet blocks, and block sizes
- **STEP Model Summary**: Extracts ISO 10303 header fields and top entity counts from `.stp`/`.step` CAD exchange files
- **DB3 SQLite Preview**: Detects SQLite 3 databases, reads `sqlite_master`, lists schema entries, and previews rows from table b-tree pages
- **ReqIF Summary**: Extracts ReqIF header metadata, specifications, spec objects, relations, datatypes, and spec types
- **Search & Raw Preview**: Search across extracted tables and inspect the original text preview for text-based formats

### Supported Data Explorer Formats
- ARXML (AUTOSAR XML)
- A2L (ASAM MCD-2 MC / ASAP2)
- ASC (Vector ASCII CAN log)
- BLF (Vector Binary Logging Format header preview)
- MF4 (ASAM MDF 4 header and block marker preview)
- AVRO (Apache Avro object container metadata preview)
- BAG (ROS bag v2 header and record hint preview)
- PCAP (classic packet capture global header and packet record preview)
- PCAPNG (packet capture next-generation section and block preview)
- STP/STEP (ISO 10303 STEP model summary)
- DB3 (SQLite 3 database schema and row preview)
- REQIF (Requirements Interchange Format summary)

## 📊 Excel Viewer Features

### Advanced Excel Viewer
- **Multi-Sheet Support**: Switch between sheets via dropdown
- **Table Display**: Clean table view of sheet data
- **Search & Filter**: Real-time search across all columns
- **Pagination**: Handle large datasets with page navigation
- **Copy to Clipboard**: Copy filtered data (tab-separated)
- **Copy as JSON**: Export current sheet data as JSON
- **Raw View**: Toggle between table and raw JSON view
- **File Information**: Sheet name, row count, column count, file size
- **Keyboard Shortcuts**: Ctrl+F search, Ctrl+C copy

### Supported Excel Formats
- XLSX (Excel Workbook)
- XLS (Excel 97-2003)

## 📄 Word Viewer Features

### Microsoft Word (DOCX) Viewer
- **Document View**: Renders `.docx` with `docx-preview` for improved layout fidelity
- **DOC Support**: Opens `.doc` via standalone legacy HTML fallback, with LibreOffice conversion fallback only when needed
- **Native Legacy Rendering**: Preserves more `.doc` paragraph styling, table structure, and readable legacy text decoding
- **Embedded Workbook Preview**: Shows extracted worksheet tables and simple SVG chart previews when legacy `.doc` files contain embedded workbook data
- **Zoom Controls**: Zoom in/out and reset (Ctrl+/-, Ctrl+0)
- **Print**: Print document (Ctrl+P)
- **File Information**: File name and file size
- **Powered by**: [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) for DOCX rendering

### Supported Word Formats
- DOCX (Microsoft Word Document)
- DOC (Microsoft Word 97-2003)

## 📽️ PowerPoint Viewer Features

### Microsoft PowerPoint (PPTX/PPT) Viewer
- **Slide View**: Reads `.pptx` and legacy `.ppt` files and renders slide content in order
- **Title + Bullet Extraction**: Displays slide title and bullet text content
- **Legacy PPT Layout Recovery**: Preserves more title/body/subtitle placement, slide sizing, and discovered shape/image positioning for `.ppt`
- **Packaged PDF.js Rendering**: Uses bundled `pdf.js` assets for environments where external CDN access is blocked
- **Slide Jump**: Jump to any slide from a dropdown
- **Zoom Controls**: Zoom in/out and reset (Ctrl+/-, Ctrl+0)
- **File Information**: File name, file size, and slide count
- **Powered by**: [JSZip](https://github.com/Stuk/jszip) for PPTX archive parsing

### Supported PowerPoint Formats
- PPT (Microsoft PowerPoint 97-2003)
- PPTX (Microsoft PowerPoint Presentation)

## 📑 PDF Editor Features

### PDF View & Edit
- **Page View**: Page-by-page rendering with thumbnail sidebar
- **Zoom Controls**: Zoom in/out and reset
- **Annotations**: Add text/signature, select, move, and delete annotations
- **Password-Protected PDFs**: Open encrypted PDFs with an in-viewer password prompt
- **Text Size Control**: Choose annotation font size when inserting text
- **Page Editing**: Reorder pages (drag & drop) and delete pages
- **Merge PDF**: Merge another PDF into the current document
- **Save Flows**: Save and Save As with state synchronization after save

### Supported PDF Formats
- PDF

## 🇰🇷 HWP Viewer Features

### Hangul Word Processor (HWP) Viewer
- **Document View**: Opens `.hwp` and `.hwpx` files directly inside Omni Viewer
- **Integrated Routing**: Works with the same signature-based viewer detection flow used across the extension
- **Powered by**: [rhwp](https://github.com/edwardkim/rhwp) (`@rhwp/core`) for upstream parsing and rendering
- **Upstream-Friendly Integration**: Runtime assets are synced from `node_modules/@rhwp/core` via `npm run sync:rhwp`, so future rhwp updates can be adopted without forking its renderer

### Supported HWP Formats
- HWP, HWPX

## 🧩 PlantUML Viewer Features

### Browser-Based PlantUML Preview
- **Serverless Rendering**: Renders PlantUML diagrams in the VS Code webview without a PlantUML server
- **Diagram / Split / Source Views**: Switch between rendered preview, side-by-side source, and read-only source
- **Zoom Controls**: Zoom in/out and reset
- **Light / Dark Render Modes**: Toggle PlantUML output mode
- **Copy Source**: Copy the original diagram text to clipboard
- **File Information**: File name, file size, and line count
- **Powered by**: [puml-canvas-js](https://github.com/battlecook/puml-canvas-js) for native JavaScript SVG rendering

### Supported PlantUML Formats
- PUML, PlantUML, IUML

## 📐 LaTeX Viewer Features

### Structure and Math Preview (Not a TeX Compiler)
- **Partial Render by Design**: Shows document structure and formulas, not typeset output — no TeX engine is involved, and the preview says so on screen
- **Section Outline**: Navigate `\part` … `\subparagraph` from a sidebar; selecting an entry scrolls the preview
- **Math Rendering**: Inline (`$…$`, `\(…\)`) and display (`$$…$$`, `\[…\]`, `equation`, `align`, `gather`, …) formulas rendered with KaTeX, progressively as they approach the viewport
- **Preamble Macros**: `\newcommand`, `\DeclareMathOperator`, and `\let` definitions are passed to the math engine
- **Tables and Theorems**: `tabular`/`array`/`longtable` with column alignment and `\multicolumn`, plus `\newtheorem` environments
- **Cross-References**: `\ref` becomes a control that scrolls to the labelled block; `\url`/`\href` open externally
- **Nothing Silently Dropped**: TikZ, `\includegraphics`, and `\input` targets stay visible as their own source with a badge explaining why they were not rendered
- **Preview / Split / Source Views**: Edit the source with undo/redo and save in place (`Ctrl/Cmd+S`) or to a copy
- **Powered by**: [omni-viewer-core](https://github.com/battlecook/omni-viewer-core) for parsing and rendering, with [KaTeX](https://katex.org/) for formulas

### Supported LaTeX Formats
- TEX, LATEX, LTX

Note: external file references are not resolved, and BibTeX, cross-reference numbering, and TikZ drawing are out of scope.

## 📓 Jupyter Notebook Viewer Features

### Read-Only Notebook Preview (.ipynb)
- **Saved Results, Never Executed**: Shows nbformat 4 notebooks in file order with the outputs stored in the file; no kernel is started and no code runs
- **Code Cells**: `In`/`Out` execution counts, syntax highlighting for the notebook's kernel language (Python, R, Julia, Scala, SQL, and more), stdout/stderr streams, and error tracebacks
- **Rich Outputs**: HTML tables, PNG/JPEG/GIF/WebP/SVG images, Markdown, LaTeX, JSON, and plain text, with one static representation chosen per output; interactive widget and JavaScript outputs fall back to their saved text
- **Markdown Cells**: GitHub-flavored Markdown with KaTeX math, `attachment:` images, and images referenced relative to the notebook (confined to the notebook's folder)
- **Navigate Large Notebooks**: Search cells and outputs, hide all code or all outputs, and expand individual cells; saved `source_hidden`, `outputs_hidden`, and `collapsed` hints set the initial state
- **Safe by Default**: Output HTML is sanitized, scripts and remote resources are blocked, and external links open in the browser
- **Opt-In Editor**: Registered as an optional editor so VS Code's own notebook editor stays the default; use `Open With OmniViewer` from the explorer
- **Powered by**: [omni-viewer-core](https://github.com/battlecook/omni-viewer-core) for parsing and rendering, with [KaTeX](https://katex.org/) for formulas

Note: notebooks larger than 64 MiB are not previewed.

## Font Viewer Features

- **Local Font Preview**: Open `.ttf`, `.otf`, and `.woff` with the shared core viewer; edit the sample text, change its size, and adjust variable-font axes
- **Glyph Browser**: Search Unicode characters and code points, browse paginated glyphs, and inspect font metadata and licenses
- **Limits**: Files up to 64 MiB; WOFF2 and font collections are not supported

## Arrow IPC / Feather V2 Viewer Features

- **Files and Streams**: Open `.arrow` and `.feather` IPC files or streams, including LZ4 and ZSTD compression
- **Data Inspection**: Search, sort, and page through tables; inspect schema and custom metadata, preview JSON, copy TSV/JSON, and export JSON through VS Code's save dialog
- **Bounded Preview**: Up to 256 MiB input and 10,000 retained rows; copy and export use the retained preview rows. Int64/Uint64 and decimal values remain strings to preserve precision. Feather V1 is not supported

## GeoJSON Viewer Features

- **Offline Map**: View all seven GeoJSON geometry types, including polygon holes, with pan/zoom and keyboard navigation
- **Feature Inspector**: Select features and inspect their properties without fetching map tiles or remote resources
- **Opt-In Editor**: Choose `Open With OmniViewer` or **GeoJSON Viewer** from **Reopen Editor With…** for `.geojson`; ordinary text editing remains available
- **Detection and Limits**: Recognizes complete GeoJSON objects within the 64 KiB content sample for `.json` and extensionless files; `.geojson` always routes by extension. Files are capped at 128 MiB, with bounded feature and vertex previews

## 🌐 HTML Viewer Features

- **Preview and Source Tabs**: View `.html` and `.htm` files with `omni-viewer-core`'s HTML viewer
- **Safe Preview**: A sandboxed iframe renders inline styles and embedded data images; scripts, external resources, and navigation are blocked
- **Encoding Support**: The core honors byte-order marks and HTML charset declarations
- **Large Documents**: Files over 8 MiB or with very dense markup open in source view; files over 64 MiB report the host's read limit
- **Opt-In Editor**: Right-click a file and choose `Open With OmniViewer`, or select **HTML Viewer** from **Reopen Editor With…**
- **Refresh**: Use the existing Omni Viewer refresh command to reload changes from disk

## 🧾 XML Viewer Features

### Element Tree and Source Side by Side
- **Tree + Source**: Element/attribute tree with a node inspector next to the original source; selecting a node highlights its range in the source, and clicking a tag or attribute in the source selects its node
- **Namespaces and Diagnostics**: Namespaces are resolved, and well-formedness errors (mismatched or unclosed tags, duplicate attributes, undeclared prefixes) are reported with line and column, then recovered so a broken file still opens
- **Search**: Names, values, or comments and processing instructions, with next/previous and a matches-only filter
- **Copy**: A node's XPath, its value, or its XML
- **Large Files**: Both panes are virtualized, and long single-line sources are split into display segments
- **Safe by Default**: External entities are never loaded, and internal DTD entities expand one level only under a budget (no XXE or billion-laughs expansion)
- **Opt-In Editor**: Registered as an optional editor so XML keeps VS Code's text editor as the default; use `Open With OmniViewer` from the explorer. OpenVINO IR, ARXML, and ReqIF files still open in their dedicated viewers
- **Powered by**: [omni-viewer-core](https://github.com/battlecook/omni-viewer-core)

### Supported XML Formats
- XML, XSD, XSL, XSLT, WSDL, XLF, XLIFF, RSS, Atom, XAML, KML, GPX, RESX, CSPROJ, VCXPROJ, NUSPEC, and extensionless files starting with an `<?xml` declaration

Note: documents larger than 64 MiB are not previewed.

## 📚 EPUB Viewer Features

### Reflowable E-Book Reader (.epub)
- **EPUB 2 and 3**: Reads the table of contents from the EPUB 3 navigation document or the EPUB 2 NCX, and walks the book's reading order with next/previous and the arrow keys
- **Book Info**: Title, creators, identifiers, publication date, series, subjects, description, and cover, plus any diagnostics
- **Text Scaling**: `Ctrl/Cmd` `+`/`-`/`0`
- **On-Demand Loading**: Only the package files are read up front; chapters and images are inflated as you open them
- **Safe by Default**: Chapter markup is sanitized; scripts, forms, frames, media, and publisher CSS are dropped, remote images are blocked, and external links open in the browser
- **DRM**: A book whose every chapter is encrypted is reported as protected; partly encrypted or fixed-layout content is listed in the diagnostics
- **Powered by**: [omni-viewer-core](https://github.com/battlecook/omni-viewer-core), with [DOMPurify](https://github.com/cure53/DOMPurify) for sanitizing

Note: books larger than 256 MiB open in the Archive viewer instead.

## 📄 JSONL Viewer Features

![JSONL Viewer Screenshot](https://eyedealisty-website.web.app/img/omniviewer/jsonl-screenshot.jpg)

### Interactive JSONL Editor
- **Line-by-Line Editing**: Direct inline editing of JSON lines with syntax validation
- **Hover Popup**: JSON popup display on line hover with formatted syntax highlighting
- **Click-to-Edit Popup**: Click popup content to edit JSON directly in formatted view
- **Real-time Validation**: Instant JSON validation with visual feedback (valid/invalid indicators)
- **Data Synchronization**: Seamless sync between popup edits and original lines
- **Syntax Highlighting**: Color-coded JSON syntax for better readability
- **Error Handling**: Clear error messages for invalid JSON format

### Supported JSONL Formats
- JSONL (JSON Lines) - Each line contains a valid JSON object

## 📊 Parquet Viewer Features

![Parquet Viewer Screenshot](https://eyedealisty-website.web.app/img/omniviewer/parquet-screenshot.jpg)

### Advanced Parquet Viewer
- **Table Display**: Clean, table view of Parquet data
- **Search & Filter**: Real-time search across all columns
- **Column Sorting**: Click headers to sort by any column (numeric/text aware)
- **Pagination**: Handle large datasets with page navigation
- **Copy to Clipboard**: Copy filtered data to clipboard (tab-separated format)
- **Keyboard Shortcuts**: Ctrl+F for search, Ctrl+C for copy
- **File Information**: Row count, column count, and file size display
- **Responsive Design**: Works on different screen sizes

### Supported Parquet Formats
- Parquet

## 🧬 HDF5 Viewer Features

### Hierarchical Data Format 5 (.h5, .hdf5, .he5)
- **Structure Tree**: Walks the file hierarchy and lists every group and dataset path
- **Dataset Details**: Shows each dataset's shape (dimensions) and datatype (e.g. Float64, Integer32)
- **Superblock Summary**: Reports superblock version, offset/length sizes, and root group address
- **Format Coverage**: Reads superblock versions 0–3, including classic symbol-table groups and version-2 object headers with compact links
- **Header Preview**: Hex/ASCII dump of the file header for inspection

## 🔢 NumPy Viewer Features

### NumPy Arrays (.npy, .npz)
- **Both Containers**: Opens a standalone `.npy` array and an `.npz` archive written by `np.savez` / `np.savez_compressed`, with an array selector for archives holding several arrays
- **Array Details**: Shows each array's dtype, byte order, shape, memory order (C or Fortran), element count, and byte size
- **Data Grid**: Pages through the values of 1-D and 2-D arrays and slices higher-dimensional ones, printing `NaN`, infinities, and negative zero exactly as stored
- **Bounded Preview**: Decodes at most 100,000 values across the file, so a large array opens with a preview rather than being loaded into the webview whole
- **Safe by Design**: Object arrays are listed but never unpickled, and an `.npz` member is inflated through a bounded stream rather than trusted to its declared size
- **Smart Routing**: The `\x93NUMPY` magic string routes a mislabeled `.npy`, and an `.npz` opens without the generic ZIP probe inflating it first. Files are inspected in memory, so an `.npz` above 512 MB is left to the Archive viewer
- **Powered by**: `omni-viewer-core` 0.19.0 for NumPy parsing and rendering

## 🧠 Safetensors Viewer Features

### Model Tensor Metadata (.safetensors)
- **Tensor Inventory**: Lists tensor names, data types, shapes, parameter counts, and byte sizes
- **Model Summary**: Shows total tensor and parameter counts, data types, metadata keys, and file size
- **Metadata View**: Displays the optional Safetensors metadata map in a searchable table
- **Validation Warnings**: Reports malformed headers, unsupported data types, and inconsistent tensor byte ranges
- **Search and Export**: Filters tensor/metadata rows and copies the parsed model as JSON
- **Efficient Large-File Access**: Reads only the Safetensors prefix and JSON header instead of loading tensor payloads
- **Powered by**: `omni-viewer-core` 0.19.0 for random-access Safetensors parsing

## 🕸️ ONNX Viewer Features

### Neural Network Graph (.onnx)
- **Model Summary**: Shows node, initializer, input, output, and function counts alongside the IR version, producer, and file size
- **Graph View**: Lists the computation graph's inputs, outputs, and value info with resolved tensor types, shapes, and dimension denotations
- **Node Inspector**: Shows each node's operator, domain, inputs, outputs, and attributes, including nested subgraphs and attribute tensors
- **Tensor Inventory**: Lists initializers with data type, shape, element count, byte size, and embedded/external storage location
- **Opsets and Metadata**: Reports imported opset domains and versions plus the model's metadata properties
- **Validation Warnings**: Reports truncated, malformed, or unsupported protobuf structures instead of failing silently
- **Weights Stay on Disk**: Parses the ModelProto for topology and metadata only — tensor payloads are skipped, never decoded into memory
- **Powered by**: `omni-viewer-core` 0.19.0 for the dependency-free ONNX protobuf reader and viewer

## 📱 TFLite / LiteRT Viewer Features

### TensorFlow Lite Model Graph (.tflite, .lite)
- **Model Summary**: Shows schema/runtime version, subgraph, operator, tensor, buffer, signature, and constant-weight counts
- **Subgraph Graph**: Visualizes operator and tensor flow for each subgraph, including control-flow references
- **Tensor Inspector**: Displays types, shapes, buffer locations, quantization parameters, sparsity, and byte-size information
- **Operator Details**: Shows builtin and custom operator codes, versions, inputs/outputs, intermediates, and decoded options
- **Model Metadata**: Lists signatures, metadata entries, external buffers, and model information in searchable panels
- **Validation Warnings**: Surfaces malformed FlatBuffers, custom operators, Select TensorFlow fallbacks, and externally stored buffers
- **Weights Stay Unparsed**: Reads the `TFL3` FlatBuffer structure without decoding tensor payloads
- **Powered by**: `omni-viewer-core` 0.19.0 for dependency-free TFLite/LiteRT parsing and rendering

## 🔥 ExecuTorch Viewer Features

### PyTorch ExecuTorch Programs (.pte)
- **Program Summary**: Shows schema version, method, instruction, operator, tensor, and delegate counts plus the constant data stored in the file
- **Method Graph**: Visualizes each method's kernel and delegate calls with the values flowing between them, with `JumpFalseCall` targets resolved within their chain
- **Instruction List**: Lists every kernel, delegate, move, jump, and free call with its operator or backend, inputs, outputs, and source stack frames
- **Value Inspector**: Shows each EValue's type and shape, dim order, element count, data size, and where its bytes live — inline constant, constant segment, mutable state, external `.ptd`, memory-planned activation, or runtime-supplied
- **Delegates and Segments**: Lists backend delegates such as XNNPACK with their compile specs and blob locations, and every data segment with its kind, file offset, size, and the methods that use it
- **Model Info**: Shows the extended header, memory-plan arena sizes, input/output pytree specs, and named data entries
- **Validation Warnings**: Flags required runtime backends, tensors stored in a separate `.ptd` file, segments past the end of the file, and unknown scalar types or instruction kinds
- **Weights Stay on Disk**: Reads the `ET12` FlatBuffer and resolves segments to offsets and byte counts without decoding a single payload. The program is inspected in memory, so a file above 512 MB is rejected
- **Powered by**: `omni-viewer-core` 0.19.0 for dependency-free ExecuTorch parsing and rendering

## 🔥 PyTorch Export Viewer Features

### `torch.export` Packages (.pt2)
- **Export IR Graph**: Shows the ATen graph — placeholders coloured by signature kind (user input, parameter, buffer, constant), operator nodes, outputs, and the `cond` / `while_loop` sub-graphs of higher-order control-flow nodes
- **Node Inspector**: Lists each node's arguments, producers and consumers, `nn.Module` stack, metadata, and stack trace
- **Weights and Constants**: Lists parameters, buffers, tensor constants, and script objects with dtype, shape, byte size, archive status, and a short value preview of every fixed-width dtype including bf16 and float8
- **Signature and Modules**: Shows graph inputs and outputs by kind (including buffer mutations and constant inputs) and the `nn.Module` hierarchy with preserved call signatures
- **Model Info**: Reports schema and torch versions, opsets, range constraints, guards, and operator counts, with symbolic shapes printed as expressions (`2*s0`) instead of sympy `srepr`
- **Multi-Model and AOTInductor Packages**: Adds a model selector for `package_pt2` bundles and opens AOTInductor-only packages on the archive listing with their compile metadata; the pre-PT2 `torch.export.save` layout is read on a best-effort basis
- **Smart Routing**: `.pt2` files open by extension, and a package saved under another name is recognized by its `archive_format` marker. The package is inspected in memory, so a file above 512 MB is left to the Archive viewer
- **Powered by**: `omni-viewer-core` 0.19.0 for dependency-free PT2 parsing and rendering

## 🟣 OpenVINO IR Viewer Features

### OpenVINO Intermediate Representation (.xml + .bin)
- **Graph View**: Shows the layer topology with a layer inspector covering ports with their producers and consumers, `<data>` attributes, `rt_info`, weight ranges, and the sub-graphs a `Loop`, `TensorIterator`, or `If` layer carries
- **Layers, Constants, and I/O**: Searchable tables of every layer, every constant with its offset, size, and status in the `.bin`, and the model's inputs and outputs with their tensor names
- **Weight Checks**: Reads the same-named `.bin` beside the `.xml`, checks every constant's byte range against it, and decodes its leading values (f16, bf16, and f8 included); a `.bin` too short for the constants, or with bytes nothing references, is flagged as a likely mismatch
- **Model Info**: Reports the network name, IR version, opsets, operator counts, and flattened `rt_info` / `meta_data`
- **IR Versions**: Targets IR v10 and v11 (OpenVINO 2020.1 and newer) and reads the legacy v7-and-earlier layout on a best-effort basis
- **Opt-In for `.xml`**: `.xml` is shared with every other XML dialect, so the viewer never becomes the default — choose **Open With… → OpenVINO IR Viewer** (or **Reopen Editor With…**). A file that is not an IR is rerouted to whichever Omni viewer recognizes it (ARXML, ReqIF, …), and otherwise reports that it is not an IR
- **Size Limits**: Topologies up to 256 MB are inspected; a `.bin` above 512 MB, or one that cannot be read, stays on disk and the topology opens with constants shown by range only, with a notice saying why
- **Powered by**: `omni-viewer-core` 0.19.0 for dependency-free OpenVINO IR parsing and rendering

## 🧱 Keras Viewer Features

### Keras Model Architecture (.keras, Keras `.h5`)
- **Both Save Formats**: Reads the Keras 3 `.keras` archive and the legacy `save_format='h5'` model saved by Keras 2
- **Model Summary**: Shows layer count, total parameters, weight bytes, and the Keras version the model was saved with
- **Layer Table**: Lists every layer with its class, activation, built input shape, dtype, trainable flag, parameter count, and weight count, flattening nested sub-models by depth
- **Layer Inspector**: Expands a layer into its full config, inbound connections, and the weights matched to it
- **Weight Inventory**: Lists each weight's store path, shape, dtype, element count, and byte size
- **Training Configuration**: Shows the compiled optimizer, loss, and metrics along with the archive's metadata and members
- **Validation Warnings**: Reports missing or unreadable configs, unmatched weights, and unknown layouts instead of failing the parse
- **Weights Stay Undecoded**: Walks the HDF5 weight store for shapes and dtypes only — no weight payload is decoded or sent into the webview. The model is inspected in memory, so a file above 512 MB is left to the HDF5 viewer or the Archive viewer instead
- **Powered by**: `omni-viewer-core` 0.19.0 for Keras archive and HDF5 model parsing and rendering

## 🍎 Core ML Viewer Features

### Apple Core ML Models (.mlmodel, .mlpackage)
- **Both Encodings**: Reads a bare `.mlmodel` specification and an `.mlpackage` archive, telling the two apart by their bytes rather than their name. A `.mlpackage` written to disk as a folder is a directory rather than a file, so open the `Data/com.apple.CoreML/*.mlmodel` inside it, or a zipped copy of the package
- **Model Summary**: Shows the specification version with the iOS/macOS release it requires, the model type, and function, graph, operation, input, and output counts
- **Prediction Interface**: Lists every input, output, state, and training input with its feature type — `image 224 × 224 RGB`, `multiArray FLOAT32[1, 3, 224, 224]` — along with shape flexibility, optional flags, and descriptions, across all functions for multi-function models
- **Graph Explorer**: Walks ML Program operations with their named operands, attributes, and nested blocks; pre-Core ML 5 neural network layers with resolved layer types; and pipeline stages, with control-flow targets linked between graphs
- **Weight Inventory**: Resolves each blob-backed tensor to its file, offset, byte count, and quantization, and reports inline tensors by size — plus a per-weight-file view of reference counts and whether the package actually carries the file
- **Custom & Updatable Ops**: Flags operations needing a class registered with the runtime and layers marked for on-device update
- **Package Contents**: Shows the `Manifest.json` items and archive members of an `.mlpackage`, including the path of the spec that was parsed
- **Weights Stay Undecoded**: Never decodes a single parameter — blob references become offsets and byte counts, so no weight payload reaches the webview. The model is inspected in memory, so a file above 512 MB is left to the Archive viewer
- **Powered by**: `omni-viewer-core` 0.19.0 for dependency-free Core ML protobuf parsing and rendering

## 🦙 GGUF Viewer Features

### Quantized Model Metadata (.gguf)
- **Model Summary**: Shows GGUF version, architecture, tensor and parameter counts, quantization type, and metadata key count
- **Tensor Inventory**: Lists tensor names, dtypes, shapes, element counts, and both relative and absolute data offsets
- **Metadata Table**: Displays every metadata key with its GGUF value type, with previews in place of oversized arrays and strings
- **Structure View**: Shows byte order, tensor data offset, and the parsed file layout
- **Validation Warnings**: Reports header, EOF, and admission-limit problems for malformed or hostile files
- **Efficient Large-File Access**: Range-reads only the metadata and tensor-index prefix — a multi-gigabyte model opens without reading its weights
- **Powered by**: `omni-viewer-core` 0.19.0 for GGUF parsing and the viewer

## 🌐 HAR Viewer Features

### HTTP Archive Network Logs (.har)
- **Built for Triage**: Opens the HTTP Archive a browser's network panel (or curl, Charles, Fiddler, Playwright) exports — the artifact a web or API failure usually arrives as — as a request log rather than a JSON tree
- **Summary Figures**: Shows request count, elapsed time, transferred bytes, decoded resource bytes, domain count, the number of failed requests, and the page count when the archive records pages
- **Request Table with Waterfall**: Sorts by every column — name, method, status, type, domain, transferred size, and time — with a per-request waterfall bar on a timeline shared by the whole archive
- **Failure Filters**: Narrows by method, status class (including requests that never got a response), resource type, and domain, plus free-text search over URLs, status text, and headers with an opt-in toggle that extends the search to bodies
- **Request Details**: Shows general info and request/response headers, query string and request payload with form fields expanded, the response body pretty-printed when it really is JSON, cookies, and a phase-by-phase timing breakdown (blocked, DNS, connect, TLS, send, wait/TTFB, receive)
- **Honest Numbers**: Keeps a size or start time the archive never recorded as unknown rather than a confident zero, takes the TLS handshake out of `connect` so the waterfall never double-counts it, and tells a body cut by the preview limit apart from one the archive stored incompletely
- **Broken Archives Still Open**: A truncated export still shows the requests it did hold, with a warning, instead of failing outright
- **Smart Routing**: `.har` files open in the HAR viewer, and a HAR saved as `.json` (or without an extension) is recognized by its `log.entries` structure, so "Open With OmniViewer" on such a `.json` opens the HAR viewer instead of the JSON tree; the raw text stays available in VS Code's text editor
- **Parsed Off the UI Thread**: The archive is parsed in a worker, and only the request model — bodies cut to a preview — is sent into the webview. Because the parsed model is about as large as the archive, archives above 100 MB are not inspected — a `.har` that large still opens in the HAR viewer and reports the limit
- **Credential-Aware Sharing**: HAR files usually carry cookies, authorization headers, and request bodies, so the Share button asks for confirmation before uploading one
- **Powered by**: `omni-viewer-core` 0.19.0 for HAR parsing and rendering

## 🧭 Smart File Detection

- **Signature-Based Routing**: Detects common file signatures before opening and can reroute mislabeled files to the matching Omni Viewer
- **Broader Format Sniffing**: Recognizes common PDF, image, audio, video, Parquet, Office, CSV-style, and JSONL content beyond filename extensions

## 🚀 Installation and Usage

### Install from Marketplace

**Marketplaces:**

- **[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=battlecook.omni-viewer)** - Official VSCode Marketplace
- **[Open VSX Registry](https://open-vsx.org/extension/battlecook/omni-viewer)** - Open Source VSX Registry

If you are using jetbrains ide, check out [this repository](https://github.com/battlecook/intellij-omni-viewer)

## 🌐 Other Platforms

Omni Viewer is also available on web and mobile platforms:

- **Web**: [Web App](https://omni-viewer-web.web.app/)
- **Android**: [Google Play](https://play.google.com/store/apps/details?id=com.eyedealisty.omniviewer)
- **iOS**: [App Store](https://apps.apple.com/kr/app/omni-viewer-mobile/id6759875642)

### Development Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Compile TypeScript**
   ```bash
   npm run compile
   ```

3. **Package Extension**
   ```bash
   npm run vscode:prepublish
   ```

## Privacy & Data Use (Planned Share Feature)

Omni Viewer does **not** currently enable this share upload flow in the released extension.  
The following policy describes the planned behavior for a future share feature release.

Open VSX listing privacy details: [open-vsx-listing-privacy.md](open-vsx-listing-privacy.md)

- **What data will be uploaded**
  - The file selected by the user for sharing (single file), encrypted on the device with AES-256-GCM before upload
  - The filename and content type are sealed inside the encrypted file; the server sees only an opaque `encrypted.bin` and its size
  - The decryption key stays in the share link's `#k=` fragment and is never sent to the server
  - Request source platform (for example `vscode`)
- **Purpose**
  - Create a temporary share link and allow limited-time download/view access
- **Planned storage location**
  - Temporary server-side processing
  - Cloud storage for shared files
  - Database storage for share metadata
- **Planned retention / expiration**
  - Default share link lifetime: **5 minutes**
  - After expiration, share access will be denied (`410`)
  - Expired objects/metadata may be removed by backend lifecycle jobs
- **Planned access model**
  - Upload endpoint will require authenticated client request (API key-based)
  - Download endpoint will be link-based with non-guessable share IDs
  - Optional maximum access-count policy may be applied per share

Privacy Policy: https://omni-viewer-web.web.app/privacy


## 📝 License

MIT License

## 📞 Support

If you encounter any issues or have feature requests, please contact us through GitHub Issues.


### Known Issues
- Large file handling optimization needed

## 📊 Performance Notes

### File Size Limitations

- **Audio/Video/Image Files**: 
  - Maximum file size limit: 50MB per file
  - Recommended file size: < 50MB for optimal performance
  - Audio files are loaded as Base64 for WebView compatibility

- **Text-based Files (CSV, JSONL, Parquet)**:
  - Maximum file size limit: 500MB per file
  - Recommended file size: < 200MB for optimal performance
  - Large files may take time to load initially
  - Memory usage scales with file size

### Parquet File Specific Limitations

- **File Size Restrictions**:
  - **Files ≥ 150MB**: Cannot be opened. Clear error message will be displayed.
  - **Files 50MB - 150MB**: Only the first 10,000 rows are displayed with a warning message showing total row count.
  - **Files < 50MB**: All rows are displayed without any limitations.
- **Row Limit**: For files between 50MB and 150MB, only the first 10,000 rows are loaded for display to prevent memory issues
- **Memory Considerations**: 
  - Parquet files are converted to JSON format for display, which can significantly increase memory usage
  - Large files may take time to load initially
  - For best performance, keep files under 50MB for full data access

### General Notes

- Large files may take time to load initially
- Memory usage scales with file size
- For best performance, keep files under recommended sizes

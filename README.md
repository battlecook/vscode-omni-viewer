# VSCode Omni Viewer

A comprehensive audio, image, PSD, video, CSV, Excel, Word, PowerPoint, PDF, Parquet, JSONL, and HWP viewer extension for VSCode and Cursor.

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
  - The file selected by the user for sharing (single file)
  - File metadata such as filename, content type, file size, file type, and optional viewer metadata (for example selected region/range)
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

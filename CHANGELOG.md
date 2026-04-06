# Changelog

## [0.17.1] - 2026-04-07

### Fixed
- **Legacy Word (`.doc`) rendering**
  - Improved lead paragraph promotion so short section lead lines can be elevated into stronger heading-like blocks when surrounded by longer body text
  - Improved keep-with-next lead paragraph handling so emphasized opening lines retain bold/larger styling instead of flattening into regular body text
  - Improved legacy table fidelity by detecting explicit table-border sprms and rendering stronger border styling when the original document requested it
  - Reduced noisy legacy image captions by suppressing internal OLE/storage stream labels that should not surface as visible image captions

## [0.17.0] - 2026-04-05

### Added
- **CSV Viewer**
  - Added clickable per-column sorting with ascending, descending, and clear-sort states
  - Added sort metadata to JSON export so filtered exports preserve the current table ordering context
- **Legacy Word (`.doc`) rendering**
  - Added semantic block modeling for legacy `.doc` content before HTML emission so the viewer can paginate sections more faithfully
  - Added paged legacy document rendering with section-aware headers/footers, multi-column layouts, floating media flow, and stronger table header modeling
  - Added cleanup for field-code noise such as hyperlink instructions before rendering inline text
- **HWP / HWPX Viewer**
  - Added footnote/endnote extraction, note summaries, and linked note reference highlighting in rendered pages
  - Added richer HWP/HWPX layout metadata including section type, column counts, page number starts, layout signatures, and semantic summaries for the new renderer
- **Regression coverage**
  - Added expanded regression tests for legacy `.doc` semantic rendering and additional legacy `.ppt` title/image-placement heuristics

### Changed
- **Extension architecture**
  - Centralized viewer registration, read-only document helpers, reroute logic, and shared error rendering so all viewer providers follow the same activation and recovery flow
  - Split message handling and file utility logic into focused modules for media, PDF, text, tabular, and Word workflows
- **PDF / PowerPoint runtime**
  - Upgraded bundled `pdfjs-dist` from 3.x to 4.x and switched packaged PDF/PPT webviews to dynamic ES module loading with `.mjs` assets
  - Raised the VS Code engine requirement to `^1.79.0`
- **HWP / HWPX typography**
  - Refined the HWP renderer with paragraph/run diagnostics, inline object placement rules, tab-stop handling, and stronger multi-column page presentation

### Fixed
- **CSV Viewer**
  - Fixed row editing, copy/export, and pagination state after filtering by tracking visible row indices instead of mutating filtered row snapshots
- **PDF Viewer**
  - Fixed packaged PDF loading in stricter webview environments by using module-based PDF.js loading and disabling `eval`-dependent parsing paths
- **Legacy PowerPoint (`.ppt`)**
  - Fixed wide top text boxes and cover-style text blocks being misclassified as body content instead of titles
  - Fixed image placement when multiple visual slots share the same bounds by preferring the most appropriate asset rather than sequential fallback alone
  - Fixed activity-list and master-image decks so backdrop images are not duplicated or sprayed into every text cell, and full-slide background images remain visible
  - Fixed packaged PPT PDF preview loading by moving to the same module-based PDF.js initialization flow used by the PDF viewer
- **Audio Viewer**
  - Fixed selected region time overlays not following region drag/resize updates consistently in the waveform UI
- **Legacy Word (`.doc`)**
  - Fixed legacy pagination gaps around embedded charts, floating media, captions, page breaks, and complex table headers so rendered pages stay closer to document structure
  - Fixed chart-adjacent empty paragraphs and DOCX style-host handling to reduce stray spacing and preserve injected rendering styles more reliably
- **HWP / HWPX Viewer**
  - Fixed HWP/HWPX block ordering and anchor resolution so inline tables, images, lines, and text boxes stay attached to the nearest paragraph or cell more reliably
  - Fixed HWP/HWPX paragraph styling by carrying more direct/referenced style information, underline/vertical-align/letter-spacing data, and table-cell paragraph rendering into the viewer

## [0.16.0] - 2026-03-23

### Added
- **HWP / HWPX Viewer**
  - Added `HWPX` package detection and viewer routing alongside existing legacy `HWP` support
  - Added a structured HWP layout document parser that models paged content, headers/footers, paragraphs, tables, images, lines, and text boxes
  - Added a dedicated HWP webview layout renderer with page frames, page numbers, zoomable paged preview, and print-ready layout blocks
- **Legacy PowerPoint (`.ppt`) regression coverage**
  - Added tests for master-unit slide scaling, Korean byte-text decoding, delayed picture extraction, and shape-linked picture placement

### Changed
- **HWP / HWPX rendering pipeline**
  - Replaced the older direct HTML conversion path with a document-layout payload and client-side renderer so HWP-family files can preserve page structure and positioned objects more faithfully
  - Updated the HWP viewer UI and loading states to reflect `HWP/HWPX` support instead of only legacy `.hwp`
- **Legacy PowerPoint (`.ppt`) media presentation**
  - Adjusted rendered slide images to use centered cover fitting for more natural visual framing inside discovered image slots

### Fixed
- **HWP / HWPX Viewer**
  - Fixed `.hwpx` files not being recognized as HWP documents even though they are ZIP-based package documents
  - Fixed HWP-family documents losing page-level structure by carrying section size, padding, header/footer text, and page pagination into the rendered view
  - Fixed embedded HWP/HWPX objects such as tables, images, connector lines, and shaped text boxes being dropped or flattened into plain text
  - Fixed positioned HWP/HWPX objects by preserving inline vs absolute placement and anchor scope information for page, paragraph, cell, and character-relative content
- **Legacy PowerPoint (`.ppt`)**
  - Fixed legacy decks that store slide geometry in PowerPoint master units by scaling slide and anchored object coordinates back to pixel-sized slide dimensions
  - Fixed Korean `TextBytesAtom` text decoding by supporting legacy byte encodings such as CP949/EUC-KR and avoiding false noise classification for readable Hangul text
  - Fixed picture extraction and placement by reading delayed `Pictures` offsets from BStore entries and preferring shape-linked blip references before sequential image fallback

## [0.15.0] - 2026-03-22

### Added
- **PDF Viewer**
  - Added support for opening password-protected PDFs with an in-viewer password prompt
  - Added text annotation font-size control in the text insertion modal
- **Legacy Word (`.doc`) rendering**
  - Added native `.doc` engine metadata in the viewer UI so legacy documents clearly indicate when they are rendered without conversion
  - Added embedded workbook extraction for legacy `.doc` files, including inline table previews and SVG chart rendering for chart-like worksheet data
- **Regression coverage**
  - Added targeted tests for file signature detection, delimiter detection, legacy `.doc` parsing, and legacy `.ppt` layout/style extraction

### Changed
- **Viewer selection**
  - Switched manual open commands and custom editors to validate file signatures before opening, and automatically reroute mislabeled files to the matching Omni Viewer when possible
  - Expanded file sniffing to recognize common image, audio, video, PDF, Parquet, Office, CSV, and JSONL content beyond filename extensions
  - Improved delimited text detection so CSV-style files can automatically use comma, semicolon, tab, or pipe separators while still preserving `.tsv` handling
- **PDF / PowerPoint asset loading**
  - Replaced runtime CDN loading of `pdf.js` with packaged `pdfjs-dist` extension assets for both the PDF viewer and PowerPoint viewer
- **Legacy Word (`.doc`) presentation**
  - Refined legacy document styling to render with a paper-like light background, richer table/list/image layouts, and clearer embedded chart/table presentation

### Fixed
- **PDF Viewer**
  - Fixed environments with restricted network access or blocked CDN requests from failing to load `pdf.js`
  - Improved signature annotations by trimming empty canvas margins before placement so saved signatures fit more naturally
  - Improved annotation selection affordances so delete controls appear only on the active annotation and selected items are highlighted more clearly
- **Legacy PowerPoint (`.ppt`)**
  - Fixed slide ordering by following `SlideListWithText` persist references instead of relying only on discovery order
  - Fixed presentation sizing to respect `DocumentAtom` dimensions when available instead of always falling back to a fixed canvas
  - Fixed title/body/subtitle placement by using `SlideAtom` layout hints and placeholder metadata for multi-column and vertical-title layouts
  - Fixed missing or weak text extraction by preferring outline text and grouped `OfficeArtClientTextbox` content over flat fallback extraction
  - Fixed legacy image and shape placement by reading OfficeArt anchors, mapping discovered visual slots, and avoiding duplicate shape/image rendering
  - Fixed shape styling so slide background/text defaults, fill colors, border colors, and border widths are carried into rendered text boxes and visible non-text shapes
- **Legacy Word (`.doc`)**
  - Fixed mojibake-prone ANSI decoding by scoring multiple candidate decoders and preferring more readable Hangul/legacy text output
  - Fixed paragraph styling loss by carrying bold, alignment, indentation, text color, and safe background/highlight colors into rendered legacy content
  - Fixed structured table reconstruction by handling legacy table offsets, row metadata propagation, merge information, and empty cells without collapsing layout

## [0.14.5] - 2026-03-16

### Changed
- **Release version follow-up**
  - Bumped the release version once more after `0.14.4` because the VS Code Marketplace publish path had already consumed that version while Open VSX had been published separately

## [0.14.4] - 2026-03-16

### Fixed
- **Audio Viewer: Standalone WaveSurfer packaging**
  - Removed runtime CDN loading for `wavesurfer.js` and audio plugins in the audio viewer webview
  - Bundled WaveSurfer core and required plugins into the local audio viewer build so playback no longer depends on external network or CDN asset layout
  - Fixed audio viewer initialization failing with `Cannot read properties of undefined (reading 'create')` in Cursor and similar webview environments

## [0.14.3] - 2026-03-16

### Fixed
- **CSV Viewer: TSV format compatibility**
  - Fixed `.tsv` files being parsed with comma-separated CSV rules even though they were already registered to open in the CSV Viewer
  - Preserved tab delimiters in table load, Raw View editing, and save flows so edited `.tsv` files remain TSV
  - Added regression tests for TSV parsing and delimiter-aware save serialization

## [0.14.2] - 2026-03-14

### Fixed
- **Webview asset loading**
  - Stopped silently falling back when required local CSS/JS assets fail to inline into viewer webviews
  - Improved compatibility for environments where webview relative asset requests can be blocked with `403 Forbidden`

## [0.14.1] - 2026-03-14

### Fixed
- **Word Viewer: DOCX packaged dependency loading**
  - Bundled `docx-preview` and `jszip` as Word viewer vendor assets instead of relying on runtime `node_modules` paths
  - Fixed installed extension builds showing `docx-preview library is not available.` when opening `.docx` files

## [0.14.0] - 2026-03-01

### Changed
- **PDF Editor: Open behavior**
  - Changed PDF custom editor priority to `default` so `.pdf` files open directly in Omni Viewer PDF Editor
- **PowerPoint Viewer**
  - Improved PPTX rendering stability and slide/chart accuracy

### Added
- **PDF Editor**
  - Added `Save As` support with VS Code save dialog
  - Added per-page delete action (`×`) in thumbnails
  - Added text/signature color selection in modal popup
  - Added annotation deletion (delete button + Delete/Backspace)
- **Legacy Office support (standalone path)**
  - Added `.ppt` standalone parser path (LibreOffice optional fallback)
  - Added `.doc` legacy HTML renderer path

### Fixed
- **PDF Editor**
  - Fixed save flow reliability (`Merge PDF`, `Save`, `Save As`)
  - Fixed annotation placement mismatch under zoom
  - Fixed stale preview after save by syncing/reloading saved state
  - Fixed non-Latin text save error (`WinAnsi cannot encode ...`)
- **PowerPoint / Word**
  - Fixed intermittent PPT `Rendering slides...` stuck state
  - Fixed PPT placeholder text/image rendering issues
  - Fixed `.doc` hard failure when LibreOffice is not installed

### Removed
- Removed `Open with PDF Editor` explorer menu command (`omni-viewer.openPdfViewer`)

## [0.13.0] - 2026-02-28

### Added
- **PDF Editor: PDF merge support**
  - Added a "Merge PDF" button in the PDF editor
  - Supports adding and merging multiple PDF files into the current document
  - Maintains page order during merge with improved drag-and-drop UX
- **PowerPoint Viewer: Microsoft PowerPoint (.pptx) support**
  - Added PowerPoint custom viewer with XML-based slide rendering for `.pptx`
  - Supports both `.pptx` and `.ppt` files
  - `.ppt` files are converted to PDF for rendering
  - Slide jump selector and zoom controls (Ctrl+/-, Ctrl+0)
  - File info header with file size and total slide count
  - Added "Open with PowerPoint Viewer" in explorer context menu for `.pptx` and `.ppt`
  - PowerPoint files open with PowerPoint Viewer by default
  - Requires LibreOffice (`soffice`) for `.ppt` to PDF conversion

## [0.12.0] - 2026-02-14

### Added
- **PDF Editor: PDF (.pdf) view and edit support**
  - View PDF with page-by-page rendering (PDF.js)
  - Default zoom 100%; zoom in/out controls
  - Left sidebar with page thumbnails; click to jump to page
  - **Add text**: Text mode → click on page → enter text → placed on PDF
  - **Add signature**: Signature mode → click on page → draw in modal → placed on PDF
  - **Move**: In View mode, drag text or signature to reposition
  - Save writes annotations into the PDF file (pdf-lib)
  - "Open with PDF Editor" in explorer context menu for .pdf files (priority: option, so default app viewer can stay default)
  - English UI (View, Text, Signature, Save)

## [0.11.0] - 2026-02-13

### Added
- **Word Viewer: Microsoft Word (.docx) support**
  - Renders DOCX as HTML (headings, paragraphs, lists, tables, images)
  - Zoom in/out and reset (Ctrl+/-, Ctrl+0)
  - Print (Ctrl+P)
  - File info: name, size
  - Powered by mammoth for DOCX to HTML conversion
  - DOCX files open with Word Viewer by default (default priority)

## [0.10.0] - 2026-02-12

### Added
- **Excel Viewer: Excel (.xlsx, .xls) support**
  - Multi-sheet support with sheet selector dropdown
  - Table view with search and filter across all columns
  - Pagination for large datasets
  - Copy to clipboard (tab-separated) and Copy as JSON
  - Toggle between table view and raw JSON view
  - File info: sheet name, row count, column count, file size
  - Keyboard shortcuts: Ctrl+F (search), Ctrl+C (copy)
  - Powered by SheetJS (xlsx) for Excel parsing
  - XLSX and XLS files open with Excel Viewer by default (default priority)


## [0.9.1] - 2026-02-08

### Fixed
- **PSD Viewer: ag-psd not loading when installed from marketplace**
  - Added `!node_modules/ag-psd/**` to `.vscodeignore` so the ag-psd package is included in the published extension; PSD viewer now works after installing from VSCode Marketplace or Open VSX

## [0.9.0] - 2026-02-08

### Added
- **PSD Viewer: Adobe Photoshop (.psd) support**
  - Layer panel with tree view of layers and groups (folders)
  - Per-layer visibility toggle (eye button)
  - View button to open a single layer in a modal
  - Checkerboard background for transparency
  - File info: name, size, document dimensions
  - Powered by ag-psd for PSD parsing

### Fixed
- **PSD Viewer: Layer visibility**
  - Fixed eye button toggling the wrong layer (closure fix with IIFE)
  - When any layer is hidden, only leaf layers are drawn (group merged canvases skipped) so that hiding one layer does not hide the whole folder

## [0.8.0] - 2026-01-22

### Added
- **HWP Viewer: Korean word processor document (.hwp) support**
  - HWP file parsing and rendering using hwp.js library
  - Convert HWP documents to HTML for direct viewing within VS Code
  - Zoom in/out functionality (Ctrl +/-, mouse wheel)
  - Print functionality (Ctrl + P)
  - Automatic dark/light theme support
  - Added "Open with HWP Viewer" option in explorer context menu
  - HWP files automatically open with HWP viewer (default priority)

## [0.7.1] - 2025-12-24

### Fixed
- **CSV Viewer: Pagination buttons visibility issue**
  - Fixed pagination buttons (Previous/Next) not being visible at the bottom of the viewer
  - Moved pagination element outside of table-container to ensure proper layout
  - Improved flex layout structure to prevent pagination from being hidden by 100% height container
  - Pagination buttons now properly display at the bottom for datasets with more than 100 rows

## [0.7.0] - 2025-11-28

### Added
- **Parquet Viewer: File size-based row limiting and restrictions**
  - Added file size-based row limiting for large Parquet files
  - Files larger than 150MB cannot be opened with clear error message (prevents memory issues)
  - Files between 50MB and 150MB show only the first 10,000 rows with a warning message
  - Files under 50MB display all rows without limitations
  - Warning message displays file size, row limit, and total row count
  - Prevents extension host from becoming unresponsive with very large files

## [0.6.0] - 2025-11-22

### Added
- **Parquet Viewer: Complete Parquet file support**
  - Added Parquet file viewer using hyparquet library
  - Implemented table view with search and pagination functionality
  - Support for reading and displaying Parquet file data as interactive table
  - JSON export functionality for Parquet data
  - Raw data view toggle for JSON representation
  - Automatic BigInt to string conversion for proper JSON serialization
  - Schema information extraction and display
  - Support for all Parquet data types including INT64 (BigInt)
  - File size and row/column count display
  - Parquet files now open automatically with Parquet viewer (default priority)


## [0.5.0] - 2025-11-13

### Added
- **Audio Viewer: Region extraction and save functionality**
  - Added context menu option to save selected audio region as new file
  - VSCode save dialog integration for choosing save location
  - Save completion notification with file path, size, and duration information
  - "Open file location" button in save completion notification


## [0.4.0] - 2025-10-25

### Added
- **Audio Viewer: Download functionality**
  - Added download button in audio viewer header
  - VSCode extension-based download with save dialog
  - Browser-based fallback download methods
  - Automatic filename extraction and sanitization

### Fixed
- **Audio Viewer: TypeScript error handling**
  - Fixed 'copyError' type assertion issue in download error handling
  - Improved error logging with proper type casting

## [0.3.4] - 2025-10-16

### Changed
- **Image Viewer: Default behavior changed to use standard editor**
  - Changed image viewer priority from "default" to "option" in package.json
  - Image files now open with VSCode's default editor by default instead of custom viewer
  - Added context menu option "Open with Image Editor" for accessing custom image viewer
  - Users can right-click image files and select "Open with Image Editor" to use the custom viewer

## [0.3.3] - 2025-10-16

### Removed
- **Image Viewer: Mouse wheel zoom functionality**
  - Disabled mouse wheel zoom in/out when hovering over images
  - Zoom buttons and keyboard shortcuts (+/-) remain functional
  - Prevents accidental zooming during image interaction

## [0.3.2] - 2025-09-19

### Added
- **Audio Viewer: Spectrogram Scale Selection**
  - Added spectrogram scale selector dropdown with options: Linear, Mel, Bark, ERB
  - Implemented real-time scale switching functionality
  - Set Mel scale as default for proper frequency visualization
  - Added scale change event handling and UI integration

## [0.3.1] - 2025-09-13

### Changed
- **Refactored JSONL viewer template structure**
  - Split large jsonlViewer.html (1413 lines) into separate CSS and JS files
  - Created css/jsonlViewer.css for all styling
  - Created js/jsonlViewer.js for all JavaScript logic
  - Reduced HTML file to 46 lines with clean structure
  - Follows same directory structure as image/ template
- **Refactored ImageEditMode into modular structure**
- **Audio Viewer: Enhanced time precision in region selection**
  - Increased time display precision from 1 to 3 decimal places in region start/end inputs

### Added
- **Drag and drop functionality for JSONL line reordering**
  - Drag line numbers to reorder JSONL lines
  - Visual feedback during drag operations (dragging, drag-over states)
  - Drag preview with rotation and shadow effects
  - Automatic line number updates after reordering
  - Auto-save document after line reordering

### Fixed
- Fixed textarea null reference error in finishEditing method
- Fixed duplicate jsonlData declaration causing SyntaxError in JSONL viewer


## [0.3.0] - 2025-09-07

### Changed
- **File Association Behavior: CSV and JSONL files now open with default text editor**
  - Changed CSV and JSONL viewer priority from "default" to "option" in package.json
  - Files now open in standard text editor by default instead of custom viewers
  - Added context menu options for opening files with custom viewers
  - Users can right-click CSV/JSONL files and select "Open with CSV Viewer" or "Open with JSONL Viewer"

### Added
- **JSONL Viewer: Interactive popup editing with hover functionality**
  - Add JSON popup display on line hover with formatted JSON syntax highlighting
  - Implement click-to-edit functionality in popup for direct JSON modification
  - Add save/cancel buttons with keyboard shortcuts (Ctrl+Enter to save, Escape to cancel)
  - Support real-time data synchronization between popup edits and original lines
  - Add click-outside-to-close functionality for better UX
  - Implement fixed popup sizing to prevent size changes on touch/interaction
  - Implement bulk delete functionality for selected lines with proper file synchronization
  - Add new line insertion by clicking empty space below content

- **Image Editor: Multi-select functionality for editing elements**
  - Implement Cmd/Ctrl+click multi-selection for shapes and text elements
  - Enable simultaneous property editing for multiple selected elements (color, opacity, size, text)
  - Support bulk deletion of selected elements with Delete/Backspace keys
  - Add keyboard shortcuts: Delete/Backspace for deletion, Escape for deselection
  - Display selection count in UI ("3 selected" badge)
  - Handle mixed property values in multi-selection (show average for numeric values, default for colors)
  - Maintain relative positions when dragging multiple elements together
  - Improve drag functionality to move all selected elements simultaneously

### Changed
- **Image Viewer: Code architecture refactoring**
  - Refactor 1390-line monolithic imageViewer.js into 5 focused modules
  - Implement class-based architecture for better encapsulation and reusability
  - Add webpack multi-configuration for TypeScript and JavaScript bundling
  - Install babel-loader, @babel/core, @babel/preset-env for ES6+ compatibility
  - Maintain backward compatibility with existing HTML template references

## [0.2.2] - 2025-01-27

### Fixed
- **CSV Viewer: Duplicate data processing in raw view paste operation**
  - Add isPasting flag to prevent input event handler during paste
  - Resolve issue where pasting text triggered both paste handler and input event
  - Ensure single data processing when pasting clipboard content
- **README: VSCode extension packaging compliance**
  - Replace SVG image with PNG to comply with VSCode packaging requirements
  - Use HTML img tag with width="150" for proper ko-fi button sizing

## [0.2.1] - 2025-09-01

### Fixed
- **Build system: External dependencies not included in VSIX package**
  - Add webpack configuration to properly bundle external npm packages
  - Fix music-metadata dependency not being included in packaged extension
  - Resolve ES module compatibility issues with music-metadata package
  - Update build scripts to use webpack instead of TypeScript compiler only

### Changed
- **Build system improvements**
  - Replace tsc compilation with webpack bundling for production builds
  - Install webpack, webpack-cli, and ts-loader as development dependencies
  - Bundle all external dependencies into single files for proper VS Code extension packaging
  - Maintain source maps for debugging capabilities

## [0.2.0] - 2025-09-01

### Added
- **Audio Viewer: Spacebar keyboard shortcut** for play/pause toggle
- **Audio Viewer: Visual feedback for playback state** - play button turns red when audio is playing
- **Image Viewer: Advanced editing mode** with comprehensive drawing and text tools
  - Text element support with customizable font size and color
  - Circle and rectangle shape tools with size and color customization
  - Independent opacity controls for fill and border colors
  - Drag and drop functionality for all elements
  - Resize handles for rectangle elements
  - Element selection with automatic bring-to-front functionality
  - Property panel with context-aware controls (text vs shape properties)

### Fixed
- **Image Viewer: Canvas positioning issues** - fixed edit canvas alignment with image
- **Image Viewer: Element selection priority** - topmost elements are now selected first
- **Image Viewer: Color opacity application** - fixed transparent color handling for shapes and text
- **Image Viewer: Border opacity support** - border colors now properly support transparency
- **Image Viewer: Text element styling** - removed background and border for cleaner appearance

### Changed
- **Image Viewer UI improvements**
  - Changed "Normal" preset button to "Original" for clearer meaning
  - Removed duplicate "Reset" preset button to eliminate redundancy
  - Added scrollbar support to image viewer for better navigation when images extend below cursor
  - Updated scrollbar styling to match VSCode theme
  - **Unified save functionality** - single "Save" button handles both filtered and edited images
  - **Simplified property panel** - shows only relevant controls based on selected element type
  - **Enhanced font size control** - added number input field alongside slider for precise control
  - **Improved element stacking** - selected elements automatically move to front

### Removed
- **Image Viewer: Duplicate "Reset" preset button** (functionality merged into "Original" button)
- **Audio Viewer: Zoom controls** (🔍+, 🔍-, 📐 Fit buttons) due to non-functioning state
- **Image Viewer: Separate "Save Edit" button** - functionality merged into main "Save" button
- **Image Viewer: Size slider for shapes** - replaced with drag-to-resize handles for rectangles

## [0.1.1] - 2025-08-30

### Added
- img directory for extension assets
- **Enhanced CSV Viewer with advanced editing capabilities**
  - Raw data view with editable textarea for direct CSV editing
  - Custom context menu for table and raw view operations
  - Row and column management (add, delete, insert)
  - Clipboard paste functionality in raw view
  - JSON export to clipboard with size validation
  - Save changes functionality for raw data modifications
  - Keyboard shortcuts for all major operations

### Fixed
- **CSV file saving issues in custom editor**
  - Fixed VS Code API injection for CSV viewer
  - Resolved data persistence issues where changes were only stored in memory
  - Added proper document URI handling in MessageHandler for accurate file saving
  - Updated CSV viewer to use direct vscode API instead of window.vscode
  - Ensured all CSV operations (cell edit, add/delete rows/columns) save to actual file
  - Added comprehensive logging for debugging save operations

### Changed
- Fixed icon path configuration for proper extension packaging
- **CSV Viewer UI/UX improvements**
  - Removed "Show Stats" button, replaced with "Copy JSON" functionality
  - Added "Toggle View" button to switch between table and raw data views
  - Raw view now matches table view width for consistent layout
  - Context menu only appears in table view (disabled in raw view for cleaner editing)
  - All notification messages converted to English for consistency

### Removed
- **CSV Viewer: "Show Stats" functionality**
- Default browser context menu in CSV viewer areas

## [0.1.0] - 2025-08-29

### Added
- Package metadata (publisher, license, repository fields)
- MIT license file
- **music-metadata** library integration for accurate audio file metadata
- **CSV Viewer** with advanced table display and data analysis features
  - Sortable table view with numeric/text-aware column sorting
  - Real-time search and filtering across all columns
  - Pagination support for large datasets
  - Copy to clipboard functionality (tab-separated format)
  - Statistics view with detailed file and data information
  - Keyboard shortcuts (Ctrl+F for search, Ctrl+C for copy)
  - Support for CSV and TSV file formats

### Fixed
- Audio file metadata display now shows accurate sample rate, channels, bit depth, and duration information instead of estimated values

## [0.0.1] - 2025-08-28

### Added
- Initial release of VSCode Omni Viewer extension
- Audio file viewer with waveform and spectrogram support
- Video file viewer
- Image file viewer
- Support for multiple audio formats (mp3, wav, ogg, flac, aac, m4a)
- Support for multiple video formats (mp4, avi, mov, wmv, flv, webm, mkv)
- Support for multiple image formats (jpg, jpeg, png, gif, bmp, webp, svg)

# Changelog

## [Unreleased]

### Added
- **Image Viewer: Modular architecture with webpack bundling**
  - Split monolithic imageViewer.js into separate modules for better maintainability
  - Create dedicated modules: imageViewerMain.js, imageFilters.js, imageEditMode.js, imageSave.js, imageUtils.js
  - Add webpack configuration for JavaScript module bundling with Babel transpilation
  - Implement ES6 module system with import/export for better code organization

### Changed
- **Image Viewer: Code architecture refactoring**
  - Refactor 1390-line monolithic imageViewer.js into 5 focused modules
  - Implement class-based architecture for better encapsulation and reusability
  - Add webpack multi-configuration for TypeScript and JavaScript bundling
  - Install babel-loader, @babel/core, @babel/preset-env for ES6+ compatibility
  - Maintain backward compatibility with existing HTML template references

### Removed

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

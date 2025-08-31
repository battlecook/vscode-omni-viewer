# Changelog

## [unreleased] 

### Added
- **Audio Viewer: Spacebar keyboard shortcut** for play/pause toggle
- **Audio Viewer: Visual feedback for playback state** - play button turns red when audio is playing

### Fixed

### Changed
- **Image Viewer UI improvements**
  - Changed "Normal" preset button to "Original" for clearer meaning
  - Removed duplicate "Reset" preset button to eliminate redundancy
  - Added scrollbar support to image viewer for better navigation when images extend below cursor
  - Updated scrollbar styling to match VSCode theme

### Deprecated

### Removed
- **Image Viewer: Duplicate "Reset" preset button** (functionality merged into "Original" button)
- **Audio Viewer: Zoom controls** (🔍+, 🔍-, 📐 Fit buttons) due to non-functioning state

### Security

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

# Changelog

## [unreleased] 

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

### Changed
- Fixed icon path configuration for proper extension packaging
- **CSV Viewer UI/UX improvements**
  - Removed "Show Stats" button, replaced with "Copy JSON" functionality
  - Added "Toggle View" button to switch between table and raw data views
  - Raw view now matches table view width for consistent layout
  - Context menu only appears in table view (disabled in raw view for cleaner editing)
  - All notification messages converted to English for consistency

### Deprecated

### Removed
- **CSV Viewer: "Show Stats" functionality**
- Default browser context menu in CSV viewer areas

### Fixed

### Security

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

### Security

## [0.0.1] - 2025-08-28

### Added
- Initial release of VSCode Omni Viewer extension
- Audio file viewer with waveform and spectrogram support
- Video file viewer
- Image file viewer
- Support for multiple audio formats (mp3, wav, ogg, flac, aac, m4a)
- Support for multiple video formats (mp4, avi, mov, wmv, flv, webm, mkv)
- Support for multiple image formats (jpg, jpeg, png, gif, bmp, webp, svg)

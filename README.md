# VSCode Omni Viewer

A comprehensive audio, image, video, and CSV viewer extension for VSCode and Cursor.

## 🎵 Audio Viewer Features

![Audio Viewer Screenshot](https://eyedealisty-website.web.app/img/omniviewer/audio-screenshot.jpg)

### Advanced Audio Player with WaveSurfer.js
- **Waveform Visualization**: Real-time audio waveform display
- **Spectrogram**: Frequency analysis with spectrogram view
- **Region Selection**: Set start/end times for specific regions
- **Loop Playback**: Repeat playback of selected regions
- **Zoom Controls**: Waveform zoom in/out and fit to screen
- **Volume Control**: Real-time volume adjustment
- **Playback Speed**: Multiple playback speed options
- **Audio Information**: Duration, sample rate, channels, bit depth, file size, format display

### Supported Audio Formats
- MP3, WAV, OGG, FLAC, AAC, M4A

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
- MP4, AVI, MOV, WMV, FLV, WebM, MKV

## 📊 CSV Viewer Features

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

### Supported CSV Formats
- CSV (Comma-Separated Values)
- TSV (Tab-Separated Values)

## 🚀 Installation and Usage

### Install from Marketplace

**VSCode Marketplace:**

- **[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=battlecook.vscode-omni-viewer)** - Official VSCode Marketplace
- **[Open VSX Registry](https://open-vsx.org/extension/battlecook/omni-viewer)** - Open Source VSX Registry

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


## 📝 License

MIT License

## 📞 Support

If you encounter any issues or have feature requests, please contact us through GitHub Issues.


### Known Issues
- Large file handling optimization needed

## 📊 Performance Notes

- Audio files are loaded as Base64 for WebView compatibility
- Large files may take time to load initially
- Memory usage scales with file size
- Recommended file size: < 50MB for optimal performance
- Maximum file size limit: 50MB per file
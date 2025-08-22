# VSCode Omni Viewer

A comprehensive audio, image, and video viewer extension for VSCode and Cursor.

## 🎵 Audio Viewer Features

### Advanced Audio Player with WaveSurfer.js
- **Waveform Visualization**: Real-time audio waveform display
- **Spectrogram**: Frequency analysis with spectrogram view
- **Region Selection**: Set start/end times for specific regions
- **Loop Playback**: Repeat playback of selected regions
- **Zoom Controls**: Waveform zoom in/out and fit to screen
- **Volume Control**: Real-time volume adjustment
- **Playback Speed**: Multiple playback speed options

### Supported Audio Formats
- MP3, WAV, OGG, FLAC, AAC, M4A

## 🖼️ Image Viewer Features

### Advanced Image Viewer
- **Zoom Controls**: 10% ~ 500% zoom in/out
- **Rotation**: 90-degree left/right rotation
- **Flip**: Horizontal/vertical flip
- **Fit to Screen**: Automatic screen size fitting
- **Keyboard Shortcuts**: Quick operation shortcuts
- **Image Information**: Resolution and size information display

### Supported Image Formats
- JPG, JPEG, PNG, GIF, BMP, WebP, SVG

## 🎬 Video Viewer Features

### Advanced Video Player
- **Playback Controls**: Play/pause/stop
- **Loop Regions**: Set start/end times and loop playback
- **Playback Speed**: 0.25x ~ 4x playback speed control
- **Skip Controls**: 10-second forward/backward skip
- **Volume Control**: Real-time volume adjustment
- **Keyboard Shortcuts**: Spacebar, arrow keys, etc.
- **Video Information**: Resolution and duration display

### Supported Video Formats
- MP4, AVI, MOV, WMV, FLV, WebM, MKV

## 🚀 Installation and Usage

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

### Usage

1. **Open Audio Files**
   - Right-click on audio file in file explorer
   - Select "Open Audio Viewer"
   - Or run "Omni Viewer: Open Audio Viewer" from command palette

2. **Open Image Files**
   - Right-click on image file in file explorer
   - Select "Open Image Viewer"
   - Or run "Omni Viewer: Open Image Viewer" from command palette

3. **Open Video Files**
   - Right-click on video file in file explorer
   - Select "Open Video Viewer"
   - Or run "Omni Viewer: Open Video Viewer" from command palette

## ⌨️ Keyboard Shortcuts

### Audio Viewer
- `Space`: Play/pause
- `S`: Stop
- `+/-`: Zoom in/out
- `F`: Fit to screen

### Image Viewer
- `+/-`: Zoom in/out
- `0`: Reset
- `F`: Fit to screen
- `←/→`: Rotate left/right

### Video Viewer
- `Space`: Play/pause
- `S`: Stop
- `←/→`: Skip 10 seconds backward/forward
- `Home/End`: Jump to beginning/end

## 🛠️ Development Information

### Technology Stack
- **TypeScript**: Main development language
- **WaveSurfer.js**: Audio visualization and playback
- **VSCode Extension API**: Extension development
- **WebView**: Custom editor implementation

### Project Structure
```
vscode-omni-viewer/
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── audioViewerProvider.ts # Audio viewer provider
│   ├── imageViewerProvider.ts # Image viewer provider
│   └── videoViewerProvider.ts # Video viewer provider
├── out/                     # Compiled JavaScript files
├── package.json            # Extension configuration
├── tsconfig.json          # TypeScript configuration
└── README.md              # Project documentation
```

### Key Feature Implementation

#### Audio Viewer (audioViewerProvider.ts)
- WaveSurfer.js-based waveform visualization
- Spectrogram plugin integration
- Region selection and loop playback logic
- Real-time audio processing and event handling

#### Image Viewer (imageViewerProvider.ts)
- CSS Transform-based image transformations
- Responsive zoom and rotation features
- Keyboard event handling
- Image metadata display

#### Video Viewer (videoViewerProvider.ts)
- HTML5 Video API utilization
- Playback speed and volume control
- Loop region playback implementation
- Keyboard shortcut support

## 📝 License

MIT License

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 Support

If you encounter any issues or have feature requests, please contact us through GitHub Issues.

## 🔧 Development Commands

```bash
# Development mode
npm run watch          # Real-time TypeScript compilation
npm run compile        # One-time compilation
npm run lint           # Code linting

# Packaging
npm run vscode:prepublish  # Production build
```

## 🎯 Features Roadmap

### Planned Features
- [ ] Enhanced spectrogram visualization
- [ ] Audio effects and filters
- [ ] Batch file processing
- [ ] Export functionality
- [ ] Custom themes and styling
- [ ] Plugin system for additional formats

### Known Issues
- Spectrogram feature temporarily disabled due to WaveSurfer.js v7 compatibility
- Large file handling optimization needed
- Mobile device support improvements

## 📊 Performance Notes

- Audio files are loaded as Base64 for WebView compatibility
- Large files may take time to load initially
- Memory usage scales with file size
- Recommended file size: < 100MB for optimal performance
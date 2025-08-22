import { FileUtils } from '../../utils/fileUtils';
import * as fs from 'fs';

// fs 모듈 모킹
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
}));

describe('FileUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAudioMimeType', () => {
    it('should return correct MIME type for MP3 files', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.mp3');
      expect(result).toBe('audio/mpeg');
    });

    it('should return correct MIME type for WAV files', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.wav');
      expect(result).toBe('audio/wav');
    });

    it('should return correct MIME type for OGG files', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.ogg');
      expect(result).toBe('audio/ogg');
    });

    it('should return correct MIME type for FLAC files', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.flac');
      expect(result).toBe('audio/flac');
    });

    it('should return correct MIME type for AAC files', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.aac');
      expect(result).toBe('audio/aac');
    });

    it('should return correct MIME type for M4A files', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.m4a');
      expect(result).toBe('audio/mp4');
    });

    it('should return default MIME type for unknown audio extensions', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.unknown');
      expect(result).toBe('audio/wav');
    });

    it('should handle case insensitive extensions', () => {
      const result = FileUtils.getAudioMimeType('/path/to/audio.MP3');
      expect(result).toBe('audio/mpeg');
    });
  });

  describe('getVideoMimeType', () => {
    it('should return correct MIME type for MP4 files', () => {
      const result = FileUtils.getVideoMimeType('/path/to/video.mp4');
      expect(result).toBe('video/mp4');
    });

    it('should return correct MIME type for AVI files', () => {
      const result = FileUtils.getVideoMimeType('/path/to/video.avi');
      expect(result).toBe('video/x-msvideo');
    });

    it('should return correct MIME type for MOV files', () => {
      const result = FileUtils.getVideoMimeType('/path/to/video.mov');
      expect(result).toBe('video/quicktime');
    });

    it('should return correct MIME type for WEBM files', () => {
      const result = FileUtils.getVideoMimeType('/path/to/video.webm');
      expect(result).toBe('video/webm');
    });

    it('should return default MIME type for unknown video extensions', () => {
      const result = FileUtils.getVideoMimeType('/path/to/video.unknown');
      expect(result).toBe('video/mp4');
    });
  });

  describe('getImageMimeType', () => {
    it('should return correct MIME type for JPG files', () => {
      const result = FileUtils.getImageMimeType('/path/to/image.jpg');
      expect(result).toBe('image/jpeg');
    });

    it('should return correct MIME type for JPEG files', () => {
      const result = FileUtils.getImageMimeType('/path/to/image.jpeg');
      expect(result).toBe('image/jpeg');
    });

    it('should return correct MIME type for PNG files', () => {
      const result = FileUtils.getImageMimeType('/path/to/image.png');
      expect(result).toBe('image/png');
    });

    it('should return correct MIME type for GIF files', () => {
      const result = FileUtils.getImageMimeType('/path/to/image.gif');
      expect(result).toBe('image/gif');
    });

    it('should return correct MIME type for WEBP files', () => {
      const result = FileUtils.getImageMimeType('/path/to/image.webp');
      expect(result).toBe('image/webp');
    });

    it('should return correct MIME type for SVG files', () => {
      const result = FileUtils.getImageMimeType('/path/to/image.svg');
      expect(result).toBe('image/svg+xml');
    });

    it('should return default MIME type for unknown image extensions', () => {
      const result = FileUtils.getImageMimeType('/path/to/image.unknown');
      expect(result).toBe('image/jpeg');
    });
  });

  describe('fileToDataUrl', () => {
    const mockBuffer = Buffer.from('test file content');
    const mockMimeType = 'audio/mpeg';

    beforeEach(() => {
      (fs.promises.readFile as jest.Mock).mockResolvedValue(mockBuffer);
    });

    it('should convert file to data URL successfully', async () => {
      const filePath = '/path/to/audio.mp3';
      const result = await FileUtils.fileToDataUrl(filePath, mockMimeType);

      expect(fs.promises.readFile).toHaveBeenCalledWith(filePath);
      expect(result).toBe(`data:${mockMimeType};base64,${mockBuffer.toString('base64')}`);
    });

    it('should throw error for files larger than 50MB', async () => {
      const largeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB
      (fs.promises.readFile as jest.Mock).mockResolvedValue(largeBuffer);

      const filePath = '/path/to/large-audio.mp3';
      
      await expect(FileUtils.fileToDataUrl(filePath, mockMimeType))
        .rejects
        .toThrow('File too large (51.0MB). Maximum size is 50MB.');
    });

    it('should handle file read errors', async () => {
      const error = new Error('File not found');
      (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

      const filePath = '/path/to/nonexistent.mp3';
      
      await expect(FileUtils.fileToDataUrl(filePath, mockMimeType))
        .rejects
        .toThrow('File not found');
    });

    it('should log file size and MIME type', async () => {
      const filePath = '/path/to/audio.mp3';
      await FileUtils.fileToDataUrl(filePath, mockMimeType);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('File loaded: 0.00MB, MIME type: audio/mpeg')
      );
    });
  });

  describe('formatFileSize', () => {
    it('should format 0 bytes correctly', () => {
      const result = FileUtils.formatFileSize(0);
      expect(result).toBe('0 Bytes');
    });

    it('should format bytes correctly', () => {
      const result = FileUtils.formatFileSize(1024);
      expect(result).toBe('1 KB');
    });

    it('should format megabytes correctly', () => {
      const result = FileUtils.formatFileSize(2 * 1024 * 1024);
      expect(result).toBe('2 MB');
    });

    it('should format gigabytes correctly', () => {
      const result = FileUtils.formatFileSize(1.5 * 1024 * 1024 * 1024);
      expect(result).toBe('1.5 GB');
    });

    it('should handle decimal values correctly', () => {
      const result = FileUtils.formatFileSize(1536); // 1.5 KB
      expect(result).toBe('1.5 KB');
    });

    it('should handle large values correctly', () => {
      const result = FileUtils.formatFileSize(1024 * 1024 * 1024 * 1024); // 1 TB
      expect(result).toBe('1 TB');
    });

    it('should handle very large values correctly', () => {
      const result = FileUtils.formatFileSize(1024 * 1024 * 1024 * 1024 * 1024); // 1 PB
      expect(result).toBe('1 PB');
    });
  });
});

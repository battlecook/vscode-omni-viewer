import { CONSTANTS } from '../utils/Constants.js';

export class FileInfoManager {
    constructor(state, audioMetadata) {
        this.state = state;
        this.audioMetadata = audioMetadata;
    }

    updateDuration(durationFromMetadata = null) {
        let duration = durationFromMetadata;
        
        if (!duration) {
            duration = this.state.wavesurfer.getDuration();
        }
        
        if (duration && !isNaN(duration)) {
            const minutes = Math.floor(duration / 60);
            const seconds = Math.floor(duration % 60);
            this.state.elements.durationInfo.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    updateFileInfo() {
        try {
            const decodedData = this.state.wavesurfer.getDecodedData();
            
            // Use server metadata if available, fallback to decoded data
            const sampleRate = this.audioMetadata.sampleRate || (decodedData?.sampleRate || CONSTANTS.WAVESURFER.SAMPLE_RATE);
            const channels = this.audioMetadata.channels || (decodedData?.numberOfChannels || 2);
            const bitDepth = this.audioMetadata.bitDepth || (decodedData?.length > 0 ? (decodedData instanceof Float32Array ? 32 : 16) : '--');
            const format = this.audioMetadata.format || this.detectFormat();
            const fileSize = this.audioMetadata.fileSize || (decodedData ? this.estimateFileSize(decodedData) : '--');
            const duration = this.audioMetadata.duration || (decodedData ? decodedData.length / sampleRate : '--');

            // Update UI elements
            this.state.elements.sampleRateInfo.textContent = sampleRate ? `${sampleRate} Hz` : '--';
            this.state.elements.channelsInfo.textContent = channels || '--';
            this.state.elements.bitDepthInfo.textContent = bitDepth === '--' ? '--' : `${bitDepth} bit`;
            this.state.elements.formatInfo.textContent = format || '--';
            this.state.elements.fileSizeInfo.textContent = fileSize || '--';
            
            // Update duration if available
            if (duration && duration !== '--') {
                this.updateDuration(duration);
            } else {
                this.updateDuration();
            }
            
            this.state.elements.fileInfo.style.display = 'flex';
        } catch (error) {
            console.warn('Error updating file info:', error);
        }
    }

    estimateFileSize(decodedData) {
        if (!decodedData) return '--';
        const estimatedSize = decodedData.length * decodedData.numberOfChannels * 2;
        const sizeInKB = Math.round(estimatedSize / 1024);
        const sizeInMB = (estimatedSize / (1024 * 1024)).toFixed(1);
        return sizeInMB > 1 ? `${sizeInMB} MB` : `${sizeInKB} KB`;
    }

    detectFormat() {
        const audioSrc = '{{audioSrc}}';
        if (audioSrc.startsWith('data:')) {
            const match = audioSrc.match(/data:([^;]+)/);
            if (match) {
                const mimeType = match[1];
                const formatMap = {
                    'mpeg': 'MP3', 'mp3': 'MP3', 'wav': 'WAV', 'flac': 'FLAC',
                    'ogg': 'OGG', 'aac': 'AAC', 'webm': 'WEBM'
                };
                
                for (const [key, format] of Object.entries(formatMap)) {
                    if (mimeType.includes(key)) return format;
                }
                return mimeType.split('/')[1]?.toUpperCase() || 'Unknown';
            }
        } else {
            const extension = audioSrc.split('.').pop()?.toLowerCase();
            const formatMap = {
                'mp3': 'MP3', 'wav': 'WAV', 'flac': 'FLAC',
                'ogg': 'OGG', 'aac': 'AAC', 'webm': 'WEBM'
            };
            return formatMap[extension] || extension?.toUpperCase() || 'Unknown';
        }
        return 'Unknown';
    }
}

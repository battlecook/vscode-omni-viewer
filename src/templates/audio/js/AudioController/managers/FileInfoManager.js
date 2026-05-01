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
            let decodedData = null;
            try { decodedData = this.state.wavesurfer.getDecodedData(); } catch (_) {}
            
            // Use server metadata if available, fallback to decoded data
            const sampleRate = this.audioMetadata.sampleRate || (decodedData?.sampleRate || CONSTANTS.WAVESURFER.SAMPLE_RATE);
            const channels = this.audioMetadata.channels || (decodedData?.numberOfChannels || 2);
            const bitDepth = this.audioMetadata.bitDepth || (decodedData?.length > 0 ? (decodedData instanceof Float32Array ? 32 : 16) : '--');
            const format = this.audioMetadata.format || this.detectFormat();
            const fileSize = this.audioMetadata.fileSize || (decodedData ? this.estimateFileSize(decodedData) : '--');
            // Prefer wavesurfer's actual duration (reliable in streaming mode) over metadata (unreliable for OGG)
            const wsDuration = this.state.wavesurfer?.getDuration();
            const duration = (wsDuration && wsDuration > 0 && isFinite(wsDuration)) ? wsDuration :
                this.audioMetadata.duration || (decodedData ? decodedData.length / sampleRate : '--');

            // Update UI elements
            this.state.elements.sampleRateInfo.textContent = sampleRate ? `${sampleRate} Hz` : '--';
            this.state.elements.channelsInfo.textContent = channels || '--';
            this.state.elements.bitDepthInfo.textContent = bitDepth === '--' ? '--' : `${bitDepth} bit`;
            this.state.elements.formatInfo.textContent = format || '--';
            this.state.elements.fileSizeInfo.textContent = fileSize || '--';
            this.updateChannelDetails(decodedData);
            
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

    updateChannelDetails(decodedData) {
        const detailsEl = this.state.elements.channelDetailsInfo;
        if (!detailsEl) {
            return;
        }

        const channelCount = decodedData?.numberOfChannels || this.audioMetadata.channels || 0;
        if (!decodedData || channelCount !== 2) {
            detailsEl.textContent = '';
            detailsEl.style.display = 'none';
            return;
        }

        const left = this.getChannelStats(decodedData.getChannelData(0));
        const right = this.getChannelStats(decodedData.getChannelData(1));
        detailsEl.textContent = `L peak ${left.peak}, RMS ${left.rms} | R peak ${right.peak}, RMS ${right.rms}`;
        detailsEl.style.display = 'block';
    }

    getChannelStats(channelData) {
        if (!channelData || channelData.length === 0) {
            return { peak: '--', rms: '--' };
        }

        const maxSamples = 200000;
        const step = Math.max(1, Math.ceil(channelData.length / maxSamples));
        let peak = 0;
        let sumSquares = 0;
        let count = 0;

        for (let i = 0; i < channelData.length; i += step) {
            const value = channelData[i] || 0;
            const abs = Math.abs(value);
            if (abs > peak) {
                peak = abs;
            }
            sumSquares += value * value;
            count++;
        }

        const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
        return {
            peak: this.formatAmplitude(peak),
            rms: this.formatAmplitude(rms)
        };
    }

    formatAmplitude(value) {
        if (!isFinite(value)) {
            return '--';
        }
        return value.toFixed(3);
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

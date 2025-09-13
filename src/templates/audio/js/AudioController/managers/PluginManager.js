import { CONSTANTS } from '../utils/Constants.js';
import { AudioUtils } from '../utils/AudioUtils.js';

export class PluginManager {
    constructor(state, waveSurferManager) {
        this.state = state;
        this.waveSurferManager = waveSurferManager;
    }

    async setupSpectrogram() {
        if (this.state.spectrogramPlugin) {
            try {
                this.state.wavesurfer.unregisterPlugin(this.state.spectrogramPlugin);
                this.state.spectrogramPlugin = null;
            } catch (error) {
                console.warn('Error removing existing spectrogram plugin:', error);
            }
        }
        
        const spectrogramContainer = document.getElementById('spectrogram');
        if (spectrogramContainer) {
            spectrogramContainer.innerHTML = '';
        }
        
        try {
            this.state.spectrogramPlugin = this.state.wavesurfer.registerPlugin(WaveSurfer.Spectrogram.create({
                container: '#spectrogram',
                labels: true,
                scale: 'linear',
                splitChannels: false,
                fftSize: CONSTANTS.SPECTROGRAM.FFT_SIZE,
                noverlap: CONSTANTS.SPECTROGRAM.NOVERLAP,
                height: CONSTANTS.SPECTROGRAM.HEIGHT,
            }));
            AudioUtils.log('Spectrogram plugin registered successfully');
        } catch (error) {
            console.warn('Failed to register spectrogram plugin:', error);
            this.state.spectrogramPlugin = null;
        }
    }

    async setupTimeline() {
        if (this.state.timelinePlugin) {
            try {
                this.state.wavesurfer.unregisterPlugin(this.state.timelinePlugin);
                this.state.timelinePlugin = null;
            } catch (error) {
                console.warn('Error removing existing timeline plugin:', error);
            }
        }
        
        const timelineContainer = document.getElementById('timeline');
        if (timelineContainer) {
            timelineContainer.innerHTML = '';
        }
        
        const intervals = this.waveSurferManager.getTimelineIntervals(this.state.wavesurfer.getDuration());
        
        try {
            this.state.timelinePlugin = this.state.wavesurfer.registerPlugin(WaveSurfer.Timeline.create({
                container: '#timeline',
                formatTimeCallback: AudioUtils.formatTime,
                timeInterval: intervals.timeInterval,
                primaryLabelInterval: intervals.primaryLabelInterval,
                secondaryLabelInterval: intervals.secondaryLabelInterval
            }));
            AudioUtils.log('Timeline plugin registered successfully');
        } catch (error) {
            console.warn('Failed to register timeline plugin:', error);
            this.state.timelinePlugin = null;
        }
    }

    async setupRegions() {
        try {
            this.state.regionsPlugin = this.state.wavesurfer.registerPlugin(WaveSurfer.Regions.create({}));
            AudioUtils.log('Regions plugin registered successfully');
        } catch (error) {
            console.warn('Failed to register regions plugin:', error);
            this.state.regionsPlugin = null;
            return;
        }
        
        this.setupRegionEvents();
    }

    setupRegionEvents() {
        this.state.regionsPlugin.enableDragSelection({
            color: 'rgba(255, 0, 0, 0.1)'
        });

        this.state.regionsPlugin.on('region-created', (region) => {
            if (this.state.regionsPlugin.getRegions) {
                const newRegions = this.state.regionsPlugin.getRegions();
                newRegions.forEach((existingRegion) => {
                    if (existingRegion.id !== region.id) {
                        existingRegion.remove();
                    }
                });
            }
            this.state.selectedRegionId = region.id;
            this.state.regionManager.showControls();
            
            setTimeout(() => {
                this.state.regionManager.createOverlays(region);
            }, 100);
        });

        this.state.regionsPlugin.on('region-clicked', (region) => {
            this.state.selectedRegionId = region.id;
            this.state.regionManager.showControls();
            this.state.regionManager.createOverlays(region);
        });

        this.state.regionsPlugin.on('region-removed', (region) => {
            if (this.state.selectedRegionId === region.id) {
                this.state.selectedRegionId = null;
                this.state.regionManager.hideControls();
            }
        });

        this.state.regionsPlugin.on('region-updated', (region) => {
            if (this.state.selectedRegionId === region.id) {
                this.state.regionManager.updateOverlays(region);
            }
        });

        this.setupRegionClickHandlers();
    }

    setupRegionClickHandlers() {
        const removeAllRegions = () => {
            if (this.state.regionsPlugin?.getRegions) {
                const regions = this.state.regionsPlugin.getRegions();
                if (regions && Object.keys(regions).length > 0) {
                    Object.values(regions).forEach(region => {
                        region.remove();
                    });
                    this.state.selectedRegionId = null;
                    this.state.regionManager.hideControls();
                }
            }
        };

        const waveformContainer = document.getElementById('waveform');
        waveformContainer.addEventListener('click', (e) => {
            const clickedElement = e.target;
            const isRegionElement = clickedElement.closest('.wavesurfer-region') || 
                                   clickedElement.closest('.region-input-overlay') ||
                                   clickedElement.classList.contains('region-input-overlay') ||
                                   clickedElement.classList.contains('region-start-input') ||
                                   clickedElement.classList.contains('region-end-input');
            
            if (!isRegionElement) {
                removeAllRegions();
            }
        });

        const spectrogramContainer = document.getElementById('spectrogram');
        if (spectrogramContainer) {
            spectrogramContainer.addEventListener('click', removeAllRegions);
        }
    }
}

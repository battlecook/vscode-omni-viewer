import SpectrogramPlugin from '../../../../../../node_modules/wavesurfer.js/dist/plugins/spectrogram.js';
import TimelinePlugin from '../../../../../../node_modules/wavesurfer.js/dist/plugins/timeline.js';
import RegionsPlugin from '../../../../../../node_modules/wavesurfer.js/dist/plugins/regions.js';
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
            this.state.spectrogramPlugin = this.state.wavesurfer.registerPlugin(SpectrogramPlugin.create({
                container: '#spectrogram',
                labels: true,
                scale: CONSTANTS.SPECTROGRAM.DEFAULT_SCALE,
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

    /**
     * Setup spectrogram with precomputed frequency data (WASM large file mode).
     * Uses wavesurfer's native Spectrogram plugin with frequenciesDataUrl.
     */
    async setupSpectrogramPrecomputed(spectrogramData, sampleRate) {
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
            // Store precomputed data for scale changes
            this.state.precomputedSpectrogramData = spectrogramData;
            this.state.precomputedSampleRate = sampleRate;

            // Convert plain arrays to Uint8Arrays (wavesurfer expects Uint8Array per time slice)
            const freqData = spectrogramData.map(slice => new Uint8Array(slice));
            const channelData = [freqData];

            // Create plugin — WASM data has mel filter bank applied
            this.state.spectrogramPlugin = this.state.wavesurfer.registerPlugin(SpectrogramPlugin.create({
                container: '#spectrogram',
                labels: true,
                scale: CONSTANTS.SPECTROGRAM.DEFAULT_SCALE,
                splitChannels: false,
                height: CONSTANTS.SPECTROGRAM.HEIGHT,
                sampleRate: sampleRate,
            }));

            const plugin = this.state.spectrogramPlugin;

            // Set frequencyMax so labels render correctly
            // (normally set by getFrequencies() which we bypass)
            plugin.frequencyMax = sampleRate / 2;

            // Cache precomputed data for scroll/zoom re-renders (fastRender)
            plugin.cachedFrequencies = channelData;

            // Override render() to ALWAYS use our precomputed data.
            // Without this, wavesurfer's decode events trigger the plugin's
            // own FFT computation which overwrites our precomputed spectrogram.
            plugin.render = async function() {
                if (this.isRendering) return;
                this.isRendering = true;
                try {
                    this.drawSpectrogram(this.cachedFrequencies);
                    this.lastZoomLevel = this.wavesurfer?.options.minPxPerSec || 0;
                } finally {
                    this.isRendering = false;
                }
            };

            // Trigger initial draw
            setTimeout(() => {
                if (plugin && !plugin.isDestroyed) {
                    plugin.render();
                    AudioUtils.log('Precomputed spectrogram drawn: ' + freqData.length + ' time slices, sampleRate=' + sampleRate);
                }
            }, 200);
        } catch (error) {
            console.warn('Failed to setup precomputed spectrogram:', error);
        }
    }

    async changeSpectrogramScale(newScale) {
        if (!this.state.spectrogramPlugin) {
            console.warn('Spectrogram plugin not available');
            return;
        }

        try {
            // Unregister the current spectrogram plugin
            this.state.wavesurfer.unregisterPlugin(this.state.spectrogramPlugin);
            this.state.spectrogramPlugin = null;

            // Clear the spectrogram container
            const spectrogramContainer = document.getElementById('spectrogram');
            if (spectrogramContainer) {
                spectrogramContainer.innerHTML = '';
            }

            // Build plugin options based on mode
            const opts = {
                container: '#spectrogram',
                labels: true,
                scale: newScale,
                splitChannels: false,
                height: CONSTANTS.SPECTROGRAM.HEIGHT,
            };

            if (this.state.precomputedSpectrogramData) {
                // Precomputed mode — WASM data has mel filter bank applied
                opts.sampleRate = this.state.precomputedSampleRate;
            } else {
                // Default mode — let plugin compute FFT
                opts.fftSize = CONSTANTS.SPECTROGRAM.FFT_SIZE;
                opts.noverlap = CONSTANTS.SPECTROGRAM.NOVERLAP;
            }

            // Create new spectrogram plugin with new scale
            this.state.spectrogramPlugin = this.state.wavesurfer.registerPlugin(
                SpectrogramPlugin.create(opts)
            );

            // Force render
            if (this.state.precomputedSpectrogramData) {
                const plugin = this.state.spectrogramPlugin;
                const freqData = this.state.precomputedSpectrogramData.map(
                    slice => new Uint8Array(slice)
                );
                const channelData = [freqData];
                plugin.frequencyMax = this.state.precomputedSampleRate / 2;
                plugin.cachedFrequencies = channelData;
                plugin.render = async function() {
                    if (this.isRendering) return;
                    this.isRendering = true;
                    try {
                        this.drawSpectrogram(this.cachedFrequencies);
                        this.lastZoomLevel = this.wavesurfer?.options.minPxPerSec || 0;
                    } finally {
                        this.isRendering = false;
                    }
                };
                setTimeout(() => plugin.render(), 200);
            } else {
                setTimeout(() => {
                    if (this.state.spectrogramPlugin) {
                        this.state.spectrogramPlugin.render();
                    }
                }, 100);
            }

            AudioUtils.log(`Spectrogram scale changed to: ${newScale}`);
        } catch (error) {
            console.warn('Failed to change spectrogram scale:', error);
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
            this.state.timelinePlugin = this.state.wavesurfer.registerPlugin(TimelinePlugin.create({
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
            this.state.regionsPlugin = this.state.wavesurfer.registerPlugin(RegionsPlugin.create({}));
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
                this.state.regionManager.updateSelectedRegionOverlays();
            }
        });

        this.state.regionsPlugin.on('region-update', (region) => {
            if (this.state.selectedRegionId === region.id) {
                this.state.regionManager.updateSelectedRegionOverlays();
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
        const contextMenu = document.getElementById('contextMenu');
        
        // Show custom context menu
        waveformContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            
            // Check if clicking on region input overlay (don't show menu there)
            const clickedElement = e.target;
            const isInputOverlay = clickedElement.closest('.region-input-overlay') ||
                                   clickedElement.classList.contains('region-input-overlay') ||
                                   clickedElement.classList.contains('region-start-input') ||
                                   clickedElement.classList.contains('region-end-input') ||
                                   clickedElement.classList.contains('region-duration-input');
            
            if (isInputOverlay) {
                // Don't show menu on input overlays
                return;
            }
            
            // Show menu if a region is selected (anywhere on waveform)
            const selectedRegion = this.state.regionManager.getSelectedRegion();
            if (selectedRegion) {
                this.showContextMenu(e, selectedRegion);
            } else {
                this.hideContextMenu();
            }
        });
        
        waveformContainer.addEventListener('click', (e) => {
            const clickedElement = e.target;
            const isRegionElement = clickedElement.closest('.wavesurfer-region') || 
                                   clickedElement.closest('.region-input-overlay') ||
                                   clickedElement.classList.contains('region-input-overlay') ||
                                   clickedElement.classList.contains('region-start-input') ||
                                   clickedElement.classList.contains('region-end-input') ||
                                   clickedElement.classList.contains('region-duration-input');
            
            if (!isRegionElement) {
                removeAllRegions();
            }
            
            // Hide context menu on click
            this.hideContextMenu();
        });

        const spectrogramContainer = document.getElementById('spectrogram');
        if (spectrogramContainer) {
            spectrogramContainer.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const selectedRegion = this.state.regionManager.getSelectedRegion();
                if (selectedRegion) {
                    this.showContextMenu(e, selectedRegion);
                } else {
                    this.hideContextMenu();
                }
            });
            
            spectrogramContainer.addEventListener('click', (e) => {
                removeAllRegions();
                this.hideContextMenu();
            });
        }

        // Hide context menu when clicking outside (but not on the menu itself)
        document.addEventListener('click', (e) => {
            const contextMenu = document.getElementById('contextMenu');
            if (contextMenu && !contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
    }

    showContextMenu(event, region) {
        const contextMenu = document.getElementById('contextMenu');
        if (!contextMenu) {
            console.warn('Context menu element not found');
            return;
        }

        if (!region) {
            console.warn('No region provided to showContextMenu');
            return;
        }

        // Clear existing menu items
        contextMenu.innerHTML = '';

        // Create menu item
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        menuItem.textContent = '💾 Save Selected Region as New File';
        menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.state.audioController && region) {
                this.state.audioController.extractAndDownloadRegion(region);
            }
            this.hideContextMenu();
        });

        contextMenu.appendChild(menuItem);

        // Position menu
        const x = event.clientX || event.pageX;
        const y = event.clientY || event.pageY;
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.style.display = 'block';

        console.log('Context menu shown at:', x, y, 'for region:', region);
    }

    hideContextMenu() {
        const contextMenu = document.getElementById('contextMenu');
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
    }

}

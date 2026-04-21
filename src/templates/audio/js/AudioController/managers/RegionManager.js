import { CONSTANTS } from '../utils/Constants.js';
import { AudioUtils } from '../utils/AudioUtils.js';

export class RegionManager {
    constructor(state) {
        this.state = state;
        this.overlayRegionListenersCleanup = null;
    }

    showControls() {
        this.state.elements.loopControls.style.display = 'flex';
    }

    hideControls() {
        this.state.elements.loopControls.style.display = 'none';
        this.removeOverlays();
    }

    createOverlays(region) {
        this.removeOverlays();
        
        const waveformContainer = document.getElementById('waveform');
        const regionElement = region.element;
        
        if (!waveformContainer || !regionElement) return;
        
        // Start input overlay
        this.state.regionStartOverlay = document.createElement('div');
        this.state.regionStartOverlay.className = 'region-input-overlay region-start-overlay';
        this.state.regionStartOverlay.innerHTML = `
            <input type="number" value="${region.start.toFixed(3)}" class="region-start-input" title="Start time">
        `;
        
        // End input overlay
        this.state.regionEndOverlay = document.createElement('div');
        this.state.regionEndOverlay.className = 'region-input-overlay region-end-overlay';
        this.state.regionEndOverlay.innerHTML = `
            <input type="number" value="${region.end.toFixed(3)}" class="region-end-input" title="End time">
        `;

        // Duration input overlay
        this.state.regionDurationOverlay = document.createElement('div');
        this.state.regionDurationOverlay.className = 'region-input-overlay region-duration-overlay';
        this.state.regionDurationOverlay.innerHTML = `
            <input type="number" value="${this.getRegionDuration(region).toFixed(3)}" class="region-duration-input" title="Duration">
        `;
        
        waveformContainer.appendChild(this.state.regionStartOverlay);
        waveformContainer.appendChild(this.state.regionEndOverlay);
        waveformContainer.appendChild(this.state.regionDurationOverlay);
        
        this.attachRegionOverlaySync(region);
        this.positionOverlays(region);
        this.setupOverlayEvents(region);
    }

    attachRegionOverlaySync(region) {
        if (this.overlayRegionListenersCleanup) {
            this.overlayRegionListenersCleanup();
            this.overlayRegionListenersCleanup = null;
        }

        if (!region?.on) {
            return;
        }

        const syncOverlays = () => {
            this.updateOverlays(region);
        };

        const unsubscribeUpdate = region.on('update', syncOverlays);
        const unsubscribeUpdateEnd = region.on('update-end', syncOverlays);

        this.overlayRegionListenersCleanup = () => {
            if (typeof unsubscribeUpdate === 'function') {
                unsubscribeUpdate();
            }
            if (typeof unsubscribeUpdateEnd === 'function') {
                unsubscribeUpdateEnd();
            }
        };
    }

    positionOverlays(region) {
        if (!this.state.regionStartOverlay || !this.state.regionEndOverlay || !this.state.regionDurationOverlay) {
            return;
        }

        const regionElement = region.element;
        if (!regionElement) {
            return;
        }

        const overlayParent = this.state.regionStartOverlay.offsetParent || this.state.regionStartOverlay.parentElement;
        if (!overlayParent) {
            return;
        }

        const parentRect = overlayParent.getBoundingClientRect();
        const regionRect = regionElement.getBoundingClientRect();
        const startLeft = regionRect.left - parentRect.left - 10;
        const endLeft = regionRect.right - parentRect.left + 10;
        const durationLeft = regionRect.left - parentRect.left + (regionRect.width / 2);
        const top = regionRect.top - parentRect.top + 10;
        const bottom = regionRect.bottom - parentRect.top + 10;

        this.state.regionStartOverlay.style.left = startLeft + 'px';
        this.state.regionStartOverlay.style.top = bottom + 'px';
        this.state.regionEndOverlay.style.left = endLeft + 'px';
        this.state.regionEndOverlay.style.top = bottom + 'px';
        this.state.regionDurationOverlay.style.left = durationLeft + 'px';
        this.state.regionDurationOverlay.style.top = top + 'px';
    }

    setupOverlayEvents(region) {
        const startInput = this.state.regionStartOverlay.querySelector('.region-start-input');
        const endInput = this.state.regionEndOverlay.querySelector('.region-end-input');
        const durationInput = this.state.regionDurationOverlay.querySelector('.region-duration-input');
        
        const applyRegionInput = (startTimeInput, endTimeInput) => {
            console.log('applyRegionInput called with:', { startTimeInput, endTimeInput, region });
            
            if (!region || !this.state.wavesurfer) {
                return;
            }
            
            let startSec = region.start;
            let endSec = region.end;

            const parsedStart = parseFloat(startTimeInput);
            const parsedEnd = parseFloat(endTimeInput);
            
            if (!isNaN(parsedStart)) startSec = parsedStart;
            if (!isNaN(parsedEnd)) endSec = parsedEnd;

            this.updateRegionBounds(startSec, endSec);
        };

        const applyDurationInput = (durationInputValue) => {
            console.log('applyDurationInput called with:', { durationInputValue, region });

            if (!region || !this.state.wavesurfer) {
                return;
            }

            const parsedDuration = parseFloat(durationInputValue);
            if (isNaN(parsedDuration)) {
                this.updateOverlays(region);
                return;
            }

            const durationSec = Math.max(CONSTANTS.REGION.MIN_DURATION, parsedDuration);
            this.updateRegionBounds(region.start, region.start + durationSec, { preserveStart: true });
        };
        
        const handleStartInput = (e) => {
            const startValue = e.target.value;
            const endValue = endInput.value;
            applyRegionInput(startValue, endValue);
        };
        
        const handleEndInput = (e) => {
            const startValue = startInput.value;
            const endValue = e.target.value;
            applyRegionInput(startValue, endValue);
        };

        const handleDurationInput = (e) => {
            applyDurationInput(e.target.value);
        };
        
        startInput.addEventListener('change', handleStartInput);
        startInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
                handleStartInput(e);
            }
        });
        
        endInput.addEventListener('change', handleEndInput);
        endInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
                handleEndInput(e);
            }
        });

        durationInput.addEventListener('change', handleDurationInput);
        durationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
                handleDurationInput(e);
            }
        });
    }

    updateOverlays(region) {
        if (this.state.regionStartOverlay && this.state.regionEndOverlay && this.state.regionDurationOverlay) {
            const startInput = this.state.regionStartOverlay.querySelector('.region-start-input');
            const endInput = this.state.regionEndOverlay.querySelector('.region-end-input');
            const durationInput = this.state.regionDurationOverlay.querySelector('.region-duration-input');
            startInput.value = region.start.toFixed(3);
            endInput.value = region.end.toFixed(3);
            durationInput.value = this.getRegionDuration(region).toFixed(3);
            this.positionOverlays(region);
        }
    }

    getRegionDuration(region) {
        return Math.max(0, region.end - region.start);
    }

    normalizeRegionBounds(startSec, endSec, options = {}) {
        const duration = this.state.wavesurfer.getDuration() || 0;
        const minDuration = Math.min(CONSTANTS.REGION.MIN_DURATION, duration);

        if (duration <= 0) {
            return { start: 0, end: 0 };
        }

        startSec = Number.isFinite(startSec) ? startSec : 0;
        endSec = Number.isFinite(endSec) ? endSec : startSec + minDuration;

        if (!options.preserveStart && startSec > endSec) {
            const temp = startSec;
            startSec = endSec;
            endSec = temp;
        }

        startSec = Math.max(0, Math.min(duration, startSec));
        endSec = Math.max(0, Math.min(duration, endSec));

        if (options.preserveStart) {
            endSec = Math.min(duration, Math.max(startSec + minDuration, endSec));
            if (startSec + minDuration > endSec) {
                startSec = Math.max(0, endSec - minDuration);
            }
        } else if (startSec + minDuration > endSec) {
            endSec = Math.min(duration, startSec + minDuration);
            if (startSec + minDuration > endSec) {
                startSec = Math.max(0, endSec - minDuration);
            }
        }

        return { start: startSec, end: endSec };
    }

    updateRegionBounds(startSec, endSec, options = {}) {
        const normalized = this.normalizeRegionBounds(startSec, endSec, options);

        try {
            if (this.state.regionsPlugin && this.state.regionsPlugin.getRegions) {
                const regions = this.state.regionsPlugin.getRegions();
                Object.values(regions).forEach(existingRegion => {
                    existingRegion.remove();
                });
            }
            
            // 새 리전 생성
            if (this.state.regionsPlugin && this.state.regionsPlugin.addRegion) {
                const newRegion = this.state.regionsPlugin.addRegion({
                    start: normalized.start,
                    end: normalized.end,
                    color: 'rgba(255, 0, 0, 0.1)'
                });
                
                this.state.selectedRegionId = newRegion.id;
                
                // 오버레이 업데이트
                setTimeout(() => {
                    this.createOverlays(newRegion);
                }, 100);
            }
        } catch (err) {
            console.error('Failed to update region: ', err);
            AudioUtils.showStatus('Failed to update region: ' + err.message, this.state.elements.status);
        }
    }

    updateSelectedRegionOverlays() {
        const selectedRegion = this.getSelectedRegion();
        if (!selectedRegion) {
            return;
        }

        this.updateOverlays(selectedRegion);
    }

    removeOverlays() {
        if (this.overlayRegionListenersCleanup) {
            this.overlayRegionListenersCleanup();
            this.overlayRegionListenersCleanup = null;
        }

        if (this.state.regionStartOverlay) {
            this.state.regionStartOverlay.remove();
            this.state.regionStartOverlay = null;
        }
        if (this.state.regionEndOverlay) {
            this.state.regionEndOverlay.remove();
            this.state.regionEndOverlay = null;
        }
        if (this.state.regionDurationOverlay) {
            this.state.regionDurationOverlay.remove();
            this.state.regionDurationOverlay = null;
        }
    }

    getSelectedRegion() {
        if (!this.state.regionsPlugin?.getRegions) {
            return null;
        }
        
        const regions = this.state.regionsPlugin.getRegions();
        
        if (!regions || Object.keys(regions).length === 0) {
            return null;
        }
        
        if (this.state.selectedRegionId && regions[this.state.selectedRegionId]) {
            const region = regions[this.state.selectedRegionId];
            return region;
        }
        
        const regionIds = Object.keys(regions);
        if (regionIds.length > 0) {
            const lastRegion = regions[regionIds[regionIds.length - 1]];
            this.state.selectedRegionId = lastRegion.id;
            return lastRegion;
        }
        return null;
    }

    clearAllRegions() {
        // Stop any playing audio first
        if (this.state.wavesurfer && this.state.isPlaying) {
            this.state.wavesurfer.stop();
            this.state.isPlaying = false;
            // Update play/pause button state
            if (this.state.elements.playPause) {
                this.state.elements.playPause.textContent = '▶️';
                this.state.elements.playPause.classList.remove('playing');
            }
        }
        
        // Remove all existing regions
        if (this.state.regionsPlugin?.getRegions) {
            const regions = this.state.regionsPlugin.getRegions();
            if (regions && Object.keys(regions).length > 0) {
                Object.values(regions).forEach(region => {
                    region.remove();
                });
            }
        }
        
        // Clear state
        this.state.selectedRegionId = null;
        this.removeOverlays();
        this.hideControls();
        
        console.log('All regions cleared and audio stopped');
    }

    // Clear regions from DOM directly (for cases where plugin isn't ready yet)
    clearRegionsFromDOM() {
        // Stop any playing audio first
        if (this.state.wavesurfer && this.state.isPlaying) {
            this.state.wavesurfer.stop();
            this.state.isPlaying = false;
            // Update play/pause button state
            if (this.state.elements.playPause) {
                this.state.elements.playPause.textContent = '▶️';
                this.state.elements.playPause.classList.remove('playing');
            }
        }
        
        // Remove any existing region elements from DOM
        const waveformContainer = document.getElementById('waveform');
        if (waveformContainer) {
            const existingRegions = waveformContainer.querySelectorAll('.wavesurfer-region');
            existingRegions.forEach(region => region.remove());
        }
        
        // Clear state
        this.state.selectedRegionId = null;
        this.removeOverlays();
        this.hideControls();
        
        console.log('Regions cleared from DOM and audio stopped');
    }
}

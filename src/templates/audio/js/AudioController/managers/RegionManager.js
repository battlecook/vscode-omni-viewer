import { CONSTANTS } from '../utils/Constants.js';
import { AudioUtils } from '../utils/AudioUtils.js';

export class RegionManager {
    constructor(state) {
        this.state = state;
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
        const containerRect = waveformContainer.getBoundingClientRect();
        const regionElement = region.element;
        
        if (!regionElement) return;
        
        const regionRect = regionElement.getBoundingClientRect();
        
        // Start input overlay
        this.state.regionStartOverlay = document.createElement('div');
        this.state.regionStartOverlay.className = 'region-input-overlay';
        this.state.regionStartOverlay.innerHTML = `
            <input type="number" value="${region.start.toFixed(1)}" class="region-start-input" title="Start time">
        `;
        
        // End input overlay
        this.state.regionEndOverlay = document.createElement('div');
        this.state.regionEndOverlay.className = 'region-input-overlay';
        this.state.regionEndOverlay.innerHTML = `
            <input type="number" value="${region.end.toFixed(1)}" class="region-end-input" title="End time">
        `;
        
        // Position calculation
        const startLeft = regionRect.left - containerRect.left - 10;
        const endLeft = regionRect.right - containerRect.left + 10;
        const top = regionRect.top - containerRect.top + 10;
        
        this.state.regionStartOverlay.style.left = startLeft + 'px';
        this.state.regionStartOverlay.style.top = top + 'px';
        
        this.state.regionEndOverlay.style.left = endLeft + 'px';
        this.state.regionEndOverlay.style.top = top + 'px';
        
        waveformContainer.appendChild(this.state.regionStartOverlay);
        waveformContainer.appendChild(this.state.regionEndOverlay);
        
        this.setupOverlayEvents(region);
    }

    setupOverlayEvents(region) {
        const startInput = this.state.regionStartOverlay.querySelector('.region-start-input');
        const endInput = this.state.regionEndOverlay.querySelector('.region-end-input');
        
        const applyRegionInput = (startTimeInput, endTimeInput) => {
            console.log('applyRegionInput called with:', { startTimeInput, endTimeInput, region });
            
            if (!region || !this.state.wavesurfer) {
                return;
            }
            
            const duration = this.state.wavesurfer.getDuration() || 0;

            let startSec = region.start;
            let endSec = region.end;

            const parsedStart = parseFloat(startTimeInput);
            const parsedEnd = parseFloat(endTimeInput);
            
            if (!isNaN(parsedStart)) startSec = parsedStart;
            if (!isNaN(parsedEnd)) endSec = parsedEnd;

            if (startSec > endSec) {
                const temp = startSec;
                startSec = endSec;
                endSec = temp;
            }

            if (startSec > duration) {
                startSec = Math.max(0, duration - CONSTANTS.REGION.MIN_DURATION);
            }
            
            if (endSec > duration) {
                endSec = duration;
            }

            startSec = Math.max(0, startSec);
            endSec = Math.min(duration, endSec);

            if (startSec + CONSTANTS.REGION.MIN_DURATION > endSec) {
                endSec = Math.min(duration, startSec + CONSTANTS.REGION.MIN_DURATION);
            }

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
                        start: startSec,
                        end: endSec,
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
    }

    updateOverlays(region) {
        if (this.state.regionStartOverlay && this.state.regionEndOverlay) {
            const startInput = this.state.regionStartOverlay.querySelector('.region-start-input');
            const endInput = this.state.regionEndOverlay.querySelector('.region-end-input');
            startInput.value = region.start.toFixed(1);
            endInput.value = region.end.toFixed(1);
        }
    }

    removeOverlays() {
        if (this.state.regionStartOverlay) {
            this.state.regionStartOverlay.remove();
            this.state.regionStartOverlay = null;
        }
        if (this.state.regionEndOverlay) {
            this.state.regionEndOverlay.remove();
            this.state.regionEndOverlay = null;
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
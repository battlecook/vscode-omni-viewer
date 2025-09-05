export class ImageFilters {
    constructor(image) {
        this.image = image;
        
        // Filter state
        this.brightness = 100;
        this.contrast = 100;
        this.saturation = 100;
        this.grayscale = 0;
        
        // Filter elements
        this.brightnessSlider = document.getElementById('brightnessSlider');
        this.contrastSlider = document.getElementById('contrastSlider');
        this.saturationSlider = document.getElementById('saturationSlider');
        this.grayscaleSlider = document.getElementById('grayscaleSlider');
        
        // Preset buttons
        this.presetNormal = document.getElementById('presetNormal');
        this.presetBright = document.getElementById('presetBright');
        this.presetDark = document.getElementById('presetDark');
        this.presetVintage = document.getElementById('presetVintage');
        this.presetBw = document.getElementById('presetBw');
    }
    
    setupEventListeners() {
        // Filter controls
        this.brightnessSlider.addEventListener('input', (e) => {
            this.brightness = parseInt(e.target.value);
            this.updateFilters();
        });

        this.contrastSlider.addEventListener('input', (e) => {
            this.contrast = parseInt(e.target.value);
            this.updateFilters();
        });

        this.saturationSlider.addEventListener('input', (e) => {
            this.saturation = parseInt(e.target.value);
            this.updateFilters();
        });

        this.grayscaleSlider.addEventListener('input', (e) => {
            this.grayscale = parseInt(e.target.value);
            this.updateFilters();
        });

        // Preset buttons
        this.presetNormal.addEventListener('click', () => this.applyPreset('normal'));
        this.presetBright.addEventListener('click', () => this.applyPreset('bright'));
        this.presetDark.addEventListener('click', () => this.applyPreset('dark'));
        this.presetVintage.addEventListener('click', () => this.applyPreset('vintage'));
        this.presetBw.addEventListener('click', () => this.applyPreset('bw'));
    }
    
    updateFilters() {
        const filterString = `brightness(${this.brightness}%) contrast(${this.contrast}%) saturate(${this.saturation}%) grayscale(${this.grayscale}%)`;
        this.image.style.filter = filterString;
    }
    
    getFilterString() {
        return `brightness(${this.brightness}%) contrast(${this.contrast}%) saturate(${this.saturation}%) grayscale(${this.grayscale}%)`;
    }
    
    applyPreset(preset) {
        // Remove active class from all preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
        
        switch(preset) {
            case 'normal':
                this.brightness = 100; this.contrast = 100; this.saturation = 100; this.grayscale = 0;
                this.presetNormal.classList.add('active');
                break;
            case 'bright':
                this.brightness = 130; this.contrast = 110; this.saturation = 100; this.grayscale = 0;
                this.presetBright.classList.add('active');
                break;
            case 'dark':
                this.brightness = 70; this.contrast = 120; this.saturation = 100; this.grayscale = 0;
                this.presetDark.classList.add('active');
                break;
            case 'vintage':
                this.brightness = 110; this.contrast = 90; this.saturation = 70; this.grayscale = 10;
                this.presetVintage.classList.add('active');
                break;
            case 'bw':
                this.brightness = 100; this.contrast = 120; this.saturation = 0; this.grayscale = 100;
                this.presetBw.classList.add('active');
                break;
        }
        
        // Update sliders
        this.brightnessSlider.value = this.brightness;
        this.contrastSlider.value = this.contrast;
        this.saturationSlider.value = this.saturation;
        this.grayscaleSlider.value = this.grayscale;
        
        this.updateFilters();
    }
    
    resetFilters() {
        this.applyPreset('normal');
    }
}

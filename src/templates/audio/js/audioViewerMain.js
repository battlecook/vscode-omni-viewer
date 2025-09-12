import { AudioController } from './AudioController/index.js';

console.log('Audio viewer script loading...');

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');
    console.log('Initializing audio viewer...');
    
    const audioController = new AudioController();
    audioController.initialize();
});

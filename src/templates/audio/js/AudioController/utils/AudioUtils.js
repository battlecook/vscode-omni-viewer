// Audio utility functions
export const AudioUtils = {
    formatTime: (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds % 1) * 1000);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    },

    showStatus: (message, statusElement) => {
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.classList.add('show');
            setTimeout(() => {
                statusElement.classList.remove('show');
            }, 100);
        }
    },

    log: (message) => {
        if (typeof vscode !== 'undefined' && vscode.env && vscode.env.uiKind === 1) {
            console.log(message);
        }
    }
};

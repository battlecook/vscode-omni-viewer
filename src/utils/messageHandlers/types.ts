export interface WebviewMessage {
    command: string;
    text?: string;
    data?: any;
    fileName?: string;
    blob?: any;
    imageData?: string;
    type?: string;
    lineNumber?: number;
    mimeType?: string;
    duration?: string;
    startTime?: string;
    endTime?: string;
    content?: string;
}

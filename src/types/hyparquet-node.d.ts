declare module 'hyparquet/src/node.js' {
    export function asyncBufferFromFile(filename: string): Promise<{
        byteLength: number;
        slice(start: number, end?: number): Promise<ArrayBuffer>;
    }>;
}

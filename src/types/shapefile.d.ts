declare module 'shapefile' {
    export interface ShapefileSource<T> {
        bbox?: [number, number, number, number];
        read(): Promise<{ done: boolean; value?: T }>;
        cancel(): Promise<void>;
    }

    export interface ShapefileOptions {
        encoding?: string;
        highWaterMark?: number;
    }

    export function open<T = any>(
        shp: string | ArrayBuffer | Uint8Array,
        dbf?: string | null | ArrayBuffer | Uint8Array | ShapefileOptions,
        options?: ShapefileOptions
    ): Promise<ShapefileSource<T>>;
}

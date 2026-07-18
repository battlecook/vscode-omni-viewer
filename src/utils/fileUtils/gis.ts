import * as fs from 'fs';
import * as path from 'path';
import proj4 from 'proj4';
import * as shapefile from 'shapefile';

type BBox = [number, number, number, number];
type Position = number[];
type GeometryType =
    | 'Point'
    | 'MultiPoint'
    | 'LineString'
    | 'MultiLineString'
    | 'Polygon'
    | 'MultiPolygon'
    | 'GeometryCollection';

export interface ShapefileReadOptions {
    featureStart?: number;
    featureLimit?: number;
}

export interface ShapefileData {
    type: 'FeatureCollection';
    features: any[];
    bbox: BBox | null;
    sourceBBox: BBox | null;
    fileSize: string;
    files: Array<{
        role: 'shp' | 'shx' | 'dbf' | 'prj' | 'cpg';
        name: string;
        exists: boolean;
        size?: string;
    }>;
    metadata: {
        loadedFeatures: number;
        skippedFeatures: number;
        nextFeatureStart: number;
        hasMoreFeatures: boolean;
        featureLimit: number;
        geometryTypes: Record<string, number>;
        propertyNames: string[];
        projection: {
            status: 'projected' | 'assumed-wgs84' | 'local' | 'failed';
            message: string;
            prj?: string;
        };
        warnings: string[];
    };
}

const DEFAULT_FEATURE_LIMIT = 10000;
const MAX_VERTEX_PREVIEW_COUNT = 200000;

export async function readShapefile(filePath: string, options: ShapefileReadOptions = {}): Promise<ShapefileData> {
    const featureStart = Math.max(0, options.featureStart ?? 0);
    const featureLimit = Math.max(1, options.featureLimit ?? DEFAULT_FEATURE_LIMIT);
    const sidecars = await collectSidecarFiles(filePath);
    const warnings: string[] = [];
    const prj = await readOptionalText(sidecars.prj.path);
    const cpg = (await readOptionalText(sidecars.cpg.path))?.trim();
    const projection = createProjection(prj, warnings);
    const source = await shapefile.open(filePath, sidecars.dbf.exists ? sidecars.dbf.path : undefined, {
        encoding: cpg || undefined
    });

    const features: any[] = [];
    const geometryTypes: Record<string, number> = {};
    const propertyNames = new Set<string>();
    let bbox: BBox | null = null;
    let totalRead = 0;
    let loadedFeatures = 0;
    let vertexCount = 0;
    let hitLimit = false;

    try {
        let reachedEnd = false;
        while (!reachedEnd) {
            const result = await source.read();
            if (result.done) {
                reachedEnd = true;
                continue;
            }

            const feature = result.value;
            if (!feature) {
                continue;
            }

            if (totalRead++ < featureStart) {
                continue;
            }

            if (loadedFeatures >= featureLimit || vertexCount >= MAX_VERTEX_PREVIEW_COUNT) {
                hitLimit = true;
                break;
            }

            const prepared = prepareFeature(feature, projection.transform);
            features.push(prepared);
            loadedFeatures++;

            const geometryType = prepared.geometry?.type || 'Unknown';
            geometryTypes[geometryType] = (geometryTypes[geometryType] || 0) + 1;

            for (const key of Object.keys(prepared.properties || {})) {
                propertyNames.add(key);
            }

            const featureBBox = computeGeometryBBox(prepared.geometry);
            if (featureBBox) {
                bbox = mergeBBox(bbox, featureBBox);
            }
            vertexCount += countGeometryVertices(prepared.geometry);
        }
    } finally {
        await source.cancel().catch(() => undefined);
    }

    if (vertexCount >= MAX_VERTEX_PREVIEW_COUNT) {
        warnings.push(`Preview stopped after ${vertexCount.toLocaleString()} vertices to keep the viewer responsive.`);
    }
    if (!sidecars.dbf.exists) {
        warnings.push('Matching .dbf file was not found, so feature properties may be empty.');
    }
    if (!sidecars.shx.exists) {
        warnings.push('Matching .shx index file was not found. Sequential preview is still available.');
    }

    return {
        type: 'FeatureCollection',
        features,
        bbox,
        sourceBBox: Array.isArray(source.bbox) ? source.bbox : null,
        fileSize: await getFileSize(filePath),
        files: await formatSidecarFiles(sidecars),
        metadata: {
            loadedFeatures,
            skippedFeatures: featureStart,
            nextFeatureStart: featureStart + loadedFeatures,
            hasMoreFeatures: hitLimit,
            featureLimit,
            geometryTypes,
            propertyNames: Array.from(propertyNames).sort((a, b) => a.localeCompare(b)),
            projection: {
                status: projection.status,
                message: projection.message,
                prj: prj || undefined
            },
            warnings
        }
    };
}

async function collectSidecarFiles(filePath: string) {
    const parsed = path.parse(filePath);
    const base = path.join(parsed.dir, parsed.name);
    return {
        shp: await describeFile(`${base}.shp`),
        shx: await describeFile(`${base}.shx`),
        dbf: await describeFile(`${base}.dbf`),
        prj: await describeFile(`${base}.prj`),
        cpg: await describeFile(`${base}.cpg`)
    };
}

async function describeFile(filePath: string): Promise<{ path: string; name: string; exists: boolean; size?: string }> {
    try {
        const stat = await fs.promises.stat(filePath);
        return { path: filePath, name: path.basename(filePath), exists: true, size: formatBytes(stat.size) };
    } catch (error) {
        return { path: filePath, name: path.basename(filePath), exists: false };
    }
}

async function formatSidecarFiles(sidecars: Awaited<ReturnType<typeof collectSidecarFiles>>): Promise<ShapefileData['files']> {
    return (['shp', 'shx', 'dbf', 'prj', 'cpg'] as const).map((role) => ({
        role,
        name: sidecars[role].name,
        exists: sidecars[role].exists,
        size: sidecars[role].size
    }));
}

async function readOptionalText(filePath: string): Promise<string | null> {
    try {
        return await fs.promises.readFile(filePath, 'utf8');
    } catch (error) {
        return null;
    }
}

async function getFileSize(filePath: string): Promise<string> {
    const stat = await fs.promises.stat(filePath);
    return formatBytes(stat.size);
}

function formatBytes(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function createProjection(prj: string | null, warnings: string[]): {
    status: ShapefileData['metadata']['projection']['status'];
    message: string;
    transform: ((position: Position) => Position) | null;
} {
    if (prj && isWgs84Projection(prj)) {
        return {
            status: 'assumed-wgs84',
            message: 'The .prj file appears to describe WGS84 coordinates.',
            transform: null
        };
    }

    if (prj) {
        try {
            const transform = proj4(prj, 'EPSG:4326');
            return {
                status: 'projected',
                message: 'Coordinates were transformed to WGS84 using the .prj definition.',
                transform: (position) => {
                    const [x, y] = transform.forward([position[0], position[1]]);
                    return [x, y, ...position.slice(2)];
                }
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Failed to parse .prj projection: ${message}`);
            return {
                status: 'failed',
                message: 'The .prj file could not be parsed. Showing geometry in local coordinates.',
                transform: null
            };
        }
    }

    warnings.push('No .prj file was found. Geographic placement may be unavailable.');
    return {
        status: 'local',
        message: 'No .prj file was found. Showing geometry in local coordinates unless values look like longitude/latitude.',
        transform: null
    };
}

function isWgs84Projection(prj: string): boolean {
    return /WGS[_\s]?84/i.test(prj) || /EPSG["']?\s*,\s*4326/i.test(prj);
}

function prepareFeature(feature: any, transform: ((position: Position) => Position) | null): any {
    return {
        type: 'Feature',
        properties: feature.properties || {},
        geometry: transform ? transformGeometry(feature.geometry, transform) : feature.geometry || null
    };
}

function transformGeometry(geometry: any, transform: (position: Position) => Position): any {
    if (!geometry) {
        return geometry;
    }
    if (geometry.type === 'GeometryCollection') {
        return {
            ...geometry,
            geometries: Array.isArray(geometry.geometries)
                ? geometry.geometries.map((child: any) => transformGeometry(child, transform))
                : []
        };
    }
    return {
        ...geometry,
        coordinates: transformCoordinates(geometry.coordinates, geometry.type, transform)
    };
}

function transformCoordinates(coordinates: any, geometryType: GeometryType, transform: (position: Position) => Position): any {
    switch (geometryType) {
    case 'Point':
        return transform(coordinates);
    case 'MultiPoint':
    case 'LineString':
        return coordinates.map((position: Position) => transform(position));
    case 'MultiLineString':
    case 'Polygon':
        return coordinates.map((line: Position[]) => line.map((position) => transform(position)));
    case 'MultiPolygon':
        return coordinates.map((polygon: Position[][]) => polygon.map((line) => line.map((position) => transform(position))));
    default:
        return coordinates;
    }
}

function computeGeometryBBox(geometry: any): BBox | null {
    let bbox: BBox | null = null;
    visitPositions(geometry, (position) => {
        if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
            return;
        }
        const pointBBox: BBox = [position[0], position[1], position[0], position[1]];
        bbox = mergeBBox(bbox, pointBBox);
    });
    return bbox;
}

function mergeBBox(current: BBox | null, next: BBox): BBox {
    if (!current) {
        return next;
    }
    return [
        Math.min(current[0], next[0]),
        Math.min(current[1], next[1]),
        Math.max(current[2], next[2]),
        Math.max(current[3], next[3])
    ];
}

function countGeometryVertices(geometry: any): number {
    let count = 0;
    visitPositions(geometry, () => {
        count++;
    });
    return count;
}

function visitPositions(geometry: any, visitor: (position: Position) => void): void {
    if (!geometry) {
        return;
    }
    if (geometry.type === 'GeometryCollection') {
        for (const child of geometry.geometries || []) {
            visitPositions(child, visitor);
        }
        return;
    }
    visitCoordinatePositions(geometry.coordinates, geometry.type, visitor);
}

function visitCoordinatePositions(coordinates: any, geometryType: GeometryType, visitor: (position: Position) => void): void {
    switch (geometryType) {
    case 'Point':
        visitor(coordinates);
        break;
    case 'MultiPoint':
    case 'LineString':
        coordinates.forEach(visitor);
        break;
    case 'MultiLineString':
    case 'Polygon':
        coordinates.forEach((line: Position[]) => line.forEach(visitor));
        break;
    case 'MultiPolygon':
        coordinates.forEach((polygon: Position[][]) => polygon.forEach((line) => line.forEach(visitor)));
        break;
    default:
        break;
    }
}

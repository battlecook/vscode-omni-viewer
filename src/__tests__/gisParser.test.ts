import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockOpen = jest.fn();

jest.mock('shapefile', () => ({
    open: mockOpen
}));

import { readShapefile } from '../utils/fileUtils/gis';

describe('readShapefile', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-viewer-shp-'));
        mockOpen.mockReset();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('streams a limited preview and reports sidecar file status', async () => {
        const shpPath = path.join(tempDir, 'roads.shp');
        const dbfPath = path.join(tempDir, 'roads.dbf');
        fs.writeFileSync(shpPath, Buffer.alloc(100));
        fs.writeFileSync(dbfPath, Buffer.alloc(20));

        const features = [
            {
                type: 'Feature',
                properties: { name: 'A' },
                geometry: { type: 'Point', coordinates: [127, 37] }
            },
            {
                type: 'Feature',
                properties: { name: 'B' },
                geometry: { type: 'Point', coordinates: [128, 38] }
            }
        ];
        let index = 0;
        const cancel = jest.fn().mockResolvedValue(undefined);
        const read = jest.fn(async () => {
            if (index >= features.length) {
                return { done: true };
            }
            return { done: false, value: features[index++] };
        });
        mockOpen.mockResolvedValue({ bbox: [127, 37, 128, 38], read, cancel });

        const result = await readShapefile(shpPath, { featureLimit: 1 });

        expect(mockOpen).toHaveBeenCalledWith(shpPath, dbfPath, { encoding: undefined });
        expect(result.features).toHaveLength(1);
        expect(result.metadata.hasMoreFeatures).toBe(true);
        expect(result.metadata.nextFeatureStart).toBe(1);
        expect(result.metadata.propertyNames).toEqual(['name']);
        expect(result.metadata.geometryTypes).toEqual({ Point: 1 });
        expect(result.files.find((file) => file.role === 'dbf')?.exists).toBe(true);
        expect(result.files.find((file) => file.role === 'prj')?.exists).toBe(false);
        expect(cancel).toHaveBeenCalled();
    });
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import JSZip from 'jszip';
import { detectCore024Preview } from '../utils/core024Detection';
import { CORE_PREVIEW_VIEWERS, readCorePreview } from '../utils/corePreview';
import { parseSarif } from 'omni-viewer-core/parsers/sarif';
import { parseSbom } from 'omni-viewer-core/parsers/sbom';
import { parseTrace } from 'omni-viewer-core/parsers/trace';
import { parseGps } from 'omni-viewer-core/parsers/gps';
import { parseDrawio } from 'omni-viewer-core/parsers/drawio';

const SARIF = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'lint' } }, results: [{ ruleId: 'R1', level: 'error', message: { text: 'Oops' } }] }] });
const SBOM = JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ type: 'library', name: 'left-pad', version: '1.3.0' }] });
const TRACE = JSON.stringify({ traceEvents: [{ name: 'run', ph: 'X', pid: 1, tid: 1, ts: 0, dur: 10 }] });
const GPX = '<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="37.5" lon="127"/><trkpt lat="37.6" lon="127.1"/></trkseg></trk></gpx>';
const KML = '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Point><coordinates>127,37.5</coordinates></Point></Placemark></kml>';
const DRAWIO = '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Box" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';

/** A minimal v3 Compound File: FAT in sector 0, directory in sector 1, empty streams. */
function compoundFile(streams: string[]): Buffer {
    const file = Buffer.alloc(512 * 3, 0);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file);
    file.writeUInt16LE(0x3e, 24); file.writeUInt16LE(3, 26); file.writeUInt16LE(0xfffe, 28);
    file.writeUInt16LE(9, 30); file.writeUInt16LE(6, 32);
    file.writeUInt32LE(1, 44); file.writeUInt32LE(1, 48); file.writeUInt32LE(4096, 56);
    file.writeUInt32LE(0xfffffffe, 60); file.writeUInt32LE(0xfffffffe, 68);
    for (let index = 0; index < 109; index++) file.writeUInt32LE(index ? 0xffffffff : 0, 76 + index * 4);
    for (let index = 0; index < 128; index++) file.writeUInt32LE(index === 0 ? 0xfffffffd : index === 1 ? 0xfffffffe : 0xffffffff, 512 + index * 4);
    const entry = (index: number, name: string, type: number, right: number, child: number) => {
        const offset = 1024 + index * 128;
        file.write(`${name}\0`, offset, 'utf16le');
        file.writeUInt16LE((name.length + 1) * 2, offset + 64);
        file[offset + 66] = type; file[offset + 67] = 1;
        file.writeUInt32LE(0xffffffff, offset + 68); file.writeUInt32LE(right, offset + 72); file.writeUInt32LE(child, offset + 76);
        file.writeUInt32LE(0xfffffffe, offset + 116);
    };
    entry(0, 'Root Entry', 5, 0xffffffff, streams.length ? 1 : 0xffffffff);
    streams.forEach((name, index) => entry(index + 1, name, 2, index + 1 < streams.length ? index + 2 : 0xffffffff, 0xffffffff));
    return file;
}

async function zip(members: Array<[string, string]>, mimetype?: string): Promise<Buffer> {
    const archive = new JSZip();
    if (mimetype) archive.file('mimetype', mimetype, { compression: 'STORE' });
    for (const [name, content] of members) archive.file(name, content);
    return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('0.24 core file preview routing', () => {
    let directory: string;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-024-')); });
    afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    async function detect(name: string, content: string | Buffer, requested?: Parameters<typeof detectCore024Preview>[3]) {
        const filePath = path.join(directory, name);
        fs.writeFileSync(filePath, content);
        const buffer = fs.readFileSync(filePath).subarray(0, 64 * 1024);
        return detectCore024Preview(filePath, buffer, path.extname(name).toLowerCase(), requested);
    }

    it.each([
        ['report.sarif', 'sarif'], ['report.sarif.json', 'sarif'], ['bom.cdx.json', 'sbom'], ['bom.cyclonedx.json', 'sbom'],
        ['profile.trace.json', 'trace'], ['profile.chrome-trace', 'trace'], ['diagram.drawio', 'drawio'], ['diagram.dio', 'drawio'],
        ['places.kmz', 'gps'], ['letter.odt', 'opendocument'], ['slides.odp', 'opendocument']
    ])('routes %s to its viewer by extension', async (name, kind) => {
        expect((await detect(name, ''))?.viewType).toBe(`omni-viewer.${kind}Viewer`);
    });

    it.each([['sarif', '.json', SARIF], ['sbom', '.json', SBOM], ['trace', '.json', TRACE], ['sarif', '', SARIF], ['trace', '', TRACE],
        ['gps', '.xml', GPX], ['gps', '.xml', KML], ['drawio', '.xml', DRAWIO], ['gps', '', GPX], ['drawio', '', DRAWIO]
    ])('recognizes %s content in a "%s" file', async (kind, ext, content) => {
        expect(await detect(`document${ext}`, content)).toMatchObject({ viewType: `omni-viewer.${kind}Viewer`, matchedBySignature: false });
    });

    it('recognizes a JSON Trace Event array', async () => {
        const events = JSON.stringify([{ name: 'a', ph: 'B', pid: 1, tid: 1, ts: 0 }, { ph: 'E', pid: 1, tid: 1, ts: 5 }]);
        expect((await detect('events.json', events))?.viewType).toBe('omni-viewer.traceViewer');
    });

    it.each([
        ['sarif', 'scan.json', SARIF, parseSarif], ['sbom', 'bom.json', SBOM, parseSbom], ['trace', 'profile.json', TRACE, parseTrace]
    ] as const)('hands detected UTF-16 %s to the core parser as UTF-8', async (kind, name, source, parse) => {
        for (const bom of [[0xff, 0xfe], [0xfe, 0xff]]) {
            const body = Buffer.from(source, 'utf16le');
            if (bom[0] === 0xfe) body.swap16();
            expect((await detect(name, Buffer.concat([Buffer.from(bom), body])))?.viewType).toBe(`omni-viewer.${kind}Viewer`);
            const data = await readCorePreview(path.join(directory, name), kind);
            expect(parse(data).result.status).toBe('ok');
        }
    });

    it('leaves ordinary JSON/XML and unrelated extensions alone', async () => {
        expect(await detect('package.json', '{"name":"x","version":"1.0.0"}')).toBeNull();
        expect(await detect('pom.xml', '<?xml version="1.0"?><project/>')).toBeNull();
        expect(await detect('notes.txt', SARIF)).toBeNull();
        expect(await detect('config.yaml', TRACE)).toBeNull();
        expect(await detect('foreign.xml', '<x:mxfile xmlns:x="urn:x"/>')).toBeNull();
        expect(await detect('plain.xml', '<gpx version="1.1"><trk/></gpx>')).toBeNull();
    });

    it('routes GPX/KML extensions to the GPS map, which also accepts a namespace-less root', async () => {
        const plainGpx = '<gpx version="1.1"><trk><trkseg><trkpt lat="37.5" lon="127"/></trkseg></trk></gpx>';
        const plainKml = '<kml><Placemark><Point><coordinates>127,37.5</coordinates></Point></Placemark></kml>';
        const prologue = `\uFEFF<?xml version="1.0"?>\n<!-- <kml xmlns="urn:x"> -->\n<!DOCTYPE gpx [<!ENTITY a "b">]>\n${plainGpx}`;
        for (const [name, content] of [['track.gpx', GPX], ['places.kml', KML], ['plain.gpx', plainGpx], ['plain.kml', plainKml], ['prologue.gpx', prologue]]) {
            expect((await detect(name, content))?.viewType).toBe('omni-viewer.gpsViewer');
            expect((await parseGps(new TextEncoder().encode(content))).result.status).not.toBe('failed');
        }
    });

    it('leaves a .gpx/.kml the GPS parser rejects to the XML viewer', async () => {
        const kml23 = '<kml xmlns="http://www.opengis.net/kml/2.3"><Placemark/></kml>';
        expect((await parseGps(new TextEncoder().encode(kml23))).result.status).toBe('failed');
        expect(await detect('places.kml', kml23)).toBeNull();
        expect(await detect('track.gpx', DRAWIO)).toBeNull();
        expect(await detect('track.gpx', '<gpx creator=" xmlns=x"><trk/></gpx>')).toMatchObject({ viewType: 'omni-viewer.gpsViewer' });
        expect(await detect('track.gpx', '<gpxData/>')).toBeNull();
        expect(await detect('empty.gpx', '')).toBeNull();
    });

    it('leaves documents over the preview budget to the generic JSON/XML viewer', async () => {
        const large = (name: string, content: string, size: number) => {
            const filePath = path.join(directory, name);
            fs.writeFileSync(filePath, content);
            fs.truncateSync(filePath, size);
            return detectCore024Preview(filePath, Buffer.from(content), path.extname(name));
        };
        expect(await large('track.gpx', GPX, 16 * 1024 * 1024 + 1)).toBeNull();
        expect(await large('scan.json', SARIF, CORE_PREVIEW_VIEWERS.sarif.maxBytes + 1)).toBeNull();
        expect(await large('report.sarif.json', SARIF, CORE_PREVIEW_VIEWERS.sarif.maxBytes + 1)).toBeNull();
        expect((await large('profile.json', TRACE, CORE_PREVIEW_VIEWERS.sarif.maxBytes + 1))?.viewType).toBe('omni-viewer.traceViewer');
        // Without a generic viewer, the extension still selects the viewer, which reports its limit.
        expect((await large('report.sarif', SARIF, CORE_PREVIEW_VIEWERS.sarif.maxBytes + 1))?.viewType).toBe('omni-viewer.sarifViewer');
    });

    it('claims Outlook MSG only for Compound Files, keeping text .msg files with their routing', async () => {
        const msg = compoundFile(['__properties_version1.0', '__substg1.0_001A001F']);
        expect(await detect('mail.msg', msg)).toMatchObject({ viewType: 'omni-viewer.msgViewer', matchedBySignature: true });
        expect(await detect('mail', msg)).toMatchObject({ viewType: 'omni-viewer.msgViewer', matchedBySignature: true });
        expect(await detect('Pose.msg', 'float64 x\nfloat64 y\n')).toBeNull();
        expect(await detect('Pose.msg', 'float64 x\nfloat64 y\n', 'omni-viewer.msgViewer')).toMatchObject({ viewType: 'omni-viewer.textViewer' });
        expect(await detect('empty.msg', '')).toBeNull();
        expect(await detect('legacy', compoundFile(['WordDocument']))).toBeNull();
        expect(await detect('legacy.doc', msg)).toBeNull();
    });

    it('verifies ZIP packages and probes extensionless KMZ and OpenDocument', async () => {
        const kmz = await zip([['doc.kml', KML]]);
        const odt = await zip([['content.xml', '<office:document-content/>']], 'application/vnd.oasis.opendocument.text');
        const odp = await zip([['content.xml', '<office:document-content/>']], 'application/vnd.oasis.opendocument.presentation');
        expect(await detect('places.kmz', kmz)).toMatchObject({ viewType: 'omni-viewer.gpsViewer', matchedBySignature: true });
        expect((await detect('places', kmz))?.viewType).toBe('omni-viewer.gpsViewer');
        expect((await detect('letter', odt))?.viewType).toBe('omni-viewer.opendocumentViewer');
        expect((await detect('slides', odp))?.viewType).toBe('omni-viewer.opendocumentViewer');
        expect(await detect('sheet', await zip([['content.xml', '<x/>']], 'application/vnd.oasis.opendocument.spreadsheet'))).toBeNull();
        expect(await detect('bundle.zip', kmz)).toBeNull();
        expect(await detect('plain', await zip([['readme.txt', 'hi']]))).toBeNull();
    });

    it('honors an explicit Archive request and leaves over-budget packages to the Archive viewer', async () => {
        const odt = await zip([['content.xml', '<x/>']], 'application/vnd.oasis.opendocument.text');
        expect(await detect('letter.odt', odt, 'omni-viewer.archiveViewer')).toBeNull();
        const filePath = path.join(directory, 'big.kmz');
        fs.writeFileSync(filePath, await zip([['doc.kml', KML]]));
        fs.truncateSync(filePath, CORE_PREVIEW_VIEWERS.gps.maxBytes + 1);
        expect(await detectCore024Preview(filePath, fs.readFileSync(filePath).subarray(0, 64), '.kmz')).toBeNull();
    });

    it('parses the routed fixtures with the published core parsers', async () => {
        const sarif = parseSarif(new TextEncoder().encode(SARIF)).result;
        expect(sarif.status).toBe('ok');
        if (sarif.status !== 'failed') expect(sarif.document.findings).toHaveLength(1);
        expect(parseSbom(new TextEncoder().encode(SBOM)).result.status).toBe('ok');
        expect(parseTrace(new TextEncoder().encode(TRACE)).result.status).not.toBe('failed');
        expect((await parseGps(new TextEncoder().encode(GPX))).result.status).not.toBe('failed');
        expect((await parseGps(new Uint8Array(await zip([['doc.kml', KML]])))).result.status).not.toBe('failed');
        expect((await parseDrawio(new TextEncoder().encode(DRAWIO))).result.status).not.toBe('failed');
    });
});

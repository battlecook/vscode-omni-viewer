import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

jest.mock('music-metadata', () => ({}), { virtual: true });
jest.mock('xlsx', () => ({}), { virtual: true });

import { parseDelimitedLine as parseHostDelimitedLine } from '../utils/fileUtils/tabular';

const DELIMITED_LINE_FIXTURES = [
    {
        delimiter: '\t',
        expected: ['pipe', '4"', 'kept'],
        line: 'pipe\t4"\tkept'
    },
    {
        delimiter: '\t',
        expected: ['item', '"leading', 'kept'],
        line: 'item\t"leading\tkept'
    },
    {
        delimiter: '\t',
        expected: ['item', '"quoted"'],
        line: 'item\t"""quoted"""'
    },
    {
        delimiter: '\t',
        expected: ['Report', 'Line A\tLine B'],
        line: 'Report\t"Line A\tLine B"'
    },
    {
        delimiter: ',',
        expected: ['a', 'b', '"c', 'd'],
        line: 'a,b,"c,d'
    },
    {
        delimiter: ',',
        expected: ['a,b', 'c'],
        line: '"a,b",c'
    },
    {
        delimiter: ',',
        expected: ['item', 'a,b', 'kept'],
        line: 'item, "a,b",kept'
    },
    {
        delimiter: ',',
        expected: ['a,b', 'c'],
        line: '\uFEFF"a,b",c'
    },
    {
        delimiter: ',',
        expected: [' a ', 'c'],
        line: '" a ",c'
    }
];

interface EditableCellStub {
    innerHTML: string;
    textContent: string;
    title: string;
}

interface CsvHistorySnapshot {
    headers: string[];
    rows: string[][];
    totalRows: number;
    totalColumns: number;
    columnWidths: (number | null)[];
}

interface CsvViewerInstance {
    addColumn(): void;
    addRow(): void;
    columnWidths: (number | null)[];
    copyToClipboard: jest.Mock;
    csvData: {
        headers: string[];
        rows: string[][];
        totalRows: number;
        totalColumns: number;
    };
    delimiter: string;
    escapeDelimitedValue(value: string): string;
    exportToJson: jest.Mock;
    finishCellEdit(
        cell: EditableCellStub,
        columnIndex: number,
        newValue: string,
        originalRowIndex: number
    ): void;
    handleColumnResize: jest.Mock;
    isTableView: boolean;
    maxHistorySize: number;
    parseDelimitedLine(line: string): string[];
    rebuildFilteredRows: jest.Mock;
    redoChange: jest.Mock | (() => void);
    redoStack: CsvHistorySnapshot[];
    refreshView: jest.Mock;
    renderTable: jest.Mock;
    saveChanges: jest.Mock;
    setupEventListeners(): void;
    showNotification: jest.Mock;
    stopColumnResize: jest.Mock;
    syncColumnWidths: jest.Mock;
    toggleView: jest.Mock;
    undoChange: jest.Mock | (() => void);
    undoStack: CsvHistorySnapshot[];
    updateFileInfo: jest.Mock;
}

interface CsvViewerClass {
    prototype: CsvViewerInstance;
}

class HTMLElementStub {
    public isContentEditable = false;

    constructor(public readonly tagName: string) {}

    public matches(selector: string): boolean {
        return selector
            .split(',')
            .map((part) => part.trim().toUpperCase())
            .includes(this.tagName.toUpperCase());
    }
}

function loadCsvViewerClass(): {
    CsvViewer: CsvViewerClass;
    documentListeners: Map<string, (event: unknown) => void>;
} {
    const sourcePath = path.join(__dirname, '..', 'templates', 'csv', 'js', 'csvViewer.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const documentListeners = new Map<string, (event: unknown) => void>();
    const context = vm.createContext({
        acquireVsCodeApi: () => ({
            getState: () => null,
            postMessage: jest.fn(),
            setState: jest.fn()
        }),
        clearTimeout,
        console,
        document: {
            addEventListener: (type: string, listener: (event: unknown) => void) => {
                documentListeners.set(type, listener);
            },
            getElementById: () => null
        },
        HTMLElement: HTMLElementStub,
        navigator: {
            clipboard: {
                readText: jest.fn(),
                writeText: jest.fn()
            }
        },
        setTimeout
    });

    vm.runInContext(source, context);

    return {
        CsvViewer: vm.runInContext('CsvViewer', context) as CsvViewerClass,
        documentListeners
    };
}

function createEditableViewer(): CsvViewerInstance {
    const { CsvViewer } = loadCsvViewerClass();
    const viewer: CsvViewerInstance = Object.create(CsvViewer.prototype);

    viewer.csvData = {
        headers: ['name', 'size'],
        rows: [['pipe', '4"']],
        totalRows: 1,
        totalColumns: 2
    };
    viewer.columnWidths = [null, null];
    viewer.undoStack = [];
    viewer.redoStack = [];
    viewer.maxHistorySize = 50;
    viewer.rebuildFilteredRows = jest.fn();
    viewer.saveChanges = jest.fn();
    viewer.showNotification = jest.fn();
    viewer.syncColumnWidths = jest.fn();
    viewer.updateFileInfo = jest.fn();
    viewer.refreshView = jest.fn();
    viewer.renderTable = jest.fn();

    return viewer;
}

describe('CSV viewer editing behavior', () => {
    it('keeps host and webview parsers aligned on shared fixtures', () => {
        const { CsvViewer } = loadCsvViewerClass();
        const viewer = Object.create(CsvViewer.prototype);

        for (const fixture of DELIMITED_LINE_FIXTURES) {
            viewer.delimiter = fixture.delimiter;
            const hostResult = parseHostDelimitedLine(fixture.line, fixture.delimiter);
            const webviewResult = [...viewer.parseDelimitedLine(fixture.line)];

            expect(hostResult).toEqual(fixture.expected);
            expect(webviewResult).toEqual(fixture.expected);
            expect(webviewResult).toEqual(hostResult);
        }
    });

    it('quotes boundary whitespace for a lossless raw-view round trip', () => {
        const { CsvViewer } = loadCsvViewerClass();
        const viewer = Object.create(CsvViewer.prototype);
        const originalValues = [' leading', 'trailing ', ' both '];
        viewer.delimiter = ',';

        const serialized = originalValues
            .map((value) => viewer.escapeDelimitedValue(value))
            .join(',');

        expect(serialized).toBe('" leading","trailing "," both "');
        expect([...viewer.parseDelimitedLine(serialized)]).toEqual(originalValues);
    });

    it('parses wide rows with unmatched opening quotes in linear time', () => {
        const { CsvViewer } = loadCsvViewerClass();
        const viewer = Object.create(CsvViewer.prototype);
        const fieldCount = 12000;
        const line = new Array(fieldCount).fill('"value').join(',');
        viewer.delimiter = ',';

        const startedAt = Date.now();
        const hostResult = parseHostDelimitedLine(line, viewer.delimiter);
        const webviewResult = [...viewer.parseDelimitedLine(line)];
        const elapsedMs = Date.now() - startedAt;

        expect(hostResult).toHaveLength(fieldCount);
        expect(webviewResult).toEqual(hostResult);
        expect(elapsedMs).toBeLessThan(1000);
    });

    it('does not save a cell that loses focus without changing', () => {
        const viewer = createEditableViewer();
        const cell = { innerHTML: 'input', textContent: '', title: '' };

        viewer.finishCellEdit(cell, 1, '4"', 0);

        expect(viewer.csvData.rows[0][1]).toBe('4"');
        expect(viewer.rebuildFilteredRows).not.toHaveBeenCalled();
        expect(viewer.saveChanges).not.toHaveBeenCalled();
        expect(cell.textContent).toBe('4"');
    });

    it('saves a cell after its value actually changes', () => {
        const viewer = createEditableViewer();
        const cell = { innerHTML: 'input', textContent: '', title: '' };

        viewer.finishCellEdit(cell, 1, '5"', 0);

        expect(viewer.csvData.rows[0][1]).toBe('5"');
        expect(viewer.rebuildFilteredRows).toHaveBeenCalledTimes(1);
        expect(viewer.saveChanges).toHaveBeenCalledTimes(1);
    });

    it('restores the previous cell value on undo and reapplies it on redo', () => {
        const viewer = createEditableViewer();
        const cell = { innerHTML: 'input', textContent: '', title: '' };

        viewer.finishCellEdit(cell, 1, '5"', 0);
        expect(viewer.csvData.rows[0][1]).toBe('5"');

        viewer.undoChange();
        expect(viewer.csvData.rows[0][1]).toBe('4"');
        expect(viewer.saveChanges).toHaveBeenCalledTimes(2);

        viewer.redoChange();
        expect(viewer.csvData.rows[0][1]).toBe('5"');
        expect(viewer.saveChanges).toHaveBeenCalledTimes(3);
    });

    it('undoes structural edits including row and column counts', () => {
        const viewer = createEditableViewer();

        viewer.addColumn();
        expect(viewer.csvData.headers).toEqual(['name', 'size', 'Column3']);
        expect(viewer.csvData.totalColumns).toBe(3);
        expect(viewer.csvData.rows[0]).toEqual(['pipe', '4"', '']);

        viewer.undoChange();
        expect(viewer.csvData.headers).toEqual(['name', 'size']);
        expect(viewer.csvData.totalColumns).toBe(2);
        expect(viewer.csvData.rows[0]).toEqual(['pipe', '4"']);
    });

    it('does not record history for a cell edit that changes nothing', () => {
        const viewer = createEditableViewer();
        const cell = { innerHTML: 'input', textContent: '', title: '' };

        viewer.finishCellEdit(cell, 1, '4"', 0);

        expect(viewer.undoStack).toHaveLength(0);
    });

    it('drops the redo stack once a new edit is made', () => {
        const viewer = createEditableViewer();
        const cell = { innerHTML: 'input', textContent: '', title: '' };

        viewer.finishCellEdit(cell, 1, '5"', 0);
        viewer.undoChange();
        expect(viewer.redoStack).toHaveLength(1);

        viewer.finishCellEdit(cell, 0, 'hose', 0);
        expect(viewer.redoStack).toHaveLength(0);
    });

    it('caps the undo stack at the configured history size', () => {
        const viewer = createEditableViewer();
        const cell = { innerHTML: 'input', textContent: '', title: '' };
        viewer.maxHistorySize = 3;

        for (let index = 0; index < 10; index += 1) {
            viewer.finishCellEdit(cell, 1, `${index}"`, 0);
        }

        expect(viewer.undoStack).toHaveLength(3);

        viewer.undoChange();
        expect(viewer.csvData.rows[0][1]).toBe('8"');
    });

    it('keeps snapshots isolated from later mutations', () => {
        const viewer = createEditableViewer();

        viewer.addRow();
        viewer.csvData.rows[1][0] = 'mutated after snapshot';
        viewer.undoChange();

        expect(viewer.csvData.rows).toHaveLength(1);
        expect(viewer.csvData.rows[0]).toEqual(['pipe', '4"']);
    });

    it('handles Cmd+Z on the document as an undo', () => {
        const { CsvViewer, documentListeners } = loadCsvViewerClass();
        const viewer = Object.create(CsvViewer.prototype);
        viewer.isTableView = true;
        viewer.copyToClipboard = jest.fn();
        viewer.exportToJson = jest.fn();
        viewer.handleColumnResize = jest.fn();
        viewer.stopColumnResize = jest.fn();
        viewer.toggleView = jest.fn();
        viewer.undoChange = jest.fn();
        viewer.redoChange = jest.fn();
        viewer.setupEventListeners();

        const keydownListener = documentListeners.get('keydown');
        const preventDefault = jest.fn();
        keydownListener?.({
            ctrlKey: false,
            key: 'z',
            metaKey: true,
            preventDefault,
            shiftKey: false,
            target: new HTMLElementStub('div')
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(viewer.undoChange).toHaveBeenCalledTimes(1);
        expect(viewer.redoChange).not.toHaveBeenCalled();

        keydownListener?.({
            ctrlKey: false,
            key: 'z',
            metaKey: true,
            preventDefault,
            shiftKey: true,
            target: new HTMLElementStub('div')
        });

        expect(viewer.redoChange).toHaveBeenCalledTimes(1);
    });

    it('leaves Cmd+Z to the browser while a cell editor has focus', () => {
        const { CsvViewer, documentListeners } = loadCsvViewerClass();
        const viewer = Object.create(CsvViewer.prototype);
        viewer.isTableView = true;
        viewer.copyToClipboard = jest.fn();
        viewer.exportToJson = jest.fn();
        viewer.handleColumnResize = jest.fn();
        viewer.stopColumnResize = jest.fn();
        viewer.toggleView = jest.fn();
        viewer.undoChange = jest.fn();
        viewer.redoChange = jest.fn();
        viewer.setupEventListeners();

        const keydownListener = documentListeners.get('keydown');
        const preventDefault = jest.fn();
        keydownListener?.({
            ctrlKey: false,
            key: 'z',
            metaKey: true,
            preventDefault,
            shiftKey: false,
            target: new HTMLElementStub('input')
        });

        expect(preventDefault).not.toHaveBeenCalled();
        expect(viewer.undoChange).not.toHaveBeenCalled();
    });

    it('allows Ctrl+V in a cell editor without switching to Raw View', () => {
        const { CsvViewer, documentListeners } = loadCsvViewerClass();
        const viewer = Object.create(CsvViewer.prototype);
        viewer.isTableView = true;
        viewer.copyToClipboard = jest.fn();
        viewer.exportToJson = jest.fn();
        viewer.handleColumnResize = jest.fn();
        viewer.stopColumnResize = jest.fn();
        viewer.toggleView = jest.fn();
        viewer.setupEventListeners();

        const keydownListener = documentListeners.get('keydown');
        const preventDefault = jest.fn();
        keydownListener?.({
            ctrlKey: true,
            key: 'v',
            metaKey: false,
            preventDefault,
            target: new HTMLElementStub('input')
        });

        expect(preventDefault).not.toHaveBeenCalled();
        expect(viewer.toggleView).not.toHaveBeenCalled();
    });
});

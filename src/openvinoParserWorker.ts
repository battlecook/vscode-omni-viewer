import { parentPort, workerData } from 'worker_threads';
import { readOpenVinoDocument } from './utils/openvinoModel';

interface OpenVinoWorkerData {
    filePath: string;
}

const port = parentPort;
if (!port) {
    throw new Error('The OpenVINO parser worker requires a parent port.');
}

const data = workerData as OpenVinoWorkerData;

void readOpenVinoDocument(data.filePath).then(
    (model) => port.postMessage({ ok: true, model }),
    (error: unknown) => {
        const value = error instanceof Error ? error : new Error(String(error));
        port.postMessage({
            ok: false,
            error: {
                name: value.name,
                message: value.message
            }
        });
    }
);

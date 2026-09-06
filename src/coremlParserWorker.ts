import { parentPort, workerData } from 'worker_threads';
import { readCoremlDocument } from './utils/coremlModel';

interface CoremlWorkerData {
    filePath: string;
}

const port = parentPort;
if (!port) {
    throw new Error('The Core ML parser worker requires a parent port.');
}

const data = workerData as CoremlWorkerData;

void readCoremlDocument(data.filePath).then(
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

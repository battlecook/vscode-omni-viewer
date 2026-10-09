import { parentPort, workerData } from 'worker_threads';
import { readHarDocument } from './utils/harModel';

interface HarWorkerData {
    filePath: string;
}

const port = parentPort;
if (!port) {
    throw new Error('The HAR parser worker requires a parent port.');
}

const data = workerData as HarWorkerData;

void readHarDocument(data.filePath).then(
    (result) => port.postMessage({ ok: true, result }),
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

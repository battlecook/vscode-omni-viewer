import { parentPort, workerData } from 'worker_threads';
import { readNumpyDocument } from './utils/numpyModel';

interface NumpyWorkerData {
    filePath: string;
}

const port = parentPort;
if (!port) {
    throw new Error('The NumPy parser worker requires a parent port.');
}

const data = workerData as NumpyWorkerData;

void readNumpyDocument(data.filePath).then(
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

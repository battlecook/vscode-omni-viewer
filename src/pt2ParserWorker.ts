import { parentPort, workerData } from 'worker_threads';
import { readPt2Document } from './utils/pt2Model';

interface Pt2WorkerData {
    filePath: string;
}

const port = parentPort;
if (!port) {
    throw new Error('The PyTorch Export parser worker requires a parent port.');
}

const data = workerData as Pt2WorkerData;

void readPt2Document(data.filePath).then(
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

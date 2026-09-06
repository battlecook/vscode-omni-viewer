import * as path from 'path';
import { Worker } from 'worker_threads';
import type { CoremlDocument } from 'omni-viewer-core/parsers/coreml';

interface WorkerSuccess {
    ok: true;
    model: CoremlDocument;
}

interface WorkerFailure {
    ok: false;
    error: {
        name: string;
        message: string;
    };
}

type WorkerResult = WorkerSuccess | WorkerFailure;

function abortError(): Error {
    const error = new Error('Core ML parsing was cancelled.');
    error.name = 'AbortError';
    return error;
}

export function parseCoremlInWorker(filePath: string, signal?: AbortSignal): Promise<CoremlDocument> {
    if (signal?.aborted) {
        return Promise.reject(abortError());
    }

    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'coremlParserWorker.js'), {
            workerData: { filePath }
        });
        let settled = false;

        const finish = (callback: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            void worker.terminate();
            callback();
        };
        const onAbort = (): void => finish(() => reject(abortError()));

        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) {
            onAbort();
            return;
        }
        worker.once('message', (result: WorkerResult) => {
            finish(() => {
                if (result.ok) {
                    resolve(result.model);
                    return;
                }
                const error = new Error(result.error.message);
                error.name = result.error.name;
                reject(error);
            });
        });
        worker.once('error', (error) => finish(() => reject(error)));
        worker.once('exit', (code) => {
            if (code !== 0) {
                finish(() => reject(new Error(`Core ML parser worker exited with code ${code}.`)));
            }
        });
    });
}

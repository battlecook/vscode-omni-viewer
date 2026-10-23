import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';
import type { OpenVinoSkippedWeights } from './openvinoModel';

export interface OpenVinoTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    weightsNotice: string;
    openvinoData: string;
}

/** The core only knows that no weights were supplied; when a `.bin` does sit
 *  beside the `.xml`, the shell says why it was left out. */
export function describeSkippedWeights(skipped: OpenVinoSkippedWeights): string {
    if (skipped.reason === 'tooLarge') {
        const size = skipped.size === null ? '' : ` (${(skipped.size / 1024 / 1024).toFixed(1)}MB)`;
        return `${skipped.fileName}${size} was not loaded because it is above the 512MB weight preview limit; constants are shown by range only.`;
    }
    return `${skipped.fileName} could not be read; constants are shown by range only.`;
}

export function createOpenVinoTemplateVariables(
    fileName: string,
    locale: string,
    model: unknown,
    cspSource: string,
    skippedWeights: OpenVinoSkippedWeights | null = null,
    nonce = randomBytes(16).toString('hex')
): OpenVinoTemplateVariables {
    // `TemplateUtils.loadTemplate` substitutes in key order, so the model
    // JSON goes last: a layer or file named `{{weightsNotice}}` must not have
    // the notice markup expanded inside the data script.
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        weightsNotice: skippedWeights
            ? `<div class="omni-openvino-notice" role="status">${escapeHtml(describeSkippedWeights(skippedWeights))}</div>`
            : '',
        openvinoData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, model }))
    };
}

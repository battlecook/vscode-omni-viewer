import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface TfliteTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    tfliteData: string;
}

export function createTfliteTemplateVariables(
    fileName: string,
    locale: string,
    model: unknown,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): TfliteTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        tfliteData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, model }))
    };
}

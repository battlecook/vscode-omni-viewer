import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface KerasTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    kerasData: string;
}

export function createKerasTemplateVariables(
    fileName: string,
    locale: string,
    model: unknown,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): KerasTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        kerasData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, model }))
    };
}

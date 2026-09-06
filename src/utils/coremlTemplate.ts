import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface CoremlTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    coremlData: string;
}

export function createCoremlTemplateVariables(
    fileName: string,
    locale: string,
    model: unknown,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): CoremlTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        coremlData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, model }))
    };
}

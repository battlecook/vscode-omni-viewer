import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface PteTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    pteData: string;
}

export function createPteTemplateVariables(
    fileName: string,
    locale: string,
    model: unknown,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): PteTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        pteData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, model }))
    };
}

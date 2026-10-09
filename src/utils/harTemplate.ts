import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface HarTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    harData: string;
}

export function createHarTemplateVariables(
    fileName: string,
    locale: string,
    result: unknown,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): HarTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        harData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, result }))
    };
}

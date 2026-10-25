import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface EpubTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    epubData: string;
}

export function createEpubTemplateVariables(
    fileName: string,
    locale: string,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): EpubTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        epubData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale }))
    };
}

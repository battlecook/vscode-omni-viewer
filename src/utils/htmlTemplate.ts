import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export function createHtmlTemplateVariables(
    fileName: string,
    locale: string,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): { [key: string]: string } {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        htmlData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale }))
    };
}

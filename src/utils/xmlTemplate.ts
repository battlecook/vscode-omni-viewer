import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface XmlTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    xmlData: string;
}

export function createXmlTemplateVariables(
    fileName: string,
    locale: string,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): XmlTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        xmlData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale }))
    };
}

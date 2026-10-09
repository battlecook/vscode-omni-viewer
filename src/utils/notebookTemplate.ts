import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface NotebookTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    notebookData: string;
}

export function createNotebookTemplateVariables(
    fileName: string,
    locale: string,
    katexCssUri: string,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): NotebookTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        notebookData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, katexCssUri }))
    };
}

import { randomBytes } from 'crypto';
import { escapeHtml, escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface NumpyTemplateVariables {
    [key: string]: string;
    fileName: string;
    cspNonce: string;
    cspSource: string;
    numpyData: string;
}

/** JSON has no NaN, Infinity, or negative zero, so `JSON.stringify` would
 *  print them as `null` and `0`. They are spelled as strings instead, which
 *  the core viewer prints verbatim — the same encoding as its own
 *  `numpyJsonReplacer`, which the extension host cannot import because it
 *  lives beside the DOM viewer. */
export function numpyJsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value !== 'number') {
        return value;
    }
    if (Number.isNaN(value)) {
        return 'NaN';
    }
    if (value === Number.POSITIVE_INFINITY) {
        return 'Infinity';
    }
    if (value === Number.NEGATIVE_INFINITY) {
        return '-Infinity';
    }
    if (Object.is(value, -0)) {
        return '-0';
    }
    return value;
}

export function createNumpyTemplateVariables(
    fileName: string,
    locale: string,
    model: unknown,
    cspSource: string,
    nonce = randomBytes(16).toString('hex')
): NumpyTemplateVariables {
    return {
        fileName: escapeHtml(fileName),
        cspNonce: escapeHtml(nonce),
        cspSource: escapeHtml(cspSource),
        numpyData: escapeJsonForHtmlScriptTag(JSON.stringify({ fileName, locale, model }, numpyJsonReplacer))
    };
}

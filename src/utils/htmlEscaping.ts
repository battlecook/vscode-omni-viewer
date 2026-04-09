export function escapeJsonForHtmlScriptTag(json: string): string {
    return json
        .replace(/</g, '\\u003C')
        .replace(/>/g, '\\u003E')
        .replace(/&/g, '\\u0026');
}

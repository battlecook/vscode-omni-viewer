import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { escapeJsonForHtmlScriptTag } from './htmlEscaping';

export class TemplateUtils {
    public static escapeJsonForHtmlScriptTag(json: string): string {
        return escapeJsonForHtmlScriptTag(json);
    }

    public static async loadTemplate(
        context: vscode.ExtensionContext,
        templateName: string,
        variables: { [key: string]: string }
    ): Promise<string> {
        const templatePath = path.join(context.extensionPath, 'src', 'templates', templateName);

        try {
            let template = await fs.promises.readFile(templatePath, 'utf8');

            template = await this.inlineExternalFiles(context, templatePath, template);

            for (const [key, value] of Object.entries(variables)) {
                const placeholder = `{{${key}}}`;
                const safeValue = value === null || value === undefined ? '' : String(value);
                // Use split/join to avoid `$` replacement semantics in String.replace.
                template = template.split(placeholder).join(safeValue);
            }

            template = this.injectOmniShareAssets(template);

            return template;
        } catch (error) {
            console.error(`Error loading template ${templateName}:`, error);
            throw new Error(`Failed to load template: ${templateName}`);
        }
    }

    private static readonly OMNI_SHARE_BUTTONS_HTML = `<div class="omni-header-actions">
    <button type="button" class="omni-header-action-btn" data-omni-action="share" title="Share with Omni Viewer" aria-label="Share with Omni Viewer">Share</button>
    <button type="button" class="omni-header-action-btn" data-omni-action="open-shared-link" title="Open shared link" aria-label="Open shared link">Open Link</button>
</div>`;

    private static readonly OMNI_SHARE_STYLE = `<style>
.omni-header-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}
.omni-header-action-btn {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground, #d4d4d4));
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    line-height: 1;
    padding: 6px 10px;
    transition: background 140ms ease;
    white-space: nowrap;
}
.omni-header-action-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
}
.omni-header-action-btn:active {
    transform: translateY(1px);
}
</style>`;

    private static readonly OMNI_VSCODE_MEMOIZE_SCRIPT = `<script>
(function () {
    if (typeof window === 'undefined') return;
    if (window.__omniVsCode__ || typeof acquireVsCodeApi !== 'function') return;
    try {
        var api = acquireVsCodeApi();
        window.__omniVsCode__ = api;
        try {
            Object.defineProperty(window, 'acquireVsCodeApi', {
                configurable: true,
                writable: true,
                value: function () { return api; }
            });
        } catch (e) {
            window.acquireVsCodeApi = function () { return api; };
        }
    } catch (e) {
        // acquireVsCodeApi may have already been called by another script.
    }
})();
</script>`;

    private static readonly OMNI_SHARE_WIRE_SCRIPT = `<script>
(function () {
    function getApi() {
        if (typeof window === 'undefined') return null;
        if (window.__omniVsCode__) return window.__omniVsCode__;
        if (typeof acquireVsCodeApi === 'function') {
            try {
                window.__omniVsCode__ = acquireVsCodeApi();
                return window.__omniVsCode__;
            } catch (e) { return null; }
        }
        return null;
    }
    function bind() {
        var api = getApi();
        if (!api) return;
        document.querySelectorAll('[data-omni-action="share"]').forEach(function (el) {
            el.addEventListener('click', function () { api.postMessage({ type: 'omniViewerShare' }); });
        });
        document.querySelectorAll('[data-omni-action="open-shared-link"]').forEach(function (el) {
            el.addEventListener('click', function () { api.postMessage({ type: 'omniViewerOpenSharedLink' }); });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
</script>`;

    private static injectOmniShareAssets(html: string): string {
        html = html.split('{{omniShareButtons}}').join(this.OMNI_SHARE_BUTTONS_HTML);

        if (html.includes('</head>')) {
            html = html.replace('</head>', `${this.OMNI_SHARE_STYLE}\n</head>`);
        } else {
            html = this.OMNI_SHARE_STYLE + html;
        }

        const firstScriptMatch = /<script\b/.exec(html);
        if (firstScriptMatch && firstScriptMatch.index !== undefined) {
            html = html.slice(0, firstScriptMatch.index) + this.OMNI_VSCODE_MEMOIZE_SCRIPT + '\n' + html.slice(firstScriptMatch.index);
        } else if (html.includes('</body>')) {
            html = html.replace('</body>', `${this.OMNI_VSCODE_MEMOIZE_SCRIPT}\n</body>`);
        } else {
            html += this.OMNI_VSCODE_MEMOIZE_SCRIPT;
        }

        if (html.includes('</body>')) {
            html = html.replace('</body>', `${this.OMNI_SHARE_WIRE_SCRIPT}\n</body>`);
        } else {
            html += this.OMNI_SHARE_WIRE_SCRIPT;
        }

        return html;
    }

    private static async inlineExternalFiles(context: vscode.ExtensionContext, templatePath: string, html: string): Promise<string> {
        const templateDir = path.dirname(templatePath);
        
        const cssMatch = html.match(/<link[^>]*href="([^"]*\.css)"[^>]*>/g);
        if (cssMatch) {
            for (const linkTag of cssMatch) {
                const hrefMatch = linkTag.match(/href="([^"]*\.css)"/);
                if (hrefMatch) {
                    const cssRelativePath = hrefMatch[1];
                    const cssPath = path.join(templateDir, cssRelativePath);
                    
                    try {
                        const cssContent = await fs.promises.readFile(cssPath, 'utf8');
                        const styleTag = `<style>\n${cssContent}\n</style>`;
                        html = html.replace(linkTag, () => styleTag);
                    } catch (error) {
                        console.error(`Failed to inline required CSS file ${cssRelativePath}:`, error);
                        throw new Error(`Required CSS asset could not be loaded: ${cssRelativePath}`);
                    }
                }
            }
        }
        
        const jsMatch = html.match(/<script[^>]*src="([^"]*\.js)"[^>]*><\/script>/g);
        if (jsMatch) {
            for (const scriptTag of jsMatch) {
                const srcMatch = scriptTag.match(/src="([^"]*\.js)"/);
                if (srcMatch) {
                    const jsRelativePath = srcMatch[1];
                    
                    if (jsRelativePath.startsWith('http://') || jsRelativePath.startsWith('https://')) {
                        continue;
                    }
                    
                    const jsPath = path.join(templateDir, jsRelativePath);
                    
                    try {
                        const jsContent = await fs.promises.readFile(jsPath, 'utf8');
                        const inlineScriptTag = `<script>\n${jsContent}\n</script>`;
                        html = html.replace(scriptTag, () => inlineScriptTag);
                    } catch (error) {
                        console.error(`Failed to inline required JavaScript file ${jsRelativePath}:`, error);
                        throw new Error(`Required JavaScript asset could not be loaded: ${jsRelativePath}`);
                    }
                }
            }
        }
        
        return html;
    }

    public static getWebviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
        return {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'media')),
                vscode.Uri.file(path.join(context.extensionPath, 'node_modules')),
                vscode.Uri.file(path.join(context.extensionPath, 'src', 'templates'))
            ]
        };
    }
}

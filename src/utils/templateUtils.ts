import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export class TemplateUtils {
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
            
            return template;
        } catch (error) {
            console.error(`Error loading template ${templateName}:`, error);
            throw new Error(`Failed to load template: ${templateName}`);
        }
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

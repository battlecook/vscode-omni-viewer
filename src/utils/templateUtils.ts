import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export class TemplateUtils {
    /**
     * HTML 템플릿을 로드하고 변수를 치환합니다.
     */
    public static async loadTemplate(
        context: vscode.ExtensionContext,
        templateName: string,
        variables: { [key: string]: string }
    ): Promise<string> {
        const templatePath = path.join(context.extensionPath, 'src', 'templates', templateName);
        
        try {
            let template = await fs.promises.readFile(templatePath, 'utf8');
            
            // 변수 치환
            for (const [key, value] of Object.entries(variables)) {
                const placeholder = `{{${key}}}`;
                template = template.replace(new RegExp(placeholder, 'g'), value);
            }
            
            return template;
        } catch (error) {
            console.error(`Error loading template ${templateName}:`, error);
            throw new Error(`Failed to load template: ${templateName}`);
        }
    }

    /**
     * 웹뷰 옵션을 설정합니다.
     */
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

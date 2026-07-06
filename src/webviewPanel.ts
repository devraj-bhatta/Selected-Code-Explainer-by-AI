import * as vscode from 'vscode';

/**
 * Manages a single reusable webview panel (singleton pattern) so repeated
 * "Explain" invocations update the same tab instead of spawning new ones.
 */
export class ExplanationPanel {
    public static currentPanel: ExplanationPanel | undefined;
    private static readonly viewType = 'selectedCodeExplainerByAI.panel';

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public onRegenerateRequested?: () => void;

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message) => {
                if (message?.command === 'regenerate') {
                    this.onRegenerateRequested?.();
                } else if (message?.command === 'copy') {
                    vscode.env.clipboard.writeText(message.text ?? '');
                    vscode.window.setStatusBarMessage('$(check) Explanation copied to clipboard', 2500);
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri): ExplanationPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (ExplanationPanel.currentPanel) {
            ExplanationPanel.currentPanel.panel.reveal(column, true);
            return ExplanationPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            ExplanationPanel.viewType,
            'Code Explanation',
            { viewColumn: column, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        ExplanationPanel.currentPanel = new ExplanationPanel(panel);
        return ExplanationPanel.currentPanel;
    }

    public showLoading(languageId: string): void {
        this.panel.title = 'Explaining code…';
        this.panel.webview.html = this.render({
            state: 'loading',
            languageId
        });
    }

    public showError(message: string): void {
        this.panel.title = 'Explanation failed';
        this.panel.webview.html = this.render({
            state: 'error',
            errorMessage: message
        });
    }

    public showResult(code: string, languageId: string, explanationMarkdown: string, includeCode: boolean): void {
        this.panel.title = 'Code Explanation';
        this.panel.webview.html = this.render({
            state: 'result',
            code,
            languageId,
            explanationHtml: markdownToHtml(explanationMarkdown),
            includeCode
        });
    }

    public dispose(): void {
        ExplanationPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }

    private render(data: {
        state: 'loading' | 'error' | 'result';
        code?: string;
        languageId?: string;
        explanationHtml?: string;
        errorMessage?: string;
        includeCode?: boolean;
    }): string {
        const nonce = getNonce();
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

        let body = '';
        if (data.state === 'loading') {
            body = `
                <div class="center">
                    <div class="spinner"></div>
                    <p>Thinking... please wait</p>
                </div>`;
        } else if (data.state === 'error') {
            body = `
                <div class="center error-box">
                    <p>⚠️ ${escapeHtml(data.errorMessage || 'Something went wrong.')}</p>
                    <button id="retry-btn">Try Again</button>
                </div>`;
        } else {
            body = `
                <div class="toolbar">
                    <button id="copy-btn" title="Copy explanation">📋 Copy</button>
                    <button id="retry-btn" title="Regenerate">🔄 Regenerate</button>
                </div>
                ${
                    data.includeCode
                        ? `<details class="code-block" open>
                                <summary>Selected code (${escapeHtml(data.languageId || 'plain text')})</summary>
                                <pre><code>${escapeHtml(data.code || '')}</code></pre>
                           </details>`
                        : ''
                }
                <div class="explanation">${data.explanationHtml}</div>`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
    body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
        padding: 16px 20px 32px;
        line-height: 1.55;
    }
    .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
    }
    button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    }
    button:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .code-block {
        margin-bottom: 16px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 8px 12px;
    }
    .code-block summary {
        cursor: pointer;
        font-weight: 600;
        font-size: 12px;
        opacity: 0.85;
    }
    pre {
        background: var(--vscode-textCodeBlock-background);
        padding: 10px;
        border-radius: 4px;
        overflow-x: auto;
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
    }
    code {
        font-family: var(--vscode-editor-font-family);
    }
    .explanation code {
        background: var(--vscode-textCodeBlock-background);
        padding: 1px 5px;
        border-radius: 3px;
    }
    .explanation h1, .explanation h2, .explanation h3 {
        margin-top: 1.2em;
    }
    .explanation ul, .explanation ol {
        padding-left: 22px;
    }
    .center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        margin-top: 60px;
        gap: 14px;
        text-align: center;
    }
    .error-box {
        color: var(--vscode-errorForeground);
    }
    .spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid var(--vscode-panel-border);
        border-top-color: var(--vscode-progressBar-background);
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>
</head>
<body>
${body}
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('retry-btn')?.addEventListener('click', () => {
        vscode.postMessage({ command: 'regenerate' });
    });
    document.getElementById('copy-btn')?.addEventListener('click', () => {
        const text = document.querySelector('.explanation')?.innerText ?? '';
        vscode.postMessage({ command: 'copy', text });
    });
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Minimal, dependency-free Markdown -> HTML renderer covering the subset
 * The model's responses typically use: headings, bold/italic, inline code,
 * fenced code blocks, and (un)ordered lists.
 */
function markdownToHtml(markdown: string): string {
    const escaped = escapeHtml(markdown);
    const lines = escaped.split('\n');
    let html = '';
    let inCodeBlock = false;
    let inList: 'ul' | 'ol' | null = null;

    const closeList = () => {
        if (inList) {
            html += `</${inList}>`;
            inList = null;
        }
    };

    for (const rawLine of lines) {
        const line = rawLine;

        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                html += '</code></pre>';
                inCodeBlock = false;
            } else {
                closeList();
                html += '<pre><code>';
                inCodeBlock = true;
            }
            continue;
        }

        if (inCodeBlock) {
            html += line + '\n';
            continue;
        }

        const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
        if (headingMatch) {
            closeList();
            const level = headingMatch[1].length;
            html += `<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`;
            continue;
        }

        const ulMatch = line.match(/^\s*[-*]\s+(.*)/);
        const olMatch = line.match(/^\s*\d+\.\s+(.*)/);

        if (ulMatch) {
            if (inList !== 'ul') {
                closeList();
                html += '<ul>';
                inList = 'ul';
            }
            html += `<li>${inlineMarkdown(ulMatch[1])}</li>`;
            continue;
        }

        if (olMatch) {
            if (inList !== 'ol') {
                closeList();
                html += '<ol>';
                inList = 'ol';
            }
            html += `<li>${inlineMarkdown(olMatch[1])}</li>`;
            continue;
        }

        closeList();

        if (line.trim() === '') {
            html += '';
        } else {
            html += `<p>${inlineMarkdown(line)}</p>`;
        }
    }

    closeList();
    if (inCodeBlock) {
        html += '</code></pre>';
    }

    return html;
}

function inlineMarkdown(text: string): string {
    return text
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

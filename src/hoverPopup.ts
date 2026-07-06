import * as vscode from 'vscode';

/**
 * Tracks the single "active" explanation popup so the hover provider knows
 * what to render, and where.
 */
interface PendingHover {
    uri: string;
    range: vscode.Range;
    markdown: vscode.MarkdownString;
}

/**
 * Shows AI explanations as a native VS Code hover popup anchored right next
 * to the selected code, instead of a side panel. This reuses the same
 * lightweight widget VS Code uses for "show type info" / "show docs" hovers,
 * so it appears, positions, and dismisses itself exactly like those do.
 */
export class ExplanationHoverController implements vscode.HoverProvider {
    private pending: PendingHover | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        this.disposables.push(
            vscode.languages.registerHoverProvider({ pattern: '**/*' }, this),
            vscode.window.onDidChangeTextEditorSelection((e) => this.handleSelectionChange(e))
        );
        context.subscriptions.push(...this.disposables, { dispose: () => this.dispose() });
    }

    // Called by VS Code whenever it needs hover content for a position —
    // including right after we programmatically ask it to show one.
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
        if (!this.pending) {
            return undefined;
        }
        if (this.pending.uri !== document.uri.toString()) {
            return undefined;
        }
        if (!this.pending.range.contains(position)) {
            return undefined;
        }
        return new vscode.Hover(this.pending.markdown, this.pending.range);
    }

    /** Shows a spinner + "Thinking..." popup while the AI request is in flight. */
    public async showLoading(editor: vscode.TextEditor, range: vscode.Range): Promise<void> {
        const markdown = new vscode.MarkdownString();
        markdown.supportThemeIcons = true;
        markdown.appendMarkdown('$(loading~spin) Thinking... please wait');
        await this.reveal(editor, range, markdown);
    }

    /** Replaces the popup content with the final (very short) explanation. */
    public async showResult(editor: vscode.TextEditor, range: vscode.Range, explanation: string): Promise<void> {
        const markdown = new vscode.MarkdownString(explanation.trim());
        markdown.isTrusted = false;
        await this.reveal(editor, range, markdown);
    }

    /** Replaces the popup content with a friendly, specific error message. */
    public async showError(editor: vscode.TextEditor, range: vscode.Range, message: string): Promise<void> {
        const markdown = new vscode.MarkdownString();
        markdown.supportThemeIcons = true;
        markdown.appendMarkdown(`$(error) ${message}`);
        await this.reveal(editor, range, markdown);
    }

    private async reveal(editor: vscode.TextEditor, range: vscode.Range, markdown: vscode.MarkdownString): Promise<void> {
        this.pending = { uri: editor.document.uri.toString(), range, markdown };

        // "editor.action.showHover" toggles: if a hover is already open at
        // this position (e.g. our earlier "Thinking..." popup), calling it
        // again silently closes it instead of refreshing the content. Hiding
        // first guarantees the next call always does a fresh show, which
        // re-invokes provideHover and picks up the new markdown.
        await vscode.commands.executeCommand('editor.action.hideHover');
        await vscode.commands.executeCommand('editor.action.showHover');
    }

    // Clears the popup once the user selects something else, so stale
    // explanations don't linger and resurface on unrelated hovers.
    private handleSelectionChange(e: vscode.TextEditorSelectionChangeEvent): void {
        if (!this.pending) {
            return;
        }
        if (e.textEditor.document.uri.toString() !== this.pending.uri) {
            return;
        }
        const stillRelevant = e.selections.some((sel) => this.pending!.range.contains(sel.active));
        if (!stillRelevant) {
            this.pending = undefined;
        }
    }

    public dispose(): void {
        this.pending = undefined;
    }
}

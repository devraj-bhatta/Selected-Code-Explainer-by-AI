import * as vscode from 'vscode';

/**
 * A single status bar entry that gives users a persistent, discoverable
 * entry point to the "Explain Selected Code" command, in addition to the
 * command palette, context menu, and keybinding.
 */
export class ExplainerStatusBar {
    private readonly item: vscode.StatusBarItem;

    constructor(commandId: string) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = commandId;
        this.item.text = '$(sparkle) Explain Code';
        this.item.tooltip = 'Explain the selected code with AI (Ctrl+Alt+E)';
        this.updateVisibility(vscode.window.activeTextEditor);
        this.item.show();
    }

    public updateVisibility(editor: vscode.TextEditor | undefined): void {
        const hasSelection = !!editor && !editor.selection.isEmpty;
        this.item.text = hasSelection ? '$(sparkle) Explain Code' : '$(sparkle) Explain Code';
        this.item.color = hasSelection ? undefined : new vscode.ThemeColor('disabledForeground');
    }

    public dispose(): void {
        this.item.dispose();
    }
}

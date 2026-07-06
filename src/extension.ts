import * as vscode from 'vscode';
import { explainCode, ExplainOptions, AiServiceError } from './aiService';
import { ExplanationPanel } from './webviewPanel';
import { ExplainerStatusBar } from './statusBar';
import { ExplanationHoverController } from './hoverPopup';

const CONFIG_SECTION = 'selectedCodeExplainerByAI';
type DisplayMode = 'popup' | 'panel' | 'notification';

// NOTE: This key is bundled with the extension so users never have to enter
// their own. Anyone who installs this extension can extract this string from
// the packaged .vsix (it is plain JavaScript) and use it outside the
// extension, and every user's requests are billed/rate-limited against this
// one account. Do not use this pattern for a public/Marketplace release —
// see the README for a safer server-side-proxy alternative.
const HARDCODED_OPENROUTER_API_KEY = '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';

// Remembers the last explained selection so "Regenerate" can re-run it
// without the user needing to re-select the code.
interface LastRequest {
    uri: vscode.Uri;
    range: vscode.Range;
    code: string;
    languageId: string;
    displayMode: DisplayMode;
}
let lastRequest: LastRequest | undefined;

let hoverController: ExplanationHoverController;

export function activate(context: vscode.ExtensionContext): void {
    console.log('Selected Code Explainer (AI) is now active.');

    hoverController = new ExplanationHoverController(context);

    const statusBar = new ExplainerStatusBar('selectedCodeExplainerByAI.explain');
    context.subscriptions.push(statusBar);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => statusBar.updateVisibility(editor)),
        vscode.window.onDidChangeTextEditorSelection((e) => statusBar.updateVisibility(e.textEditor))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('selectedCodeExplainerByAI.explain', () => handleExplain(context)),
        vscode.commands.registerCommand('selectedCodeExplainerByAI.explainInPanel', () =>
            handleExplain(context, 'panel')
        ),
        vscode.commands.registerCommand('selectedCodeExplainerByAI.regenerate', () => handleRegenerate(context)),
        vscode.commands.registerCommand('selectedCodeExplainerByAI.selectModel', () => handleSelectModel())
    );
}

export function deactivate(): void {
    // Nothing to clean up explicitly; VS Code disposes everything in
    // context.subscriptions automatically.
}

/**
 * Core entry point triggered from the command palette, right-click menu,
 * editor toolbar icon, keybinding, or status bar item.
 */
async function handleExplain(context: vscode.ExtensionContext, forcedDisplayMode?: DisplayMode): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Please open a code file first.');
        return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText || !selectedText.trim()) {
        vscode.window.showWarningMessage('Please select some code first.');
        return;
    }

    if (selectedText.length > 20000) {
        const proceed = await vscode.window.showWarningMessage(
            'The selected code is very large, which may be slow or exceed the model\'s limits. Continue anyway?',
            'Continue',
            'Cancel'
        );
        if (proceed !== 'Continue') {
            return;
        }
    }

    const languageId = editor.document.languageId;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const displayMode = forcedDisplayMode ?? config.get<DisplayMode>('displayMode', 'popup');

    lastRequest = { uri: editor.document.uri, range: selection, code: selectedText, languageId, displayMode };

    await runExplanation(
        context,
        editor,
        selection,
        HARDCODED_OPENROUTER_API_KEY,
        selectedText,
        languageId,
        displayMode
    );
}

async function handleRegenerate(context: vscode.ExtensionContext): Promise<void> {
    if (!lastRequest) {
        vscode.window.showInformationMessage('There is no previous explanation to regenerate yet.');
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== lastRequest.uri.toString()) {
        vscode.window.showWarningMessage('Switch back to the original file to regenerate that explanation.');
        return;
    }
    await runExplanation(
        context,
        editor,
        lastRequest.range,
        HARDCODED_OPENROUTER_API_KEY,
        lastRequest.code,
        lastRequest.languageId,
        lastRequest.displayMode
    );
}

async function runExplanation(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    range: vscode.Range,
    apiKey: string,
    code: string,
    languageId: string,
    displayMode: DisplayMode
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const model = config.get<string>('model', 'openrouter/free');
    const responseLanguage = config.get<string>('responseLanguage', 'English');
    const temperature = config.get<number>('temperature', 0.3);
    const includeCode = config.get<boolean>('includeSelectedCodeInPanel', true);

    // The hover popup is meant for a glance, not a lecture — it always asks
    // for a single short sentence regardless of the configured detail level.
    const detailLevel =
        displayMode === 'popup' ? 'popup' : config.get<'brief' | 'standard' | 'detailed'>('explanationDetail', 'standard');
    const maxOutputTokens = displayMode === 'popup' ? 100 : config.get<number>('maxOutputTokens', 1024);

    const options: ExplainOptions = {
        apiKey,
        model,
        code,
        languageId,
        detailLevel,
        responseLanguage,
        temperature,
        maxOutputTokens
    };

    let panel: ExplanationPanel | undefined;

    if (displayMode === 'popup') {
        await hoverController.showLoading(editor, range);
    } else if (displayMode === 'panel') {
        panel = ExplanationPanel.createOrShow(context.extensionUri);
        panel.onRegenerateRequested = () => runExplanation(context, editor, range, apiKey, code, languageId, displayMode);
        panel.showLoading(languageId);
    }

    await vscode.window.withProgress(
        {
            location:
                displayMode === 'notification' ? vscode.ProgressLocation.Notification : vscode.ProgressLocation.Window,
            title: 'Thinking... please wait',
            cancellable: true
        },
        async (_progress, cancellationToken) => {
            try {
                const explanation = await explainCode(options, cancellationToken);

                if (cancellationToken.isCancellationRequested) {
                    return;
                }

                if (displayMode === 'popup') {
                    await hoverController.showResult(editor, range, explanation);
                } else if (panel) {
                    panel.showResult(code, languageId, explanation, includeCode);
                } else {
                    await showInNotification(explanation);
                }
            } catch (err) {
                const message = err instanceof AiServiceError ? err.message : `Unexpected error: ${String(err)}`;
                if (displayMode === 'popup') {
                    await hoverController.showError(editor, range, message);
                } else if (panel) {
                    panel.showError(message);
                } else {
                    vscode.window.showErrorMessage(message);
                }
            }
        }
    );
}

async function showInNotification(explanation: string): Promise<void> {
    const plain = explanation.replace(/[`*#]/g, '');
    const truncated = plain.length > 600 ? plain.slice(0, 600) + '…' : plain;
    const choice = await vscode.window.showInformationMessage(truncated, 'Open Full Explanation');
    if (choice === 'Open Full Explanation') {
        const doc = await vscode.workspace.openTextDocument({ content: explanation, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
}

async function handleSelectModel(): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const current = config.get<string>('model', 'openrouter/free');

    // OpenRouter's free-model catalog (":free" suffixed slugs) changes
    // week to week as providers rotate promos. "openrouter/free" and
    // "openrouter/auto" are stable OpenRouter-maintained routers, so they're
    // used as the safe defaults here instead of a specific model that could
    // vanish. Check https://openrouter.ai/models?order=pricing-low-to-high
    // for the current named free models if you want to pin one directly.
    const presets: Array<vscode.QuickPickItem & { id: string }> = [
        {
            id: 'openrouter/free',
            label: 'openrouter/free',
            description: 'Auto-routes to whichever free model is currently available (recommended default)'
        },
        {
            id: 'openrouter/auto',
            label: 'openrouter/auto',
            description: 'Auto-routes to the best available model for the prompt — may use paid models'
        },
        { id: '__custom__', label: 'Enter a custom model ID…', description: current }
    ];

    const picked = await vscode.window.showQuickPick(presets, {
        title: 'Select AI Model',
        placeHolder: `Current: ${current}`
    });

    if (!picked) {
        return;
    }

    let modelId = picked.id;
    if (modelId === '__custom__') {
        const custom = await vscode.window.showInputBox({
            title: 'Custom OpenRouter Model ID',
            prompt: 'e.g. a slug from https://openrouter.ai/models, such as "qwen/qwen3-coder:free"',
            value: current,
            ignoreFocusOut: true
        });
        if (!custom) {
            return;
        }
        modelId = custom.trim();
    }

    await config.update('model', modelId, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`AI model set to "${modelId}".`);
}

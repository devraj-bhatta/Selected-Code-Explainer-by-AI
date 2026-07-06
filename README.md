# Selected Code Explainer (AI)

Select any block of code, in **any programming language**, and get a clear, plain-English explanation powered by **OpenRouter** (Qwen, DeepSeek, Llama, GPT-OSS, and 300+ other models through one API) — right inside VS Code.

![demo placeholder](media/icon.png)

## ✨ Features

- **Works with any language** — the extension sends the selection plus its VS Code language ID to the model; it doesn't hardcode any language-specific parsing.
- **Instant popup, right next to your code** — by default, explanations appear as a one-sentence hover popup anchored at your selection (the same widget VS Code uses for type info), so you get an answer without leaving your place in the file.
- **Multiple ways to trigger it**, so it fits into any workflow:
  - Command Palette (`Ctrl+Shift+P` → "AI Explainer: Explain Selected Code")
  - Right-click context menu on a selection
  - Editor title bar icon (✨) when text is selected
  - Keybinding: `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS)
  - Status bar button ("✨ Explain Code")
  - Detailed-panel variant: `Ctrl+Alt+Shift+E`
- **Rich detailed panel (optional)** — a theme-aware side panel with Markdown rendering, a collapsible view of the original code, "Copy" and "Regenerate" buttons, for when a one-sentence popup isn't enough.
- **Fully configurable**: explanation detail level, output language, model, temperature, and max tokens.
- **Friendly error handling** for invalid keys, out-of-credit errors, rate limits, network issues, and oversized selections.
- **Zero runtime dependencies** — uses Node's built-in `https` module to call the OpenRouter REST API directly.

> ⚠️ **API key note:** this build calls OpenRouter with a single API key hardcoded in `src/extension.ts`, so end users never have to enter one. That's convenient, but it means *your* key ships inside the packaged extension (anyone can extract it from the `.vsix`) and every user's usage is billed/rate-limited against that one account. Fine for personal/internal use; not recommended if you publish this publicly — see the Development section below for a safer alternative.

## 🚀 Getting started

1. Install the extension.
2. Select some code in any file.
3. Run **AI Explainer: Explain Selected Code** (via any of the trigger methods above).
4. A short, one-sentence explanation pops up right next to your selection.

For a fuller explanation, run **AI Explainer: Explain Selected Code (Detailed Panel)** instead — it opens a side panel with as much detail as your `explanationDetail` setting asks for.

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `selectedCodeExplainerByAI.model` | `openrouter/free` | Model slug from [OpenRouter's catalog](https://openrouter.ai/models). `openrouter/free` auto-routes to whichever free model is currently available — OpenRouter's free model list rotates often, so this is the most reliable default. If you get a 404, check current models via **AI Explainer: Select AI Model**. |
| `selectedCodeExplainerByAI.explanationDetail` | `standard` | `brief`, `standard`, or `detailed`. Only applies to the detailed panel — the popup is always a single short sentence. |
| `selectedCodeExplainerByAI.responseLanguage` | `English` | Natural language of the explanation. |
| `selectedCodeExplainerByAI.temperature` | `0.3` | Model creativity/randomness (0–1). |
| `selectedCodeExplainerByAI.maxOutputTokens` | `1024` | Maximum explanation length for the detailed panel (the popup always uses a small fixed budget). |
| `selectedCodeExplainerByAI.displayMode` | `popup` | `popup`, `panel`, or `notification` — where **AI Explainer: Explain Selected Code** shows its result. |
| `selectedCodeExplainerByAI.includeSelectedCodeInPanel` | `true` | Show the original code in the detailed panel. |

You can also change the model quickly via **AI Explainer: Select AI Model**, which offers a quick-pick of OpenRouter's auto-routers plus a custom entry option (paste any slug from [openrouter.ai/models](https://openrouter.ai/models), e.g. `qwen/qwen3-coder:free` — verify it's still active first, since free slugs change frequently).

## 🧩 Commands

| Command | Keybinding |
|---|---|
| AI Explainer: Explain Selected Code | `Ctrl+Alt+E` / `Cmd+Alt+E` — shows a one-sentence popup next to the selection |
| AI Explainer: Explain Selected Code (Detailed Panel) | `Ctrl+Alt+Shift+E` / `Cmd+Alt+Shift+E` — opens the full side-panel explanation |
| AI Explainer: Regenerate Last Explanation | — |
| AI Explainer: Select AI Model | — |

## 🔒 Privacy

- Your selected code is sent **only** to OpenRouter (and, in turn, whichever underlying model provider you've selected) over HTTPS to generate the explanation — it is not sent to any other server.
- The extension collects no telemetry and makes no other network calls.

## 🛠 Development

```bash
git clone https://github.com/devraj-bhatta/selected-code-explainer-ai.git
cd selected-code-explainer-ai
npm install
npm run watch
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded, then select some code and try the commands.

### A safer key-handling alternative

Instead of hardcoding your OpenRouter key in the extension source, consider running a small proxy you control (a Cloudflare Worker or Vercel Function works well) that holds the real key server-side and forwards chat-completion requests. Point the extension at your proxy's URL instead of `openrouter.ai` directly. That way you can rate-limit or cut off individual users, rotate the real key without republishing, and avoid shipping a working credential inside a public `.vsix`.

### Project structure

```
selected-code-explainer-ai/
├── src/
│   ├── extension.ts       # Activation, command registration, orchestration
│   ├── aiService.ts       # OpenRouter chat-completions client (no dependencies)
│   ├── webviewPanel.ts    # Detailed explanation panel UI (HTML/CSS/JS)
│   ├── hoverPopup.ts      # Native hover-popup controller (default quick explanation)
│   └── statusBar.ts       # Status bar entry point
├── media/icon.png         # Marketplace icon
├── package.json           # Extension manifest (commands, menus, config)
└── tsconfig.json
```

## 📦 Publishing to the VS Code Marketplace

1. Confirm `publisher` in `package.json` (`devraj-bhatta`) matches your registered [Marketplace publisher ID](https://marketplace.visualstudio.com/manage).
2. Install the packaging tool if you haven't already: `npm install -g @vscode/vsce`.
3. Compile and package:
   ```bash
   npm run compile
   vsce package
   ```
   This produces a `.vsix` file you can install locally (`code --install-extension your-file.vsix`) or upload manually.
4. To publish directly:
   ```bash
   vsce login devraj-bhatta
   vsce publish
   ```

## 📄 License

MIT — see [LICENSE](LICENSE).

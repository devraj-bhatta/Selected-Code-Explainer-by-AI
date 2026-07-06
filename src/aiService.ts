import * as https from 'https';

/**
 * Options controlling how an explanation is generated.
 */
export interface ExplainOptions {
    apiKey: string;
    model: string;
    code: string;
    languageId: string;
    detailLevel: 'popup' | 'brief' | 'standard' | 'detailed';
    responseLanguage: string;
    temperature: number;
    maxOutputTokens: number;
}

/**
 * Thrown for any OpenRouter-related failure so the caller can show a
 * user-friendly, specific message instead of a generic error.
 */
export class AiServiceError extends Error {
    constructor(message: string, public readonly statusCode?: number) {
        super(message);
        this.name = 'AiServiceError';
    }
}

const API_HOST = 'openrouter.ai';
const API_PATH = '/api/v1/chat/completions';

// Sent as optional-but-recommended attribution headers by OpenRouter so
// requests show up correctly on https://openrouter.ai/rankings.
const APP_REFERRER = 'https://github.com/devraj-bhatta/selected-code-explainer-ai';
const APP_TITLE = 'Selected Code Explainer (AI)';

/**
 * Builds the system + user messages sent to the model, based on user
 * preferences for detail level and response language.
 */
function buildMessages(options: ExplainOptions): { system: string; user: string } {
    const detailInstructions: Record<ExplainOptions['detailLevel'], string> = {
        popup:
            'In ONE short sentence (max ~20 words), state what this code does. Be extremely concise. ' +
            'No headings, no bullet points, no code blocks, no restating the code — just the single sentence.',
        brief: 'Give a concise 2-3 sentence summary of what the code does. No headings, no line-by-line breakdown.',
        standard:
            'Explain what the code does in a clear paragraph, then list the key steps or logic as short bullet points.',
        detailed:
            'Provide an in-depth explanation: start with a one-paragraph summary of its purpose, then a line-by-line ' +
            'or block-by-block breakdown, and finally mention any edge cases, complexity, or potential issues you notice.'
    };

    const system = [
        'You are an expert software engineer and patient programming teacher.',
        `Respond entirely in ${options.responseLanguage}.`,
        'Format your response using Markdown (use backticks for identifiers, and fenced code blocks only if you must show a corrected/alternative snippet).',
        'Do not repeat the entire input code back verbatim.'
    ].join(' ');

    const user = [
        `Explain the following ${options.languageId || 'code'} snippet to a developer reading it for the first time.`,
        detailInstructions[options.detailLevel],
        ``,
        `Code:`,
        '```' + (options.languageId || ''),
        options.code,
        '```'
    ].join('\n');

    return { system, user };
}

/**
 * Calls the OpenRouter chat-completions REST endpoint and returns the
 * generated explanation text. Uses Node's built-in https module so the
 * extension has zero runtime dependencies.
 */
export function explainCode(options: ExplainOptions, token?: { isCancellationRequested: boolean }): Promise<string> {
    const { system, user } = buildMessages(options);

    const body = JSON.stringify({
        model: options.model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        temperature: options.temperature,
        max_tokens: options.maxOutputTokens
    });

    return new Promise<string>((resolve, reject) => {
        const req = https.request(
            {
                hostname: API_HOST,
                path: API_PATH,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    Authorization: `Bearer ${options.apiKey}`,
                    'HTTP-Referer': APP_REFERRER,
                    'X-Title': APP_TITLE
                },
                timeout: 30_000
            },
            (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (raw += chunk));
                res.on('end', () => {
                    if (token?.isCancellationRequested) {
                        reject(new AiServiceError('Cancelled by user.'));
                        return;
                    }

                    let parsed: any;
                    try {
                        parsed = JSON.parse(raw);
                    } catch {
                        reject(new AiServiceError('Received an unreadable response from OpenRouter.', res.statusCode));
                        return;
                    }

                    if (res.statusCode && res.statusCode >= 400) {
                        const apiMessage = parsed?.error?.message ?? 'Unknown error from OpenRouter.';
                        reject(new AiServiceError(mapApiError(res.statusCode, apiMessage), res.statusCode));
                        return;
                    }

                    const text = extractText(parsed);
                    if (!text) {
                        reject(
                            new AiServiceError(
                                'OpenRouter returned an empty response. The content may have been filtered, the model may be overloaded, or try again.'
                            )
                        );
                        return;
                    }

                    resolve(text.trim());
                });
            }
        );

        req.on('timeout', () => {
            req.destroy();
            reject(new AiServiceError('Request to OpenRouter timed out. Check your internet connection and try again.'));
        });

        req.on('error', (err) => {
            reject(new AiServiceError(`Network error while contacting OpenRouter: ${err.message}`));
        });

        req.write(body);
        req.end();
    });
}

function extractText(parsed: any): string | undefined {
    return parsed?.choices?.[0]?.message?.content;
}

function mapApiError(statusCode: number, apiMessage: string): string {
    switch (statusCode) {
        case 400:
            return `OpenRouter rejected the request (400): ${apiMessage}`;
        case 401:
            return 'The bundled OpenRouter API key was rejected (invalid or revoked). If you are the developer, check the key in src/extension.ts and its status at openrouter.ai/keys.';
        case 402:
            return 'OpenRouter says this model has run out of credits/quota. Try a free model (e.g. "openrouter/free") via "AI Explainer: Select AI Model", or add credits to the account.';
        case 403:
            return 'OpenRouter rejected this request as forbidden. The key may lack permission for this model.';
        case 404:
            return `The selected model was not found (404). Try a different model via "AI Explainer: Select AI Model". Details: ${apiMessage}`;
        case 429:
            return 'You have hit OpenRouter\'s rate limit for this model. Please wait a moment and try again, or switch to a different free model.';
        case 500:
        case 502:
        case 503:
            return 'OpenRouter (or the underlying model provider) is temporarily unavailable. Please try again in a moment, or pick a different model.';
        default:
            return `OpenRouter API error (${statusCode}): ${apiMessage}`;
    }
}

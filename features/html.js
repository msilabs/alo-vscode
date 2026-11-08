'use strict';

const vscode = require('vscode');
const { expressionRanges, isInside, htmlView } = require('../lib/embedded');

// VS Code's own HTML support only answers for HTML documents. So for each request we give it
// an HTML copy of the `.alo` file at a separate URI, ask it, and hand its answer back.
// This is the "request forwarding" pattern from the VS Code docs.
const SCHEME = 'alo-html';
const views = new Map();

function createView(document) {
    const text = document.getText();
    const ranges = expressionRanges(text);
    // The version in the URI makes VS Code read fresh text after every edit.
    const uri = vscode.Uri.from({
        scheme: SCHEME,
        path: '/' + encodeURIComponent(document.uri.toString()) + '.html',
        query: String(document.version),
    });
    views.set(uri.toString(), htmlView(text, ranges));
    return { uri, ranges };
}

async function askHtml(document, position, command, ...args) {
    const view = createView(document);
    try {
        if (isInside(document.offsetAt(position), view.ranges)) return undefined;
        // A user's `files.associations` (e.g. `"*.html": "django-html"`) can give the copy
        // another language, so the language is set by hand.
        let copy = await vscode.workspace.openTextDocument(view.uri);
        if (copy.languageId !== 'html') copy = await vscode.languages.setTextDocumentLanguage(copy, 'html');
        return await vscode.commands.executeCommand(command, copy.uri, position, ...args);
    } finally {
        views.delete(view.uri.toString());
    }
}

function registerHtmlFeatures(context) {
    const content = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
        provideTextDocumentContent: (uri) => views.get(uri.toString()) ?? '',
    });

    const completion = vscode.languages.registerCompletionItemProvider(
        'alo',
        {
            async provideCompletionItems(document, position, token, context) {
                const list = await askHtml(document, position, 'vscode.executeCompletionItemProvider', context.triggerCharacter);
                if (!list) return undefined;
                // Emmet answers in `.alo` files directly, so its answers from the HTML copy would show twice.
                const items = list.items.filter((item) => !/\bEmmet\b/i.test(item.detail ?? ''));
                return new vscode.CompletionList(items, list.isIncomplete);
            },
        },
        '.', ':', '<', '"', '=', '/',
    );

    const hover = vscode.languages.registerHoverProvider('alo', {
        async provideHover(document, position) {
            const hovers = await askHtml(document, position, 'vscode.executeHoverProvider');
            if (!hovers || hovers.length === 0) return undefined;
            return new vscode.Hover(hovers.flatMap((h) => h.contents), hovers[0].range);
        },
    });

    context.subscriptions.push(content, completion, hover);
}

module.exports = { registerHtmlFeatures };

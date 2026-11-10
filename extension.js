'use strict';

const vscode = require('vscode');
const { closingTag, expandBraces } = require('./lib/auto-insert');
const { registerHtmlFeatures } = require('./features/html');
const { registerStatus } = require('./features/status');
const { registerComponentFeatures } = require('./features/components');
const { Projects } = require('./features/projects');
const { registerDiagnostics } = require('./features/diagnostics');
const { registerQuickFixes } = require('./features/quick-fixes');
const { registerAssociations } = require('./features/associations');
const { registerExpressionFeatures } = require('./features/expressions');

function activate(context) {
    const log = vscode.window.createOutputChannel('Alo', { log: true });

    const showOutput = vscode.commands.registerCommand('alo.showOutput', () => log.show());

    const typing = vscode.workspace.onDidChangeTextDocument(autoInsert);

    const projects = new Projects(log);

    context.subscriptions.push(log, showOutput, typing, projects);
    registerHtmlFeatures(context);
    registerComponentFeatures(context, projects);
    registerExpressionFeatures(context, projects);
    const status = registerStatus(context, log, projects);
    registerDiagnostics(context, log, projects);
    registerQuickFixes(context, projects);
    registerAssociations(context, log);
    loadEmbeddedLanguageRules(context.extensionUri).catch((err) => log.error(err));

    // What other extensions (and our tests) get from `getExtension('msilabs.alo-vscode').exports`.
    return { status, projects };
}

// VS Code loads a language's comment, bracket and indent rules only once it sees that language,
// and it does not always notice the CSS and JS inside `.alo` files. Opening an empty file of each
// language, without showing it, makes it load them. Files on disk never ask to be saved.
// The HTML file also starts VS Code's HTML support early, before the first completion request.
// The language is set by hand because a user's `files.associations` may map `.js` or `.html`
// to something else.
const EMBEDDED_FILES = { 'empty.css': 'css', 'empty.js': 'javascript', 'empty.html': 'html' };

async function loadEmbeddedLanguageRules(extensionUri) {
    for (const [file, language] of Object.entries(EMBEDDED_FILES)) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(extensionUri, 'embedded', file));
        if (document.languageId !== language) await vscode.languages.setTextDocumentLanguage(document, language);
    }
}

function autoInsert(event) {
    // Undo and redo must not trigger new edits.
    if (event.reason !== undefined) return;
    if (event.document.languageId !== 'alo') return;
    if (event.contentChanges.length !== 1) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== event.document) return;

    const change = event.contentChanges[0];
    if (!['{', '{}', '>'].includes(change.text)) return;

    const document = event.document;
    const cursor = change.range.start.translate(0, 1);
    const before = document.getText(new vscode.Range(new vscode.Position(0, 0), cursor));
    const after = document.lineAt(cursor.line).text.slice(cursor.character);

    if (change.text === '>') {
        const close = closingTag(before, after);
        if (close) {
            const snippet = new vscode.SnippetString().appendTabstop(0).appendText(close);
            editor.insertSnippet(snippet, cursor);
        }
        return;
    }

    const braces = expandBraces(before, after);
    if (braces) {
        const range = new vscode.Range(
            cursor.translate(0, -braces.removeBefore),
            cursor.translate(0, braces.removeAfter),
        );
        const snippet = new vscode.SnippetString().appendText(braces.open).appendTabstop(0).appendText(braces.close);
        editor.insertSnippet(snippet, range);
    }
}

function deactivate() {}

module.exports = { activate, deactivate };

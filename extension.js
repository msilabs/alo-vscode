'use strict';

const vscode = require('vscode');
const { closingTag, expandBraces } = require('./lib/auto-insert');

function activate(context) {
    const hello = vscode.commands.registerCommand('alo.hello', () => {
        vscode.window.showInformationMessage('আলো এক্সটেনশন চালু আছে!');
    });

    const typing = vscode.workspace.onDidChangeTextDocument(autoInsert);

    context.subscriptions.push(hello, typing);
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

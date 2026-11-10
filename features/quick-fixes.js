'use strict';

const path = require('path');
const vscode = require('vscode');
const { quickFixes } = require('../lib/quick-fixes');

// The light bulb on Alo's squiggles: "Change to `<Card>`", "Change to `title`", "Create components/X.alo".
function registerQuickFixes(context, projects) {
    const provider = {
        provideCodeActions(document, range, codeActionContext) {
            const text = document.getText();
            const actions = [];

            for (const diagnostic of codeActionContext.diagnostics) {
                if (diagnostic.source !== 'alo') continue;
                const start = document.offsetAt(diagnostic.range.start);
                const end = document.offsetAt(diagnostic.range.end);

                for (const fix of quickFixes(text, start, end, diagnostic.message)) {
                    const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
                    action.diagnostics = [diagnostic];
                    // The preferred fix is the one "Auto Fix" (Shift+Alt+.) applies without asking.
                    action.isPreferred = Boolean(fix.preferred);
                    action.edit = new vscode.WorkspaceEdit();

                    for (const edit of fix.edits ?? []) {
                        const editRange = new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end));
                        action.edit.replace(document.uri, editRange, edit.newText);
                    }

                    if (fix.create) {
                        const root = projects.forFile(document.uri.fsPath)?.root;
                        if (!root) continue;
                        const uri = vscode.Uri.file(path.join(root, ...fix.create.file.split('/')));
                        // An empty file first, then its text: both in one edit, so a single undo removes it.
                        action.edit.createFile(uri, { ignoreIfExists: true });
                        action.edit.insert(uri, new vscode.Position(0, 0), fix.create.content);
                        // Runs after the edit: shows the new file.
                        action.command = { command: 'vscode.open', title: 'Open the new component', arguments: [uri] };
                    }
                    actions.push(action);
                }
            }
            return actions;
        },
    };

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('alo', provider, {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
        }),
    );
}

module.exports = { registerQuickFixes };

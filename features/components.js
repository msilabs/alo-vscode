'use strict';

const path = require('path');
const vscode = require('vscode');
const { findProjectRoot, loadCore, listComponents } = require('../lib/project');
const { componentNameStart } = require('../lib/component-completion');

// After `<`, suggests the project's components: `Card`, `Blog.PostCard`, ...
function registerComponentCompletion(context, log) {
    const provider = {
        provideCompletionItems(document, position) {
            if (document.uri.scheme !== 'file') return undefined;

            const start = componentNameStart(document.getText(), document.offsetAt(position));
            if (start < 0) return undefined;

            const root = findProjectRoot(document.uri.fsPath);
            if (!root) return undefined;

            let components;
            try {
                components = listComponents(root, loadCore(root));
            } catch (err) {
                log.warn(`Could not list components: ${err.message}`);
                return undefined;
            }

            // A component inside itself would never finish rendering.
            const self = path.relative(root, document.uri.fsPath).split(path.sep).join('/');
            // The typed part may contain dots (`Blog.Po`), which VS Code's own word range would cut off.
            const range = new vscode.Range(document.positionAt(start), position);

            return components
                .filter((component) => component.file !== self)
                .map((component) => {
                    const item = new vscode.CompletionItem(
                        { label: component.name, description: component.file },
                        vscode.CompletionItemKind.Class,
                    );
                    item.range = range;
                    item.detail = 'Alo component';
                    item.documentation = new vscode.MarkdownString(`\`<${component.name} />\` from \`${component.file}\``);
                    // Components come before HTML tags whenever both match equally well.
                    item.sortText = '0' + component.name;
                    return item;
                });
        },
    };

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider('alo', provider, '<', '.'));
}

module.exports = { registerComponentCompletion };

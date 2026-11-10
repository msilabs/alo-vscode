'use strict';

const vscode = require('vscode');
const { findProjectRoot, loadCore, summarize } = require('../lib/project');

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Shows which Alo core the editor uses for the active file, e.g. "Alo 1.0.0", in the status bar.
function registerStatus(context, log, projects) {
    const item = vscode.window.createStatusBarItem('alo.status', vscode.StatusBarAlignment.Right, 100);
    item.name = 'Alo';
    item.command = 'alo.showOutput';

    const reported = new Set();

    function update() {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.languageId !== 'alo' || document.uri.scheme !== 'file') {
            item.hide();
            return;
        }

        const root = findProjectRoot(document.uri.fsPath);
        if (!root) {
            item.text = '$(flame) Alo';
            item.tooltip = 'This file is not inside an Alo project: no `pages/` folder was found above it.';
            item.show();
            return;
        }

        const core = loadCore(root, { trusted: vscode.workspace.isTrusted });
        const from = core.source === 'project' ? "the project's node_modules" : 'the copy inside this extension';
        let details;
        try {
            const { pages, components } = summarize(root, core);
            details = `${count(pages, 'page')} · ${count(components, 'component')}`;
        } catch (err) {
            details = `Could not read the project: ${err.message}`;
        }

        let restricted = '';
        if (!vscode.workspace.isTrusted) {
            restricted =
                '\n\n**Restricted Mode:** errors are not checked here, because checking runs the code in your templates.' +
                (core.untrusted ? " The project's own Alo in node_modules is not used either." : '') +
                ' Trust the folder to turn this on.';
        }

        item.text = vscode.workspace.isTrusted ? `$(flame) Alo ${core.version}` : `$(shield) Alo ${core.version}`;
        item.tooltip = new vscode.MarkdownString(`**Alo ${core.version}** from ${from}\n\n${details}${restricted}\n\nClick to open the Alo log.`);
        item.show();

        const key = root + '|' + core.dir;
        if (!reported.has(key)) {
            reported.add(key);
            log.info(`Project ${root}: using Alo ${core.version} from ${core.dir}`);
            if (core.skipped) {
                log.warn(`Ignored Alo ${core.skipped.version} in ${core.skipped.dir}: this extension supports Alo 1.x.`);
            }
        }
    }

    context.subscriptions.push(item, vscode.window.onDidChangeActiveTextEditor(update), projects.onDidChange(update));
    update();
    return item;
}

module.exports = { registerStatus };

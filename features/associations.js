'use strict';

const vscode = require('vscode');
const { conflictingKeys, withoutKeys } = require('../lib/associations');

const DISMISSED = 'alo.associations.dismissed';

// Every settings level where `files.associations` opens `.alo` files as something else.
function findConflicts() {
    const conflicts = [];
    const add = (config, target, where, folder) => {
        const inspected = config.inspect('files.associations');
        const value = {
            [vscode.ConfigurationTarget.Global]: inspected?.globalValue,
            [vscode.ConfigurationTarget.Workspace]: inspected?.workspaceValue,
            [vscode.ConfigurationTarget.WorkspaceFolder]: inspected?.workspaceFolderValue,
        }[target];
        const keys = conflictingKeys(value);
        if (keys.length > 0) conflicts.push({ config, target, where, value, keys, folder });
    };

    add(vscode.workspace.getConfiguration(), vscode.ConfigurationTarget.Global, 'your user settings');
    add(vscode.workspace.getConfiguration(), vscode.ConfigurationTarget.Workspace, 'the workspace settings');
    // In a window with several folders, each folder can have its own `.vscode/settings.json`.
    if ((vscode.workspace.workspaceFolders ?? []).length > 1) {
        for (const folder of vscode.workspace.workspaceFolders) {
            add(vscode.workspace.getConfiguration(undefined, folder.uri), vscode.ConfigurationTarget.WorkspaceFolder, `${folder.name}/.vscode/settings.json`, folder);
        }
    }
    return conflicts;
}

// Removes the conflicting keys and switches already open `.alo` files to Alo.
async function useAlo() {
    for (const conflict of findConflicts()) {
        await conflict.config.update('files.associations', withoutKeys(conflict.value, conflict.keys), conflict.target);
    }
    for (const document of vscode.workspace.textDocuments) {
        if (document.uri.path.toLowerCase().endsWith('.alo') && document.languageId !== 'alo') {
            await vscode.languages.setTextDocumentLanguage(document, 'alo');
        }
    }
}

async function offerToFix(context, log) {
    const conflicts = findConflicts();
    if (conflicts.length === 0) return;
    const where = conflicts.map((c) => `${c.where} (\`${c.keys.join('`, `')}\`)`).join(' and ');
    log.warn(`files.associations in ${where} opens .alo files as another language.`);
    if (context.workspaceState.get(DISMISSED)) return;

    const choice = await vscode.window.showInformationMessage(
        `\`files.associations\` in ${where} opens .alo files as another language, so the Alo extension cannot help with them. Open them as Alo instead?`,
        'Use Alo',
        'Not Now',
        "Don't Ask Again",
    );
    if (choice === 'Use Alo') await useAlo();
    if (choice === "Don't Ask Again") await context.workspaceState.update(DISMISSED, true);
}

function registerAssociations(context, log) {
    context.subscriptions.push(vscode.commands.registerCommand('alo.useAloForAloFiles', useAlo));
    offerToFix(context, log).catch((err) => log.error(err));
}

module.exports = { registerAssociations, findConflicts };

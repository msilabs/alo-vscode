'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { checkProject, problemRange } = require('../lib/diagnostics');

// How long to wait after the last keystroke before checking. Checking renders the whole site.
const DELAY = 400;

const toPosition = ({ line, character }) => new vscode.Position(line, character);

// Shows Alo's errors and warnings as squiggles and in the Problems panel, while you type.
function registerDiagnostics(context, log, projects) {
    const collection = vscode.languages.createDiagnosticCollection('alo');
    const caches = new Map(); // root → { sfc, data }, kept between checks
    const shown = new Map(); // root → the URIs that currently have problems
    const timers = new Map(); // root → the pending check
    const known = new Set(); // every project root seen, to check again when files or trust change

    function rootOf(document) {
        if (document.uri.scheme !== 'file') return null;
        return projects.forFile(document.uri.fsPath)?.root ?? null;
    }

    // The text of every open file in the project, saved or not.
    function openTexts(root) {
        const texts = new Map();
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme !== 'file') continue;
            const relative = path.relative(root, document.uri.fsPath);
            if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
            texts.set(relative.split(path.sep).join('/'), document.getText());
        }
        return texts;
    }

    function toDiagnostic(problem, text, root) {
        const { start, end } = problemRange(text, problem.line, problem.column);
        const message = problem.hint ? `${problem.message}\n${problem.hint}` : problem.message;
        const severity = problem.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const diagnostic = new vscode.Diagnostic(new vscode.Range(toPosition(start), toPosition(end)), message, severity);
        diagnostic.source = 'alo';
        // An error inside a component also points to the page that used it.
        const from = problem.calledFrom;
        if (from?.file) {
            const where = new vscode.Position(Math.max(0, (from.line ?? 1) - 1), Math.max(0, (from.column ?? 1) - 1));
            const uri = vscode.Uri.file(path.join(root, ...from.file.split('/')));
            diagnostic.relatedInformation = [new vscode.DiagnosticRelatedInformation(new vscode.Location(uri, where), 'Used here')];
        }
        return diagnostic;
    }

    function forget(root) {
        for (const uri of (shown.get(root) ?? new Map()).values()) collection.delete(uri);
        shown.delete(root);
    }

    function check(root) {
        // Checking renders the site, which runs the JavaScript in `{{ }}`: only in a trusted folder.
        if (!vscode.workspace.isTrusted) return forget(root);
        const project = projects.forFile(path.join(root, '_'));
        if (!project) return;
        if (!caches.has(root)) caches.set(root, { sfc: new Map(), data: new Map() });

        const texts = openTexts(root);
        let problems;
        try {
            problems = checkProject(root, project.core, texts, caches.get(root));
        } catch (err) {
            // Not an Alo error: a bug in Alo or in this extension. Keep the old squiggles.
            log.error(`Checking ${root} failed: ${err.stack ?? err}`);
            return;
        }

        const byFile = new Map();
        for (const problem of problems) {
            if (!problem.file) {
                log.warn(problem.hint ? `${problem.message} ${problem.hint}` : problem.message);
                continue;
            }
            const uri = vscode.Uri.file(path.join(root, ...problem.file.split('/')));
            let text = texts.get(problem.file);
            if (text === undefined) {
                try {
                    text = fs.readFileSync(uri.fsPath, 'utf8');
                } catch {
                    text = '';
                }
            }
            const entry = byFile.get(uri.toString()) ?? { uri, diagnostics: [] };
            entry.diagnostics.push(toDiagnostic(problem, text, root));
            byFile.set(uri.toString(), entry);
        }

        for (const [key, uri] of shown.get(root) ?? []) {
            if (!byFile.has(key)) collection.delete(uri);
        }
        for (const { uri, diagnostics } of byFile.values()) collection.set(uri, diagnostics);
        shown.set(root, new Map([...byFile].map(([key, { uri }]) => [key, uri])));
    }

    // Waits until typing pauses, so a fast typist does not trigger a check per keystroke.
    function schedule(root) {
        known.add(root);
        clearTimeout(timers.get(root));
        timers.set(
            root,
            setTimeout(() => {
                timers.delete(root);
                check(root);
            }, DELAY),
        );
    }

    function scheduleFor(document) {
        const root = rootOf(document);
        if (root) schedule(root);
    }

    context.subscriptions.push(
        collection,
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'alo') scheduleFor(document);
        }),
        // Any file in the project counts: data JSON and Markdown, global CSS, not just `.alo`.
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.contentChanges.length > 0) scheduleFor(event.document);
        }),
        vscode.workspace.onDidSaveTextDocument(scheduleFor),
        // Closing an unsaved file throws its changes away, so the disk version counts again.
        vscode.workspace.onDidCloseTextDocument(scheduleFor),
        projects.onDidChange(() => {
            for (const root of known) schedule(root);
        }),
        { dispose: () => timers.forEach(clearTimeout) },
    );

    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'alo') scheduleFor(document);
    }
    return collection;
}

module.exports = { registerDiagnostics };

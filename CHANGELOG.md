# Changelog

## 0.1.2

Security fixes, after Socket.dev flagged two risks in 0.1.1, and one new feature.

- In a project made with `adhar init --web`, **Alo: Start Dev Server** runs `adhar dev` from the project root, so `/api` works while you edit the site.

- The copy of Alo that comes with the extension is now Alo 1.2.2:
    - Expressions in `{{ }}`, `if`, `else-if` and `for` no longer run through `new Function`. Alo reads them with its own parser and evaluator, with an allowlist of globals and methods. `constructor`, `__proto__`, `prototype`, `process`, `require` and `globalThis` are blocked. Error messages are fixed text; no expression is run a second time to find an error.
    - Markdown no longer passes raw HTML through. It is escaped by default. Links keep only `http`, `https` and `mailto`; images keep only `http` and `https`. Attribute values are always escaped.
    - `node:vm` is no longer used for `<script>`.
- `alo dev` and `alo build` started from the editor now get only the environment variables they need, not the editor's whole environment.
- A project's own `node_modules/@msilabs/alo` is used only from Alo 1.2.1, the first version with these fixes. An older one is ignored with a warning in the log, and the bundled copy is used instead.
- New tests for the XSS and expression payloads against the bundled copy.
- README: what the extension runs, which environment variables it reads, and that it makes no network calls of its own.

## 0.1.1

- The copy of Alo that comes with the extension is now Alo 1.1.0:
    - A component in a folder written without its folder, like `<PostCard />` for `components/blog/PostCard.alo`, now suggests the full name, and the quick fix changes the tag to `<Blog.PostCard>`.
    - A lowercase tag with a dot, like `<blog.PostCard>`, is an error with the right spelling as its hint.
- README: badges, and a note that only projects made with an older `alo init` open `.alo` files as HTML.

## 0.1.0

First release.

- `.alo` language with highlighting for `{{ }}`, `{{{ }}}`, template logic and component tags, and CSS and JS inside `<style>` and `<script>`.
- Snippets, Emmet, HTML suggestions and hovers, and `{{` becoming `{{ | }}`.
- Component, prop, `data.`, `item.`, `props.` and loop variable suggestions; go to component and data files; hovers with a component's props.
- Alo's errors and warnings while typing, with quick fixes for its suggestions.
- CodeLens with each page's URL and each layout's page count.
- Commands: New…, Start/Stop Dev Server, Open Dev Server in Browser, Build, Open .alo Files as Alo, Show Log.
- Uses the project's own Alo 1.x when installed, and a bundled copy otherwise.
- Limited support for Restricted Mode: no project code runs in untrusted folders.

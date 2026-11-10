# Changelog

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

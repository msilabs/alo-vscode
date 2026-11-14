# Alo project: instructions for AI assistants

This is an Alo project. Alo is a small static site framework: you write `.alo` files (plain HTML with a few extras), and `node alo build` produces plain HTML, CSS and JS in `dist/`. You probably have no training data about Alo, so do not guess from React, Vue, Astro, Svelte or Jinja. Follow this file.

## Hard rules

- No `import`, no config file, no plugins. Everything comes from folder and file names.
- Never add `<link rel="stylesheet">` or `<script src>` for local files. CSS and JS are collected and linked automatically.
- Loops and conditions exist only as `<template for>`, `<template if>`, `<template else-if>`, `<template else>`. Never put `for` or `if` on `<li>`, `<div>`, `<Card>` or any other tag.
- `{{ }}` runs once at build time. It is not a browser runtime and is not reactive. Anything that changes after the page loads goes in a `<script>`.
- Inside a component, read props only as `props.title`. Never write bare `{{ title }}`. The `class` and `id` props are not added to the root element automatically; write `class="card {{ props.class }}"` yourself.
- Components do not see `item`. Pass it as a prop: `<Blog.PostMeta post="{{ item }}" />`.
- `{{{ }}}` (unescaped HTML) works only in text position, never in attributes or props. Use it only for `item.body`.
- Use `props.x`, `data.x`, `route.path`, `item` (only in `[slug]` pages) and nothing else as globals.

## Project layout

```
pages/
  layout.alo            wraps every page below it; exactly one <slot />
  page.alo              /
  not-found.alo         /404.html
  about/page.alo        /about/
  blog/layout.alo       extra layout for /blog/...
  blog/page.alo         /blog/
  blog/[slug]/page.alo  one page per item in data/blog/
  (group)/...           route group: not in the URL, but its layout applies
components/             Card.alo -> <Card />, blog/PostCard.alo -> <Blog.PostCard />
data/                   site.json -> data.site, blog/*.md -> data.blog (array)
global/                 .css and .js files that apply to every page
public/                 copied to dist/ byte for byte
```

- Component files and folders: `PascalCase.alo` files; a kebab-case folder becomes PascalCase (`post-list/Item.alo` -> `<PostList.Item />`).
- A component in a folder is always written with its full name, from anywhere, even from a component in the same folder: inside `components/blog/PostList.alo` write `<Blog.PostCard />`, never `<PostCard />`. The closing tag too: `</Blog.PostCard>`.
- The dynamic folder is always named `[slug]`, one level only, and it must be the last path segment.
- Start a tag with a capital letter for a component, lower case for HTML.

## A `.alo` file

Up to four top-level blocks, all optional. Nothing else may sit outside them.

```html
<head>
    <title>About | {{ data.site.name }}</title>
</head>

<template>
    <h1>About</h1>
    <Card title="Mission" class="mt-4">
        <p>Slot content</p>
    </Card>
</template>

<style>
    h1 { color: tomato; }
</style>

<script>
    console.log('page loaded');
</script>
```

- Do not write `<html>`, `<head>` or `<body>` inside `<template>`. Alo adds charset, viewport and the document shell.
- Components cannot have a `<head>` block. Layouts must contain exactly one `<slot />`. Components may have at most one `<slot />`, and `<slot>` takes no attributes (no named slots).

## Templates

```html
<p>{{ data.blog.length }} posts</p>
<a href="/blog/{{ post.slug }}/">{{ post.title }}</a>

<ul>
    <template for="(post, i) in data.blog">
        <li>{{ i + 1 }}. {{ post.title }}</li>
    </template>
</ul>

<template if="stock > 10"><span>In stock</span></template>
<template else-if="stock > 0"><span>Only {{ stock }} left</span></template>
<template else><span>Sold out</span></template>
```

- `{{ }}` holds plain JavaScript. The result is HTML-escaped. `null` and `undefined` print nothing. Write a literal `{{` as `\{{`.
- `{{ }}` is not processed inside `<script>` or `<style>`, and not inside Markdown files.
- Data is deeply frozen. Do not call `push`, `sort`, `reverse` on it; use `toSorted()`, `toReversed()` or a copy.
- Attribute whose whole value is one `{{ }}`: `null`/`undefined` removes the attribute; for `disabled`, `checked`, `hidden`, `open` a falsy value removes it.
- Props: `title="Hi"` is the string `"Hi"`. `post="{{ post }}"` and `count="{{ 5 }}"` pass the real value (object, number). `label="Post: {{ x }}"` is always a string. `featured` with no value is `true`. `post-date="x"` is read as `props.postDate`.
- Always write links as `/about/` (leading and trailing slash). With `--base /repo/` Alo prefixes them.

## Data

- A file is its value: `data/site.json` -> `data.site`; `footer-links.json` -> `data.footerLinks`.
- A folder containing only files is an array, sorted by file name: `data/blog/2026-01-10-hello-world.md` gives `item.date = "2026-01-10"` and `item.slug = "hello-world"`.
- A folder containing subfolders is an object.
- Markdown front matter is a small YAML subset (`key: value`, strings, numbers, booleans, simple lists). Use `.json` for nested data. `draft: true` hides the item in `build` but not in `dev`.
- The Markdown body is `item.body`; print it with `{{{ item.body }}}`.
- `data/site.json` holds `name`, `lang`, and `url` (an origin without trailing slash; needed for `sitemap.xml`).

## CSS and JavaScript

- `<style>` is scoped to its own file. `<style global>` is not scoped. A file may have one of each.
- A parent's scoped CSS does not reach a child component, not even its root. Pass `class` as a prop and style that class in the component's own `<style>` (`.card.highlight`) or in the parent's `<style global>`.
- Scoped styles cannot target `:root`, `html` or `body`. Put those in `global/*.css` or `<style global>`.
- A component `<script>` runs once per instance. `$el` is the component's root element. Pass build-time data with `data-*`: `data-start="{{ props.start }}"`, read `$el.dataset.start`.
- Page and layout scripts have no `$el`; use `document.querySelector`.
- `global/*.js` runs on every page, before everything else.
- There is no reactive runtime. For more, add a library such as Alpine.js with a `<script>` in `<head>`; Alo leaves `x-data`, `@click`, `:class` untouched.

## Commands

```
node alo dev                       dev server with live reload (http://localhost:3000)
node alo build                     production build into dist/
node alo build --base /repo/       build for a sub-path such as GitHub Pages
node alo new page blog/first-post
node alo new layout blog
node alo new component Card
node alo new post blog/hello-world
```

- Never edit `dist/` or `.alo/`; they are generated.
- After you change files, run `node alo build`. It exits with code 1 on any error and keeps the old `dist/`.
- Errors show the file, line, a code frame and a hint (for example "Did you mean `<Card>`?"). Read the hint and fix that exact spot. Warnings (unused component, prop typo) are worth fixing too.
- Terminal messages are in English.

## Common mistakes

| Wrong | Right |
| --- | --- |
| `<li for="p in posts">` | `<template for="p in posts"><li>...</li></template>` |
| `{{ title }}` in a component | `{{ props.title }}` |
| `<Card :post="post" />` | `<Card post="{{ post }}" />` |
| `import Card from './Card.alo'` | nothing; `<Card />` just works |
| `<PostCard />` for `components/blog/PostCard.alo` | `<Blog.PostCard />`, also inside `components/blog/` |
| `<blog.PostCard />` | `<Blog.PostCard />` |
| `<link rel="stylesheet" href="style.css">` | put CSS in `<style>` or `global/` |
| `{{ item.title }}` inside a component | pass `item` as a prop |
| `href="about"` or `href="/about"` | `href="/about/"` |
| `{{{ x }}}` in an attribute | `{{ x }}` |
| `posts.reverse()` on data | `posts.toReversed()` |
| `<slot name="header">` | not supported; pass props or use a child component |

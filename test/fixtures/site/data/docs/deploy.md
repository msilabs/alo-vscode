---
title: ডিপ্লয়
description: dist/ ফোল্ডারটিই পুরো সাইট। যেকোনো স্ট্যাটিক হোস্টে তুলে দিলেই চলে।
---

## যা লাগে

`node alo build` চালালে `dist/` ফোল্ডারে তৈরি হয় সাধারণ HTML, CSS আর JS ফাইল। সার্ভারে Node.js বা অন্য কিছু চালাতে হয় না।

## Netlify বা Cloudflare Pages

রিপোজিটরি যুক্ত করে এই দুটি মান দিন:

| সেটিং | মান |
| --- | --- |
| বিল্ড কমান্ড | `npm run build` |
| publish ফোল্ডার | `dist` |

## cPanel বা সাধারণ হোস্টিং

নিজের কম্পিউটারে বিল্ড করুন:

```bash
node alo build
```

তারপর `dist/`-এর **ভেতরের** সবকিছু `public_html`-এ আপলোড করুন।

## GitHub Pages

সাইট থাকে `https://<user>.github.io/<repo>/`-এ, মানে একটি সাব-পাথে। তাই `--base` দিন।

### ওয়ার্কফ্লো ফাইল

`.github/workflows/pages.yml`:

```yaml
name: Pages
on:
    push:
        branches: [main]
permissions:
    contents: read
    pages: write
    id-token: write
jobs:
    deploy:
        runs-on: ubuntu-latest
        environment:
            name: github-pages
            url: ${{ steps.deployment.outputs.page_url }}
        steps:
            - uses: actions/checkout@v7
            - uses: actions/setup-node@v7
              with:
                  node-version: 24
            - run: npm ci
            - run: node alo build --base /my-repo/
            - uses: actions/configure-pages@v6
            - uses: actions/upload-pages-artifact@v5
              with:
                  path: dist
            - id: deployment
              uses: actions/deploy-pages@v5
```

`/my-repo/`-এর জায়গায় দিন আপনার রিপোজিটরির নাম।

### GitHub-এর সেটিং

রিপোজিটরির Settings → Pages-এ গিয়ে Source হিসেবে বেছে নিন **GitHub Actions**। এরপর `main`-এ push করলেই সাইট প্রকাশ হয়।

ধাপে ধাপে বিস্তারিত আছে [ব্লগের এই লেখায়](/blog/deploy-to-github-pages/)।

## সাব-পাথে রাখলে

- টেমপ্লেটে লিংক সবসময় লিখুন `/about/`-এর মতো করে; `--base` দিলে Alo নিজেই `/my-repo/about/` বানায়।
- JS থেকে base জানতে: `document.documentElement.dataset.base ?? '/'`।
- নিজের কম্পিউটারে একইভাবে দেখতে: `node alo dev --base /my-repo/`।

বিস্তারিত: [বিল্ড আর আউটপুট](/docs/build/#base-path)।

## নিজের ডোমেইন

নিজের ডোমেইনের রুটে সাইট রাখলে `--base` লাগে না। `data/site.json`-এ `url` দিন, যাতে `sitemap.xml` তৈরি হয়:

```json
{
    "url": "https://example.com"
}
```

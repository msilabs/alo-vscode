---
title: GitHub Pages-এ সাইট প্রকাশ
description: একটি workflow ফাইল আর একটি ফ্ল্যাগ দিয়ে বিনামূল্যে সাইট অনলাইনে।
tags: [গাইড, ডিপ্লয়]
---

`node alo build` চালালে `dist/` ফোল্ডারে তৈরি হয় পুরো সাইট। এই ফোল্ডারটি যেকোনো হোস্টিংয়ে রাখলেই চলে। এখানে দেখাচ্ছি GitHub Pages, যেখানে প্রতিবার `main`-এ push করলে সাইট নিজে থেকে আপডেট হবে।

## সাব-পাথ আর `--base`

GitHub Pages-এ সাইট থাকে `https://<user>.github.io/<repo>/` ঠিকানায়, মানে ডোমেইনের মূলে নয়, একটি সাব-পাথে। এর জন্য কোনো কনফিগারেশন লাগে না, শুধু বিল্ডের সময় পাথটি বলে দিন:

```bash
node alo build --base /my-repo/
```

টেমপ্লেটে লিংক সবসময় লিখুন `/about/`-এর মতো করে। বিল্ডের সময় আলো নিজেই সব লিংক, ছবি, CSS আর JS-এর সামনে `/my-repo/` বসিয়ে দেয়।

## ধাপ ১: Pages চালু করা

GitHub-এ রিপোজিটরির **Settings → Pages**-এ গিয়ে **Source** হিসেবে বেছে নিন **GitHub Actions**।

## ধাপ ২: workflow ফাইল

প্রজেক্টে `.github/workflows/pages.yml` ফাইলটি বানান। `/my-repo/`-এর জায়গায় আপনার রিপোজিটরির নাম দিন:

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

## ধাপ ৩: push

ফাইলটি commit করে push করুন। রিপোজিটরির **Actions** ট্যাবে বিল্ড চলতে দেখা যাবে, আর এক-দুই মিনিটের মধ্যে সাইট চলে আসবে `https://<user>.github.io/my-repo/`-এ।

## sitemap

সার্চ ইঞ্জিনের জন্য `sitemap.xml` চাইলে `data/site.json`-এ `url` দিন। এখানে শুধু origin থাকবে, পাথ নয়, কারণ পাথ আসে `--base` থেকে:

```json
{
    "url": "https://<user>.github.io"
}
```

---
title: বিল্ড আর আউটপুট
description: node alo build কী বানায়, আর কোন কাজগুলো নিজে থেকে হয়ে যায়।
---

## বিল্ড

```bash
node alo build
```

পুরো সাইট তৈরি হয় `dist/` ফোল্ডারে। ফোল্ডারের নাম সবসময় `dist`। বিল্ডে এরর হলে পুরনো `dist/` অক্ষত থাকে।

```
dist/
├── index.html
├── about/index.html
├── blog/hello-world/index.html
├── 404.html
├── sitemap.xml
├── robots.txt
├── favicon.ico                  ← public/ থেকে
└── assets/
    ├── style.3f9a1c2b.css
    ├── global.8d41e07a.js
    ├── components.c2b6f913.js
    └── pages/
        └── contact.5a07d3e1.js
```

## যা নিজে থেকে হয়

এগুলোর কিছুই শিখতে বা চালু করতে হয় না:

- CSS মিনিফাই হয়।
- CSS আর JS ফাইলের নামে কনটেন্টের হ্যাশ বসে, তাই ব্রাউজার নিশ্চিন্তে ক্যাশ করতে পারে।
- `sitemap.xml` আর `robots.txt` তৈরি হয়।
- `public/`-এর সবকিছু হুবহু কপি হয়।
- খসড়া আইটেম (`draft: true`) বাদ যায়।

`dev` সবসময় দেয় পড়ার মতো আউটপুট: হ্যাশ ছাড়া, মিনিফাই না করা, খসড়াসহ।

## `public/` ফোল্ডার

ছবি, ফন্ট, favicon রাখুন `public/`-এ। কোনো প্রসেসিং ছাড়া সেগুলো `dist/`-এর রুটে কপি হয়:

| ফাইল | ঠিকানা |
| --- | --- |
| `public/favicon.ico` | `/favicon.ico` |
| `public/images/logo.svg` | `/images/logo.svg` |

`public/`-এর ফাইলের নামে হ্যাশ বসে না।

## base path

সাইট যদি ডোমেইনের রুটে না থেকে সাব-পাথে থাকে, যেমন GitHub Pages-এর `https://user.github.io/my-repo/`, তাহলে `--base` দিন:

```bash
node alo build --base /my-repo/
node alo dev --base /my-repo/
```

টেমপ্লেটে লিংক সবসময় লিখুন `/about/`-এর মতো করে; Alo নিজেই `/my-repo/about/` বানায়। base বসে এসব জায়গায়, যখন মান `/` দিয়ে শুরু হয়:

- `href`, `src`, `action`, `poster`, `srcset`-এর মতো অ্যাট্রিবিউট
- ইনলাইন `style` আর CSS ফাইলের `url(/...)`
- Markdown-এর লিংক আর ছবি

`route.path`-এ base থাকে না, তাই মেনুর সক্রিয় লিংক মেলানো (`route.path === link.href`) সবসময় কাজ করে। কনফিগারেশন ফাইল নেই বলে base সবসময় আসে এই ফ্ল্যাগ থেকে।

## `sitemap.xml`

`data/site.json`-এ `url` থাকলে `sitemap.xml` তৈরি হয়:

```json
{
    "url": "https://example.com"
}
```

- `url`-এ থাকে শুধু origin, শেষে `/` ছাড়া। পাথ দিতে হলে `--base` ব্যবহার করুন।
- এতে থাকে সব পেইজ, শুধু `404.html` বাদে।
- কোনো পেইজ বাদ দিতে তার `<head>`-এ লিখুন:

```html
<meta name="robots" content="noindex">
```

## `robots.txt`

নিজে থেকে তৈরি হয়, সব পেইজের অনুমতি আর sitemap-এর ঠিকানাসহ।

নিজের `robots.txt` বা `sitemap.xml` চাইলে ফাইলটি `public/`-এ রাখুন; তখন Alo সেটিই ব্যবহার করে।

## যা মিনিফাই হয় না

JS আর HTML মিনিফাই হয় না। নিরাপদ JS মিনিফায়ারের জন্য পুরো JS পার্সার লাগে, অথচ ছোট সাইটে লাভ সামান্য। HTML-এর হোয়াইটস্পেস হুবহু রাখতে হয়।

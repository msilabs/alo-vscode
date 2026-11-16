---
title: ডেটা
description: data/ ফোল্ডারের JSON আর Markdown ফাইল সব জায়গায় পাওয়া যায় data নামে, কোনো import ছাড়া।
---

## ফাইল থেকে `data`

`data/` ফোল্ডারের সবকিছু সব পেইজ, লেআউট আর কম্পোনেন্টে `data` হিসেবে পাওয়া যায়:

| ফাইল | পাওয়া যায় |
| --- | --- |
| `data/site.json` | `data.site` |
| `data/footer-links.json` | `data.footerLinks` |
| `data/blog/*.md`, `*.json` | `data.blog` (অ্যারে) |
| `data/shop/products/*.json` | `data.shop.products` |

```html
<footer>
    <template for="link in data.footerLinks">
        <a href="{{ link.href }}">{{ link.label }}</a>
    </template>
</footer>
```

## তিনটি নিয়ম

1. **ফাইল মানে তার মান।** `data/team.json` হয় `data.team`।
2. **শুধু ফাইলে ভর্তি ফোল্ডার মানে অ্যারে।** `data/blog/` হয় `data.blog`। একই ফোল্ডারে JSON আর Markdown মেশানো যায়।
3. **সাবফোল্ডারওয়ালা ফোল্ডার মানে অবজেক্ট।** `data/shop/products/` হয় `data.shop.products`।

নামে `-` থাকলে key হয় camelCase: `footer-links.json` থেকে `data.footerLinks`। নামে চলে ছোট হাতের অক্ষর, সংখ্যা আর হাইফেন।

## ফাইলের ধরন

- `.json`: পুরো ফাইলটিই মান।
- `.md`: ফ্রন্ট ম্যাটারের ফিল্ডগুলো, আর সাথে `body` (রেন্ডার করা HTML)। বিস্তারিত [Markdown কনটেন্ট](/docs/markdown/) পেইজে।

## অ্যারে ফোল্ডার

অ্যারের আইটেমগুলো সাজানো থাকে ফাইলের নাম অনুযায়ী, আর প্রতিটি আইটেম নিজে থেকে কিছু ফিল্ড পায়:

- **`slug`:** ফাইলের নাম, এক্সটেনশন ছাড়া। `hello-world.md` থেকে `"hello-world"`।
- **`date`:** নামের শুরুতে তারিখ থাকলে সেটি। `2026-01-10-hello-world.md` থেকে `item.date` হয় `"2026-01-10"`, আর `item.slug` হয় `"hello-world"`।

### ক্রম

- তারিখ দিয়ে নাম দিলে আইটেম আসে পুরনো থেকে নতুন ক্রমে।
- ক্রম নিজে ঠিক করতে নামের শুরুতে সংখ্যা দিন: `01-…`, `02-…`।

নতুনটি আগে দেখাতে বা কয়েকটি নিতে সাধারণ JS লিখুন:

```html
<!-- হোমে সর্বশেষ ৩টি পোস্ট, নতুনটি আগে -->
<Blog.PostList posts="{{ data.blog.toReversed().slice(0, 3) }}" />
```

### খসড়া

আইটেমে `draft: true` থাকলে সেটি `build`-এ আসে না, শুধু `dev`-এ দেখা যায়।

## সাইটের সেটিংস

`data/site.json`-এ থাকে সাইটের সেটিংস:

```json
{
    "name": "আমার সাইট",
    "lang": "bn",
    "url": "https://example.com"
}
```

| ফিল্ড | কাজ |
| --- | --- |
| `name` | ডিফল্ট শিরোনাম |
| `lang` | বসে `<html lang>`-এ; ডিফল্ট `bn` |
| `url` | দিলে `sitemap.xml` তৈরি হয়; শুধু origin, শেষে `/` ছাড়া |

বাকি ফিল্ড ইচ্ছামতো রাখুন, যেমন `description` বা `repository`; সেগুলো পড়া যায় `data.site.description` দিয়ে।

## ডেটা বদলানো যায় না

সব ডেটা অপরিবর্তনীয়। `data.blog.reverse()`, `sort()` বা `push()` লিখলে Alo এরর দেখায়। বদলে নতুন মান বানান: `toReversed()`, `toSorted()` বা `slice()`।

এতে এক পেইজের সাজানো অন্য পেইজের ক্রম বদলে দেয় না।

## JS-এ ডেটা পাঠানো

`data` শুধু বিল্ডের সময় পাওয়া যায়, ব্রাউজারে নয়। ব্রাউজারের JS-এ কোনো মান লাগলে সেটি বসান HTML-এর `data-*` অ্যাট্রিবিউটে:

```html
<template>
    <div class="counter" data-start="{{ props.start ?? 0 }}">
        <button>+</button> <span></span>
    </div>
</template>

<script>
    let n = Number($el.dataset.start);
</script>
```

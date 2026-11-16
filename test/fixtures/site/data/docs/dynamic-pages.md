---
title: ডায়নামিক পেইজ
description: একটি [slug] ফোল্ডার দিয়ে data/ ফোল্ডারের প্রতিটি আইটেমের জন্য আলাদা পেইজ।
---

## এক ফাইল, অনেক পেইজ

`pages/blog/[slug]/page.alo` প্রতিটি `data/blog/` আইটেমের জন্য একটি পেইজ বানায়। আইটেমটি পাওয়া যায় `item`-এ:

```html
<!-- pages/blog/[slug]/page.alo -->
<head>
    <title>{{ item.title }} | {{ data.site.name }}</title>
</head>

<template>
    <article>
        <h1>{{ item.title }}</h1>
        <time>{{ item.date }}</time>
        {{{ item.body }}}
    </article>
</template>
```

| ফাইল | পেইজ |
| --- | --- |
| `data/blog/2026-01-10-hello-world.md` | `/blog/hello-world/` |
| `data/blog/2026-02-01-second-post.md` | `/blog/second-post/` |
| `data/blog/third-post.json` | `/blog/third-post/` |

## কোন ডেটা থেকে

পেইজের পাথই ডেটার পাথ: `pages/<পাথ>/[slug]/` পড়ে `data/<পাথ>/` থেকে। রাউট গ্রুপ এখানে গোনা হয় না:

- `pages/blog/[slug]/page.alo` পড়ে `data/blog/`
- `pages/(site)/blog/[slug]/page.alo`-ও পড়ে `data/blog/`

ফোল্ডারটি অ্যারে হতে হবে, মানে তাতে শুধু ফাইল থাকবে। ফোল্ডার না থাকলে বা খালি থাকলে Alo এরর দেখায়।

## `item`

`item`-এ থাকে ফাইলের সব ফিল্ড, আর সাথে:

- `item.slug`: URL-এর অংশ, ফাইলের নাম থেকে (তারিখ বাদ দিয়ে)।
- `item.date`: ফাইলের নামের শুরুতে তারিখ থাকলে।
- `item.body`: Markdown ফাইল হলে, রেন্ডার করা HTML।

কম্পোনেন্ট `item` দেখে না; দরকার হলে প্রপ দিয়ে পাঠান:

```html
<Blog.PostMeta post="{{ item }}" />
```

## তালিকার পেইজ

পোস্টের তালিকা বানাতে একই ডেটার ওপর লুপ চালান:

```html
<!-- pages/blog/page.alo -->
<template>
    <h1>ব্লগ</h1>
    <template for="post in data.blog.toReversed()">
        <a href="/blog/{{ post.slug }}/">{{ post.title }}</a>
    </template>
</template>
```

## নিয়ম

- ডায়নামিক ফোল্ডারের নাম সবসময় `[slug]`। `[id]` বা অন্য নাম চলে না।
- `[slug]` একটি পাথে থাকে একবারই, আর সেটি পাথের শেষ ফোল্ডার।
- খসড়া আইটেমের (`draft: true`) পেইজ তৈরি হয় শুধু `dev`-এ।
- কোনো আইটেমের slug আর একটি সাধারণ পেইজের URL মিলে গেলে Alo দুটি ফাইলের নামসহ এরর দেখায়।

## এই ডকস নিজেই উদাহরণ

আপনি যে পেইজটি পড়ছেন, সেটিও এভাবে তৈরি: `pages/(site)/docs/[slug]/page.alo` একটি ফাইল, আর `data/docs/`-এর প্রতিটি Markdown ফাইল একটি পেইজ।

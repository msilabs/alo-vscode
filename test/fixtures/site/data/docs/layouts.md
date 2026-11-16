---
title: লেআউট
description: হেডার, ফুটারের মতো যা অনেক পেইজে একই থাকে, তা একবার লিখুন layout.alo ফাইলে।
---

## লেআউট কী

`layout.alo` তার ফোল্ডারের সব পেইজকে মোড়ায়। লেআউটে ঠিক একটি `<slot />` থাকে, যেখানে পেইজ বসে:

```html
<!-- pages/layout.alo -->
<template>
    <Header />
    <main>
        <slot />
    </main>
    <Footer />
</template>
```

নতুন লেআউট বানাতে:

```bash
node alo new layout blog    # pages/blog/layout.alo
```

## লেআউটের ভেতরে লেআউট

পেইজের ফোল্ডার থেকে `pages/` রুট পর্যন্ত প্রতিটি ফোল্ডারে `layout.alo` খোঁজা হয়। পেইজ প্রথমে বসে সবচেয়ে কাছের লেআউটে, তারপর সেটি বসে উপরেরটিতে:

```
pages/
├── layout.alo           ← সব পেইজে
└── blog/
    ├── layout.alo       ← শুধু /blog/... এ, উপরের লেআউটের ভেতরে
    ├── page.alo
    └── [slug]/
        └── page.alo
```

এখানে `/blog/hello-world/` পেইজটি বসে `blog/layout.alo`-তে, আর সেটি বসে রুটের `layout.alo`-তে। কোনো ফোল্ডারে লেআউট না থাকলে সেই ধাপ বাদ যায়।

## কিছু পেইজে আলাদা লেআউট

রাউট গ্রুপ, মানে বন্ধনীর ফোল্ডার, URL-এ গোনা হয় না কিন্তু লেআউট খোঁজার পথে থাকে:

```
pages/
├── layout.alo            ← ফন্ট, favicon: সব পেইজে
├── (site)/
│   ├── layout.alo        ← হেডার-ফুটার
│   └── about/page.alo    → /about/
└── (bare)/
    └── launch/page.alo   → /launch/ (হেডার-ফুটার ছাড়া)
```

## `<head>` কীভাবে মেলে

সব লেআউট আর পেইজের `<head>` মিলে একটি হয়। ক্রম: রুট লেআউট, ভেতরের লেআউট, তারপর পেইজ।

- `<title>`: শেষেরটি প্রাধান্য পায়। কোথাও না থাকলে বসে `data.site.name`।
- `<meta name>` আর `<meta property>`: একই নাম হলে শেষেরটি প্রাধান্য পায়।
- বাকি সব ক্রম অনুযায়ী বসে; হুবহু একই লাইন দুবার থাকলে একবারই বসে।

তাই সাইটের সাধারণ বর্ণনা লেআউটে রাখুন, আর যে পেইজের নিজের বর্ণনা আছে, সেখানে আবার লিখুন:

```html
<!-- pages/layout.alo -->
<head>
    <meta name="description" content="{{ data.site.description }}">
    <link rel="icon" href="/favicon.svg">
</head>
```

```html
<!-- pages/about/page.alo -->
<head>
    <title>আমাদের কথা | {{ data.site.name }}</title>
    <meta name="description" content="আমরা কারা, আর কী করি।">
</head>
```

## লেআউটে যা পাওয়া যায়

লেআউটে পেইজের মতোই `data` আর `route` পাওয়া যায়। লেআউটের `<style>` শুধু লেআউটের নিজের এলিমেন্টে লাগে, আর `<script>` চলে তার নিচের সব পেইজে।

---
title: পেইজ আর রাউটিং
description: ফোল্ডারই URL। একটি page.alo ফাইল বানালেই একটি পেইজ তৈরি হয়।
---

## `.alo` ফাইল

একটি `.alo` ফাইলে চারটি ব্লক থাকতে পারে, সবগুলোই ঐচ্ছিক:

```html
<head>
    <title>আমাদের কথা</title>
</head>

<template>
    <h1>আমাদের কথা</h1>
</template>

<style>
    h1 {
        color: tomato;
    }
</style>

<script>
    console.log('পেইজ খুলেছে');
</script>
```

| ব্লক | কাজ |
| --- | --- |
| `<head>` | পেইজের `<title>`, `<meta>` আর `<link>` |
| `<template>` | পেইজের HTML |
| `<style>` | শুধু এই ফাইলের CSS |
| `<script>` | এই পেইজের JS |

`<html>`, `<head>`, `<body>`, `charset` আর `viewport` Alo নিজে বসায়; এগুলো লিখতে হয় না।

## ফোল্ডারই URL

`pages/` ফোল্ডারের ভেতরে প্রতিটি ফোল্ডার একটি URL, আর সেই ফোল্ডারের `page.alo` ফাইলটিই পেইজ:

```
pages/
├── layout.alo           ← সব পেইজের হেডার-ফুটার
├── page.alo             → /
├── not-found.alo        → /404.html
├── about/
│   └── page.alo         → /about/
└── blog/
    ├── layout.alo       ← শুধু /blog/... এ
    ├── page.alo         → /blog/
    └── [slug]/
        └── page.alo     → /blog/<slug>/
```

নতুন পেইজ বানাতে ফাইলটি হাতে বানান, অথবা চালান:

```bash
node alo new page contact    # pages/contact/page.alo
```

### নামের নিয়ম

- ফোল্ডারের নামে চলে ছোট হাতের ইংরেজি অক্ষর, সংখ্যা আর হাইফেন: `about`, `contact-us`।
- `pages/`-এ থাকে শুধু `page.alo`, `layout.alo` আর `not-found.alo`। কম্পোনেন্ট রাখুন `components/`-এ।
- একই URL দুই জায়গা থেকে তৈরি হলে Alo দুটি ফাইলের নামসহ এরর দেখায়।

## 404 পেইজ

`pages/not-found.alo` থাকলে সেটি থেকে তৈরি হয় `/404.html`। ফাইলটি থাকে শুধু `pages/`-এর রুটে, আর পায় শুধু রুটের `layout.alo`।

## রাউট গ্রুপ

বন্ধনীর ফোল্ডার URL-এ গোনা হয় না, কিন্তু লেআউট খোঁজার পথে থাকে। এতে কিছু পেইজকে আলাদা লেআউট দেওয়া যায়, বা লেআউট ছাড়াই রাখা যায়:

```
pages/
├── (site)/
│   ├── layout.alo        ← হেডার-ফুটার
│   ├── page.alo          → /
│   └── about/page.alo    → /about/
└── (bare)/
    └── launch/page.alo   → /launch/ (হেডার-ফুটার ছাড়া)
```

গ্রুপের ভেতরে গ্রুপ রাখা যায়।

## বর্তমান পেইজের পাথ

প্রতিটি পেইজ, লেআউট আর কম্পোনেন্টে `route.path` পাওয়া যায়, যেমন `"/blog/hello-world/"`। মেনুতে বর্তমান পেইজের লিংক চিহ্নিত করতে এটি কাজে লাগে:

```html
<template for="link in data.menu">
    <a href="{{ link.href }}" aria-current="{{ route.path === link.href ? 'page' : null }}">{{ link.label }}</a>
</template>
```

মান `null` হলে অ্যাট্রিবিউটটিই বাদ যায়, তাই `aria-current` বসে শুধু বর্তমান পেইজের লিংকে।

---
title: "টেমপ্লেট: মান, লুপ, শর্ত"
description: মান বসাতে {{ }}, আর লুপ ও শর্ত লিখতে <template> ট্যাগ। এর বাইরে নতুন কোনো সিনট্যাক্স নেই।
---

## এক নজরে

| লিখবেন | কাজ |
| --- | --- |
| `{{ x }}` | মান বসানো |
| `{{{ html }}}` | এস্কেপ ছাড়া HTML (যেমন Markdown-এর বডি) |
| `<template for="x in list">` | লুপ |
| `<template if>` / `<template else-if>` / `<template else>` | শর্ত |

## মান বসানো

`{{ }}`-এর ভেতরে সাধারণ JavaScript লিখুন, যা চলে **বিল্ডের সময়**। ফল HTML-এস্কেপ হয়ে বসে। এক্সপ্রেশন নিরাপদ একটি সাবসেটে চলে (1.2.1 থেকে): মান, অপারেটর, `.` আর `?.`, মেথড কল, টেমপ্লেট লিটারাল, `new Date`/`new Intl.*`, আর `x => x.title`-এর মতো অ্যারো ফাংশন। `function`, `class`, `this`, `process`, `require` আর `constructor`/`__proto__`-এ হাত দেওয়া চলে না।

```html
<p>মোট {{ data.blog.length }}টি লেখা</p>
<a href="/blog/{{ post.slug }}/">{{ post.title }}</a>
<p>দাম: {{ (price * 1.15).toFixed(2) }}</p>
```

- `null` আর `undefined` খালি লেখা হয়ে যায়।
- আক্ষরিক `{{` লিখতে চাইলে লিখুন `\{{`।

## অ্যাট্রিবিউটে মান

অ্যাট্রিবিউটের পুরো মান একটি `{{ }}` হলে যা স্বাভাবিক, তা-ই ঘটে:

- মান `null` বা `undefined` হলে অ্যাট্রিবিউটটিই বাদ যায়। তাই `<img alt="{{ post.alt }}">`-এ `alt` না থাকলে আউটপুটে `alt` থাকে না।
- `disabled`, `checked`, `hidden`, `open`-এর মতো অ্যাট্রিবিউট সত্য হলে বসে, মিথ্যা হলে বাদ যায়:

```html
<button disabled="{{ !ready }}">পাঠান</button>
```

## লুপ

লুপ আর শর্ত লেখা হয় শুধু `<template>` ট্যাগে। ট্যাগটি নিজে আউটপুটে যায় না, যায় শুধু ভেতরের কনটেন্ট:

```html
<ul>
    <template for="(post, i) in data.blog">
        <li>{{ i + 1 }}. {{ post.title }}</li>
    </template>
</ul>
```

অবজেক্টের ওপর লুপ চালাতে লিখুন `Object.entries(obj)`।

## শর্ত

```html
<template if="stock > 10">
    <span>স্টকে আছে</span>
</template>
<template else-if="stock > 0">
    <span>মাত্র {{ stock }}টি বাকি</span>
</template>
<template else>
    <span>শেষ হয়ে গেছে</span>
</template>
```

### লুপের ভেতরে শর্ত

একই `<template>`-এ `for` আর `if` একসাথে চলে না; একটির ভেতরে আরেকটি রাখুন:

```html
<template for="post in data.blog">
    <template if="post.featured">
        <li>{{ post.title }}</li>
    </template>
</template>
```

## এস্কেপ ছাড়া HTML

`{{{ x }}}` বসায় এস্কেপ ছাড়া HTML। এটি শুধু লেখার জায়গায় চলে, অ্যাট্রিবিউটে নয়। সাধারণত লাগে শুধু Markdown-এর বডির জন্য:

```html
<article>
    {{{ item.body }}}
</article>
```

বাইরের কারও লেখা এভাবে বসালে সেটি নিরাপদ নয়।

## কোথায় কী পাওয়া যায়

| জায়গা | ভেরিয়েবল |
| --- | --- |
| পেইজ, লেআউট | `data`, `route`, `base`, `item` (শুধু ডায়নামিক পেইজে), লুপ ভেরিয়েবল |
| কম্পোনেন্ট | `data`, `route`, `base`, `props`, লুপ ভেরিয়েবল |

- `route.path`: বর্তমান পেইজের পাথ, যেমন `"/blog/hello-world/"`।
- `base`: `--base` ফ্ল্যাগের মান, ডিফল্ট `"/"`। খুব কম দরকার হয়, কারণ লিংকে base নিজে থেকে বসে।

অজানা নাম লিখলে Alo এরর দেখায়, সাথে বলে দেয় ওই জায়গায় কোন কোন ভেরিয়েবল আছে।

## সাধারণ ভুল

| যা লিখেছেন | ঠিক যেভাবে |
| --- | --- |
| `<li if="...">` বা `<li for="...">` | `<template>` দিয়ে মোড়ান |
| `<Card for="post in data.blog" />` | `<template for="…"><Card /></template>` |
| একই `<template>`-এ `for` আর `if` | একটির ভেতরে আরেকটি |
| `data.blog.reverse()`, `sort()` | `data.blog.toReversed()`, `toSorted()`, `slice()` |

শেষেরটির কারণ: ডেটা বদলানো যায় না। `reverse()` আর `sort()` মূল অ্যারেটিই বদলে দেয়, তাই Alo এরর দেখায়; `toReversed()` আর `toSorted()` নতুন অ্যারে বানায়।

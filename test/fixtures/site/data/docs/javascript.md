---
title: JavaScript
description: সাধারণ JS, কোনো ফ্রেমওয়ার্ক ছাড়া। কম্পোনেন্টের নিজের এলিমেন্ট পাওয়া যায় $el দিয়ে।
---

## কোথায় কোন JS

| কোথায় লিখবেন | কখন চলে |
| --- | --- |
| কম্পোনেন্টের `<script>` | কম্পোনেন্টের প্রতিটি ইনস্ট্যান্সের জন্য একবার; `$el` পাওয়া যায় |
| পেইজ বা লেআউটের `<script>` | সেই পেইজে (লেআউট হলে তার নিচের সব পেইজে) |
| `global/` ফোল্ডারের `.js` | সব পেইজে |

কিছুই `<script src>` দিয়ে যোগ করতে হয় না। যে পেইজে স্ক্রিপ্টওয়ালা কোনো কম্পোনেন্ট বা নিজের স্ক্রিপ্ট নেই, সেখানে সেগুলোর JS যোগ হয় না; সব পেইজে যায় শুধু `global/`-এর JS।

## কম্পোনেন্টের স্ক্রিপ্ট

কম্পোনেন্টের `<script>` চলে প্রতিটি ইনস্ট্যান্সের জন্য আলাদা করে, আর `$el` হলো তার রুট এলিমেন্ট:

```html
<!-- components/Faq.alo -->
<template>
    <div class="faq">
        <button>{{ props.question }}</button>
        <p>{{ props.answer }}</p>
    </div>
</template>

<style>
    p {
        display: none;
    }
    .open p {
        display: block;
    }
</style>

<script>
    $el.querySelector('button').addEventListener('click', () => {
        $el.classList.toggle('open');
    });
</script>
```

পেইজে দশটি `<Faq />` থাকলে স্ক্রিপ্টটি দশবার চলে, প্রতিবার নিজের `$el` নিয়ে। তাই `document.querySelector`-এর বদলে `$el.querySelector` লিখুন।

- একটি কম্পোনেন্টের এরর অন্যগুলো থামায় না।
- কম্পোনেন্টে একটিই রুট এলিমেন্ট রাখুন। একাধিক থাকলে `$el` হয় প্রথমটি, আর Alo সতর্ক করে।

## বিল্ডের ডেটা JS-এ

`{{ }}` চলে বিল্ডের সময়, `<script>` চলে ব্রাউজারে। তাই `<script>`-এর ভেতরে `props` বা `data` পাওয়া যায় না। মান পাঠাতে ব্যবহার করুন সাধারণ HTML-এর `data-*` অ্যাট্রিবিউট:

```html
<template>
    <div class="counter" data-start="{{ props.start ?? 0 }}">
        <button>+</button> <span></span>
    </div>
</template>

<script>
    let n = Number($el.dataset.start);
    const span = $el.querySelector('span');
    span.textContent = n;
    $el.querySelector('button').addEventListener('click', () => {
        span.textContent = ++n;
    });
</script>
```

## পেইজ আর লেআউটের স্ক্রিপ্ট

পেইজ আর লেআউটের `<script>`-এ `$el` নেই; সেখানে সাধারণ `document.querySelector` চলে:

```html
<!-- pages/contact/page.alo -->
<script>
    document.querySelector('form').addEventListener('submit', (event) => {
        // ...
    });
</script>
```

প্রতিটি ফাইলের কোড আলাদা থাকে, তাই এক ফাইলের ভেরিয়েবল অন্য ফাইলে মেশে না।

## গ্লোবাল JS

`global/` ফোল্ডারের সব `.js` ফাইল চলে সব পেইজে, পুরো পাথের বর্ণানুক্রমে। এখানে লেখা ফাংশন সব জায়গা থেকে ডাকা যায়।

```js
// global/main.js
// বাইরের সাইটের লিংক নতুন ট্যাবে খোলে
document.querySelectorAll('a[href^="http"]').forEach((link) => {
    if (link.host === location.host) return;
    link.target = '_blank';
    link.rel = 'noopener';
});
```

## ইন্টারঅ্যাকটিভিটির রেসিপি

| যা দরকার | যেভাবে |
| --- | --- |
| ক্লিক, মেনু, ট্যাব, মোডাল, ফর্ম | `$el` আর `addEventListener` |
| বিল্ডের ডেটা JS-এ নেওয়া | `data-*` আর `$el.dataset` |
| কম্পোনেন্টের মধ্যে যোগাযোগ | `document.dispatchEvent(new CustomEvent('cart:add'))` আর `addEventListener` |
| পেইজ বদলালেও মান ধরে রাখা | `localStorage` |

## JS লাইব্রেরি যোগ করা

আরও বেশি লাগলে `<head>`-এ একটি `<script>` দিয়ে যেকোনো JS লাইব্রেরি যোগ করা যায়, যেমন Alpine.js:

```html
<!-- pages/layout.alo -->
<head>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head>
```

Alo অচেনা অ্যাট্রিবিউট (`x-data`, `@click`, `:class`) যেমন আছে তেমন রাখে।

## base path আর JS

Alo আপনার JS-এর লেখা বদলায় না। `--base` দিয়ে বিল্ড করলে JS থেকে base জানতে:

```js
const base = document.documentElement.dataset.base ?? '/';
fetch(base + 'data/products.json');
```

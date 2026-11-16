---
title: ব্যাকএন্ড লাগলে
description: ফর্ম জমা বা ডেটা জমিয়ে রাখার মতো কাজে Alo-র জোড়া Adhar (আধার) ব্যবহারের দুটি পথ।
---

Alo শুধু স্ট্যাটিক ফাইল বানায়। তাই ফর্ম জমা নেওয়া, ডেটা জমিয়ে রাখা বা লাইভ তথ্য দেখানোর মতো কাজের জন্য একটি সার্ভার লাগে। সে কাজের জন্য Alo-র জোড়া ফ্রেমওয়ার্ক আছে: [Adhar (আধার)](https://msilabs.github.io/adhar/)।

Adhar একটি হালকা backend ফ্রেমওয়ার্ক, শুধু JSON API-র জন্য। Alo-র মতোই ফোল্ডারই সবকিছু: `api/notes/route.js` মানে `/api/notes`, আর ডেটাবেস হিসেবে Node.js-এর নিজস্ব SQLite চলে, আলাদা কিছু ইনস্টল করতে হয় না।

## কখন লাগে

- যোগাযোগের ফর্ম, মন্তব্য বা নিউজলেটারের ঠিকানা নেওয়া।
- নোট, তালিকা বা গণনার মতো ডেটা জমিয়ে রাখা আর পেইজে দেখানো।
- এমন তথ্য, যা প্রতিবার সার্ভার থেকে আনতে হয়।

লগইনের মতো কিছুর জন্য Adhar-এ এখনো তৈরি সমাধান নেই; সেটি নিজে লিখতে হয়।

## দুটি পথ

| | আলাদা প্রজেক্ট | এক প্রজেক্টে (full stack) |
| --- | --- | --- |
| সাইট | Alo-র নিজের প্রজেক্ট, স্ট্যাটিক হোস্টে | Adhar প্রজেক্টের `web/` ফোল্ডারে |
| API | আলাদা সার্ভারে | একই সার্ভারে, একই পোর্টে |
| শুরু | `npx @msilabs/adhar init my-api` | `npx @msilabs/adhar init my-app --web` |
| CORS | লাগে | লাগে না |
| কখন ভালো | সাইট GitHub Pages বা Netlify-তে থাকবে, বা একই API মোবাইল অ্যাপও ডাকবে | সাইট আর API একসাথে ডিপ্লয় হবে |

## আলাদা প্রজেক্ট

Adhar-এ একটি API প্রজেক্ট বানান:

```bash
npx @msilabs/adhar init my-api
cd my-api
npm install
node adhar dev
```

তারপর Adhar-এর `.env`-এ জানিয়ে দিন কোন সাইট এই API ডাকতে পারবে। নিজের কম্পিউটারে Alo চলে `http://localhost:3000`-এ, আর Adhar `http://localhost:8134`-এ:

```
CORS_ORIGIN=http://localhost:3000
```

Alo-র কোনো কম্পোনেন্টের `<script>` থেকে API ডাকুন:

```html
<script>
    $el.querySelector('form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = new FormData(event.target).get('title');
        const res = await fetch('http://localhost:8134/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        });
        if (res.ok) event.target.reset();
    });
</script>
```

সাইট প্রকাশের সময় `localhost` বদলে আপনার API-র ঠিকানা দিন, আর `CORS_ORIGIN`-এ লিখুন সাইটের ঠিকানা, যেমন `https://my-site.example.com`।

## এক প্রজেক্টে

Adhar প্রজেক্টের `web/` ফোল্ডারে Alo-র সাইট রাখা যায়, আর দুটো এক পোর্টে চলে:

```bash
npx @msilabs/adhar init my-app --web
cd my-app
npm install
node adhar dev
```

- `/api` আর তার নিচের ঠিকানা API-র; বাকি সব সাইটের।
- সাইট থেকে API ডাকতে শুধু পথ লিখুন: `fetch('/api/notes')`। একই ঠিকানা, তাই CORS লাগে না।
- ফাইল বদলালে পেইজ নিজে রিলোড হয়, ঠিক Alo-র মতো।
- সব কাজ হয় `node adhar …` দিয়ে; `web/`-এর ভেতরে আলাদা `alo` কমান্ড লাগে না।

প্রকাশের সময় ক্রম: `node adhar build`, তারপর `node adhar migrate`, তারপর `node adhar start`।

## মনে রাখুন

- GitHub Pages বা Netlify-র মতো স্ট্যাটিক হোস্টে API চলে না। API-র জন্য লাগে Node.js আর একটি স্থায়ী ডিস্কওয়ালা সার্ভার (VPS, অথবা volume যুক্ত Railway, Render, Fly.io)।
- তাই full stack প্রজেক্টের সাইটও সেই Node সার্ভার থেকেই যায়, স্ট্যাটিক হোস্ট থেকে নয়।
- Alo-তে Adhar-এর কোনো কোড বা সেটিং লাগে না। Alo নিজে আগের মতোই শুধু স্ট্যাটিক ফাইল বানায়।

পুরো বিবরণ Adhar-এর ডকসে: [Full stack](https://msilabs.github.io/adhar/docs/full-stack/) আর [আলাদা প্রজেক্ট হিসেবে](https://msilabs.github.io/adhar/docs/with-alo/)।

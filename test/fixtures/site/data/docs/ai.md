---
title: AI সহকারী দিয়ে কাজ
description: Claude, ChatGPT, Cursor বা Copilot-কে Alo-র নিয়ম জানিয়ে দিন, যাতে সে ঠিক কোড লেখে।
---

## সমস্যাটি কী

Claude, ChatGPT, Cursor বা Copilot-এর মতো AI সহকারী Alo সম্পর্কে জানে না। আগে না জানালে সে React বা Vue-র ধরনে কোড লিখবে:

| AI যা লেখে | Alo-তে যা ঠিক |
| --- | --- |
| `import Card from './Card'` | কিছুই না; `<Card />` সরাসরি চলে |
| `<li for="post in posts">` | `<template for="post in posts"><li>…</li></template>` |
| কম্পোনেন্টে `{{ title }}` | `{{ props.title }}` |
| `:title="post.title"` | `title="{{ post.title }}"` |

## `alo init` দিয়ে বানানো প্রজেক্টে

রুটে একটি `AGENTS.md` থাকে। Claude Code, Cursor, Codex-এর মতো টুল ফোল্ডার খুললে এটি নিজে পড়ে নেয়; আপনাকে কিছু করতে হয় না।

## চ্যাটে বা অন্য প্রজেক্টে

AI-কে এই লিংক দিন, বা প্রম্পটে লিখে দিন:

> Read https://raw.githubusercontent.com/msilabs/alo/main/templates/init/AGENTS.md and follow it for all Alo code in this project.

পুরনো প্রজেক্টে ফাইলটি নিজে যোগ করতে চাইলে [AGENTS.md](https://raw.githubusercontent.com/msilabs/alo/main/templates/init/AGENTS.md) নামিয়ে প্রজেক্টের রুটে রাখুন।

## গাইডে কী আছে

- কঠোর নিয়ম: কী কখনো লেখা যাবে না।
- প্রজেক্টের গঠন, টেমপ্লেট, ডেটা, CSS আর JS।
- কমান্ড।
- AI সবচেয়ে বেশি যে ভুলগুলো করে, তার তালিকা।

গাইডটি ইংরেজিতে, কারণ AI-এর কাছে নিয়মগুলো এতে সবচেয়ে নির্ভুল পৌঁছায়।

## `llms.txt`

Alo-র রিপোজিটরির রুটে একটি [llms.txt](https://raw.githubusercontent.com/msilabs/alo/main/llms.txt) ফাইল আছে। এতে AI-এর জন্য দরকারি সব লিংক এক জায়গায়: AI গাইড, README, পুরো স্পেক আর নকশার সিদ্ধান্ত।

## ভুল ধরা পড়ে বিল্ডে

AI ভুল লিখলেও Alo-র এরর মেসেজ ঠিক পথ বলে দেয়, যেমন "Logic can only be written on a `<template>` tag."। এরর মেসেজটি AI-কে ফেরত দিলে সে সাধারণত নিজেই ঠিক করে নেয়।

---
title: কমান্ড
description: init, dev, build আর new। ফ্ল্যাগ মাত্র তিনটি।
---

## সব কমান্ড

```bash
node alo init [folder]                # উদাহরণসহ নতুন প্রজেক্ট (npx @msilabs/alo init)
         [--template name]            # default, blank, portfolio, docs, landing
node alo dev [--port 3000] [--base /] # dev সার্ভার + লাইভ রিলোড
node alo build [--base /]             # dist/ এ প্রোডাকশন বিল্ড
node alo new page blog/first-post     # pages/blog/first-post/page.alo
node alo new page "(bare)/launch"     # pages/(bare)/launch/page.alo
node alo new layout blog              # pages/blog/layout.alo
node alo new component Card           # components/Card.alo
node alo new component blog/PostCard  # components/blog/PostCard.alo
node alo new post blog/hello-world    # data/blog/<আজকের তারিখ>-hello-world.md (খসড়া)
node alo --help
node alo --version
```

একই কমান্ড তিনভাবে চালানো যায়, তিনটিই প্রজেক্টের নিজের ভার্সন চালায়: `node alo dev`, `npm run dev` অথবা `npx alo dev`।

## `init`

```bash
npx @msilabs/alo init my-site
npx @msilabs/alo init my-site --template docs
```

উদাহরণ পেইজ, কম্পোনেন্ট, ডেটা আর Markdown পোস্টসহ নতুন প্রজেক্ট বানায়। যে ফোল্ডার ফাঁকা নয়, সেখানে চলে না। ফোল্ডারের নাম না দিলে বর্তমান ফাঁকা ফোল্ডারেই বানায়।

`--template` দিয়ে অন্য ধরনের সাইট দিয়ে শুরু করা যায়: `default` (না দিলে এটিই), `blank`, `portfolio`, `docs` আর `landing`। কোনটি কখন নেবেন, তা আছে [ইনস্টল ও প্রজেক্টের গঠন](/docs/installation/#টেমপ্লেট) পেইজে। ভুল নাম দিলে কাছাকাছি নাম আর পুরো তালিকা দেখায়, আর কিছু তৈরি হয় না।

## `dev`

```bash
node alo dev
node alo dev --port 4000
```

- ঠিকানা `http://localhost:3000`। পোর্ট ব্যস্ত থাকলে পরেরটি নেয়, আর সেটি জানিয়ে দেয়।
- ফাইল বদলে সংরক্ষণ করলে পেইজ নিজে থেকে রিলোড হয়।
- খসড়া আইটেম (`draft: true`) দেখা যায়।
- এরর হলে ব্রাউজারেই এরর দেখায়। ঠিক করে সংরক্ষণ করলে পেইজ ফিরে আসে।
- বিল্ড হয় `.alo/dev/` ফোল্ডারে; `dist/` ছোঁয় না।

## `build`

```bash
node alo build
node alo build --base /my-repo/
```

`dist/`-এ পুরো সাইট বানায়। কী কী ঘটে, তা আছে [বিল্ড আর আউটপুট](/docs/build/) পেইজে।

## `new`

নতুন ফাইল বানায়, শুরুর কোডসহ:

| কমান্ড | যা বানায় |
| --- | --- |
| `new page contact` | `pages/contact/page.alo` |
| `new page "(bare)/launch"` | `pages/(bare)/launch/page.alo` |
| `new layout blog` | `pages/blog/layout.alo` |
| `new component Card` | `components/Card.alo` |
| `new component blog/PostCard` | `components/blog/PostCard.alo` |
| `new post blog/hello-world` | `data/blog/<আজকের তারিখ>-hello-world.md` |

- আগে থেকে থাকা ফাইল ওভাররাইট করে না।
- কম্পোনেন্টের নাম বড় হাতের অক্ষরে শুরু না হলে এরর দেখায়।
- `new post` ফ্রন্ট ম্যাটারে `title` আর `draft: true` বসায়। প্রকাশের সময় `draft` লাইনটি সরান।

## ফ্ল্যাগ

ফ্ল্যাগ মাত্র তিনটি:

| ফ্ল্যাগ | কোথায় | কাজ |
| --- | --- | --- |
| `--template` | `init` | নতুন প্রজেক্টের টেমপ্লেট; ডিফল্ট `default` |
| `--port` | `dev` | dev সার্ভারের পোর্ট; ডিফল্ট `3000` |
| `--base` | `dev`, `build` | সাইটের সাব-পাথ; ডিফল্ট `/` |

## এরর মেসেজ

প্রতিটি এররে থাকে ফাইল, লাইন, কোডের অংশ আর সমাধানের ইঙ্গিত:

```
✖ Error: pages/about/page.alo:12:5
  Component `<Crad>` not found.

  11 |   <h1>আমাদের সম্পর্কে</h1>
  12 |   <Crad title="মিশন" />
     |   ^
  13 | </template>

  Hint: Did you mean `<Card>`? (components/Card.alo)
```

- এরর লাল `✖`, সতর্কবার্তা হলুদ `⚠`। সতর্কবার্তায় বিল্ড থামে না।
- কম্পোনেন্টের ভেতরের এররে লেখা থাকে কোন ফাইল থেকে সেটি ডাকা হয়েছে।
- ভুল কমান্ড লিখলে সাহায্য দেখায়, সাথে কাছাকাছি কমান্ডের পরামর্শ।
- রং বন্ধ করতে `NO_COLOR` সেট করুন।

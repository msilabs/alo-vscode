---
title: কম্পোনেন্ট আর প্রপস
description: যে অংশ বারবার লাগে, সেটি একবার লিখে সব জায়গায় ব্যবহার করুন।
---

## কম্পোনেন্ট কী

বড় হাতের অক্ষর দিয়ে শুরু হওয়া ট্যাগ মানেই কম্পোনেন্ট, ছোট হাতের অক্ষর দিয়ে শুরু হলে HTML। `components/Card.alo` ফাইলটিই `<Card />`। কোনো `import` লাগে না, আর পেইজ, লেআউট বা অন্য কম্পোনেন্ট, সব জায়গায় চলে।

```html
<!-- components/Card.alo -->
<template>
    <article class="card {{ props.class }}">
        <h3>{{ props.title ?? 'শিরোনাম নেই' }}</h3>
        <slot>
            <p>কিছু লেখা নেই।</p>
        </slot>
    </article>
</template>
```

```html
<Card title="হ্যালো" class="mt-4">
    <p>কার্ডের ভেতরের লেখা</p>
</Card>
```

## প্রপস

ট্যাগের অ্যাট্রিবিউটগুলোই প্রপস। কম্পোনেন্টের ভেতরে সেগুলো পড়া যায় শুধু `props` থেকে: `{{ props.title }}`।

| লিখবেন | কম্পোনেন্ট যা পায় |
| --- | --- |
| `title="হ্যালো"` | স্ট্রিং `"হ্যালো"` |
| `post="{{ post }}"` | আসল মানটিই, এখানে অবজেক্ট |
| `count="{{ 5 }}"` | সংখ্যা `5` |
| `count="5"` | স্ট্রিং `"5"` |
| `subtitle="পোস্ট: {{ post.title }}"` | সবসময় স্ট্রিং |
| `featured` (মান ছাড়া) | `true` |
| `post-date="আজ"` | `props.postDate` |

- না পাঠানো প্রপ `undefined`। ডিফল্ট মান দিতে লিখুন `{{ props.title ?? 'শিরোনাম নেই' }}`।
- `class` বা `id` নিজে থেকে কোথাও বসে না; কম্পোনেন্ট নিজে বসায়, যেমন উপরের `class="card {{ props.class }}"`।

### ভুল নামের প্রপ

ভুল নামের প্রপ পাঠালে Alo সতর্ক করে: "`<Card>`-এ `titel` কোথাও ব্যবহার হয়নি। আপনি কি `title` বোঝাতে চেয়েছিলেন?" এর জন্য প্রপস আগে থেকে ঘোষণা করতে হয় না।

## স্লট

`<slot />`-এ বসে কম্পোনেন্ট ট্যাগের ভেতরের কনটেন্ট। সেই কনটেন্ট রেন্ডার হয় ডাকার জায়গার ভেরিয়েবল দিয়েই। কিছু না পাঠালে দেখায় `<slot>`-এর ভেতরের ফলব্যাক।

## ফোল্ডারে কম্পোনেন্ট

কম্পোনেন্ট বাড়লে সেগুলো ফোল্ডারে সাজান। তখন ট্যাগের নামের সামনে ডট দিয়ে বসে ফোল্ডারের নাম:

| ফাইল | ট্যাগ |
| --- | --- |
| `components/Card.alo` | `<Card />` |
| `components/blog/PostCard.alo` | `<Blog.PostCard />` |
| `components/post-list/Item.alo` | `<PostList.Item />` |
| `components/shop/cart-items/Row.alo` | `<Shop.CartItems.Row />` |

### নামের নিয়ম

1. **ফোল্ডারের নাম ছোট হাতের অক্ষরে**, শব্দের মাঝে `-`: `blog`, `post-list`। ট্যাগে সেটি হয় বড় হাতের অক্ষরে শুরু, `-` ছাড়া: `Blog`, `PostList`।
2. **ফাইলের নাম বড় হাতের অক্ষরে শুরু**, প্রতিটি শব্দও বড় হাতের অক্ষরে: `PostCard.alo`।
3. **সবসময় পুরো নাম লিখুন**, যেখান থেকেই ডাকুন, এমনকি একই ফোল্ডারের কম্পোনেন্ট থেকেও। বন্ধ করার ট্যাগেও পুরো নাম: `<Blog.PostCard>…</Blog.PostCard>`।
4. ফোল্ডার যত গভীরেই হোক, নিয়ম একই।

### উদাহরণ

একই ফোল্ডারের দুটি কম্পোনেন্ট, আর একটি পেইজ যা সেগুলো ব্যবহার করে:

```html
<!-- components/blog/PostCard.alo -->
<template>
    <article class="post-card">
        <h3><a href="/blog/{{ props.post.slug }}/">{{ props.post.title }}</a></h3>
    </article>
</template>
```

```html
<!-- components/blog/PostList.alo -->
<template>
    <div class="post-list">
        <template for="post in props.posts">
            <Blog.PostCard post="{{ post }}" />
        </template>
    </div>
</template>
```

```html
<!-- pages/blog/page.alo -->
<template>
    <h1>ব্লগ</h1>
    <Blog.PostList posts="{{ data.blog }}" />
</template>
```

`PostList` আর `PostCard` একই ফোল্ডারে, তবু `PostList` লেখে `<Blog.PostCard />`, শুধু `<PostCard />` নয়। ফলে একটি কম্পোনেন্টের নাম সব জায়গায় একই থাকে, আর নাম দেখেই বোঝা যায় ফাইলটি কোথায়।

ফোল্ডারসহ নতুন কম্পোনেন্ট বানাতে:

```bash
node alo new component blog/PostCard   # components/blog/PostCard.alo
```

## সাধারণ ভুল

এই ভুলগুলোতে Alo এরর দেখায় আর ঠিক নামটি বলে দেয়:

| যা লিখেছেন | Alo যা বলে | ঠিক যেভাবে |
| --- | --- | --- |
| `components/blog/PostList.alo`-এ `<PostCard />` | Did you mean `<Blog.PostCard>`? | `<Blog.PostCard />` |
| `<blog.PostCard />` | `<blog.PostCard>` is not an HTML tag. | `<Blog.PostCard />` |
| `<Blog.PostCard>…</PostCard>` | `</PostCard>` has no matching `<PostCard>`. | `</Blog.PostCard>` |
| `components/Blog/PostCard.alo` | Component folder name `Blog` is not allowed. | `components/blog/PostCard.alo` |
| `components/blog/post-card.alo` | Component file name `post-card.alo` is not allowed. | `components/blog/PostCard.alo` |

## কম্পোনেন্টের স্টাইল আর স্ক্রিপ্ট

কম্পোনেন্টের `<style>` শুধু সেই কম্পোনেন্টে প্রযোজ্য হয়, আর `<script>` প্রতিটি ইনস্ট্যান্সের জন্য আলাদা করে চলে। স্ক্রিপ্টে কম্পোনেন্টের নিজের এলিমেন্ট পাওয়া যায় `$el` দিয়ে।

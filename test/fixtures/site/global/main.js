// সব পেইজে চলে: বাইরের সাইটের লিংক নতুন ট্যাবে খোলে।
document.querySelectorAll('a[href^="http"]').forEach((link) => {
    if (link.host === location.host) return;
    link.target = '_blank';
    link.rel = 'noopener';
});

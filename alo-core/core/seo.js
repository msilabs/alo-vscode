'use strict';

function escapeXml(text) {
    return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
}

function isNoindex(html) {
    const head = html.slice(0, html.indexOf('</head>'));
    return [...head.matchAll(/<meta\s[^>]*>/gi)].some(
        (match) => /\sname\s*=\s*["']?robots["'\s>]/i.test(match[0]) && /\scontent\s*=\s*["'][^"']*noindex/i.test(match[0]),
    );
}

// pages: [{ path, html }] — every built HTML page except 404.html.
// Pages whose <head> says noindex are left out. URL = site.url + base + route.path.
function buildSitemap(pages, siteUrl, base) {
    const urls = pages
        .filter((page) => !isNoindex(page.html))
        .map((page) => siteUrl + base + page.path.slice(1))
        .sort();
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
        '</urlset>',
        '',
    ].join('\n');
}

function buildRobots(siteUrl, base) {
    const lines = ['User-agent: *', 'Allow: /'];
    if (siteUrl) lines.push(`Sitemap: ${siteUrl}${base}sitemap.xml`);
    return lines.join('\n') + '\n';
}

module.exports = { buildSitemap, buildRobots, isNoindex };

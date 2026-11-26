#!/usr/bin/env python3
"""يولّد صفحة ثابتة لكل خبر منشور (n/<id>.html) فيها Open Graph (معاينة فيسبوك/واتساب)
وبتحوّل القارئ للتطبيق (#n=<id>)، ويحدّث sitemap.xml."""
import json, os, html, time, re, glob
WEB = os.environ.get('WEB', 'https://elsayedabosama1-cmyk.github.io/mirsad/')
d = json.load(open('data/news.json', encoding='utf-8'))
now = int(time.time() * 1000)
pub = [n for n in d.get('news', []) if n.get('st') == 'published' and n.get('at', 0) <= now]
os.makedirs('n', exist_ok=True)
keep = set()
E = lambda s: html.escape(str(s or ''), quote=True)
def img_of(n):
    for p in ([n.get('img')] + list(n.get('imgs') or [])):
        if p and not str(p).startswith('data:'):
            return p if str(p).startswith('http') else WEB + str(p).lstrip('/')
    return WEB + 'icon-512.png'
for n in pub:
    i = re.sub(r'[^A-Za-z0-9_-]', '', str(n['id']))
    if not i: continue
    keep.add(i + '.html')
    t = n.get('t', '')
    desc = re.sub(r'\s+', ' ', n.get('b', '')).strip()[:200]
    url = f'{WEB}n/{i}.html'
    ts = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(n.get('at', now) / 1000))
    page = f'''<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(t)} | مِرصد</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{E(url)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="مِرصد">
<meta property="og:title" content="{E(t)}"><meta property="og:description" content="{E(desc)}">
<meta property="og:image" content="{E(img_of(n))}"><meta property="og:url" content="{E(url)}"><meta property="og:locale" content="ar_AR">
<meta property="article:published_time" content="{ts}">
<meta name="twitter:card" content="summary_large_image">
<style>body{{font-family:system-ui,Tahoma,sans-serif;background:#eaf1fb;color:#14213d;margin:0;padding:24px;line-height:1.8}}main{{max-width:720px;margin:auto}}img{{max-width:100%;border-radius:12px}}a.b{{display:inline-block;background:#c8102e;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;margin-top:12px}}</style>
<script>location.replace("{WEB}#n={i}")</script></head>
<body><main><h1>{E(t)}</h1><img src="{E(img_of(n))}" alt=""><p>{E(n.get('b',''))}</p><a class="b" href="{WEB}#n={i}">افتح في مِرصد</a></main></body></html>'''
    open(f'n/{i}.html', 'w', encoding='utf-8').write(page)
for f in glob.glob('n/*.html'):
    if os.path.basename(f) not in keep: os.remove(f)
urls = [WEB] + [f'{WEB}n/{os.path.basename(f)}' for f in sorted(glob.glob('n/*.html'))]
open('sitemap.xml', 'w', encoding='utf-8').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'<url><loc>{u}</loc></url>\n' for u in urls) + '</urlset>\n')
r = open('robots.txt', encoding='utf-8').read()
if 'Sitemap:' not in r: open('robots.txt', 'a', encoding='utf-8').write(f'Sitemap: {WEB}sitemap.xml\n')
print('pages:', len(keep))

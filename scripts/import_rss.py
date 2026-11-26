#!/usr/bin/env python3
"""Imports items from RSS/Atom sources.
mode=review (default): items wait in data/inbox.json for approval.
mode=auto: headline + short summary + source link + image URL are published to data/news.json
(aggregator style, always crediting the source). Writes data/sources_status.json."""
import json, hashlib, re, html, time, sys, urllib.request
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime

def load(p, d):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return d

def clean(x, n=400):
    x = re.sub(r'<[^>]+>', ' ', html.unescape(x or ''))
    x = re.sub(r'\s+', ' ', x).strip()
    return x[:n]

def safe(u):
    u = (u or '').strip()
    return u if re.match(r'^https?://', u) else ''

def ts(s):
    if not s:
        return None
    try:
        return int(parsedate_to_datetime(s).timestamp() * 1000)
    except Exception:
        pass
    try:
        return int(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return None

def text(e, *names):
    for n in names:
        x = e.find(n)
        if x is not None and (x.text or '').strip():
            return x.text
    return ''

MEDIA = '{http://search.yahoo.com/mrss/}'
def img_of(it, desc):
    for tag in ('content', 'thumbnail'):
        for m in it.iter(MEDIA + tag):
            u = safe(m.get('url'))
            if u and (m.get('medium') in (None, 'image') or tag == 'thumbnail' or re.search(r'\.(jpe?g|png|webp)', u, re.I)):
                return u
    for e in it.findall('enclosure'):
        if (e.get('type') or '').startswith('image'):
            return safe(e.get('url'))
    m = re.search(r'<img[^>]+src=["\']([^"\']+)', html.unescape(desc or ''))
    return safe(m.group(1)) if m else ''

def entries(root):
    for it in root.iter('item'):
        desc = text(it, 'description', '{http://purl.org/rss/1.0/modules/content/}encoded')
        src = it.find('source')
        yield (text(it, 'title'), safe(text(it, 'link')) or safe(text(it, 'guid')), desc,
               ts(text(it, 'pubDate', '{http://purl.org/dc/elements/1.1/}date')), img_of(it, desc),
               (src.text or '').strip() if src is not None else '')
    A = '{http://www.w3.org/2005/Atom}'
    for it in root.iter(A + 'entry'):
        link = ''
        for l in it.findall(A + 'link'):
            if l.get('rel') in (None, 'alternate'):
                link = safe(l.get('href'))
                break
        desc = text(it, A + 'summary', A + 'content')
        yield (text(it, A + 'title'), link, desc, ts(text(it, A + 'updated', A + 'published')), img_of(it, desc), '')

now = int(time.time() * 1000)
sources = load('data/sources.json', {'sources': []}).get('sources', [])
inbox = load('data/inbox.json', {'items': []})
items = inbox.get('items', [])
have = {i['id'] for i in items}
NEWS = load('data/news.json', {'news': []})
nlist = NEWS.get('news', [])
links = {n.get('srcUrl') for n in nlist if n.get('srcUrl')}
norm = lambda t: re.sub(r'[^\w]+', '', t or '')[:60]
titles = {norm(n.get('t')) for n in nlist}
added = pub = 0
CAP_AUTO = 90
status = []
for s in sources:
    if not s.get('active', True) or not safe(s.get('url')) and not s.get('url', '').startswith('file://'):
        continue
    st = {'id': s.get('id', ''), 'name': s.get('name', ''), 'ok': False, 'new': 0}
    try:
        req = urllib.request.Request(s['url'], headers={'User-Agent': 'Mozilla/5.0 (compatible; MirsadBot/1.0)'})
        root = ET.fromstring(urllib.request.urlopen(req, timeout=25).read())
        st['ok'] = True
    except Exception as e:
        print('skip', s.get('name'), e)
        st['err'] = str(e)[:120]
        status.append(st)
        continue
    auto = s.get('mode') == 'auto'
    lim = int(s.get('max', 3 if auto else 20))
    n = 0
    for title, link, desc, at, img, srcname in entries(root):
        title = clean(title, 300)
        if not title or n >= lim:
            continue
        if 'news.google.com' not in s.get('url', ''):
            srcname = ''
        if srcname and title.endswith(' - ' + srcname):
            title = title[:-len(srcname) - 3].strip()
        iid = hashlib.sha1((link or title).encode('utf-8')).hexdigest()[:12]
        at = at or now
        age = 12 * 3600000 if auto else 3 * 86400000
        if iid in have or (link and link in links) or norm(title) in titles or at < now - age or at > now + 3600000:
            continue
        if 'news.google.com' not in s.get('url', ''):
            srcname = ''
        sname = srcname or s.get('name', '')
        if auto:
            if pub >= CAP_AUTO:
                continue
            summ = clean(desc, 320)
            if summ.startswith(title[:40]) or len(summ) < 30:
                summ = ''
            body = (summ + '\n\n' if summ else '') + 'المصدر: ' + sname
            nlist.append({'id': 'a' + iid, 'h': [], 't': title, 'b': body, 'cat': s.get('cat') or 'أخبار مصر', 'src': sname,
                          'au': '', 'gov': '', 'kw': '', 'vid': '', 'srcUrl': link, 'note': '', 'brand': '', 'an': None,
                          'img': img, 'imgs': [img] if img else [], 'st': 'published', 'by': 'auto', 'auto': 1, 'byE': '',
                          'rn': '', 'at': at, 'later': 0, 'fb': []})
            titles.add(norm(title))
            if link:
                links.add(link)
            pub += 1
        else:
            items.append({'id': iid, 'sid': s.get('id', ''), 'source': sname, 'cat': s.get('cat', ''),
                          'title': title, 'summary': clean(desc), 'link': link, 'at': at, 'imported': now})
            added += 1
        have.add(iid)
        n += 1
    st['new'] = n
    status.append(st)
items.sort(key=lambda i: i['at'], reverse=True)
inbox['items'] = items[:300]
if added:
    with open('data/inbox.json', 'w', encoding='utf-8') as f:
        json.dump(inbox, f, ensure_ascii=False, indent=1)
# prune old auto items (never touch items edited by a person)
before = len(nlist)
nlist[:] = [n for n in nlist if not (n.get('auto') and n.get('by') == 'auto' and n.get('at', now) < now - 7 * 86400000)]
if pub or len(nlist) != before:
    nlist.sort(key=lambda n: n.get('at', 0), reverse=True)
    NEWS['news'] = nlist
    NEWS['version'] = NEWS.get('version', 0) + 1
    with open('data/news.json', 'w', encoding='utf-8') as f:
        json.dump(NEWS, f, ensure_ascii=False, separators=(',', ':'))
with open('data/sources_status.json', 'w', encoding='utf-8') as f:
    json.dump({'at': now, 'published': pub, 'queued': added, 'sources': status}, f, ensure_ascii=False, indent=1)
print('auto-published', pub, 'queued', added)

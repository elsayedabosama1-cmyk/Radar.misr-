#!/usr/bin/env python3
"""Imports items from approved RSS/Atom sources into data/inbox.json.
Imported items are never published: they wait in the review queue."""
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

def entries(root):
    for it in root.iter('item'):
        yield (text(it, 'title'), safe(text(it, 'link')) or safe(text(it, 'guid')),
               text(it, 'description', '{http://purl.org/rss/1.0/modules/content/}encoded'),
               ts(text(it, 'pubDate', '{http://purl.org/dc/elements/1.1/}date')))
    A = '{http://www.w3.org/2005/Atom}'
    for it in root.iter(A + 'entry'):
        link = ''
        for l in it.findall(A + 'link'):
            if l.get('rel') in (None, 'alternate'):
                link = safe(l.get('href'))
                break
        yield (text(it, A + 'title'), link, text(it, A + 'summary', A + 'content'),
               ts(text(it, A + 'updated', A + 'published')))

now = int(time.time() * 1000)
sources = load('data/sources.json', {'sources': []}).get('sources', [])
inbox = load('data/inbox.json', {'items': []})
items = inbox.get('items', [])
have = {i['id'] for i in items}
links = {n.get('srcUrl') for n in load('data/news.json', {'news': []}).get('news', []) if n.get('srcUrl')}
added = 0
for s in sources:
    if not s.get('active', True) or not safe(s.get('url')) and not s.get('url', '').startswith('file://'):
        continue
    try:
        req = urllib.request.Request(s['url'], headers={'User-Agent': 'MirsadBot/1.0'})
        root = ET.fromstring(urllib.request.urlopen(req, timeout=25).read())
    except Exception as e:
        print('skip', s.get('name'), e)
        continue
    n = 0
    for title, link, desc, at in entries(root):
        title = clean(title, 300)
        if not title or n >= 20:
            continue
        iid = hashlib.sha1((link or title).encode('utf-8')).hexdigest()[:12]
        at = at or now
        if iid in have or (link and link in links) or at < now - 3 * 86400000:
            continue
        items.append({'id': iid, 'sid': s.get('id', ''), 'source': s.get('name', ''), 'cat': s.get('cat', ''),
                      'title': title, 'summary': clean(desc), 'link': link, 'at': at, 'imported': now})
        have.add(iid)
        n += 1
        added += 1
items.sort(key=lambda i: i['at'], reverse=True)
inbox['items'] = items[:300]
if added:
    with open('data/inbox.json', 'w', encoding='utf-8') as f:
        json.dump(inbox, f, ensure_ascii=False, indent=1)
print('added', added)

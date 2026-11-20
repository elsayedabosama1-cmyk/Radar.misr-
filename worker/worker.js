// مِرصد – وسيط الدخول والصلاحيات (Cloudflare Worker)
// يخزّن الحسابات في KV (الربط: USERS)، ويكتب في GitHub بالسر GITHUB_TOKEN بدل ما التطبيق يشيل أي مفتاح.
const REPO_DEFAULT = 'elsayedabosama1-cmyk/Radar.misr-', BR_DEFAULT = 'main';
const ROLES = { chairman: 'رئيس مجلس الإدارة', editor_in_chief: 'رئيس التحرير', editor: 'محرر / صحفي', reporter: 'مراسل' };
const SENIOR = ['chairman', 'editor_in_chief'];
const te = new TextEncoder(), td = new TextDecoder();

const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const ERR = (m, s = 400) => J({ message: m }, s);

async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return k;
}
async function signJWT(p, secret) {
  const h = b64u(te.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))), b = b64u(te.encode(JSON.stringify(p)));
  const k = await hmac(secret);
  return h + '.' + b + '.' + b64u(await crypto.subtle.sign('HMAC', k, te.encode(h + '.' + b)));
}
async function verifyJWT(t, secret) {
  try {
    const [h, b, s] = t.split('.'); if (!h || !b || !s) return null;
    const k = await hmac(secret);
    if (!(await crypto.subtle.verify('HMAC', k, unb64u(s), te.encode(h + '.' + b)))) return null;
    const p = JSON.parse(td.decode(unb64u(b)));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, k, 256));
}
const ukey = (e) => 'u:' + String(e).trim().toLowerCase();
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const pub = (u) => ({ email: u.email, name: u.name, role: u.role, roleName: ROLES[u.role], active: u.active, created: u.created });

async function mkUser(env, { email, name, role, password }) {
  email = String(email || '').trim().toLowerCase();
  if (!okEmail(email)) throw new Error('الإيميل مش صحيح');
  if (!ROLES[role]) throw new Error('الدور مش معروف');
  if (!password || password.length < 8) throw new Error('كلمة السر لازم 8 حروف أو أكتر');
  if (!String(name || '').trim()) throw new Error('اكتب الاسم');
  if (await env.USERS.get(ukey(email))) throw new Error('الإيميل ده موجود قبل كده');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const u = { email, name: String(name).trim(), role, salt: b64(salt), hash: await pbkdf2(password, salt), active: true, created: Date.now(), fails: 0, lock: 0 };
  await env.USERS.put(ukey(email), JSON.stringify(u));
  return u;
}
async function audit(env, user, act) {
  const id = 'a:' + String(9e15 - Date.now()).padStart(16, '0') + Math.random().toString(36).slice(2, 6);
  await env.USERS.put(id, JSON.stringify({ at: Date.now(), by: user.email, name: user.name, role: user.role, act }), { expirationTtl: 60 * 60 * 24 * 365 });
}

// ===== التحقق من تعديلات news.json حسب الدور =====
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function checkNews(user, oldDb, newDb, msg) {
  if (!newDb || !Array.isArray(newDb.news)) throw new Error('بيانات غير صالحة');
  const senior = SENIOR.includes(user.role), olds = new Map((oldDb.news || []).map((n) => [n.id, n])), news = newDb.news;
  if (!senior) {
    for (const k of new Set([...Object.keys(oldDb), ...Object.keys(newDb)])) {
      if (['news', 'log', 'version'].includes(k)) continue;
      if (!same(oldDb[k], newDb[k])) throw new Error('مش من صلاحيتك تعدّل (' + k + ')');
    }
    const ids = new Set(news.map((n) => n.id));
    for (const id of olds.keys()) if (!ids.has(id)) throw new Error('مش من صلاحيتك تحذف أخبار');
    for (const n of news) {
      const o = olds.get(n.id);
      if (!o) {
        if (!['review', 'draft'].includes(n.st)) throw new Error('الخبر الجديد لازم يتبعت للمراجعة، النشر لرئيس التحرير');
        n.by = user.name; n.byE = user.email; n.rn = '';
      } else if (!same(o, n)) {
        if (o.byE !== user.email) throw new Error('تقدر تعدّل أخبارك بس');
        if (!['review', 'returned', 'rejected', 'draft'].includes(o.st)) throw new Error('الخبر ده اتنشر، التعديل لرئيس التحرير');
        if (n.st !== 'review' && n.st !== 'draft') throw new Error('بعد التعديل ابعته للمراجعة');
        n.by = o.by; n.byE = o.byE; n.rn = o.rn;
      }
    }
  } else {
    for (const n of news) { const o = olds.get(n.id); if (!o) { n.byE = n.byE || user.email; n.by = n.by || user.name } else if (!same(o, n) && n.st !== o.st) { n.rb = user.name; n.rbE = user.email; n.rbAt = Date.now() } }
  }
  newDb.log = [{ at: Date.now(), by: user.name, role: user.role, act: msg }].concat(oldDb.log || []).slice(0, 300);
  return newDb;
}

const PATH_OK = /^(data|photos|files)(\/[^\/\\\0]+)*$/;
async function ghFetch(env, method, path, body) {
  const repo = env.REPO || REPO_DEFAULT;
  return fetch('https://api.github.com/repos/' + repo + path, { method, headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'mirsad-worker', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
const relay = async (r) => new Response([204, 205, 304].includes(r.status) ? null : await r.text(), { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

async function proxy(env, user, req, sub, url) {
  const BR = env.BRANCH || BR_DEFAULT, senior = SENIOR.includes(user.role), m = req.method;
  if (sub === 'actions/import') {
    if (!senior || m !== 'POST') return ERR('مش من صلاحيتك', 403);
    const r = await ghFetch(env, 'POST', '/actions/workflows/import-news.yml/dispatches', { ref: BR });
    await audit(env, user, 'تشغيل الاستيراد'); return relay(r);
  }
  if (!PATH_OK.test(sub) || sub.includes('..')) return ERR('مسار غير مسموح', 400);
  if (m === 'GET') {
    const open = sub === 'data' || sub === 'data/news.json';
    if (!open && !(senior && sub.startsWith('data/'))) return ERR('مش من صلاحيتك', 403);
    return relay(await ghFetch(env, 'GET', '/contents/' + sub + '?ref=' + BR));
  }
  const body = await req.json().catch(() => null);
  if (!body) return ERR('طلب غير صالح');
  const msg = String(body.message || 'Update').slice(0, 200);
  if (m === 'PUT') {
    if (sub === 'data/news.json') {
      const cur = await ghFetch(env, 'GET', '/contents/data/news.json?ref=' + BR);
      if (cur.status !== 200) return relay(cur);
      const cj = await cur.json();
      if (body.sha && body.sha !== cj.sha) return ERR('تعارض في الحفظ', 409);
      const oldDb = JSON.parse(td.decode(unb64(cj.content.replace(/\n/g, '')))); let newDb;
      try { newDb = JSON.parse(td.decode(unb64(body.content))); newDb = checkNews(user, oldDb, newDb, msg) } catch (e) { return ERR(e.message, 403) }
      const w = await ghFetch(env, 'PUT', '/contents/data/news.json', { message: msg + ' [' + user.email + ']', content: b64(te.encode(JSON.stringify(newDb))), branch: BR, sha: cj.sha });
      await audit(env, user, msg); return relay(w);
    }
    if (sub.startsWith('data/')) { if (!senior) return ERR('مش من صلاحيتك', 403) }
    else if (body.sha && !senior) return ERR('مش من صلاحيتك تستبدل ملف موجود', 403);
    if (typeof body.content !== 'string' || body.content.length > 14e6) return ERR('الملف كبير أو غير صالح', 413);
    const w = await ghFetch(env, 'PUT', '/contents/' + sub, { message: msg + ' [' + user.email + ']', content: body.content, branch: BR, ...(body.sha ? { sha: body.sha } : {}) });
    await audit(env, user, msg + ' ← ' + sub); return relay(w);
  }
  if (m === 'DELETE') {
    if (!senior || sub.startsWith('data/')) return ERR('مش من صلاحيتك', 403);
    const w = await ghFetch(env, 'DELETE', '/contents/' + sub, { message: msg, branch: BR, sha: body.sha });
    await audit(env, user, 'حذف ' + sub); return relay(w);
  }
  return ERR('غير مسموح', 405);
}

async function auth(req, env) {
  const h = req.headers.get('Authorization') || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const p = t && await verifyJWT(t, env.JWT_SECRET); if (!p) return null;
  const raw = await env.USERS.get(ukey(p.email)); if (!raw) return null;
  const u = JSON.parse(raw); return u.active ? u : null;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.JWT_SECRET || !env.GITHUB_TOKEN || !env.USERS) return ERR('الخادم مش متظبط: ناقص JWT_SECRET أو GITHUB_TOKEN أو USERS', 500);
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/' && req.method === 'GET') return J({ ok: true, app: 'mirsad-api' });
      if (path === '/login' && req.method === 'POST') {
        const { email, password } = await req.json().catch(() => ({}));
        const raw = email && await env.USERS.get(ukey(email));
        if (!raw) return ERR('الإيميل أو كلمة السر غلط', 401);
        const u = JSON.parse(raw);
        if (u.lock > Date.now()) return ERR('الحساب مقفول مؤقتًا بعد محاولات غلط، جرّب بعد شوية', 429);
        if (!u.active) return ERR('الحساب مجمّد، كلّم رئيس المجلس', 403);
        if (await pbkdf2(String(password || ''), unb64(u.salt)) !== u.hash) {
          u.fails = (u.fails || 0) + 1; if (u.fails >= 5) { u.lock = Date.now() + 10 * 60e3; u.fails = 0 }
          await env.USERS.put(ukey(email), JSON.stringify(u)); return ERR('الإيميل أو كلمة السر غلط', 401);
        }
        if (u.fails) { u.fails = 0; await env.USERS.put(ukey(email), JSON.stringify(u)) }
        const token = await signJWT({ email: u.email, exp: Math.floor(Date.now() / 1000) + 12 * 3600 }, env.JWT_SECRET);
        await audit(env, u, 'تسجيل دخول'); return J({ token, user: pub(u) });
      }
      if (path === '/bootstrap' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!env.BOOTSTRAP_KEY || b.key !== env.BOOTSTRAP_KEY) return ERR('مفتاح الإعداد غلط', 403);
        const list = await env.USERS.list({ prefix: 'u:' });
        for (const k of list.keys) { const u = JSON.parse(await env.USERS.get(k.name)); if (u.role === 'chairman') return ERR('حساب رئيس المجلس موجود بالفعل', 409) }
        const u = await mkUser(env, { ...b, role: 'chairman' }); await audit(env, u, 'إنشاء حساب رئيس المجلس'); return J({ user: pub(u) }, 201);
      }
      const user = await auth(req, env);
      if (!user) return ERR('سجّل دخول تاني', 401);
      if (path === '/me') return J({ user: pub(user) });
      if (path === '/users') {
        if (user.role !== 'chairman') return ERR('لرئيس المجلس بس', 403);
        if (req.method === 'GET') { const l = await env.USERS.list({ prefix: 'u:' }); return J({ users: (await Promise.all(l.keys.map(async (k) => pub(JSON.parse(await env.USERS.get(k.name)))))), roles: ROLES }) }
        if (req.method === 'POST') { const u = await mkUser(env, await req.json()); await audit(env, user, 'إنشاء حساب ' + u.email + ' (' + ROLES[u.role] + ')'); return J({ user: pub(u) }, 201) }
        if (req.method === 'PATCH') {
          const b = await req.json(), raw = await env.USERS.get(ukey(b.email)); if (!raw) return ERR('الحساب مش موجود', 404);
          const u = JSON.parse(raw);
          if (u.email === user.email && (b.active === false || (b.role && b.role !== 'chairman'))) return ERR('ماينفعش تجمّد أو تنزّل دور حسابك', 400);
          if (b.role) { if (!ROLES[b.role]) return ERR('الدور مش معروف'); u.role = b.role }
          if (typeof b.active === 'boolean') u.active = b.active;
          if (b.name) u.name = String(b.name).trim();
          if (b.password) { if (b.password.length < 8) return ERR('كلمة السر لازم 8 حروف أو أكتر'); const s = crypto.getRandomValues(new Uint8Array(16)); u.salt = b64(s); u.hash = await pbkdf2(b.password, s); u.fails = 0; u.lock = 0 }
          await env.USERS.put(ukey(u.email), JSON.stringify(u)); await audit(env, user, 'تعديل حساب ' + u.email); return J({ user: pub(u) });
        }
      }
      if (path === '/audit') {
        if (!SENIOR.includes(user.role)) return ERR('مش من صلاحيتك', 403);
        const l = await env.USERS.list({ prefix: 'a:', limit: 200 });
        return J({ log: await Promise.all(l.keys.map(async (k) => JSON.parse(await env.USERS.get(k.name)))) });
      }
      if (path.startsWith('/gh/')) return proxy(env, user, req, decodeURIComponent(path.slice(4)), url);
      return ERR('مش موجود', 404);
    } catch (e) { return ERR(e.message || 'خطأ', 500) }
  }
};

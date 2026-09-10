// Tầng lưu trữ .json — 2 backend:
//  - file:  chạy local (ghi thẳng /data) hoặc Vercel chưa cấu hình token (ghi /tmp, MẤT khi restart)
//  - github: Vercel + GITHUB_TOKEN → đọc/ghi TRỰC TIẾP file .json trong repo GitHub
//           => mọi user thấy chung 1 lịch sử, thoát ra vào lại vẫn còn, xem được trên GitHub.
const fs = require('fs');
const path = require('path');

const IS_VERCEL = !!process.env.VERCEL;
const TMP_DIR = '/tmp/wapchat';
const SEED_DIR = path.join(__dirname, '..', 'data');

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_REPO =
  process.env.GITHUB_REPO ||
  (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : '');
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';
// Cho phép test backend github ở local: STORAGE=github node server.js
const USE_GH = !!GH_TOKEN && !!GH_REPO && (IS_VERCEL || process.env.STORAGE === 'github');

function storageMode() {
  if (USE_GH) return 'github';
  return IS_VERCEL ? 'tmp' : 'file';
}

// ---------- backend file ----------
function dataPath(name) {
  if (!IS_VERCEL || process.env.STORAGE === 'github') {
    if (!IS_VERCEL) return path.join(SEED_DIR, name);
  }
  if (!IS_VERCEL) return path.join(SEED_DIR, name);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmp = path.join(TMP_DIR, name);
  if (!fs.existsSync(tmp)) {
    try {
      fs.copyFileSync(path.join(SEED_DIR, name), tmp);
    } catch (e) {
      fs.writeFileSync(tmp, '{}', 'utf8');
    }
  }
  return tmp;
}

function clone(o) {
  return o === undefined ? o : JSON.parse(JSON.stringify(o));
}

// ---------- backend github (Contents API, có ETag để poll nhẹ, không tốn rate-limit) ----------
const ghCache = {}; // name -> { etag, sha, data }

function ghHeaders(extra) {
  return Object.assign(
    {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + GH_TOKEN,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wap-chat',
    },
    extra || {}
  );
}

async function ghRead(name) {
  const c = ghCache[name];
  const headers = ghHeaders(c && c.etag ? { 'If-None-Match': c.etag } : {});
  const url =
    `https://api.github.com/repos/${GH_REPO}/contents/data/${encodeURIComponent(name)}` +
    `?ref=${encodeURIComponent(GH_BRANCH)}`;
  const r = await fetch(url, { headers });
  if (r.status === 304 && c) return c;
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read ${name}: HTTP ${r.status}`);
  const j = await r.json();
  const data = JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8'));
  ghCache[name] = { etag: r.headers.get('etag') || '', sha: j.sha, data };
  return ghCache[name];
}

async function ghWrite(name, data) {
  let lastErr = null;
  for (let t = 0; t < 4; t++) {
    let cur = null;
    try {
      cur = await ghRead(name);
    } catch (e) {
      lastErr = e;
    }
    const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');
    const payload = { message: `wap-chat: update ${name}`, content, branch: GH_BRANCH };
    if (cur && cur.sha) payload.sha = cur.sha;
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/data/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: ghHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
    } catch (e) {
      lastErr = e;
      break;
    }
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      ghCache[name] = { etag: '', sha: (j.content && j.content.sha) || '', data: clone(data) };
      return true;
    }
    if (r.status === 409 || r.status === 422) {
      delete ghCache[name]; // sha cũ → đọc lại rồi thử lại
      lastErr = new Error(`GitHub write ${name}: conflict, retry`);
      continue;
    }
    lastErr = new Error(`GitHub write ${name}: HTTP ${r.status}`);
    break;
  }
  throw lastErr || new Error('GitHub write failed');
}

// ---------- API dùng chung (async) ----------
async function readJson(name, fallback) {
  if (USE_GH) {
    try {
      const c = await ghRead(name);
      return c ? clone(c.data) : clone(fallback);
    } catch (e) {
      console.error('[store]', e.message);
      const m = ghCache[name];
      return m ? clone(m.data) : clone(fallback);
    }
  }
  try {
    const raw = fs.readFileSync(dataPath(name), 'utf8');
    const v = JSON.parse(raw || 'null');
    return v ?? clone(fallback);
  } catch (e) {
    return clone(fallback);
  }
}

async function writeJson(name, obj) {
  if (USE_GH) {
    try {
      await ghWrite(name, obj);
      return true;
    } catch (e) {
      console.error('[store]', e.message);
      return false;
    }
  }
  try {
    fs.writeFileSync(dataPath(name), JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

async function getUsers() {
  const d = await readJson('users.json', { users: [] });
  return Array.isArray(d) ? d : d.users || [];
}

async function findUser(username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  const users = await getUsers();
  return users.find((x) => String(x.username).toLowerCase() === u) || null;
}

function isAdmin(u) {
  return !!u && u.role === 'admin';
}

async function getMessages() {
  const d = await readJson('messages.json', { messages: [] });
  return Array.isArray(d) ? d : d.messages || [];
}

// Giữ nguyên các key chú thích "// ..." trong file khi ghi (chỉ thay mảng messages)
async function saveMessages(arr) {
  const keep = arr.slice(-300);
  const doc = await readJson('messages.json', { messages: [] });
  if (doc && !Array.isArray(doc) && typeof doc === 'object') {
    doc.messages = keep;
    return writeJson('messages.json', doc);
  }
  return writeJson('messages.json', keep);
}

// ID duy nhất, tăng dần theo thời gian — không cần file meta, bớt 1 vòng đọc/ghi mỗi tin.
// (Date.now()*1000 + ngẫu nhiên: vừa so sánh được m.id > lastId, vừa không trùng kể cả gửi cùng mili-giây)
function genId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

// Khóa ghi trong cùng instance: xếp hàng các request sửa messages để không ghi đè mất tin của nhau.
let writeLock = Promise.resolve();
function withLock(fn) {
  const run = writeLock.then(fn, fn);
  writeLock = run.catch(() => {});
  return run;
}

async function pushSystem(text, knownAll) {
  const all = knownAll || (await getMessages());
  all.push({
    id: genId(),
    user: 'system',
    nick: 'Hệ thống',
    avatar: '📢',
    color: '#666666',
    text,
    type: 'system',
    time: Date.now(),
  });
  await saveMessages(all);
}

// ---------- SESSION 24h (token + cookie) ----------
// Server chỉ lưu SHA256 của token trong data/sessions.json (kể cả repo public cũng không lộ phiên).
// Token thật nằm ở trình duyệt (cookie + localStorage), hết hạn sau 24h kể từ lần đăng nhập.
const crypto = require('crypto');
const SESSION_TTL = 24 * 3600 * 1000; // 24 giờ
const SESSION_EXTEND_THRESHOLD = 6 * 3600 * 1000; // còn dưới 6h mà vẫn online → gia hạn thêm 24h

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(t) {
  return crypto.createHash('sha256').update(String(t || ''), 'utf8').digest('hex');
}
async function readSessionDoc() {
  const d = await readJson('sessions.json', { sessions: {} });
  const doc = d && typeof d === 'object' && !Array.isArray(d) ? d : { sessions: {} };
  if (!doc.sessions || typeof doc.sessions !== 'object') doc.sessions = {};
  return doc;
}
function pruneSessions(sessions) {
  const now = Date.now();
  let n = 0;
  for (const h of Object.keys(sessions)) {
    if (!sessions[h] || sessions[h].expiry <= now) {
      delete sessions[h];
      n++;
    }
  }
  return n;
}
async function createSession(username) {
  return withLock(async () => {
    const token = newToken();
    const expiresAt = Date.now() + SESSION_TTL;
    const doc = await readSessionDoc();
    pruneSessions(doc.sessions);
    doc.sessions[hashToken(token)] = { user: String(username).toLowerCase(), expiry: expiresAt };
    await writeJson('sessions.json', doc);
    return { token, expiresAt };
  });
}
async function verifySession(token) {
  if (!token) return null;
  const doc = await readSessionDoc();
  const h = hashToken(token);
  const s = doc.sessions[h];
  if (!s) return null;
  if (s.expiry <= Date.now()) {
    await withLock(async () => {
      const d2 = await readSessionDoc();
      if (d2.sessions[h]) {
        delete d2.sessions[h];
        await writeJson('sessions.json', d2);
      }
    });
    return null;
  }
  const user = await findUser(s.user);
  if (!user) return null;
  return { user, expiry: s.expiry, hash: h };
}
async function extendSession(hash) {
  return withLock(async () => {
    const doc = await readSessionDoc();
    const s = doc.sessions[hash];
    if (!s || s.expiry <= Date.now()) return 0;
    if (s.expiry - Date.now() < SESSION_EXTEND_THRESHOLD) {
      s.expiry = Date.now() + SESSION_TTL;
      await writeJson('sessions.json', doc);
    }
    return s.expiry;
  });
}
async function destroySession(token) {
  if (!token) return;
  return withLock(async () => {
    const doc = await readSessionDoc();
    const h = hashToken(token);
    if (doc.sessions[h]) {
      delete doc.sessions[h];
      await writeJson('sessions.json', doc);
    }
  });
}
// Token gửi lên qua body.token, query ?token= hoặc cookie wap_token (trình duyệt tự gửi)
function getTokenFromReq(req, b) {
  if (b && b.token) return String(b.token);
  try {
    const u = new URL(req.url, 'http://localhost');
    const q = u.searchParams.get('token');
    if (q) return q;
  } catch (e) {}
  const c = req.headers && req.headers.cookie;
  if (c) {
    const m = String(c).match(/(?:^|;\s*)wap_token=([^;]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch (e) {
        return m[1];
      }
    }
  }
  return '';
}
function setSessionCookie(res, token, remember) {
  let v = `wap_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
  if (remember) v += `; Max-Age=${24 * 3600}`; // nhớ 24h; không nhớ = cookie theo tab
  res.setHeader('Set-Cookie', v);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'wap_token=; Path=/; Max-Age=0; SameSite=Lax');
}

// Ngày theo giờ Việt Nam (dùng cho "xóa chat theo ngày")
function vnDate(t) {
  return new Date(Number(t) + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function cors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = {
  readJson,
  writeJson,
  getUsers,
  findUser,
  isAdmin,
  getMessages,
  saveMessages,
  genId,
  withLock,
  pushSystem,
  SESSION_TTL,
  createSession,
  verifySession,
  extendSession,
  destroySession,
  getTokenFromReq,
  setSessionCookie,
  clearSessionCookie,
  vnDate,
  send,
  body,
  cors,
  storageMode,
  IS_VERCEL,
};

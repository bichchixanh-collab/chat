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

// ID tăng đơn điệu, không tái sử dụng sau khi xóa → client đồng bộ xóa đúng
async function nextId() {
  const m = await readJson('meta.json', { nextId: 0 });
  let n = (m && m.nextId) || 0;
  if (!n) {
    const all = await getMessages();
    n = all.reduce((mx, x) => Math.max(mx, x.id || 0), 0);
  }
  n += 1;
  const doc = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  doc.nextId = n;
  await writeJson('meta.json', doc);
  return n;
}

async function pushSystem(text) {
  const all = await getMessages();
  const id = await nextId();
  all.push({
    id,
    user: 'system',
    nick: 'Hệ thống',
    avatar: '📢',
    color: '#666666',
    text,
    type: 'system',
    time: Date.now(),
  });
  await saveMessages(all);
  return id;
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
  nextId,
  pushSystem,
  vnDate,
  send,
  body,
  cors,
  storageMode,
  IS_VERCEL,
};

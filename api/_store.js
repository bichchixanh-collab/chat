// Helper đọc/ghi file .json — chạy được cả local và Vercel.
// Vercel: filesystem chỉ đọc, nên data ghi ra /tmp (reset khi cold-start/redeploy).
// Local: ghi thẳng vào /data để bạn thấy file thay đổi.
const fs = require('fs');
const path = require('path');

const IS_VERCEL = !!process.env.VERCEL;
const TMP_DIR = '/tmp/wapchat';
const SEED_DIR = path.join(__dirname, '..', 'data');

function dataPath(name) {
  if (!IS_VERCEL) return path.join(SEED_DIR, name);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmp = path.join(TMP_DIR, name);
  if (!fs.existsSync(tmp)) {
    try {
      fs.copyFileSync(path.join(SEED_DIR, name), tmp);
    } catch (e) {
      fs.writeFileSync(tmp, name.includes('messages') ? '{"messages":[]}' : '{}');
    }
  }
  return tmp;
}

function readJson(name, fallback) {
  try {
    const raw = fs.readFileSync(dataPath(name), 'utf8');
    return JSON.parse(raw || 'null') ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(name, obj) {
  try {
    fs.writeFileSync(dataPath(name), JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function getUsers() {
  const data = readJson('users.json', { users: [] });
  return Array.isArray(data) ? data : (data.users || []);
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
      try { resolve(d ? JSON.parse(d) : {}); }
      catch (e) { resolve({}); }
    });
  });
}

module.exports = { readJson, writeJson, getUsers, send, body, IS_VERCEL };

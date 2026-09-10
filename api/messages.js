// GET  /api/messages?user=x                 -> trả ngay (100 tin gần nhất + online + typing)
// GET  /api/messages?user=x&wait=1&total=N&lastId=M -> LONG-POLL: giữ request tới ~7s,
//      có tin mới/xóa (total hoặc id cuối đổi) là trả ngay → bên nhận thấy gần như tức thì.
// POST /api/messages { user, nick, avatar, typing } -> heartbeat online (10s/lần)
const { readJson, writeJson, verifySession, extendSession, getTokenFromReq, send, body, cors, storageMode } = require('./_store');

const ONLINE_TIMEOUT = 30000; // 30s không ping coi như offline
const TYPING_TIMEOUT = 4000; // 4s
const WINDOW = 100; // số tin trả về mỗi lần
const WAIT_ROUNDS = 7; // long-poll tối đa ~7s (dưới giới hạn 10s của Vercel free)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prune(online) {
  const now = Date.now();
  const out = {};
  for (const k of Object.keys(online || {})) {
    if (now - ((online[k] || {}).seen || 0) <= ONLINE_TIMEOUT) out[k] = online[k];
  }
  return out;
}

function toArray(doc) {
  return Array.isArray(doc) ? doc : doc.messages || [];
}

async function snapshot(me) {
  // 1 vòng đọc song song (GitHub 304 dùng ETag nên rất nhẹ)
  const [doc, onlineRaw, typingRaw] = await Promise.all([
    readJson('messages.json', { messages: [] }),
    readJson('online.json', {}),
    readJson('typing.json', {}),
  ]);
  const all = toArray(doc);
  const total = all.length;
  const lastId = total ? all[total - 1].id : 0;
  const online = prune(onlineRaw); // chỉ lọc, không ghi (đỡ tốn 1 write mỗi poll)
  const now = Date.now();
  const typing = Object.keys(typingRaw || {}).filter(
    (u) => u !== me && now - (typingRaw[u] || 0) < TYPING_TIMEOUT
  );
  return { all, total, lastId, online, typing, now };
}

module.exports = async (req, res) => {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (req.method === 'POST') {
    const b = await body(req);
    const u = String(b.user || '').trim().toLowerCase();
    if (!u) return send(res, 400, { ok: false, error: 'Thiếu user' });
    const [onlineRaw, typing] = await Promise.all([
      readJson('online.json', {}),
      readJson('typing.json', {}),
    ]);
    const online = prune(onlineRaw);
    online[u] = { seen: Date.now(), nick: b.nick || u, avatar: b.avatar || '👤' };
    if (typeof b.typing !== 'undefined') {
      if (b.typing) typing[u] = Date.now();
      else delete typing[u];
    }
    await Promise.all([writeJson('online.json', online), writeJson('typing.json', typing)]);

    // kiểm tra session 24h (kèm token): hết hạn thì báo client đá về màn hình login;
    // còn dưới 6h mà vẫn online thì gia hạn thêm 24h. Không gửi token thì bỏ qua.
    let sessionValid = null;
    let expiresAt = 0;
    const tok = getTokenFromReq(req, b);
    if (tok) {
      const v = await verifySession(tok);
      sessionValid = !!v;
      if (v) expiresAt = await extendSession(v.hash);
    }
    return send(res, 200, { ok: true, sessionValid, expiresAt });
  }

  const url = new URL(req.url, 'http://localhost');
  const me = (url.searchParams.get('user') || '').toLowerCase();
  const wait = url.searchParams.get('wait') === '1';
  const cTotal = parseInt(url.searchParams.get('total') || '-1', 10);
  const cLast = parseInt(url.searchParams.get('lastId') || '0', 10);

  let snap = await snapshot(me);

  // Long-poll: chừng nào chưa đổi thì check lại mỗi 1s (lượt check dính 304, không tốn rate-limit)
  if (wait && cTotal >= 0 && cTotal === snap.total && cLast === snap.lastId) {
    for (let i = 0; i < WAIT_ROUNDS; i++) {
      await sleep(1000);
      // kiểm tra nhẹ: chỉ đọc messages
      let changed = false;
      try {
        const doc = await readJson('messages.json', { messages: [] });
        const all = toArray(doc);
        if (all.length !== snap.total || (all.length && all[all.length - 1].id !== snap.lastId)) {
          changed = true;
        }
      } catch (e) {
        changed = true; // đọc lỗi thì trả snapshot mới cho client thử lại
      }
      if (changed || res.writableEnded) break;
      if (i === WAIT_ROUNDS - 1) break;
    }
    if (!res.writableEnded) snap = await snapshot(me);
  }

  if (res.writableEnded) return;
  return send(res, 200, {
    ok: true,
    messages: snap.all.slice(-WINDOW),
    total: snap.total,
    lastId: snap.lastId,
    online: Object.entries(snap.online).map(([username, v]) => ({ username, ...v })),
    typing: snap.typing,
    storage: storageMode(),
    serverTime: snap.now,
  });
};

// GET  /api/messages?user=x  -> poll realtime: 100 tin gần nhất + online + typing (đọc song song)
// POST /api/messages { user, nick, avatar, typing } -> heartbeat online (10s/lần)
const { readJson, writeJson, send, body, cors, storageMode } = require('./_store');

const ONLINE_TIMEOUT = 30000; // 30s không ping coi như offline
const TYPING_TIMEOUT = 4000; // 4s
const WINDOW = 100; // số tin trả về mỗi lần poll

function prune(online) {
  const now = Date.now();
  const out = {};
  for (const k of Object.keys(online || {})) {
    if (now - ((online[k] || {}).seen || 0) <= ONLINE_TIMEOUT) out[k] = online[k];
  }
  return out;
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
    return send(res, 200, { ok: true });
  }

  const url = new URL(req.url, 'http://localhost');
  const me = (url.searchParams.get('user') || '').toLowerCase();

  // 1 vòng đọc song song (GitHub 304 dùng ETag nên poll rất nhẹ)
  const [doc, onlineRaw, typingRaw] = await Promise.all([
    readJson('messages.json', { messages: [] }),
    readJson('online.json', {}),
    readJson('typing.json', {}),
  ]);
  const all = Array.isArray(doc) ? doc : doc.messages || [];
  const recent = all.slice(-WINDOW);
  const total = all.length;
  const lastId = total ? all[total - 1].id : 0;

  const online = prune(onlineRaw); // chỉ lọc, không ghi (đỡ tốn 1 write mỗi poll)
  const now = Date.now();
  const typing = Object.keys(typingRaw || {}).filter(
    (u) => u !== me && now - (typingRaw[u] || 0) < TYPING_TIMEOUT
  );

  return send(res, 200, {
    ok: true,
    messages: recent,
    total,
    lastId,
    online: Object.entries(online).map(([username, v]) => ({ username, ...v })),
    typing,
    storage: storageMode(),
    serverTime: now,
  });
};

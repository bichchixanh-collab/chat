// GET /api/messages?since=0  -> poll realtime (chat + sticker + smile đều qua đây)
// POST /api/messages { user } -> heartbeat online (giữ tương thích cũ)
const { readJson, writeJson, send, body } = require('./_store');

const ONLINE_TIMEOUT = 15000; // 15s không ping coi như offline
const TYPING_TIMEOUT = 4000;  // 4s

function pruneOnline() {
  const online = readJson('online.json', {});
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(online)) {
    if (now - (online[k].seen || 0) > ONLINE_TIMEOUT) { delete online[k]; changed = true; }
  }
  if (changed) writeJson('online.json', online);
  return online;
}

function getTyping(except) {
  const typing = readJson('typing.json', {});
  const now = Date.now();
  return Object.keys(typing)
    .filter((u) => u !== except && now - (typing[u] || 0) < TYPING_TIMEOUT)
    .map((u) => u);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  // heartbeat: client ping kèm user mỗi 5s
  if (req.method === 'POST') {
    const b = await body(req);
    if (b.user) {
      const online = readJson('online.json', {});
      online[String(b.user).toLowerCase()] = {
        seen: Date.now(),
        nick: b.nick || b.user,
        avatar: b.avatar || '👤',
      };
      writeJson('online.json', online);
    }
    if (typeof b.typing !== 'undefined' && b.user) {
      const typing = readJson('typing.json', {});
      if (b.typing) typing[String(b.user).toLowerCase()] = Date.now();
      else delete typing[String(b.user).toLowerCase()];
      writeJson('typing.json', typing);
    }
    return send(res, 200, { ok: true });
  }

  const url = new URL(req.url, 'http://localhost');
  const since = parseInt(url.searchParams.get('since') || '0', 10);
  const me = (url.searchParams.get('user') || '').toLowerCase();

  const data = readJson('messages.json', { messages: [] });
  const all = Array.isArray(data) ? data : (data.messages || []);
  const fresh = all.filter((m) => (m.id || 0) > since).slice(-100);
  const online = pruneOnline();
  const typing = getTyping(me);
  const lastId = all.length ? all[all.length - 1].id : 0;

  return send(res, 200, {
    ok: true,
    messages: fresh,
    lastId,
    online: Object.entries(online).map(([username, v]) => ({ username, ...v })),
    typing,
    serverTime: Date.now(),
  });
};

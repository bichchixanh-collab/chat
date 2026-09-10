// POST /api/send { user, text, type }  type: text | sticker | smile
// Tối ưu tốc độ: 1 vòng đọc song song (users+messages+typing) + 1 vòng ghi duy nhất (messages).
// - Không ghi typing.json ở đây: client tự heartbeat typing=false sau khi gửi, quá 4s cũng tự hết.
// - Xếp hàng ghi (lock) chống mất tin khi gửi dồn.
const { readJson, writeJson, genId, withLock, send, body, cors } = require('./_store');

const MAX_LEN = 500;
const lastSend = {}; // chống spam: 800ms / user

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = async (req, res) => {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  const b = await body(req);
  const username = String(b.user || '').trim().toLowerCase();
  const text = String(b.text ?? '').trim().slice(0, MAX_LEN);
  const type = ['text', 'sticker', 'smile'].includes(b.type) ? b.type : 'text';

  if (!username) return send(res, 400, { ok: false, error: 'Chưa đăng nhập!' });
  if (!text) return send(res, 400, { ok: false, error: 'Tin nhắn rỗng!' });

  const now = Date.now();
  if (now - (lastSend[username] || 0) < 800)
    return send(res, 429, { ok: false, error: 'Gửi chậm thôi bạn ơi!' });
  lastSend[username] = now;

  try {
    const msg = await withLock(async () => {
      // 1 vòng đọc song song duy nhất
      const [usersDoc, msgDoc] = await Promise.all([
        readJson('users.json', { users: [] }),
        readJson('messages.json', { messages: [] }),
      ]);
      const users = Array.isArray(usersDoc) ? usersDoc : usersDoc.users || [];
      const info = users.find((x) => String(x.username).toLowerCase() === username);
      if (!info) throw httpErr(403, 'Tài khoản không tồn tại (liên hệ admin)!');

      const all = Array.isArray(msgDoc) ? msgDoc : msgDoc.messages || [];
      const m = {
        id: genId(),
        user: username,
        nick: info.nick || username,
        avatar: info.avatar || '👤',
        color: info.color || '#0066cc',
        text,
        type,
        time: now,
      };
      all.push(m);
      const keep = all.slice(-300);
      const outDoc =
        msgDoc && !Array.isArray(msgDoc) && typeof msgDoc === 'object'
          ? { ...msgDoc, messages: keep }
          : keep;
      await writeJson('messages.json', outDoc); // vòng ghi duy nhất
      return m;
    });
    return send(res, 200, { ok: true, message: msg });
  } catch (e) {
    if (e && e.status) return send(res, e.status, { ok: false, error: e.message });
    console.error('[send]', (e && e.message) || e);
    return send(res, 500, { ok: false, error: 'Gửi thất bại, thử lại!' });
  }
};

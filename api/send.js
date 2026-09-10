// POST /api/send { user, text, type }  type: text | sticker | smile
// Chat / sticker / smile đều realtime qua polling /api/messages
const { findUser, getMessages, saveMessages, nextId, readJson, writeJson, send, body, cors } = require('./_store');

const MAX_LEN = 500;
const lastSend = {}; // chống spam: 800ms / user

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

  const info = await findUser(username);
  if (!info) return send(res, 403, { ok: false, error: 'Tài khoản không tồn tại (liên hệ admin)!' });

  const now = Date.now();
  if (now - (lastSend[username] || 0) < 800)
    return send(res, 429, { ok: false, error: 'Gửi chậm thôi bạn ơi!' });
  lastSend[username] = now;

  const all = await getMessages();
  const msg = {
    id: await nextId(),
    user: username,
    nick: info.nick || username,
    avatar: info.avatar || '👤',
    color: info.color || '#0066cc',
    text,
    type,
    time: now,
  };
  all.push(msg);
  await saveMessages(all);

  // xóa trạng thái "đang gõ" của người gửi
  try {
    const typing = await readJson('typing.json', {});
    if (typing[username]) {
      delete typing[username];
      await writeJson('typing.json', typing);
    }
  } catch (e) {}

  return send(res, 200, { ok: true, message: msg });
};

// POST /api/send { user, text, type }  type: text | sticker | smile | image
// Tất cả hành động chat/sticker/smile đều realtime qua polling /api/messages
const { readJson, writeJson, getUsers, send, body } = require('./_store');

const MAX_LEN = 500;
const lastSend = {}; // chống spam đơn giản: 800ms / user

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

  const users = getUsers();
  const info = users.find((x) => String(x.username).toLowerCase() === username) || {};
  const data = readJson('messages.json', { messages: [] });
  const arr = Array.isArray(data) ? data : (data.messages || []);
  const id = arr.length ? arr[arr.length - 1].id + 1 : 1;

  const msg = {
    id,
    user: username,
    nick: info.nick || username,
    avatar: info.avatar || '👤',
    color: info.color || '#0066cc',
    text,
    type,
    time: now,
  };
  arr.push(msg);
  // giữ tối đa 300 tin gần nhất để file .json nhẹ (chuẩn wap)
  const keep = arr.slice(-300);
  const toSave = Array.isArray(data) ? keep : { messages: keep };
  writeJson('messages.json', toSave);

  // xóa typing của người gửi
  try {
    const typing = readJson('typing.json', {});
    if (typing[username]) { delete typing[username]; writeJson('typing.json', typing); }
  } catch (e) {}

  return send(res, 200, { ok: true, message: msg });
};

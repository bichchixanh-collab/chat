// POST /api/send { user, text, type }  type: text | sticker | smile
// Tối ưu tốc độ: đọc song song + ghi song song (1 vòng), xếp hàng ghi chống mất tin.
const { findUser, readJson, writeJson, genId, withLock, send, body, cors } = require('./_store');

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

  try {
    const msg = await withLock(async () => {
      // 1 vòng đọc song song
      const [msgDoc, typing] = await Promise.all([
        readJson('messages.json', { messages: [] }),
        readJson('typing.json', {}),
      ]);
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
      // 1 vòng ghi song song
      const jobs = [writeJson('messages.json', outDoc)];
      if (typing[username]) {
        const t2 = { ...typing };
        delete t2[username];
        jobs.push(writeJson('typing.json', t2));
      }
      await Promise.all(jobs);
      return m;
    });
    return send(res, 200, { ok: true, message: msg });
  } catch (e) {
    console.error('[send]', e.message);
    return send(res, 500, { ok: false, error: 'Gửi thất bại, thử lại!' });
  }
};

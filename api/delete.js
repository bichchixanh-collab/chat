// POST /api/delete { user, action, ids, date }
// Phân quyền:
//  - mọi user: one (1/vài tin CỦA MÌNH), mine (tất cả tin CỦA MÌNH)
//  - admin:     any (tin bất kỳ), all (toàn bộ), byDate (theo ngày, giờ VN)
// Tin hệ thống (system) được bảo vệ, chỉ mất khi admin "xóa toàn bộ".
const { findUser, isAdmin, getMessages, saveMessages, pushSystem, withLock, vnDate, send, body, cors } = require('./_store');

module.exports = async (req, res) => {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  const b = await body(req);
  const me = await findUser(b.user);
  if (!me) return send(res, 401, { ok: false, error: 'Chưa đăng nhập hoặc tài khoản không tồn tại!' });
  const admin = isAdmin(me);
  const myName = String(me.username).toLowerCase();
  const action = String(b.action || '');

  try {
    return await withLock(async () => {
      let all = await getMessages();
      const before = all.length;
      let deleted = 0;

      if (action === 'one' || action === 'any') {
        const ids = [...new Set((Array.isArray(b.ids) ? b.ids : [b.ids]).map(Number))].slice(0, 20);
        if (!ids.length || ids.some((n) => !n)) return send(res, 400, { ok: false, error: 'Thiếu id tin nhắn!' });
        const targets = all.filter((m) => ids.includes(m.id));
        if (!targets.length) return send(res, 404, { ok: false, error: 'Không tìm thấy tin nhắn!' });
        if (action === 'one' && !admin && targets.some((m) => m.user !== myName))
          return send(res, 403, { ok: false, error: 'Bạn chỉ được xóa tin của mình!' });
        if (action === 'any' && !admin)
          return send(res, 403, { ok: false, error: 'Chỉ admin được xóa tin của người khác!' });
        if (targets.some((m) => m.user === 'system'))
          return send(res, 403, { ok: false, error: 'Không xóa được thông báo hệ thống!' });
        all = all.filter((m) => !ids.includes(m.id));
        deleted = before - all.length;
        await saveMessages(all);
        return send(res, 200, { ok: true, deleted });
      }

      if (action === 'mine') {
        all = all.filter((m) => !(m.user === myName && m.user !== 'system'));
        deleted = before - all.length;
        if (!deleted) return send(res, 200, { ok: true, deleted: 0 });
        await saveMessages(all);
        return send(res, 200, { ok: true, deleted });
      }

      if (!admin) return send(res, 403, { ok: false, error: 'Chỉ admin mới dùng được chức năng này!' });

      if (action === 'all') {
        await pushSystem(`🔔 Admin ${me.nick || me.username} đã xóa toàn bộ đoạn chat`, []);
        return send(res, 200, { ok: true, deleted: before });
      }

      if (action === 'byDate') {
        const date = String(b.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
          return send(res, 400, { ok: false, error: 'Ngày không hợp lệ (cần YYYY-MM-DD)!' });
        all = all.filter((m) => !(m.user !== 'system' && vnDate(m.time) === date));
        deleted = before - all.length;
        if (!deleted) return send(res, 200, { ok: true, deleted: 0 });
        await pushSystem(`🔔 Admin ${me.nick || me.username} đã xóa ${deleted} tin ngày ${date}`, all);
        return send(res, 200, { ok: true, deleted });
      }

      return send(res, 400, { ok: false, error: 'Action không hợp lệ!' });
    });
  } catch (e) {
    console.error('[delete]', e.message);
    return send(res, 500, { ok: false, error: 'Xóa thất bại, thử lại!' });
  }
};

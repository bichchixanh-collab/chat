// Admin panel API — CHỈ role=admin.
// GET  /api/admin?user=adminName -> { users (kèm pass để quản lý), total, storage }
// POST /api/admin { admin, action, ... }
//   action=addUser    { username, password, nick, color, avatar, role }
//   action=updateUser { username, password?, nick?, color?, avatar?, role? }
//   action=delUser    { username } (xóa cả user + toàn bộ chat của user đó)
const { findUser, isAdmin, getMessages, saveMessages, pushSystem, readJson, writeJson, send, body, cors, storageMode } = require('./_store');

async function readUserDoc() {
  const doc = await readJson('users.json', { users: [] });
  if (Array.isArray(doc)) return { users: doc };
  if (!doc || typeof doc !== 'object') return { users: [] };
  if (!Array.isArray(doc.users)) doc.users = [];
  return doc;
}

async function requireAdmin(name) {
  const me = await findUser(name);
  return me && isAdmin(me) ? me : null;
}

const USER_RE = /^[a-z0-9_.]{3,20}$/i;

module.exports = async (req, res) => {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const me = await requireAdmin(url.searchParams.get('user'));
    if (!me) return send(res, 403, { ok: false, error: 'Cần quyền admin!' });
    const doc = await readUserDoc();
    const msgs = await getMessages();
    return send(res, 200, {
      ok: true,
      users: doc.users,
      messages: msgs.slice(-100),
      total: msgs.length,
      storage: storageMode(),
    });
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
  const b = await body(req);
  const me = await requireAdmin(b.admin);
  if (!me) return send(res, 403, { ok: false, error: 'Cần quyền admin!' });
  const action = String(b.action || '');
  const doc = await readUserDoc();

  if (action === 'addUser') {
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password ?? '');
    if (!USER_RE.test(username)) return send(res, 400, { ok: false, error: 'Username 3-20 ký tự (chữ, số, _ .)' });
    if (!password || password.length > 50) return send(res, 400, { ok: false, error: 'Password 1-50 ký tự!' });
    if (doc.users.some((x) => String(x.username).toLowerCase() === username))
      return send(res, 400, { ok: false, error: 'Username đã tồn tại!' });
    doc.users.push({
      username,
      password,
      nick: String(b.nick || username).slice(0, 30),
      color: String(b.color || '#0066cc').slice(0, 20),
      avatar: String(b.avatar || '👤').slice(0, 8),
      role: b.role === 'admin' ? 'admin' : 'user',
    });
    if (!(await writeJson('users.json', doc))) return send(res, 500, { ok: false, error: 'Ghi file thất bại!' });
    await pushSystem(`🔔 Admin đã thêm thành viên mới: ${username}`);
    return send(res, 200, { ok: true, users: doc.users });
  }

  if (action === 'updateUser') {
    const username = String(b.username || '').trim().toLowerCase();
    const u = doc.users.find((x) => String(x.username).toLowerCase() === username);
    if (!u) return send(res, 404, { ok: false, error: 'Không tìm thấy user!' });
    if (b.password !== undefined && b.password !== '') {
      if (String(b.password).length > 50) return send(res, 400, { ok: false, error: 'Password quá dài!' });
      u.password = String(b.password);
    }
    if (b.nick !== undefined) u.nick = String(b.nick).slice(0, 30);
    if (b.color !== undefined) u.color = String(b.color).slice(0, 20);
    if (b.avatar !== undefined) u.avatar = String(b.avatar).slice(0, 8);
    if (b.role !== undefined) {
      if (username === String(me.username).toLowerCase() && b.role !== 'admin')
        return send(res, 400, { ok: false, error: 'Không tự hạ quyền chính mình!' });
      u.role = b.role === 'admin' ? 'admin' : 'user';
    }
    if (!(await writeJson('users.json', doc))) return send(res, 500, { ok: false, error: 'Ghi file thất bại!' });
    return send(res, 200, { ok: true, users: doc.users });
  }

  if (action === 'delUser') {
    const username = String(b.username || '').trim().toLowerCase();
    if (username === String(me.username).toLowerCase())
      return send(res, 400, { ok: false, error: 'Không tự xóa chính mình!' });
    const idx = doc.users.findIndex((x) => String(x.username).toLowerCase() === username);
    if (idx < 0) return send(res, 404, { ok: false, error: 'Không tìm thấy user!' });
    if (doc.users[idx].role === 'admin' && doc.users.filter((x) => x.role === 'admin').length <= 1)
      return send(res, 400, { ok: false, error: 'Không xóa admin cuối cùng!' });
    doc.users.splice(idx, 1);
    if (!(await writeJson('users.json', doc))) return send(res, 500, { ok: false, error: 'Ghi file thất bại!' });
    const msgs = await getMessages();
    const mine = msgs.filter((m) => m.user === username).length;
    await saveMessages(msgs.filter((m) => m.user !== username));
    await pushSystem(`🔔 Admin đã xóa thành viên ${username} (+${mine} tin)`);
    return send(res, 200, { ok: true, users: doc.users, deletedMessages: mine });
  }

  return send(res, 400, { ok: false, error: 'Action không hợp lệ!' });
};

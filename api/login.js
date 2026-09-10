// POST /api/login  { username, password, remember } -> check data/users.json + cấp session 24h
const { getUsers, createSession, setSessionCookie, send, body, cors } = require('./_store');

module.exports = async (req, res) => {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  const b = await body(req);
  const u = String(b.username || '').trim().toLowerCase();
  const users = await getUsers();
  const found = users.find(
    (x) => String(x.username).toLowerCase() === u && String(x.password) === String(b.password || '')
  );
  if (!found) return send(res, 401, { ok: false, error: 'Sai tên hoặc mật khẩu!' });

  const remember = b.remember !== false; // tick "ghi nhớ" = giữ 24h kể cả tắt trình duyệt
  const { token, expiresAt } = await createSession(found.username);
  setSessionCookie(res, token, remember);

  const { password: _p, ...safe } = found;
  if (!safe.role) safe.role = 'user';
  return send(res, 200, { ok: true, user: safe, token, expiresAt, remember });
};

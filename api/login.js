// POST /api/login  { username, password } -> check data/users.json
const { getUsers, send, body, cors } = require('./_store');

module.exports = async (req, res) => {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  const { username = '', password = '' } = await body(req);
  const u = String(username).trim().toLowerCase();
  const users = await getUsers();
  const found = users.find(
    (x) => String(x.username).toLowerCase() === u && String(x.password) === String(password)
  );
  if (!found) return send(res, 401, { ok: false, error: 'Sai tên hoặc mật khẩu!' });

  const { password: _p, ...safe } = found;
  if (!safe.role) safe.role = 'user';
  return send(res, 200, { ok: true, user: safe });
};

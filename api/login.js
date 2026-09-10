// POST /api/login  { username, password } -> check data/users.json
const { getUsers, send, body } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  const { username = '', password = '' } = await body(req);
  const u = String(username).trim().toLowerCase();
  const users = getUsers();
  const found = users.find(
    (x) => String(x.username).toLowerCase() === u && String(x.password) === String(password)
  );
  if (!found) return send(res, 401, { ok: false, error: 'Sai tên hoặc mật khẩu!' });

  const { password: _p, ...safe } = found;
  return send(res, 200, { ok: true, user: safe });
};

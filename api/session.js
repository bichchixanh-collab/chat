// Session 24h — tự đăng nhập lại khi mở web.
// GET  /api/session?token=... (hoặc cookie wap_token) -> { user, expiresAt } nếu còn hạn
// POST /api/session { action: 'logout', token }      -> hủy phiên + xóa cookie
const { verifySession, destroySession, getTokenFromReq, clearSessionCookie, send, body, cors } = require('./_store');

function safeUser(u) {
  const { password: _p, ...safe } = u;
  if (!safe.role) safe.role = 'user';
  return safe;
}

module.exports = async (req, res) => {
  cors(res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (req.method === 'GET') {
    const v = await verifySession(getTokenFromReq(req, null));
    if (!v) return send(res, 401, { ok: false, error: 'Phiên hết hạn, đăng nhập lại!' });
    return send(res, 200, { ok: true, user: safeUser(v.user), expiresAt: v.expiry });
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
  const b = await body(req);
  if (String(b.action || '') !== 'logout') return send(res, 400, { ok: false, error: 'Action không hợp lệ!' });
  await destroySession(getTokenFromReq(req, b));
  clearSessionCookie(res);
  return send(res, 200, { ok: true });
};

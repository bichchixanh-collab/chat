/* WAP CHAT v2 frontend — polling 1s, lịch sử dùng chung, linkify, xóa chat, admin panel */
const $ = (id) => document.getElementById(id);
const els = {
  loginBox: $('loginBox'), chatBox: $('chatBox'),
  inUser: $('inUser'), inPass: $('inPass'), inRemember: $('inRemember'),
  btnLogin: $('btnLogin'), loginErr: $('loginErr'),
  msgs: $('msgs'), inMsg: $('inMsg'), btnSend: $('btnSend'),
  btnSmile: $('btnSmile'), btnSticker: $('btnSticker'),
  smilePanel: $('smilePanel'), stickerPanel: $('stickerPanel'),
  onlineBar: $('onlineBar'), onlineCount: $('onlineCount'),
  typingBar: $('typingBar'), meInfo: $('meInfo'),
  btnLogout: $('btnLogout'), btnSound: $('btnSound'), btnAdmin: $('btnAdmin'),
  btnMyDel: $('btnMyDel'), adminPanel: $('adminPanel'),
  clock: $('clock'), connDot: $('connDot'), connTxt: $('connTxt'),
  storeBadge: $('storeBadge'), storeWarn: $('storeWarn'),
};

const SMILE_LIST = ["😀","😁","😂","🤣","😊","😍","😘","😎","🤔","😅","😭","😡","👍","👎","🙏","👏","🔥","🎉","💔","❤️","💯","✌️","🤝","👋","🐱","🐶","🐼","🦊","🐸","🍕","🍺","☕","🌹","⭐","🌙","⚽","🎮","🚀"];
const STICKERS = ["😂","😍","😭","😡","🥳","😱","🤡","💩","👻","🎃","🐱","🐶","🐼","🦊","🐸","🦁","🐵","🐷","💘","💔","🔥","⭐","🌹","🎁","🍺","⚽","🚀","👍","👎","✌️","🤝","🙏"];

let me = null; // {username, nick, color, avatar, role}
let lastId = 0, lastTotal = -1, firstLoad = true;
let soundOn = true;
let pollTimer = null, heartTimer = null;
let typingActive = false, typingTimer = null;
let adminTab = 'msgs', adminUsers = [], adminMsgs = [], adminFilter = '';

const isAdmin = () => me && me.role === 'admin';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtTime(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}
function fmtDT(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}
// Nhận diện link: escape trước rồi mới linkify (chống XSS). Link ảnh nhúng thumbnail.
function richText(raw) {
  const h = esc(raw).replace(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi, (m) => {
    let url = m, trail = '';
    const tm = url.match(/[.,!?;:'")\]}>]+$/);
    if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
    if (!url) return m;
    const href = /^www\./i.test(url) ? 'https://' + url : url;
    let out = `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
    if (/\.(jpe?g|png|gif|webp)(\?[^\s<]*)?$/i.test(href))
      out += `<br><a href="${href}" target="_blank" rel="noopener noreferrer"><img class="chatimg" loading="lazy" src="${href}" alt="ảnh"></a>`;
    return out;
  });
  return h;
}
function beep() {
  if (!soundOn) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

// ---- render tin nhắn ----
function canDel(m) {
  if (!me || m.user === 'system' || m.type === 'system') return false;
  return isAdmin() || m.user === me.username.toLowerCase();
}
function msgNode(m) {
  const div = document.createElement('div');
  const mine = me && m.user === me.username.toLowerCase();
  div.dataset.mid = m.id;
  if (m.user === 'system' || m.type === 'system') {
    div.className = 'msg sys';
    div.innerHTML = `<span>📢 ${richText(m.text)}</span><div class="time">${fmtTime(m.time)}</div>`;
  } else {
    div.className = 'msg' + (mine ? ' me' : '') + (m.type === 'sticker' || m.type === 'smile' ? ' stickerMsg' : '');
    div.innerHTML =
      `<div class="head"><span>${esc(m.avatar || '👤')}</span> <b style="color:${esc(m.color || '#0066cc')}">${esc(m.nick || m.user)}</b>` +
      `<span class="time">${fmtTime(m.time)}</span></div>` +
      `<div class="body">${richText(m.text)}</div>` +
      (canDel(m) ? `<button class="delbtn" data-del="${m.id}" title="Xóa tin này">✕</button>` : '');
  }
  return div;
}
// Full reload khi phát hiện có tin bị xóa (total giảm) — giữ vị trí cuộn nếu đang xem cũ
function fullReload(list) {
  const nearBottom = els.msgs.scrollHeight - els.msgs.scrollTop - els.msgs.clientHeight < 120;
  els.msgs.innerHTML = '';
  list.forEach((m) => els.msgs.appendChild(msgNode(m)));
  while (els.msgs.children.length > 200) els.msgs.removeChild(els.msgs.firstChild);
  els.msgs.scrollTop = nearBottom ? els.msgs.scrollHeight : 0;
}
function renderOnline(list) {
  els.onlineCount.textContent = `● ${list.length} online`;
  els.onlineBar.innerHTML = list.length
    ? '🟢 Online: ' + list.map((u) => `${esc(u.avatar || '👤')} <b>${esc(u.nick || u.username)}</b>`).join(' • ')
    : '⚪ Chưa có ai online';
}
function renderTyping(users) {
  els.typingBar.textContent = users.length ? `✍️ ${users.join(', ')} đang gõ...` : '';
}
function renderStorage(mode) {
  if (mode === 'github') {
    els.storeBadge.textContent = '💾 github (dùng chung)';
    els.storeWarn.style.display = 'none';
  } else if (mode === 'file') {
    els.storeBadge.textContent = '💾 file local';
    els.storeWarn.style.display = 'none';
  } else {
    els.storeBadge.textContent = '⚠️ bộ nhớ tạm';
    els.storeWarn.style.display = 'block';
    els.storeWarn.innerHTML = '⚠️ Server đang lưu chat ở <b>bộ nhớ tạm</b> (chưa cấu hình GITHUB_TOKEN) — thoát/restart có thể <b>mất chat</b>. Xem mục 3 trong README để bật lưu vĩnh viễn bằng file .json trên GitHub.';
  }
}

// ---- API ----
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Lỗi ' + r.status));
  return j;
}
async function poll() {
  if (!me) return;
  try {
    const j = await api('/api/messages?user=' + encodeURIComponent(me.username));
    const list = j.messages || [];
    if (firstLoad) {
      fullReload(list);
      firstLoad = false;
    } else if (lastTotal >= 0 && (j.total || 0) < lastTotal) {
      fullReload(list); // có tin bị xóa → vẽ lại (realtime cho mọi user)
    } else {
      list.filter((m) => m.id > lastId).forEach((m) => {
        if (!els.msgs.querySelector(`[data-mid="${m.id}"]`)) {
          els.msgs.appendChild(msgNode(m));
          while (els.msgs.children.length > 200) els.msgs.removeChild(els.msgs.firstChild);
          if (m.user !== 'system' && m.user !== me.username.toLowerCase()) beep();
          els.msgs.scrollTop = els.msgs.scrollHeight;
        }
      });
    }
    if (list.length) lastId = Math.max(lastId, ...list.map((m) => m.id));
    if (j.lastId) lastId = Math.max(lastId, j.lastId);
    lastTotal = j.total ?? lastTotal;
    renderOnline(j.online || []);
    renderTyping(j.typing || []);
    renderStorage(j.storage);
    els.connDot.textContent = '🟢'; els.connTxt.textContent = 'đang kết nối';
  } catch (e) {
    els.connDot.textContent = '🔴'; els.connTxt.textContent = 'mất kết nối, đang thử lại...';
  }
}
async function heartbeat(typing) {
  if (!me) return;
  try {
    await fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me.username, nick: me.nick, avatar: me.avatar, typing }),
    });
  } catch (e) {}
}
function typingStart() {
  if (!me || typingActive) return;
  typingActive = true;
  heartbeat(true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(typingStop, 3000);
}
function typingStop() {
  if (!typingActive) return;
  typingActive = false;
  clearTimeout(typingTimer);
  heartbeat(false);
}
async function sendMsg(text, type) {
  text = (text || '').trim();
  if (!text || !me) return;
  try {
    const j = await api('/api/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me.username, text, type: type || 'text' }),
    });
    if (!els.msgs.querySelector(`[data-mid="${j.message.id}"]`)) {
      els.msgs.appendChild(msgNode(j.message));
      els.msgs.scrollTop = els.msgs.scrollHeight;
    }
    lastId = Math.max(lastId, j.message.id);
    lastTotal = lastTotal >= 0 ? lastTotal + 1 : lastTotal;
  } catch (e) { alert(e.message); }
}
async function deleteMsg(id) {
  if (!confirm('Xóa tin nhắn này?')) return;
  try {
    await api('/api/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me.username, action: isAdmin() ? 'any' : 'one', ids: [id] }),
    });
    poll(); // đồng bộ ngay
  } catch (e) { alert(e.message); }
}

// ---- panels cười / sticker ----
function buildPanels() {
  els.smilePanel.innerHTML = '';
  SMILE_LIST.forEach((s) => {
    const el = document.createElement('span');
    el.textContent = s;
    el.onclick = () => { els.inMsg.value += s; els.inMsg.focus(); typingStart(); };
    els.smilePanel.appendChild(el);
  });
  els.stickerPanel.innerHTML = '';
  STICKERS.forEach((s) => {
    const el = document.createElement('span');
    el.textContent = s;
    el.onclick = () => { sendMsg(s, 'sticker'); togglePanel(null); };
    els.stickerPanel.appendChild(el);
  });
}
function togglePanel(which) {
  const s = els.smilePanel, t = els.stickerPanel;
  if (which === 'smile') {
    const open = s.style.display !== 'none';
    s.style.display = open ? 'none' : 'grid'; t.style.display = 'none';
    els.btnSmile.classList.toggle('active', !open);
    els.btnSticker.classList.remove('active');
  } else if (which === 'sticker') {
    const open = t.style.display !== 'none';
    t.style.display = open ? 'none' : 'grid'; s.style.display = 'none';
    els.btnSticker.classList.toggle('active', !open);
    els.btnSmile.classList.remove('active');
  } else { s.style.display = 'none'; t.style.display = 'none'; els.btnSmile.classList.remove('active'); els.btnSticker.classList.remove('active'); }
  els.msgs.scrollTop = els.msgs.scrollHeight;
}

// ---- ADMIN PANEL ----
function toggleAdmin(force) {
  const p = els.adminPanel;
  const show = force !== undefined ? force : p.style.display === 'none';
  p.style.display = show ? 'block' : 'none';
  els.btnAdmin.textContent = show ? '✕ Đóng Admin' : '⚙ Admin';
  if (show) loadAdmin();
  if (show) p.scrollIntoView({ block: 'nearest' });
}
async function loadAdmin() {
  els.adminPanel.innerHTML = '<h3>⏳ Đang tải dữ liệu admin...</h3>';
  try {
    const j = await api('/api/admin?user=' + encodeURIComponent(me.username));
    adminUsers = j.users || [];
    adminMsgs = (j.messages || []).slice().reverse(); // mới nhất trước
    renderAdmin();
  } catch (e) {
    els.adminPanel.innerHTML = `<h3>⚠️ ${esc(e.message)}</h3>`;
  }
}
function renderAdmin() {
  const tabs = `<div class="atabs">
      <button data-atab="msgs" class="${adminTab === 'msgs' ? 'on' : ''}">💬 Tin nhắn (${adminMsgs.length})</button>
      <button data-atab="users" class="${adminTab === 'users' ? 'on' : ''}">👥 Users (${adminUsers.length})</button>
    </div>`;
  let body = '';
  if (adminTab === 'msgs') {
    const users = [...new Set(adminMsgs.map((m) => m.user))];
    body = `<div class="arow">
        <input type="date" id="aDate">
        <button class="abtn danger small" id="aDelDate">Xóa ngày này</button>
        <button class="abtn danger small" id="aDelAll">Xóa TOÀN BỘ</button>
      </div>
      <div class="arow">
        <select id="aFilter"><option value="">-- Lọc theo user --</option>${
          users.map((u) => `<option value="${esc(u)}" ${adminFilter === u ? 'selected' : ''}>${esc(u)}</option>`).join('')
        }</select>
        <button class="abtn small" id="aReload">↻ Tải lại</button>
      </div>
      <div id="aMsgList">${adminMsgs
        .filter((m) => !adminFilter || m.user === adminFilter)
        .slice(0, 60)
        .map((m) => `<div class="amsg"><span class="tm">${fmtDT(m.time)}</span>
          <span class="t"><b>${esc(m.nick || m.user)}</b>: ${esc(String(m.text).slice(0, 80))}</span>
          ${m.user === 'system' ? '' : `<button class="abtn danger small" data-adel="${m.id}">Xóa</button>`}
        </div>`).join('') || '<i>Không có tin nào.</i>'}</div>`;
  } else {
    body = `<div class="arow">
        <input id="nUser" placeholder="tên mới" maxlength="20">
        <input id="nPass" placeholder="pass" maxlength="50">
        <input id="nNick" placeholder="nick" maxlength="30">
        <button class="abtn small" id="aAdd">+ Thêm</button>
      </div>
      ${adminUsers.map((u) => `<div class="auser" data-uname="${esc(u.username)}">
        <span class="uname">${esc(u.avatar || '')} ${esc(u.username)}</span>
        <span class="role">${esc(u.role || 'user')}</span>
        <div class="urow">
          <input data-f="nick" value="${esc(u.nick || '')}" placeholder="nick" maxlength="30">
          <input data-f="password" value="${esc(u.password || '')}" placeholder="pass mới (để trống = giữ)" maxlength="50">
        </div>
        <div class="urow">
          <input data-f="avatar" value="${esc(u.avatar || '')}" placeholder="avatar" maxlength="8">
          <input data-f="color" value="${esc(u.color || '')}" placeholder="màu #..." maxlength="20">
          <select data-f="role"><option value="user" ${u.role !== 'admin' ? 'selected' : ''}>user</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select>
        </div>
        <div class="urow">
          <button class="abtn small" data-asave>Lưu</button>
          <button class="abtn danger small" data-adeluser>Xóa user + chat</button>
        </div>
      </div>`).join('')}`;
  }
  els.adminPanel.innerHTML = `<h3>👑 ADMIN PANEL — ${esc(me.nick)}</h3>` + tabs + body;

  els.adminPanel.querySelectorAll('[data-atab]').forEach((b) => (b.onclick = () => { adminTab = b.dataset.atab; renderAdmin(); }));
  const rel = () => loadAdmin();
  if ($('aReload')) $('aReload').onclick = rel;
  if ($('aFilter')) $('aFilter').onchange = (e) => { adminFilter = e.target.value; renderAdmin(); };
  if ($('aDelAll')) $('aDelAll').onclick = async () => {
    if (!confirm('XÓA TOÀN BỘ chat của mọi người? Không khôi phục được!')) return;
    if (!confirm('Chắc chắn lần 2? Bấm OK để xóa sạch.')) return;
    try {
      await api('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: me.username, action: 'all' }) });
      alert('Đã xóa toàn bộ!');
      poll(); loadAdmin();
    } catch (e) { alert(e.message); }
  };
  if ($('aDelDate')) $('aDelDate').onclick = async () => {
    const d = $('aDate').value;
    if (!d) { alert('Chọn ngày trước!'); return; }
    if (!confirm(`Xóa toàn bộ chat ngày ${d} (giờ VN)?`)) return;
    try {
      const j = await api('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: me.username, action: 'byDate', date: d }) });
      alert(`Đã xóa ${j.deleted} tin ngày ${d}`);
      poll(); loadAdmin();
    } catch (e) { alert(e.message); }
  };
  els.adminPanel.querySelectorAll('[data-adel]').forEach((b) => (b.onclick = () => deleteMsg(Number(b.dataset.adel))));
  if ($('aAdd')) $('aAdd').onclick = async () => {
    try {
      const j = await api('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin: me.username, action: 'addUser',
          username: $('nUser').value.trim(), password: $('nPass').value,
          nick: $('nNick').value.trim() || $('nUser').value.trim() }) });
      adminUsers = j.users; renderAdmin(); poll();
    } catch (e) { alert(e.message); }
  };
  els.adminPanel.querySelectorAll('[data-asave]').forEach((b) => (b.onclick = async () => {
    const card = b.closest('.auser');
    const fields = {};
    card.querySelectorAll('[data-f]').forEach((inp) => (fields[inp.dataset.f] = inp.value));
    if (!fields.password) delete fields.password;
    try {
      const j = await api('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin: me.username, action: 'updateUser', username: card.dataset.uname, ...fields }) });
      adminUsers = j.users; renderAdmin(); poll();
    } catch (e) { alert(e.message); }
  }));
  els.adminPanel.querySelectorAll('[data-adeluser]').forEach((b) => (b.onclick = async () => {
    const uname = b.closest('.auser').dataset.uname;
    if (!confirm(`Xóa user ${uname} + TOÀN BỘ chat của họ?`)) return;
    try {
      const j = await api('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin: me.username, action: 'delUser', username: uname }) });
      adminUsers = j.users; renderAdmin(); poll();
    } catch (e) { alert(e.message); }
  }));
}

// ---- login / logout ----
async function doLogin() {
  const u = els.inUser.value.trim(), p = els.inPass.value;
  if (!u || !p) { els.loginErr.textContent = 'Nhập đủ tên + mật khẩu!'; return; }
  els.btnLogin.disabled = true; els.btnLogin.textContent = '... đang vào ...';
  try {
    const j = await api('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    });
    me = j.user;
    if (els.inRemember.checked) localStorage.setItem('wap_user', els.inUser.value.trim());
    else localStorage.removeItem('wap_user');
    sessionStorage.setItem('wap_session', JSON.stringify(me));
    enterChat();
  } catch (e) { els.loginErr.textContent = e.message; }
  els.btnLogin.disabled = false; els.btnLogin.textContent = '» Vào chát «';
}
function enterChat() {
  els.loginBox.style.display = 'none';
  els.chatBox.style.display = 'block';
  els.storeWarn.style.display = 'none';
  els.meInfo.innerHTML = `${esc(me.avatar)} <b style="color:${esc(me.color)}">${esc(me.nick)}</b> <small>(${esc(me.username)}${me.role === 'admin' ? ' 👑' : ''})</small>`;
  els.btnAdmin.style.display = isAdmin() ? '' : 'none';
  els.msgs.innerHTML = '';
  lastId = 0; lastTotal = -1; firstLoad = true;
  toggleAdmin(false);
  poll(); heartbeat(false);
  clearInterval(pollTimer); clearInterval(heartTimer);
  pollTimer = setInterval(poll, 1000);              // realtime: quét mỗi 1s (poll GitHub 304 rất nhẹ)
  heartTimer = setInterval(() => heartbeat(false), 10000); // giữ online
}
function doLogout() {
  typingStop();
  heartbeat(false);
  me = null; sessionStorage.removeItem('wap_session');
  clearInterval(pollTimer); clearInterval(heartTimer);
  els.chatBox.style.display = 'none'; els.loginBox.style.display = 'block';
  els.loginErr.textContent = '';
}

// ---- events ----
els.btnLogin.onclick = doLogin;
els.inPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
els.inUser.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.inPass.focus(); });
els.btnLogout.onclick = doLogout;
els.btnSend.onclick = () => { sendMsg(els.inMsg.value, 'text'); els.inMsg.value = ''; typingStop(); els.inMsg.focus(); };
els.inMsg.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.btnSend.click(); });
els.inMsg.addEventListener('input', typingStart);
els.btnSmile.onclick = () => togglePanel('smile');
els.btnSticker.onclick = () => togglePanel('sticker');
els.btnSound.onclick = () => { soundOn = !soundOn; els.btnSound.textContent = soundOn ? '🔔' : '🔕'; };
els.btnAdmin.onclick = () => toggleAdmin();
els.btnMyDel.onclick = async () => {
  if (!confirm('Xóa TOÀN BỘ tin nhắn CỦA BẠN trong phòng? (tin người khác giữ nguyên)')) return;
  try {
    const j = await api('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me.username, action: 'mine' }) });
    alert(`Đã xóa ${j.deleted} tin của bạn.`);
    poll();
  } catch (e) { alert(e.message); }
};
// nút ✕ trên từng tin (ủy quyền vì tin render động)
els.msgs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (b) deleteMsg(Number(b.dataset.del));
});

// đồng hồ wap
setInterval(() => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  els.clock.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}, 1000);

// tự đăng nhập lại
(function init() {
  buildPanels();
  const saved = localStorage.getItem('wap_user');
  if (saved) els.inUser.value = saved;
  try {
    const s = sessionStorage.getItem('wap_session');
    if (s) { me = JSON.parse(s); enterChat(); }
  } catch (e) {}
})();

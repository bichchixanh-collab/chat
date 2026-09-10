/* WAP CHAT frontend — realtime bằng polling 1.5s (tương thích Vercel serverless) */
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
  btnLogout: $('btnLogout'), btnSound: $('btnSound'),
  clock: $('clock'), connDot: $('connDot'), connTxt: $('connTxt'),
};

const SMILES = '😀😁😂🤣😊😍😘😎🤔😅😭😡👍👎🙏👏🔥🎉💔❤💯✌🤝👋🐱🐶🐼🦊🐸🍕🍺☕🌹⭐🌙⚽🎮🚀'
  .split(/(?:\uD83C[\uDDE6-\uDDFF])|./).filter(Boolean);
// fallback nếu split lỗi: dùng mảng cứng
const SMILE_LIST = ["😀","😁","😂","🤣","😊","😍","😘","😎","🤔","😅","😭","😡","👍","👎","🙏","👏","🔥","🎉","💔","❤️","💯","✌️","🤝","👋","🐱","🐶","🐼","🦊","🐸","🍕","🍺","☕","🌹","⭐","🌙","⚽","🎮","🚀"];
const STICKERS = ["😂","😍","😭","😡","🥳","😱","🤡","💩","👻","🎃","🐱","🐶","🐼","🦊","🐸","🦁","🐵","🐷","💘","💔","🔥","⭐","🌹","🎁","🍺","⚽","🚀","👍","👎","✌️","🤝","🙏"];

let me = null;          // {username, nick, color, avatar}
let lastId = 0;
let soundOn = true;
let pollTimer = null, heartTimer = null;

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

// ---- render ----
function addMsg(m, animate) {
  if (document.querySelector(`[data-mid="${m.id}"]`)) return;
  const div = document.createElement('div');
  const mine = me && m.user === me.username.toLowerCase();
  if (m.user === 'system' || m.type === 'system') {
    div.className = 'msg sys';
    div.dataset.mid = m.id;
    div.innerHTML = `<span>📢 ${esc(m.text)}</span><div class="time">${fmtTime(m.time)}</div>`;
  } else {
    div.className = 'msg' + (mine ? ' me' : '') + (m.type === 'sticker' || m.type === 'smile' ? ' stickerMsg' : '');
    div.dataset.mid = m.id;
    div.innerHTML =
      `<div class="head"><span>${esc(m.avatar || '👤')}</span> <b style="color:${esc(m.color || '#0066cc')}">${esc(m.nick || m.user)}</b>` +
      `<span class="time">${fmtTime(m.time)}</span></div>` +
      `<div class="body">${esc(m.text)}</div>`;
  }
  els.msgs.appendChild(div);
  // giới hạn DOM 200 tin cho nhẹ máy cùi
  while (els.msgs.children.length > 200) els.msgs.removeChild(els.msgs.firstChild);
  els.msgs.scrollTop = els.msgs.scrollHeight;
  if (animate && m.user !== 'system' && (!me || m.user !== me.username.toLowerCase())) beep();
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

// ---- API ----
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Lỗi ' + r.status));
  return j;
}

async function poll() {
  try {
    const q = new URLSearchParams({ since: lastId, user: me ? me.username : '' });
    const j = await api('/api/messages?' + q.toString());
    if (j.messages && j.messages.length) {
      const first = lastId !== 0;
      j.messages.forEach((m) => { addMsg(m, first); lastId = Math.max(lastId, m.id); });
    } else if (j.lastId) {
      lastId = Math.max(lastId, j.lastId);
    }
    renderOnline(j.online || []);
    renderTyping(j.typing || []);
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

async function sendMsg(text, type) {
  text = (text || '').trim();
  if (!text || !me) return;
  try {
    const j = await api('/api/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: me.username, text, type: type || 'text' }),
    });
    addMsg(j.message, false);
    lastId = Math.max(lastId, j.message.id);
  } catch (e) { alert(e.message); }
}

// ---- panels ----
function buildPanels() {
  els.smilePanel.innerHTML = '';
  SMILE_LIST.forEach((s) => {
    const el = document.createElement('span');
    el.textContent = s;
    el.onclick = () => { els.inMsg.value += s; els.inMsg.focus(); heartbeat(true); };
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
  els.meInfo.innerHTML = `${esc(me.avatar)} <b style="color:${esc(me.color)}">${esc(me.nick)}</b> <small>(${esc(me.username)})</small>`;
  els.msgs.innerHTML = ''; lastId = 0;
  poll(); heartbeat(false);
  clearInterval(pollTimer); clearInterval(heartTimer);
  pollTimer = setInterval(poll, 1500);       // realtime: quét tin mới mỗi 1.5s
  heartTimer = setInterval(() => heartbeat(false), 5000); // giữ online
}
function doLogout() {
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
els.btnSend.onclick = () => { sendMsg(els.inMsg.value, 'text'); els.inMsg.value = ''; heartbeat(false); els.inMsg.focus(); };
els.inMsg.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.btnSend.click(); });
els.inMsg.addEventListener('input', () => heartbeat(true));
els.btnSmile.onclick = () => togglePanel('smile');
els.btnSticker.onclick = () => togglePanel('sticker');
els.btnSound.onclick = () => { soundOn = !soundOn; els.btnSound.textContent = soundOn ? '🔔' : '🔕'; };

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

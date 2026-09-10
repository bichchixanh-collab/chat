# 💬 WAP CHAT v2 — realtime, lưu bằng file .json, deploy Vercel

Giao diện wap xưa (nhẹ, hợp máy yếu): đăng nhập, chat realtime, mặt cười 😀, sticker 🎁, online + đang gõ, **nhận diện link** (link ảnh nhúng thumbnail), **xóa chat**, **admin panel**.

## 1. Tài khoản (sửa trong `data/users.json`)

```json
{
  "users": [
    { "username": "admin", "password": "admin123", "nick": "Quản trị", "color": "#7c3aed", "avatar": "👑", "role": "admin" },
    { "username": "user1", "password": "pass1", "nick": "User Một", "color": "#d60000", "avatar": "🐯", "role": "user" }
  ]
}
```

- `role: "admin"` → toàn quyền: nút **⚙ Admin** hiện trong phòng chat.
- Đổi pass / thêm người: sửa file rồi push (hoặc admin sửa ngay trong panel 👥 Users).
- ⚠️ Đổi ngay pass `admin/admin123` sau khi deploy!

Mặc định: `admin/admin123` 👑, `user1/pass1`, `user2/pass2`, `user3/pass3`.

## 2. Chạy local (không cần cài gì, Node >= 18)

```bash
node server.js
# mở http://localhost:3000
```

Mở 2-3 tab đăng nhập các user khác nhau để test realtime.

## 3. Deploy Vercel + LƯU CHAT VĨNH VIỄN (quan trọng)

Vercel không cho ghi file → muốn **thoát ra vào lại vẫn còn chat, mọi user thấy chung**, phải bật backend GitHub (vẫn là file `.json` trong repo, xem/sửa được trên GitHub):

1. Tạo token: GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)** → **Generate** → tick **`repo`** → copy token (chỉ hiện 1 lần).
2. Vercel → project → **Settings → Environment Variables**, thêm:
   - `GITHUB_TOKEN` = token vừa copy
   - `GITHUB_REPO` = `ten-ban/wap-chat` (nếu repo private hoặc muốn chắc ăn; repo public cùng tài khoản thì tự nhận)
   - `GITHUB_BRANCH` = `main` (mặc định đã là `main`, khỏi thêm cũng được)
3. **Redeploy** (Deployments → ⋯ → Redeploy).

Xong: mỗi tin nhắn là 1 commit `wap-chat: update messages.json` trong repo. Chế độ lưu hiện ở chân phòng chat: `💾 github (dùng chung)` là OK. Nếu hiện `⚠️ bộ nhớ tạm` nghĩa là chưa cấu hình token → chat mất khi restart.

Lưu ý: `data/meta.json` giữ ID tăng dần (để đồng bộ xóa đúng) — đừng sửa tay.

## 8. Tốc độ đồng bộ (delay bao nhiêu là bình thường?)

- Gửi → hiện ở máy khác mất khoảng **1-2s**: gồm 1 lần ghi GitHub (~1s, GitHub phải tạo commit) + long-poll trả ngay sau đó.
- Lần đầu mở web sau một lúc không ai dùng có thể chậm thêm 1-3s (Vercel "ngủ đông", cần hâm máy).
- Code đã tối ưu: bên gửi chỉ còn 1 vòng đọc song song + 1 vòng ghi duy nhất, bên nhận long-poll (không quét interval), poll idle dính ETag 304 nên không tốn rate-limit.
- **Giới hạn cứng**: chừng nào còn ghi file qua GitHub API thì không thể dưới ~1s. Muốn gần như tức thì (<1s) phải đổi backend realtime (Supabase/Vercel KV...) — vẫn giữ nguyên giao diện, bảo mình là mình chuyển.

## 4. Tính năng

| Tính năng | Ai dùng | Cách dùng |
|---|---|---|
| Đăng nhập giữ 24 giờ | mọi user | tick **Ghi nhớ tôi (24 giờ)** khi login → tắt máy mở lại vẫn vào thẳng phòng chat; bỏ tick = chỉ giữ theo tab. Hết 24h (hoặc bấm Thoát) thì login lại. Đang online mà hết hạn sẽ có thông báo + đá về login. Còn dưới 6h mà vẫn online thì tự gia hạn thêm 24h |
|---|---|---|
| Chat / sticker / smile realtime | mọi user | gõ + Gửi; 😀 chèn cười, 🎁 gửi sticker ngay (~2s mọi người thấy) |
| Lịch sử dùng chung | mọi user | vào phòng là tự tải 100 tin gần nhất, thoát ra vào lại vẫn còn |
| Nhận diện link | mọi user | dán `https://...` hoặc `www...` tự thành link bấm được; link ảnh (.jpg/.png/.gif/.webp) tự nhúng thumbnail |
| Xóa 1 tin của mình | mọi user | nút **✕** trên tin của mình |
| Xóa toàn bộ tin của mình | mọi user | nút **🗑 Xóa chat của tôi** dưới khung nhập |
| Xóa tin bất kỳ | admin | nút **✕** trên mọi tin + tab 💬 trong Admin panel |
| Xóa toàn bộ chat | admin | Admin panel → **Xóa TOÀN BỘ** (hỏi 2 lần) |
| Xóa chat theo ngày (giờ VN) | admin | Admin panel → chọn ngày → **Xóa ngày này** |
| Quản lý users | admin | Admin panel → tab 👥: thêm / sửa nick-pass-avatar-màu-quyền / xóa user (+chat của họ) |

Mọi hành động xóa đều **realtime**: các máy khác tự cập nhật trong ~2s.

## 5. Realtime kiểu gì?

Vercel serverless không giữ websocket → **long-polling**: client gửi `GET /api/messages?wait=1` kèm `total` đang có, server giữ request tới ~7s, có tin mới/xóa là trả ngay → máy nhận thấy sau **~0.5s** (không tốn rate-limit vì lượt check dính ETag 304). Nhận xong client gọi tiếp request khác ngay. Hết 7s không có gì thì tự nhả và gọi lại. Online: ping 10s, quá 30s coi như offline.

## 6. Cấu trúc

```
index.html / style.css / app.js -> giao diện wap + admin panel
api/login.js    -> POST {username,password,remember} (cấp token + cookie 24h)
api/session.js  -> GET verify token / POST logout (tự đăng nhập lại, hủy phiên)
api/messages.js -> GET long-poll / POST heartbeat (kèm kiểm tra + gia hạn session)
api/send.js     -> POST {user,text,type} (đọc/ghi song song + xếp hàng chống mất tin)
api/delete.js   -> POST {user, action: one|mine (mọi user) / any|all|byDate (admin)}
api/admin.js    -> GET/POST quản lý users + xem tin (chỉ admin)
api/_store.js   -> đọc/ghi .json (file local | GitHub repo | /tmp tạm) + genId + lock + session
data/users.json -> tài khoản ———————— sửa được
data/messages.json -> lịch sử chat (giữ 300 tin)
data/sessions.json -> phiên đăng nhập 24h (chỉ lưu SHA256 token — đừng sửa tay)
data/online.json, typing.json -> trạng thái online/đang gõ
```

## 7. Reset chat (local)

Sửa `data/messages.json` về `{"messages":[]}` rồi restart `node server.js`. Trên production: vào Admin panel → Xóa TOÀN BỘ.

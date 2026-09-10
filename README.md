# 💬 WAP CHAT — realtime, lưu bằng file .json, deploy Vercel

Giao diện wap xưa (nhẹ, hợp máy yếu), có đăng nhập, chat realtime, mặt cười 😀, sticker 🎁, hiển thị ai đang online + ai đang gõ.

## 1. Tài khoản (thay đổi được)

Mở file **`data/users.json`** rồi sửa, ví dụ:

```json
{
  "users": [
    { "username": "user1", "password": "pass1", "nick": "User Một", "color": "#d60000", "avatar": "🐯" },
    { "username": "user2", "password": "pass2", "nick": "User Hai", "color": "#0066cc", "avatar": "🐼" },
    { "username": "user3", "password": "pass3", "nick": "User Ba", "color": "#008800", "avatar": "🦊" }
  ]
}
```

- Muốn thêm người: thêm 1 object vào mảng `users`.
- Muốn đổi pass: sửa `password` rồi commit + redeploy là xong.

Mặc định: `user1/pass1`, `user2/pass2`, `user3/pass3`.

## 2. Chạy thử ở máy local (không cần cài gì)

Yêu cầu: Node.js >= 18.

```bash
node server.js
# mở http://localhost:3000
```

Mở 2-3 tab khác nhau, đăng nhập 3 user để test chat realtime.

## 3. Upload GitHub + deploy Vercel

```bash
git add .
git commit -m "wap chat v1"
git push origin main
```

Lên [vercel.com](https://vercel.com) → **Add New → Project → Import** repo này → **Deploy**.
Không cần chỉnh gì thêm (đã có `vercel.json`, `api/*.js` tự thành serverless functions).

Cấu trúc:

```
index.html / style.css / app.js   -> giao diện wap
api/login.js                      -> POST {username,password} check data/users.json
api/messages.js                   -> GET ?since=&user= (poll realtime) + POST heartbeat online/typing
api/send.js                       -> POST {user,text,type} (text|sticker|smile)
api/_store.js                     -> helper đọc/ghi .json (local + /tmp trên Vercel)
data/users.json                   -> tài khoản (sửa được)
data/messages.json                -> lịch sử chat (app tự ghi, giữ 300 tin)
data/online.json, typing.json     -> trạng thái online/đang gõ
```

## 4. Realtime kiểu gì?

- Vercel serverless **không giữ websocket**, nên app dùng **polling**: client gọi `GET /api/messages?since=lastId` mỗi **1.5 giây**.
- Chat / sticker / smile đều đi qua `POST /api/send` → lần poll kế tiếp là mọi người thấy ngay (~1-2s), có ting + tự cuộn.
- Online: client ping mỗi 5s, ai quá 15s không ping coi như offline.
- Đang gõ: client báo `typing:true` khi nhập, hiện `✍️ user1 đang gõ...`.

## 5. ⚠️ Lưu ý quan trọng về file .json trên Vercel

- Code đã xử lý: local thì ghi thẳng vào `data/*.json` (bạn thấy file đổi).
- Trên Vercel, filesystem chỉ đọc → app tự chuyển sang ghi ở `/tmp/wapchat/*.json`.
- Hệ quả: **chat sẽ mất khi Vercel cold-start / redeploy**, vì `/tmp` là tạm.
- Đây là giới hạn của Vercel free + yêu cầu "lưu bằng file .json".
- Khi nào cần lưu vĩnh viễn: bảo mình, mình chuyển sang Vercel KV / Postgres mà **giữ nguyên giao diện**.

## 6. Reset chat

Xóa tin nhắn trong `data/messages.json` về `{"messages":[]}` rồi push lại (local thì restart `node server.js`).

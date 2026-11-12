// =============================================================
//  TikTok Live Gift Printer - Server
//  Kết nối TikTok LIVE -> nhận sự kiện tặng quà -> gửi xuống trình duyệt để in avatar
// =============================================================
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// Proxy ảnh avatar: CDN của TikTok hay chặn hotlink / CORS,
// nên trình duyệt sẽ tải ảnh qua server mình.
// Chỉ cho phép domain của TikTok để tránh bị lợi dụng làm open-proxy.
// -------------------------------------------------------------
const ALLOWED_IMG_HOST = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|ibyteimg\.com|byteimg\.com|muscdn\.com)$/i;

app.get('/avatar', async (req, res) => {
  try {
    const url = new URL(String(req.query.url || ''));
    if (url.protocol !== 'https:' || !ALLOWED_IMG_HOST.test(url.hostname)) {
      return res.status(400).send('URL ảnh không hợp lệ');
    }
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' } });
    if (!r.ok) return res.status(502).send('Không tải được ảnh');
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(400).send('Lỗi: ' + e.message);
  }
});

// -------------------------------------------------------------
// Lấy thông tin gọn từ sự kiện gift.
// Thư viện v2 trả về dữ liệu theo schema proto v3 (user.displayId, user.avatarThumb.urlList, gift.type...)
// nhưng README cũ dùng tên khác (uniqueId, profilePicture, giftDetails) -> đọc cả hai cho chắc.
// -------------------------------------------------------------
function pickUrl(img) {
  return img?.urlList?.[0] || img?.url?.[0] || null;
}

function parseGift(data) {
  const u = data.user || {};
  return {
    uniqueId: u.uniqueId || u.displayId || u.id || 'unknown',
    nickname: u.nickname || u.uniqueId || u.displayId || '',
    avatar:
      pickUrl(u.avatarLarge) || pickUrl(u.avatarMedium) || pickUrl(u.avatarThumb) || pickUrl(u.profilePicture),
    giftName: data.gift?.name || data.giftDetails?.giftName || data.extendedGiftInfo?.name || `Gift #${data.giftId}`,
    giftImage: pickUrl(data.gift?.image) || pickUrl(data.giftDetails?.giftImage),
    giftType: data.gift?.type ?? data.giftDetails?.giftType,
    diamondCount: data.gift?.diamondCount ?? data.giftDetails?.diamondCount ?? 0,
    repeatCount: Number(data.repeatCount) || 1,
    repeatEnd: Boolean(data.repeatEnd),
    time: Date.now(),
  };
}

// -------------------------------------------------------------
// Quản lý kết nối TikTok LIVE (mỗi lúc chỉ 1 phiên live)
// -------------------------------------------------------------
let live = null; // TikTokLiveConnection hiện tại
let liveUser = null;

function broadcastStatus(state, message) {
  io.emit('status', { state, user: liveUser, message });
  console.log(`[status] ${state}${message ? ' - ' + message : ''}`);
}

async function connectLive(username) {
  await disconnectLive();
  liveUser = username.replace(/^@/, '').trim();
  live = new TikTokLiveConnection(liveUser, { processInitialData: false });

  // Sự kiện tặng quà
  live.on(WebcastEvent.GIFT, (data) => {
    const g = parseGift(data);
    // giftType 1 = quà có thể "combo" (bấm liên tục). Trong lúc combo, TikTok bắn nhiều event,
    // chỉ xử lý khi repeatEnd = true (kết thúc combo) để không in trùng.
    if (g.giftType === 1 && !g.repeatEnd) return;
    console.log(`[gift] @${g.uniqueId} tặng ${g.repeatCount}x ${g.giftName} (${g.diamondCount} 💎)`);
    io.emit('gift', g);
  });

  live.on(WebcastEvent.STREAM_END, () => broadcastStatus('ended', 'Buổi live đã kết thúc'));
  live.on(ControlEvent.DISCONNECTED, () => broadcastStatus('disconnected', 'Mất kết nối'));
  live.on(ControlEvent.ERROR, (err) => console.error('[live error]', err?.message || err));

  broadcastStatus('connecting', `Đang kết nối @${liveUser}...`);
  const state = await live.connect();
  broadcastStatus('connected', `Đã kết nối @${liveUser} (roomId ${state.roomId})`);
}

async function disconnectLive() {
  if (live) {
    try { live.removeAllListeners(); await live.disconnect(); } catch (_) {}
    live = null;
    broadcastStatus('disconnected', 'Đã ngắt kết nối');
  }
}

// -------------------------------------------------------------
// Socket.IO: giao tiếp giữa trình duyệt <-> server
// -------------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('status', { state: live ? 'connected' : 'disconnected', user: liveUser });

  socket.on('connect-live', async (username, ack) => {
    try {
      if (!username) throw new Error('Chưa nhập username');
      await connectLive(username);
      ack?.({ ok: true });
    } catch (e) {
      const msg = e?.message || String(e);
      broadcastStatus('error', msg);
      live = null;
      ack?.({ ok: false, error: msg });
    }
  });

  socket.on('disconnect-live', async (ack) => {
    await disconnectLive();
    ack?.({ ok: true });
  });

  // Giả lập 1 lượt tặng quà để test máy in mà không cần đang live
  socket.on('test-gift', () => {
    io.emit('gift', {
      uniqueId: 'test_user',
      nickname: 'Người test',
      avatar: null, // client sẽ dùng ảnh mẫu
      giftName: 'Rose',
      giftType: 1,
      diamondCount: 1,
      repeatCount: 1,
      repeatEnd: true,
      time: Date.now(),
      test: true,
    });
  });
});

server.listen(PORT, () => {
  console.log(`✅ Mở trình duyệt: http://localhost:${PORT}`);
});

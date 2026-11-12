// =============================================================
//  TikTok Live Gift Printer - Server
//  TikTok LIVE -> sự kiện tặng quà -> SERVER tự quyết định & tự gửi lệnh in ra máy in
//  (không phụ thuộc trình duyệt: đóng tab web vẫn in, mở nhiều tab cũng không in trùng)
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { TikTokLiveConnection, WebcastEvent, ControlEvent, UserOfflineError } from 'tiktok-live-connector';
import { listPrinters, printGift } from './printer.js';
import { initStats, logGift, logPrint, getOverview, getDay, getDayCsv } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

// =============================================================
// 1. CÀI ĐẶT (lưu ra file settings.json để tắt/mở lại server vẫn còn)
// =============================================================
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
initStats(path.join(__dirname, 'data')); // thống kê lưu trong thư mục data/
const DEFAULTS = {
  username: '', // tài khoản TikTok đang live
  autoConnect: false, // true = đang bật kết nối -> server khởi động lại sẽ tự kết nối lại
  printer: '', // tên máy in
  paperMm: 58, // khổ giấy
  autoPrint: true, // tự động in khi có quà
  oncePerUser: true, // mỗi người chỉ in 1 lần
  minDiamonds: 1, // giá trị quà tối thiểu (kim cương, tính cả combo)
  thanksTemplate: 'Thank you {name}! Here is a photo for you.', // câu đọc cảm ơn, {name} = tên người tặng
};
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
} catch (_) {}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('[settings] Không lưu được:', e.message);
  }
  io.emit('settings', settings);
}

// Chỉ nhận đúng các trường hợp lệ từ giao diện
function updateSettings(patch = {}) {
  if (typeof patch.printer === 'string') settings.printer = patch.printer;
  if ([50, 58, 80].includes(Number(patch.paperMm))) settings.paperMm = Number(patch.paperMm);
  if (typeof patch.autoPrint === 'boolean') settings.autoPrint = patch.autoPrint;
  if (typeof patch.oncePerUser === 'boolean') settings.oncePerUser = patch.oncePerUser;
  if (Number.isFinite(Number(patch.minDiamonds))) settings.minDiamonds = Math.max(0, Number(patch.minDiamonds));
  if (typeof patch.thanksTemplate === 'string') settings.thanksTemplate = patch.thanksTemplate.slice(0, 200).trim() || DEFAULTS.thanksTemplate;
  saveSettings();
}

// =============================================================
// 2. ĐỌC DỮ LIỆU SỰ KIỆN QUÀ
// Dữ liệu thật (đã kiểm tra trên live thật) theo schema proto v3:
//   user.displayId = @username, user.nickname, user.avatarThumb.urlList (ảnh 100x100)
//   gift.name, gift.type (1 = quà combo), gift.diamondCount, repeatCount, repeatEnd, common.msgId
// README của thư viện dùng tên cũ (uniqueId, giftDetails, profilePicture) -> đọc cả hai.
// =============================================================
const pickUrl = (img) => img?.urlList?.[0] || img?.url?.[0] || null;

function parseGift(data) {
  const u = data.user || {};
  return {
    msgId: data.common?.msgId || null,
    uniqueId: u.uniqueId || u.displayId || u.id || 'unknown',
    nickname: u.nickname || u.uniqueId || u.displayId || '',
    avatar: pickUrl(u.avatarLarge) || pickUrl(u.avatarMedium) || pickUrl(u.avatarThumb) || pickUrl(u.profilePicture),
    giftName: data.gift?.name || data.giftDetails?.giftName || data.extendedGiftInfo?.name || `Gift #${data.giftId}`,
    giftType: data.gift?.type ?? data.giftDetails?.giftType,
    diamondCount: data.gift?.diamondCount ?? data.giftDetails?.diamondCount ?? 0,
    repeatCount: Number(data.repeatCount) || 1,
    repeatEnd: Boolean(data.repeatEnd),
    time: Date.now(),
  };
}

// =============================================================
// 3. XỬ LÝ QUÀ -> QUYẾT ĐỊNH IN -> GỬI LỆNH IN
// =============================================================
const history = []; // 100 quà gần nhất (để giao diện hiển thị, in lại)
const printedUsers = new Set(); // người đã được in (cho chế độ "mỗi người 1 lần")
const seenMsgIds = new Set(); // chống sự kiện trùng
let seq = 0;

function updateRecord(rec, patch) {
  Object.assign(rec, patch);
  io.emit('gift-update', { id: rec.id, status: rec.status, reason: rec.reason, error: rec.error });
}

function handleGift(g, { force = false } = {}) {
  if (g.msgId) {
    if (seenMsgIds.has(g.msgId)) return;
    if (seenMsgIds.size > 5000) seenMsgIds.clear();
    seenMsgIds.add(g.msgId);
  }

  const total = (g.diamondCount || 0) * (g.repeatCount || 1);
  let reason = null;
  if (!force) {
    if (!settings.autoPrint) reason = 'tắt tự động in';
    else if (total < settings.minDiamonds) reason = `dưới ${settings.minDiamonds} 💎`;
    else if (settings.oncePerUser && printedUsers.has(g.uniqueId)) reason = 'đã in rồi';
  }

  const rec = { ...g, id: ++seq, total, status: reason ? 'skipped' : 'queued', reason, error: null };
  history.unshift(rec);
  history.length = Math.min(history.length, 100);
  io.emit('gift', rec);
  console.log(`[gift] @${g.uniqueId} tặng ${g.repeatCount}x ${g.giftName} (${total} 💎) -> ${reason ? 'bỏ qua: ' + reason : 'IN'}`);

  // Ghi vào thống kê vĩnh viễn (không ghi lượt in thử)
  if (!g.test) {
    logGift(rec, { room: settings.username, status: rec.status, reason });
    io.emit('stats-changed');
  }

  if (!reason) {
    sendToPrinter(rec);
    speakThanks(rec);
  }
}

// =============================================================
// 3b. ĐỌC LỜI CẢM ƠN (giọng tiếng Anh, phát trên trình duyệt đang bật "loa")
// =============================================================
// Tên đọc bằng giọng tiếng Anh: bỏ dấu tiếng Việt (Được -> Duoc), bỏ emoji/ký hiệu, tối đa 30 ký tự.
// Tên không còn chữ (toàn emoji, chữ Hàn...) -> dùng @username nếu dễ đọc, không thì "my friend".
function speakableName(g) {
  const clean = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '') // bỏ dấu
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9 .'-]/g, ' ') // chỉ giữ chữ Latin, số
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30);
  const nick = clean(g.nickname);
  if (/[A-Za-z]{2,}/.test(nick)) return nick;
  const handle = clean(String(g.uniqueId).replace(/[._]/g, ' '));
  if (/[A-Za-z]{2,}/.test(handle) && !/^user\s?\d+$/i.test(handle)) return handle; // "user123456789" đọc rất dài -> bỏ
  return 'my friend';
}

let speakerId = null; // socket.id của tab đang làm "loa" (chỉ 1 tab đọc để không bị đọc chồng)

function speakThanks(g) {
  if (!speakerId) return;
  const text = settings.thanksTemplate.replace(/\{name\}/g, speakableName(g));
  io.to(speakerId).emit('speak', { text });
}

async function sendToPrinter(rec) {
  if (!settings.printer) {
    updateRecord(rec, { status: 'error', error: 'Chưa chọn máy in' });
    return;
  }
  printedUsers.add(rec.uniqueId); // đánh dấu ngay để quà tiếp theo của người này không xếp hàng in trùng
  updateRecord(rec, { status: 'queued', reason: null, error: null });
  try {
    await printGift(rec, { printer: settings.printer, paperMm: settings.paperMm });
    updateRecord(rec, { status: 'printed' });
    if (!rec.test) {
      logPrint(rec.uniqueId, true);
      io.emit('stats-changed');
    }
  } catch (e) {
    printedUsers.delete(rec.uniqueId); // in lỗi -> cho phép in lại lần sau
    console.error('[print error]', e?.message || e);
    updateRecord(rec, { status: 'error', error: e?.message || String(e) });
  }
}

// =============================================================
// 4. KẾT NỐI TIKTOK LIVE + TỰ ĐỘNG KẾT NỐI LẠI
//  - Chưa lên live: cứ 30 giây kiểm tra lại, lên live là tự kết nối
//  - Rớt mạng / TikTok ngắt: tự kết nối lại (5s, 10s, 20s... tối đa 60s)
// =============================================================
let live = null;
let wantConnected = false;
let retryTimer = null;
let retryCount = 0;
let lastStatus = { state: 'disconnected', message: 'Chưa kết nối' };

// Theo dõi "sức khoẻ" kết nối: thời điểm nhận dữ liệu gần nhất, số người xem, số quà
const health = { lastDataAt: 0, viewers: null, gifts: 0, connectedAt: 0 };
const STALE_MS = 120000; // 2 phút không có dữ liệu nào -> coi như kết nối chết -> kết nối lại

function setStatus(state, message) {
  lastStatus = { state, user: settings.username, message };
  io.emit('status', lastStatus);
  console.log(`[status] ${state} - ${message}`);
}

function closeConnection() {
  if (!live) return;
  const conn = live;
  live = null;
  conn.removeAllListeners(); // gỡ listener trước để sự kiện "disconnected" không kích hoạt kết nối lại
  try {
    conn.disconnect()?.catch?.(() => {});
  } catch (_) {}
}

function scheduleRetry(ms) {
  if (!wantConnected) return;
  const delay = ms ?? Math.min(60000, 5000 * 2 ** retryCount++);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(openConnection, delay);
  return Math.round(delay / 1000);
}

async function openConnection() {
  clearTimeout(retryTimer);
  closeConnection();
  const user = settings.username;
  const conn = new TikTokLiveConnection(user, { processInitialData: false });
  live = conn;

  // Mọi gói dữ liệu từ TikTok (kể cả bình luận, tim, người vào phòng...) -> kết nối còn sống
  conn.on(ControlEvent.WEBSOCKET_DATA, () => (health.lastDataAt = Date.now()));
  conn.on(WebcastEvent.ROOM_USER, (d) => (health.viewers = Number(d.total) || health.viewers));

  conn.on(WebcastEvent.GIFT, (data) => {
    health.gifts++;
    const g = parseGift(data);
    // gift.type 1 = quà combo: trong lúc bấm liên tục TikTok gửi nhiều sự kiện,
    // chỉ xử lý sự kiện cuối (repeatEnd = true) để không in trùng.
    if (g.giftType === 1 && !g.repeatEnd) return;
    handleGift(g);
  });

  conn.on(WebcastEvent.STREAM_END, () => {
    closeConnection();
    scheduleRetry(30000);
    setStatus('waiting', `Live của @${user} đã kết thúc. Đang chờ lên live lại...`);
  });

  conn.on(ControlEvent.DISCONNECTED, () => {
    if (live !== conn) return;
    const s = scheduleRetry();
    setStatus('reconnecting', `Mất kết nối, tự kết nối lại sau ${s}s...`);
  });

  conn.on(ControlEvent.ERROR, (err) => {
    const ex = err?.exception || err;
    if (ex instanceof UserOfflineError || ex?.name === 'UserOfflineError') return; // đã báo ở trạng thái "chờ live"
    console.error('[live error]', err?.info ? `${err.info}: ${ex?.message || ex}` : ex?.message || ex);
  });

  setStatus('connecting', `Đang kết nối @${user}...`);
  try {
    const state = await conn.connect();
    if (live !== conn) return; // đã bị ngắt/đổi tài khoản trong lúc đang kết nối
    retryCount = 0;
    Object.assign(health, { lastDataAt: Date.now(), connectedAt: Date.now(), viewers: null, gifts: 0 });
    setStatus('connected', `Đã kết nối @${user} (phòng ${state.roomId}). Có quà là tự in.`);
  } catch (e) {
    if (live !== conn) return;
    closeConnection();
    if (e instanceof UserOfflineError || e?.name === 'UserOfflineError') {
      scheduleRetry(30000);
      setStatus('waiting', `@${user} chưa lên live. Tự kiểm tra lại mỗi 30 giây...`);
    } else {
      const s = scheduleRetry();
      setStatus('error', `Lỗi: ${e?.message || e}. Thử lại sau ${s}s...`);
    }
  }
}

function startLive(username) {
  const user = String(username || '').replace(/^@/, '').trim();
  if (!user) throw new Error('Chưa nhập username');
  settings.username = user;
  settings.autoConnect = true;
  saveSettings();
  wantConnected = true;
  retryCount = 0;
  openConnection();
}

function stopLive() {
  wantConnected = false;
  clearTimeout(retryTimer);
  closeConnection();
  settings.autoConnect = false;
  saveSettings();
  setStatus('disconnected', 'Đã ngắt kết nối');
}

// Watchdog: 15 giây kiểm tra 1 lần. Kết nối "chết lặng" (không báo ngắt nhưng không còn dữ liệu)
// -> tự kết nối lại. Đồng thời gửi số người xem / thời điểm dữ liệu mới nhất lên giao diện.
setInterval(() => {
  const connected = lastStatus.state === 'connected' && live;
  if (connected && Date.now() - health.lastDataAt > STALE_MS) {
    console.warn('[watchdog] 2 phút không nhận được dữ liệu từ TikTok -> kết nối lại');
    setStatus('reconnecting', 'Không nhận được dữ liệu từ TikTok, đang kết nối lại...');
    retryCount = 0;
    openConnection();
  }
  io.emit('health', connected ? { ...health, now: Date.now() } : null);
}, 15000);

// =============================================================
// 5. PROXY ẢNH AVATAR cho giao diện (CDN TikTok chặn web khác lấy ảnh trực tiếp)
// =============================================================
const ALLOWED_IMG_HOST = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|ibyteimg\.com|byteimg\.com|muscdn\.com)$/i;

app.get('/avatar', async (req, res) => {
  try {
    const url = new URL(String(req.query.url || ''));
    if (url.protocol !== 'https:' || !ALLOWED_IMG_HOST.test(url.hostname)) return res.status(400).send('URL ảnh không hợp lệ');
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).send('Không tải được ảnh');
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(400).send('Lỗi: ' + e.message);
  }
});

// =============================================================
// 5b. API THỐNG KÊ (tab "Thống kê" trên giao diện gọi tới)
//   GET /api/stats              -> tổng quan: hôm nay, 7 ngày, tổng cộng, danh sách các ngày
//   GET /api/stats/2026-11-12   -> chi tiết 1 ngày: top người tặng, loại quà, danh sách
//   GET /api/stats/2026-11-12.csv -> tải file Excel (CSV) của ngày đó
// =============================================================
app.get('/api/stats', (req, res) => res.json(getOverview()));

app.get(/^\/api\/stats\/(\d{4}-\d{2}-\d{2})(\.csv)?$/, (req, res) => {
  const [date, csv] = [req.params[0], req.params[1]];
  if (!csv) return res.json(getDay(date));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="qua-tang-${date}.csv"`);
  res.send(getDayCsv(date));
});

// =============================================================
// 6. SOCKET.IO: giao diện web chỉ để XEM và CÀI ĐẶT
// =============================================================
io.on('connection', (socket) => {
  socket.emit('settings', settings);
  socket.emit('status', lastStatus);
  socket.emit('history', history);

  socket.on('connect-live', (username, ack) => {
    try {
      startLive(username);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });
  socket.on('disconnect-live', (ack) => {
    stopLive();
    ack?.({ ok: true });
  });

  socket.on('update-settings', (patch) => updateSettings(patch));

  socket.on('list-printers', async (ack) => {
    try {
      ack?.({ ok: true, ...(await listPrinters()) });
    } catch (e) {
      ack?.({ ok: false, error: e?.message || String(e) });
    }
  });

  // In lại 1 quà trong danh sách (bỏ qua bộ lọc)
  socket.on('reprint', (id) => {
    const rec = history.find((r) => r.id === id);
    if (rec) sendToPrinter(rec);
  });

  socket.on('reset-printed', () => printedUsers.clear());

  // Tab bật "Đọc lời cảm ơn" -> trở thành loa duy nhất; tab loa cũ tự tắt
  socket.emit('speaker', { id: speakerId });
  socket.on('claim-speaker', () => {
    speakerId = socket.id;
    io.emit('speaker', { id: speakerId });
  });
  socket.on('release-speaker', () => {
    if (speakerId === socket.id) speakerId = null;
    io.emit('speaker', { id: speakerId });
  });
  socket.on('disconnect', () => {
    if (speakerId === socket.id) {
      speakerId = null;
      io.emit('speaker', { id: null });
    }
  });

  // Reset quà tặng: xoá danh sách quà + bộ đếm quà + danh sách "đã in" -> bắt đầu lại từ đầu.
  // Không ảnh hưởng kết nối live và các lệnh in đang chạy dở.
  socket.on('reset-gifts', () => {
    history.length = 0;
    printedUsers.clear();
    health.gifts = 0;
    io.emit('history', []); // mọi tab đang mở cùng xoá danh sách
    console.log('[reset] Đã xoá danh sách quà tặng');
  });

  // In thử (không cần đang live)
  socket.on('test-print', () =>
    handleGift(
      { uniqueId: 'test_user', nickname: 'Người test', avatar: null, giftName: 'Rose', giftType: 1, diamondCount: 1, repeatCount: 1, time: Date.now(), test: true },
      { force: true }
    )
  );
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Cổng ${PORT} đang bị dùng: có thể app đã chạy ở một cửa sổ khác (tắt cửa sổ đó rồi chạy lại).`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log(`✅ Mở trình duyệt: http://localhost:${PORT}`);
  // Lần trước đang bật kết nối -> tự kết nối lại khi khởi động server
  if (settings.autoConnect && settings.username) {
    console.log(`[auto] Tự kết nối lại @${settings.username}`);
    wantConnected = true;
    openConnection();
  }
});

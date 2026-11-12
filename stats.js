// =============================================================
//  THỐNG KÊ QUÀ TẶNG (lưu vĩnh viễn, không bị mất khi bấm Reset hay tắt server)
//  Mỗi sự kiện được ghi thêm 1 dòng JSON vào data/gift-log.jsonl:
//    {"type":"gift",  "t":..., "date":"2026-11-12", "room":"shop", "uniqueId":"lan", ... }
//    {"type":"print", "t":..., "date":"2026-11-12", "uniqueId":"lan", "ok":true }
//  Định dạng JSONL (mỗi dòng 1 JSON): ghi nối thêm rất nhanh, file hỏng 1 dòng không ảnh hưởng dòng khác.
// =============================================================
import fs from 'node:fs';
import path from 'node:path';

let LOG_FILE = null;

export function initStats(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  LOG_FILE = path.join(dataDir, 'gift-log.jsonl');
}

// Ngày theo giờ của máy tính (YYYY-MM-DD) -> quà lúc 23:59 và 00:01 nằm đúng 2 ngày khác nhau
export function localDate(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function append(entry) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('[stats] Không ghi được thống kê:', e.message);
  }
}

export function logGift(g, { room, status, reason }) {
  append({
    type: 'gift',
    t: g.time,
    date: localDate(g.time),
    room,
    uniqueId: g.uniqueId,
    nickname: g.nickname,
    avatar: g.avatar,
    giftName: g.giftName,
    repeatCount: g.repeatCount,
    diamondCount: g.diamondCount,
    total: g.total,
    status,
    reason,
  });
}

export function logPrint(uniqueId, ok) {
  const t = Date.now();
  append({ type: 'print', t, date: localDate(t), uniqueId, ok });
}

function readAll() {
  try {
    return fs
      .readFileSync(LOG_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null; // bỏ qua dòng hỏng
        }
      })
      .filter(Boolean);
  } catch {
    return []; // chưa có file
  }
}

// ---------- Tổng hợp theo ngày ----------
function emptyDay(date) {
  return { date, gifts: 0, items: 0, diamonds: 0, givers: new Set(), prints: 0 };
}

function summarize(days) {
  const s = { gifts: 0, items: 0, diamonds: 0, givers: new Set(), prints: 0 };
  for (const d of days) {
    s.gifts += d.gifts;
    s.items += d.items;
    s.diamonds += d.diamonds;
    s.prints += d.prints;
    d.givers.forEach((u) => s.givers.add(u));
  }
  return { gifts: s.gifts, items: s.items, diamonds: s.diamonds, givers: s.givers.size, prints: s.prints };
}

export function getOverview() {
  const map = new Map();
  for (const e of readAll()) {
    if (!map.has(e.date)) map.set(e.date, emptyDay(e.date));
    const d = map.get(e.date);
    if (e.type === 'gift') {
      d.gifts += 1; // lượt tặng (1 combo = 1 lượt)
      d.items += e.repeatCount || 1; // số món quà (combo 10 Rose = 10 món)
      d.diamonds += e.total || 0;
      d.givers.add(e.uniqueId);
    } else if (e.type === 'print' && e.ok) {
      d.prints += 1;
    }
  }
  const all = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  const today = localDate();
  const weekAgo = localDate(Date.now() - 6 * 86400000);
  return {
    today: summarize(all.filter((d) => d.date === today)),
    week: summarize(all.filter((d) => d.date >= weekAgo)),
    total: summarize(all),
    days: all.map((d) => ({ ...d, givers: d.givers.size })),
  };
}

export function getDay(date) {
  const entries = readAll().filter((e) => e.date === date);
  const gifts = entries.filter((e) => e.type === 'gift');

  // Bảng xếp hạng người tặng
  const people = new Map();
  for (const g of gifts) {
    const p = people.get(g.uniqueId) || { uniqueId: g.uniqueId, nickname: g.nickname, avatar: g.avatar, gifts: 0, items: 0, diamonds: 0 };
    p.gifts += 1;
    p.items += g.repeatCount || 1;
    p.diamonds += g.total || 0;
    p.nickname = g.nickname || p.nickname;
    p.avatar = g.avatar || p.avatar;
    people.set(g.uniqueId, p);
  }

  // Thống kê theo loại quà
  const types = new Map();
  for (const g of gifts) {
    const t = types.get(g.giftName) || { giftName: g.giftName, items: 0, diamonds: 0 };
    t.items += g.repeatCount || 1;
    t.diamonds += g.total || 0;
    types.set(g.giftName, t);
  }

  return {
    date,
    summary: {
      gifts: gifts.length,
      items: gifts.reduce((n, g) => n + (g.repeatCount || 1), 0),
      diamonds: gifts.reduce((n, g) => n + (g.total || 0), 0),
      givers: people.size,
      prints: entries.filter((e) => e.type === 'print' && e.ok).length,
    },
    topGivers: [...people.values()].sort((a, b) => b.diamonds - a.diamonds || b.gifts - a.gifts),
    giftTypes: [...types.values()].sort((a, b) => b.diamonds - a.diamonds),
    items: gifts.sort((a, b) => b.t - a.t),
  };
}

// File CSV mở bằng Excel (có BOM để Excel hiển thị đúng tiếng Việt)
export function getDayCsv(date) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Thời gian', 'Phòng live', 'Username', 'Tên', 'Quà', 'Số lượng', 'Giá 1 quà (💎)', 'Tổng 💎', 'Trạng thái in']];
  for (const g of getDay(date).items.slice().reverse()) {
    rows.push([
      new Date(g.t).toLocaleString('vi-VN'),
      g.room,
      '@' + g.uniqueId,
      g.nickname,
      g.giftName,
      g.repeatCount,
      g.diamondCount,
      g.total,
      g.status === 'skipped' ? 'Bỏ qua: ' + g.reason : 'In',
    ]);
  }
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

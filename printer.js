// =============================================================
//  In trực tiếp ra máy in (không qua hộp thoại in của Chrome)
//  Avatar -> xử lý ảnh (sharp) -> tạo phiếu PDF (pdfkit) -> gửi thẳng tới máy in theo TÊN
// =============================================================
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import winPrinter from 'pdf-to-printer'; // Windows (dùng SumatraPDF đi kèm, in im lặng)

const require = createRequire(import.meta.url);
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'); // có đủ dấu tiếng Việt
const FONT_REG = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');

const isWin = process.platform === 'win32';
const execFileAsync = promisify(execFile);
const MM = 72 / 25.4; // 1mm = 2.835pt (đơn vị của PDF)

// -------------------------------------------------------------
// Danh sách máy in đã cài trên máy tính
// -------------------------------------------------------------
export async function listPrinters() {
  if (isWin) {
    const [all, def] = await Promise.all([winPrinter.getPrinters(), winPrinter.getDefaultPrinter().catch(() => null)]);
    return { printers: all.map((p) => p.name), defaultPrinter: def?.name || null };
  }
  // macOS / Linux: hỏi CUPS. "lpstat -e" = danh sách máy in (mỗi dòng 1 tên), "lpstat -d" = máy in mặc định
  const env = { ...process.env, LANG: 'C', LC_ALL: 'C' };
  const [all, def] = await Promise.all([
    execFileAsync('lpstat', ['-e'], { env }).then((r) => r.stdout).catch(() => ''),
    execFileAsync('lpstat', ['-d'], { env }).then((r) => r.stdout).catch(() => ''),
  ]);
  return {
    printers: all.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    defaultPrinter: def.match(/destination:\s*(\S+)/)?.[1] || null,
  };
}

// -------------------------------------------------------------
// Ảnh avatar: tải về -> vuông -> đen trắng -> tăng tương phản -> cắt tròn, viền đen
// -------------------------------------------------------------
const PLACEHOLDER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ddd"/><circle cx="50" cy="38" r="18" fill="#555"/><ellipse cx="50" cy="88" rx="32" ry="24" fill="#555"/></svg>'
);

async function downloadAvatar(url) {
  if (!url) return PLACEHOLDER_SVG;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.warn('[printer] Không tải được avatar, dùng ảnh mẫu:', e.message);
    return PLACEHOLDER_SVG;
  }
}

async function makeRoundAvatar(input, size = 600) {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
  const ring = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 5}" fill="none" stroke="#000" stroke-width="10"/></svg>`
  );
  // Bước 1: cắt vuông, đen trắng, tăng tương phản, khoét tròn (ngoài vòng tròn = trong suốt)
  const round = await sharp(input)
    .resize(size, size, { fit: 'cover' })
    .grayscale()
    .normalise()
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  // Bước 2: nền trắng (giấy in nhiệt) + vẽ viền tròn màu đen
  return sharp(round).flatten({ background: '#ffffff' }).composite([{ input: ring }]).png().toBuffer();
}

// Font không có emoji -> bỏ emoji khỏi tên để không in ra ô vuông
const cleanText = (s) => String(s || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();

// -------------------------------------------------------------
// Tạo file PDF đúng khổ giấy in nhiệt (rộng paperMm, cao tự tính)
// -------------------------------------------------------------
export async function renderTicketPdf(gift, paperMm = 58) {
  const avatar = await makeRoundAvatar(await downloadAvatar(gift.avatar));

  const margin = 4 * MM;
  const W = paperMm * MM;
  const imgSize = W - margin * 2;
  const H = margin + imgSize + 18 * MM; // chừa chỗ cho tên + dòng quà + khoảng trống để xé giấy

  const file = path.join(os.tmpdir(), `tiktok-gift-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.pdf`);
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: 'TikTok Gift' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', res));

  doc.image(avatar, margin, margin, { width: imgSize, height: imgSize });

  const name = cleanText(gift.nickname) || '@' + gift.uniqueId;
  doc.font(FONT_BOLD).fontSize(12).fillColor('#000')
    .text(name, 2 * MM, margin + imgSize + 2 * MM, { width: W - 4 * MM, align: 'center', height: 16, ellipsis: true, lineBreak: false });
  doc.font(FONT_REG).fontSize(8)
    .text(`@${gift.uniqueId} • ${gift.repeatCount}x ${cleanText(gift.giftName)}`, 2 * MM, margin + imgSize + 8 * MM, {
      width: W - 4 * MM, align: 'center', height: 12, ellipsis: true, lineBreak: false,
    });

  doc.end();
  await done;
  await fs.writeFile(file, Buffer.concat(chunks));
  return file;
}

// -------------------------------------------------------------
// Gửi PDF tới máy in. In LẦN LƯỢT (hàng chờ) để nhiều quà cùng lúc không bị chồng lệnh.
// -------------------------------------------------------------
let chain = Promise.resolve();

export function printGift(gift, { printer, paperMm = 58 } = {}) {
  const job = chain.then(async () => {
    if (!printer) throw new Error('Chưa chọn máy in');
    // Chỉ cho in ra máy in thật sự đã cài (tên máy in do trình duyệt gửi lên, không tin tuyệt đối)
    const { printers } = await listPrinters();
    if (!printers.includes(printer)) throw new Error(`Không tìm thấy máy in "${printer}"`);
    const file = await renderTicketPdf(gift, paperMm);
    try {
      if (isWin) {
        // noscale: giữ đúng kích thước mm, không phóng to ra khổ A4
        await winPrinter.print(file, { printer, scale: 'noscale', silent: true });
      } else {
        // Gọi lệnh lp trực tiếp (execFile, không qua shell) -> tên máy in có dấu cách vẫn chạy, không bị chèn lệnh
        await execFileAsync('lp', ['-d', printer, '-o', `media=Custom.${paperMm}x${Math.round(paperMm + 22)}mm`, file]);
      }
      console.log(`[printer] Đã gửi lệnh in @${gift.uniqueId} -> "${printer}"`);
    } finally {
      fs.unlink(file).catch(() => {});
    }
  });
  chain = job.catch(() => {}); // lỗi 1 lệnh không làm kẹt hàng chờ
  return job;
}

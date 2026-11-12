# TikTok Gift Printer

Khi có người tặng quà trên TikTok LIVE, app sẽ in avatar (hình tròn, đen trắng) của người đó ra máy in nhiệt.

## 1. Cài đặt và chạy

Cần **Node.js 20 trở lên**.

```bash
npm install
npm start
```

Sau đó mở **Chrome** vào http://localhost:3000, nhập username tài khoản đang live rồi bấm **Kết nối**.

## 2. In không hiện hộp thoại (quan trọng)

Mặc định `window.print()` sẽ mở hộp thoại in mỗi lần. Để in thẳng:

1. Vào **Cài đặt Windows → Máy in**, đặt máy in nhiệt làm máy in **mặc định**.
2. Đóng hết cửa sổ Chrome, rồi mở Chrome với cờ `--kiosk-printing`:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing http://localhost:3000
```

(Có thể tạo shortcut trên Desktop, thêm `--kiosk-printing` vào cuối ô Target.)

3. Bấm **In thử** để kiểm tra khổ giấy.

## 3. Máy in nào dùng được?

- Máy in phải có **driver trên máy tính** (hiện trong danh sách "Máy in" của Windows). Phần lớn máy in nhiệt USB 58/80mm (Xprinter, Gprinter...) đều dùng được.
- Một số máy in mini Bluetooth (loại hình con mèo) **chỉ in qua app điện thoại**, không có driver PC, nên không dùng được theo cách này.
- Trong tuỳ chọn của máy in, chọn đúng khổ giấy (58mm/80mm) và bật **dithering** nếu có, để ảnh in đẹp hơn.

## 4. Các tuỳ chọn trên giao diện

| Tuỳ chọn | Tác dụng |
|---|---|
| Tự động in | Tắt đi thì chỉ ghi nhận quà, không in (bấm vào nhãn để in tay) |
| Mỗi người chỉ in 1 lần | Một người tặng nhiều quà cũng chỉ in 1 lần. Bấm "Xoá danh sách đã in" để làm lại từ đầu |
| Quà tối thiểu 💎 | Chỉ in khi quà có giá trị từ số kim cương này trở lên (tính cả combo) |
| Khổ giấy | 50 / 58 / 80mm |

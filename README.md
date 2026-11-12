# TikTok Gift Printer

Khi có người tặng quà trên TikTok LIVE, app sẽ in avatar (hình tròn, đen trắng) của người đó ra máy in nhiệt.

## 1. Cài đặt và chạy

Cần **Node.js 20 trở lên**.

```bash
npm install
npm start
```

Sau đó mở **Chrome** vào http://localhost:3000, nhập username tài khoản đang live rồi bấm **Kết nối**.

## 2. Chọn máy in (in thẳng ra giấy)

1. Cắm máy in nhiệt vào máy tính và **cài driver** (máy in phải hiện trong *Cài đặt Windows → Máy in & máy quét*).
2. Vào driver máy in → **Printing Preferences**: chọn đúng khổ giấy (58mm hoặc 80mm).
3. Trên web, ở mục **Cách in**, chọn **"Gửi thẳng tới máy in"**. Ở ô **Máy in**, chọn đúng tên máy in nhiệt.
   - **KHÔNG** chọn `Microsoft Print to PDF`, `Microsoft XPS`, `OneNote`... vì đó là máy in ảo, chỉ ra file.
   - Mới cắm máy in thì bấm nút **↻** để tải lại danh sách.
4. Bấm **In thử**, giấy sẽ ra ngay mà không hiện hộp thoại nào.

> Ở chế độ này, server (Node.js) tự tạo phiếu in rồi gửi thẳng tới máy in theo tên, không đi qua Chrome.
> Windows dùng SumatraPDF đi kèm thư viện `pdf-to-printer` để in im lặng, còn macOS/Linux dùng lệnh `lp` (CUPS).
> File phiếu tạm sẽ tự xoá sau khi in.

## 3. Máy in nào dùng được?

- Máy in phải có **driver trên máy tính**. Phần lớn máy in nhiệt USB 58/80mm (Xprinter, Gprinter...) đều dùng được.
- Một số máy in mini Bluetooth (loại hình con mèo) **chỉ in qua app điện thoại**, không có driver PC, nên không dùng được.
- Nếu ảnh ra bị nhỏ hoặc lệch: chỉnh khổ giấy trong *Printing Preferences* của driver cho khớp với ô **Khổ giấy** trên web.

## 4. Các tuỳ chọn trên giao diện

| Tuỳ chọn | Tác dụng |
|---|---|
| Tự động in | Tắt đi thì chỉ ghi nhận quà, không in (bấm vào nhãn để in tay) |
| Mỗi người chỉ in 1 lần | Một người tặng nhiều quà cũng chỉ in 1 lần. Bấm "Xoá danh sách đã in" để làm lại từ đầu |
| Quà tối thiểu 💎 | Chỉ in khi quà có giá trị từ số kim cương này trở lên (tính cả combo) |
| Cách in | **Gửi thẳng tới máy in** (khuyên dùng) hoặc qua hộp thoại in của Chrome (cách cũ) |
| Máy in | Chọn máy in nhiệt thật, không chọn máy in PDF |
| Khổ giấy | 50 / 58 / 80mm |

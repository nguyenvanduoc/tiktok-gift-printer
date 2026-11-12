# TikTok Gift Printer

Khi có người tặng quà trên TikTok LIVE, app sẽ in avatar (hình tròn, đen trắng) của người đó ra máy in nhiệt.

## 1. Cài đặt và chạy

Cần **Node.js 22 trở lên** (bản LTS ở https://nodejs.org).

```bash
npm install
npm start
```

Sau đó mở trình duyệt vào http://localhost:3000, nhập username TikTok rồi bấm **Kết nối**.

## Cách hoạt động

```
TikTok LIVE ──(có người tặng quà)──> server (npm start) ──(tự gửi lệnh in)──> Máy in nhiệt
                                          │
                                          └──> Trang web: chỉ để xem danh sách quà và cài đặt
```

- **Server tự in**: đóng trang web vẫn in bình thường, mở nhiều tab cũng không in trùng. Chỉ cần cửa sổ `npm start` còn chạy.
- **Bấm Kết nối trước khi lên live cũng được**: hệ thống kiểm tra mỗi 30 giây, bạn lên live là tự kết nối.
- **Rớt mạng / TikTok ngắt kết nối**: tự kết nối lại.
- **Kết nối "chết lặng"** (không báo ngắt nhưng 2 phút không có dữ liệu): tự kết nối lại. Dưới trạng thái có dòng `👁 người xem • 🎁 lượt quà • dữ liệu mới nhất Ns trước` để biết kết nối còn sống.
- **Tắt rồi mở lại `npm start`**: tự kết nối lại tài khoản lần trước. Cài đặt được lưu trong `settings.json`.
- **Quà combo** (bấm liên tục): chỉ in 1 lần, khi kết thúc combo.
- **Avatar**: tự lấy ảnh lớn 1080px từ trang cá nhân để in nét, không lấy được thì dùng ảnh nhỏ.
- **Tên có emoji / chữ Hàn, Trung...**: font không in được thì bỏ đi, nếu không còn gì thì in @username.

## 2. Chọn máy in (in thẳng ra giấy)

1. Cắm máy in nhiệt vào máy tính và **cài driver** (máy in phải hiện trong *Cài đặt Windows → Máy in & máy quét*).
2. Vào driver máy in → **Printing Preferences**: chọn đúng khổ giấy (58mm hoặc 80mm).
3. Trên web, ở ô **Máy in**, chọn đúng tên máy in nhiệt.
   - **KHÔNG** chọn `Microsoft Print to PDF`, `Microsoft XPS`, `OneNote`... vì đó là máy in ảo, chỉ ra file.
   - Mới cắm máy in thì bấm nút **↻** để tải lại danh sách.
4. Bấm **In thử**, giấy sẽ ra ngay mà không hiện hộp thoại nào.

> Server (Node.js) tự tạo phiếu in rồi gửi thẳng tới máy in theo tên, không qua hộp thoại in của trình duyệt.
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
| Máy in | Chọn máy in nhiệt thật, không chọn máy in PDF |
| Khổ giấy | 50 / 58 / 80mm |
| Bấm vào nhãn "Đã in" / "Bỏ qua" / "Lỗi in" | In lại người đó |
| 🗑️ Reset quà tặng | Xoá danh sách quà trên tab Live, đưa bộ đếm lượt quà về 0, mọi người đều được in lại từ đầu. Kết nối live và **tab Thống kê vẫn giữ nguyên** |

## 5. Tab 📊 Thống kê

Mọi quà nhận được đều được ghi lại **vĩnh viễn** vào file `data/gift-log.jsonl` (bấm Reset hay tắt chương trình cũng không mất).

- **Hôm nay / 7 ngày qua / Tổng cộng**: tổng 💎, số lượt tặng, số quà, số người tặng.
- **Theo ngày**: mỗi ngày 1 dòng (lượt tặng, số quà, 💎, người tặng, số tờ đã in). Bấm vào 1 ngày để xem chi tiết:
  - 🏆 Top người tặng (xếp theo 💎)
  - 🎁 Thống kê theo loại quà
  - 🕒 Danh sách theo giờ
  - ⬇️ **Tải Excel (CSV)** của ngày đó
- Đang mở tab Thống kê mà có quà mới thì số liệu tự cập nhật.
- Ngày được tính theo giờ máy tính (quà lúc 23:59 thuộc hôm đó, 00:01 thuộc hôm sau). Lượt **In thử** không được tính.
- Muốn xoá hết thống kê: tắt chương trình rồi xoá file `data/gift-log.jsonl`.

## 6. 🔊 Đọc lời cảm ơn

Khi có quà **được in**, máy tính đọc to (giọng tiếng Anh): *"Thank you {tên}! Here is a photo for you."*

1. Ở tab **Live**, khung **🔊 Đọc lời cảm ơn**: tick **Bật đọc trên máy này**.
2. Chọn **Giọng đọc** (khuyên dùng `Google US English`, tự nhiên nhất) và **Tốc độ**, bấm **▶️ Đọc thử**.
3. Muốn đổi câu: sửa ô **Câu đọc**, `{name}` sẽ được thay bằng tên người tặng.

- Mở trang trên **máy đang phát live** để tiếng được thu vào live (phần mềm live phải thu âm thanh máy tính, ví dụ TikTok LIVE Studio / OBS: *Desktop Audio*).
- **Chỉ 1 tab đọc** (tab bật sau cùng) để không bị đọc chồng. Đóng tab đó thì không đọc nữa (vẫn in bình thường).
- Tải lại trang: trình duyệt bắt buộc phải bấm vào trang 1 lần mới cho phát tiếng, nên bấm vào bất kỳ chỗ nào để bật lại.
- Tên tiếng Việt được bỏ dấu cho giọng tiếng Anh đọc tự nhiên (Được → Duoc), bỏ emoji. Tên toàn emoji/chữ nước ngoài thì đọc username, hoặc "my friend".
- Người bị bỏ qua (đã in rồi, dưới mức quà tối thiểu) thì không đọc.


# Crunchy Trail – ASMR 3D

**Chơi ngay trên web:** https://nhatbien.github.io/crunchy-trail/ (tự deploy từ nhánh `main` bằng GitHub Actions).

Game 3D thư giãn kiểu ASMR cho **YouTube Playables**, **iOS** và **Android**, dùng chung một codebase (Three.js + TypeScript + Vite, đóng gói native bằng Capacitor).

Bạn điều khiển "Mochi", một bé mochi mềm mềm, đi dạo trên **một vùng đất liền** gồm 10 khu nối liền nhau: lưới 3×3 khu nhỏ (mỗi khu 8×8 đơn vị) cộng một dải bàn phím cơ dài ở phía đông (8×24). Đi tới đâu, vật liệu ở đó bị nghiền và phát âm thanh ASMR ngay tại chỗ, pan trái/phải theo vị trí:

| Khu | Hiệu ứng | Âm thanh |
| --- | --- | --- |
| Xốp bóng khí | bóng phồng lên rồi bẹp | `pop` |
| Bãi cỏ | cỏ bị cắt, để lại sọc như sân cỏ thật | `grass` |
| Tuyết mới | tuyết lún thành dấu chân xanh nhạt | `snow` |
| Lá mùa thu | lá bị đá bay, lộ thảm cỏ | `leaves` |
| Cát động lực | lát cát cầu vồng đổ xuống | `sand` |
| Thạch | thạch rung rinh khi lại gần, bẹp thành vũng | `slime` |
| Pop It | núm silicone lõm xuống | `popit` |
| Pha lê băng | pha lê vỡ thành mảnh lấp lánh | `ice` |
| Phím kalimba | mỗi phím một nốt ngũ cung, đi đường nào cũng ra giai điệu | `kalimba` |
| Bàn phím creamy | keycap nhiều màu có chữ, lún xuống và sáng đèn nền RGB, gõ dồn dập như typing nhanh | `keys` |

Không có màn chơi hay đồng hồ đếm giờ. Khi bạn rời một khu, vật liệu ở đó tự mọc lại (lá rơi xuống, bóng phồng lại, cỏ mọc lên…). Phần thưởng nhẹ nhàng gồm: đá quý rải khắp bản đồ (tự hồi sinh), +5 khi khám phá khu mới, +5 khi nghiền sạch một khu (gần 100% thì phần còn lại tự nghiền thành một chuỗi), +3 cho mỗi 1.000 lần nghiền, và combo "Tingles" khi nghiền liên tục. Đá quý dùng để mua 10 màu da và 6 loại mũ (có tai nghe ASMR).

## Chạy thử

```bash
npm install
npm run dev
```

Mở `http://localhost:5174`. Điều khiển: kéo ở bất kỳ đâu (cảm ứng hoặc chuột), hoặc WASD / phím mũi tên. Esc để tạm dừng hoặc đóng menu.

## Build

| Lệnh | Kết quả |
| --- | --- |
| `npm run build:youtube` | `dist-youtube/` + `release/crunchy-trail-youtube-v<version>.zip`, kèm kiểm tra giới hạn của YouTube |
| `npm run build:native` | `dist-native/` cho Capacitor |
| `npm run cap:sync` | build native rồi copy sang `ios/` và `android/` |
| `npm run ios` / `npm run android` | sync rồi mở Xcode / Android Studio |
| `npm run build:web` | bản web thường (`dist-web/`) |

### YouTube Playables

1. Chạy `npm run build:youtube`, rồi upload file zip trong `release/` lên YouTube Playables (Developer Portal).
2. Kiểm tra bằng [Playables Test Suite](https://developers.google.com/youtube/gaming/playables/reference/test_suite_guide).
3. Thumbnail không chữ, không logo (đúng yêu cầu) nằm trong `art/out/`: `thumb_16x9.jpg`, `thumb_9x16.jpg`, `thumb_1x1.jpg`.

Những điểm đã làm theo yêu cầu chứng nhận:
- SDK `https://www.youtube.com/game_api/v1` được chèn làm script đầu tiên, chỉ trong bản YouTube.
- Gọi `firstFrameReady()` khi màn loading đã hiện, và `gameReady()` khi màn tiêu đề đã bấm được.
- Chỉ lưu bằng cloud save (`loadData` luôn được chờ xong trước `saveData`). Dữ liệu lưu được kiểm tra kỹ nên save của phiên bản cũ không làm crash game.
- Âm thanh theo `isAudioEnabled` / `onAudioEnabledChange`. Không có nút tắt tiếng tổng, chỉ có bật/tắt riêng nhạc nền và âm thanh thiên nhiên.
- Tạm dừng/tiếp tục chỉ qua `onPause` / `onResume` của SDK (bản YouTube không dùng Page Visibility API).
- Co giãn được mọi tỉ lệ màn hình từ 9:16 đến 32:9, không khóa xoay màn hình. Hỗ trợ cảm ứng, chuột và bàn phím. Có nút bật/tắt rung.
- Không link ra ngoài, không nút thoát, không yêu cầu chia sẻ. Font và mọi asset đều nằm trong gói.
- Điểm gửi lên (`sendScore`) = tổng số lần nghiền, luôn lưu xong trước khi gửi nên khớp với dữ liệu save.

### iOS

```bash
npm run cap:sync
npx cap open ios
```

Trong Xcode: chọn Team ở *Signing & Capabilities*, đổi Bundle ID nếu cần (hiện là `com.crunchytrail.asmr` trong `capacitor.config.ts`), rồi Run hoặc Product → Archive. iPhone khóa dọc, iPad xoay tự do.

Build cho simulator bằng dòng lệnh:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath build/ios CODE_SIGNING_ALLOWED=NO build
```

### Android

```bash
npm run cap:sync
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug
```

APK nằm ở `android/app/build/outputs/apk/debug/app-debug.apk`. Bản phát hành cần keystore riêng (`./gradlew bundleRelease` + cấu hình signing).

## Cấu trúc

```
src/
  main.ts                 khởi động: platform → save → audio → world → game
  platform/               YouTube SDK / Capacitor native / web
  audio/AudioEngine.ts    Web Audio: shuffle-bag, giới hạn voice, pan, reverb, ambience, nhạc generative
  audio/synth.ts          âm thanh tổng hợp dự phòng khi thiếu file
  game/Game.ts            vòng lặp open world, khu vực, combo, phần thưởng
  game/worldmap.ts        bản đồ lưới 4×3 ô với ranh giới uốn lượn
  game/surfaces/          10 loại vật liệu ASMR (instancing chia chunk, mọc lại)
  game/Character.ts       Mochi (squash & stretch, chớp mắt, mũ)
  ui/                     HUD, minimap, menu, cửa hàng (DOM, đa ngôn ngữ)
public/audio/             âm thanh CC0 đã master + manifest.json (xem AUDIO_CREDITS.md)
art/                      ảnh gen bằng Codex CLI (raw/) và bản đã xử lý (out/)
tools/                    script xử lý ảnh / âm thanh
```

Ngôn ngữ có sẵn: English, Tiếng Việt, Español, Português, Bahasa Indonesia, Français, Deutsch, 日本語, 한국어 (tự chọn theo ngôn ngữ của YouTube/thiết bị).

## Bản quyền asset

Xem [CREDITS.md](CREDITS.md) và [AUDIO_CREDITS.md](AUDIO_CREDITS.md).

# p4-hid-mapper⚡flash

ESP32-P4 固件在线烧录工具。参考 [pico-hid-mapper-flash](../pico-hid-mapper-flash)（RP2040/RP2350 · WebUSB + PICOBOOT）搭建，区别是本站面向 **ESP32-P4**，通过 **Web Serial API + [esptool-js](https://github.com/espressif/esptool-js)**（v0.7.0，本地 vendored 于 `vendor/esptool/`）连接芯片串口下载模式完成烧录。

## 结构

与参考项目一样：纯 ES6 模块，无构建步骤、无外部运行时依赖。

- `index.html` — 页面结构（中文 UI）。
- `style.css` — 沿用参考项目样式。
- `js/config.js` — 芯片版本 → 固件 hash KV 接口的 map、CDN 前缀、烧录偏移（`FLASH_OFFSET = 0x0`）、波特率等。
- `js/app.js` — UI 控制器：Web Serial 连接、芯片筛选、按版本下载固件、烧录进度、擦除、重启。
- `js/md5.js` — 纯 JS 同步 MD5（esptool-js 的 `calculateMD5Hash` 回调需要同步返回值）。
- `vendor/esptool/bundle.js` — esptool-js 0.7.0 自包含 bundle（含 pako）。

## 固件来源与芯片筛选

固件不在仓库内。页面连接设备后按 **芯片版本** 决定烧什么：

1. esptool 识别芯片描述（如 `ESP32-P4 (revision v3.1)`），只接受 `ESP32-P4` 且版本在支持列表内的设备，否则拒绝并断开。
2. 版本号查 `FIRMWARE_HASH_URLS` map（`js/config.js`）得到 KV 接口，取回版本 hash（`{"key":..., "value":"<hash>"}`）。
3. 拼 `https://1833788059.cdn.123clouddisk.com/.../p4-hid-mapper-{hash}.bin` 下载（带缓存规避）。

当前支持：`v1.3`（固件 5.5.2）、`v3.1`（固件 6.1.0，KV 上传前会 404）。扩充新版本只需在 map 里加一行。
固件是 ESP-IDF `merge_bin` 合并镜像，整包从 **0x0** 烧录。

## 运行

Web Serial 需要 secure context，`localhost` 例外：

```
python3 -m http.server 8000
# 打开 http://localhost:8000 （Chrome / Edge）
```

## 烧录流程

1. 连接设备：`navigator.serial.requestPort()` → esptool 复位进下载模式 → sync → 识别芯片。
2. 烧录：`esploader.writeFlash({ fileArray: [{ data, address: 0x0 }], compress: true, ... })`，进度直接来自 `reportProgress` 回调，完成后 MD5 校验。
3. 校验通过后 `esploader.after('hard_reset')` 重启进应用并断开。

若连接失败，按住板上 **BOOT** 键并复位（或重新插拔 USB）让芯片进入下载模式后重试。

# p4-hid-mapper⚡flash

ESP32-P4 固件在线烧录工具。参考 [pico-hid-mapper-flash](../pico-hid-mapper-flash)（RP2040/RP2350 · WebUSB + PICOBOOT）搭建，区别是本站面向 **ESP32-P4**，通过 **Web Serial API + [esptool-js](https://github.com/espressif/esptool-js)**（v0.7.0，本地 vendored 于 `vendor/esptool/`）连接芯片串口下载模式完成烧录。

## 结构

与参考项目一样：纯 ES6 模块，无构建步骤、无外部运行时依赖。

- `index.html` — 页面结构（中文 UI）。版本选择已暂时注释，当前仅使用固定测试 URL。
- `style.css` — 沿用参考项目样式。
- `js/config.js` — 固件地址与常量（烧录偏移 `FLASH_OFFSET = 0x0`、波特率、flash 容量等）。
- `js/app.js` — UI 控制器：Web Serial 连接、芯片识别、下载固件、烧录进度、擦除、重启。
- `js/md5.js` — 纯 JS 同步 MD5（esptool-js 的 `calculateMD5Hash` 回调需要同步返回值）。
- `vendor/esptool/bundle.js` — esptool-js 0.7.0 自包含 bundle（含 pako）。

## 固件来源

固件不在仓库内，页面在每次点击烧录时实时从 CDN 拉取（带缓存规避参数）：

- 测试地址：`FIRMWARE_URL`（`js/config.js`）— `https://1833788059.cdn.123clouddisk.com/.../p4-hid-mapper-<hash>.bin`
- 当前固件是 ESP-IDF `merge_bin` 输出的合并镜像（bootloader @0x2000、分区表 @0x8000、app @0x20000），整包从 **0x0** 烧录。若改为单 app 镜像，需把 `FLASH_OFFSET` 改成分区偏移。

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

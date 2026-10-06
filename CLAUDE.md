# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

p4-hid-mapper⚡flash 是 ESP32-P4 固件的在线烧录站。它是 [pico-hid-mapper-flash](../pico-hid-mapper-flash) 的姊妹项目：同样的纯 ES6 模块、无构建步骤、无外部运行时依赖、中文 UI、中文注释；但协议层完全不同——那里是 WebUSB + 自研 PICOBOOT 库，这里是 **Web Serial API + esptool-js**（vendored 于 `vendor/esptool/bundle.js`，v0.7.0）。

固件 `.bin` 不在仓库里：页面连接设备、识别芯片版本后，按版本查 KV 接口取 hash 再从 CDN 拉取（带 `?t=<Date.now()>` 缓存规避 + `cache: 'no-store'`）。

## Commands

- **运行站点**：`python3 -m http.server 8000`，浏览器打开 `http://localhost:8000`（Web Serial 要求 secure context，localhost 例外）。仅 Chrome / Edge 支持。
- 无测试框架、无 node_modules、无 CI——验证方式是起服务后用真实 ESP32-P4 硬件走一遍连接/烧录。

## Architecture

### 烧录链路（js/app.js）

1. **连接**：`navigator.serial.requestPort()`（不做 VID 过滤，兼容 USB-UART 桥接板）→ `new Transport(port)` → `new ESPLoader({ transport, baudrate: FLASH_BAUDRATE, romBaudrate: ROM_BAUDRATE, terminal, debugLogging: false })` → `await esploader.main()`（复位进下载模式 + sync + 识别芯片，返回如 `"ESP32-P4 (revision v3.1)"`）。
2. **芯片筛选**：用正则从 `main()` 返回值提取型号与版本号；型号必须是 `REQUIRED_CHIP`（ESP32-P4）且版本号是 `FIRMWARE_HASH_URLS`（`js/config.js`，版本 → KV 接口的 map，扩充新版本加一行）的 key，否则拒绝并 `closeAndReset()` 断开。信息面板的「芯片版本」只显示版本号（如 `v3.1`）。
3. **取固件**：烧录前**先连接后取固件**（顺序不能反，固件地址取决于芯片版本）：版本号查 map → KV 接口返回 `{"key":..., "value":"<hash>"}` → 拼 `${FIRMWARE_CDN_PREFIX}${hash}${FIRMWARE_CDN_SUFFIX}` 下载。
4. **烧录**：`esploader.writeFlash({ fileArray: [{ data, address: FLASH_OFFSET }], flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: false, compress: true, reportProgress, calculateMD5Hash })`。进度条直接用 `reportProgress(fileIndex, written, total)` 的真实进度（不像参考项目那样按时间估算）。
5. **校验**：esptool 内部完成，MD5 由 `calculateMD5Hash` 回调提供——必须是**同步**函数，Web Crypto 没有 MD5，所以有 `js/md5.js`（纯 JS 同步实现，已对标准向量校验）。
6. **重启**：`esploader.after('hard_reset')` 硬复位进应用，然后 `transport.disconnect()` 关串口。
7. **擦除**：`esploader.eraseFlash()` 整片擦除。

### 关键约定 / 坑

- `FLASH_OFFSET = 0x0`（`js/config.js`）：当前固件是 ESP-IDF `merge_bin` 合并镜像（bootloader @0x2000、分区表 @0x8000、app @0x20000），整包从 0x0 烧。换成单 app 镜像时必须改偏移（P4 首个 app 分区通常是 0x20000）。
- 串口操作不包前端超时（与参考项目不同）：esptool-js 内部管理超时，`Promise.race` 超时只会让 UI 失控而传输还在跑。只有网络请求用 `withTimeout`。
- esptool 的 `terminal` 回调桥接到活动日志：`writeLine` 进日志区，`write`（无换行的零散输出）只进控制台防刷屏。
- 版本选择 UI（稳定版/最新版切换）已按需求注释在 `index.html` 里：固件版本现在由**设备芯片版本自动决定**（`FIRMWARE_HASH_URLS` map），不再有手动渠道切换；恢复手动选择时参考 `../pico-hid-mapper-flash/js/app.js` 的 `resolveFirmwareSource()`。
- 统计上报（STATS_*）预留但 `STATS_ENABLED = false`。
- 复用参考项目样式：`style.css` 是整份拷贝，版本切换的样式留着以备恢复 UI。

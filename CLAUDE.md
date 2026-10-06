# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

p4-hid-mapper⚡flash 是 ESP32-P4 固件的在线烧录站。它是 [pico-hid-mapper-flash](../pico-hid-mapper-flash) 的姊妹项目：同样的纯 ES6 模块、无构建步骤、无外部运行时依赖、中文 UI、中文注释；但协议层完全不同——那里是 WebUSB + 自研 PICOBOOT 库，这里是 **Web Serial API + esptool-js**（vendored 于 `vendor/esptool/bundle.js`，v0.7.0）。

固件 `.bin` 不在仓库里：页面在每次烧录时实时从 CDN 拉取（`FIRMWARE_URL` in `js/config.js`，带 `?t=<Date.now()>` 缓存规避 + `cache: 'no-store'`）。

## Commands

- **运行站点**：`python3 -m http.server 8000`，浏览器打开 `http://localhost:8000`（Web Serial 要求 secure context，localhost 例外）。仅 Chrome / Edge 支持。
- 无测试框架、无 node_modules、无 CI——验证方式是起服务后用真实 ESP32-P4 硬件走一遍连接/烧录。

## Architecture

### 烧录链路（js/app.js）

1. **连接**：`navigator.serial.requestPort()`（不做 VID 过滤，兼容 USB-UART 桥接板）→ `new Transport(port)` → `new ESPLoader({ transport, baudrate: FLASH_BAUDRATE, romBaudrate: ROM_BAUDRATE, terminal, debugLogging: false })` → `await esploader.main()`（复位进下载模式 + sync + 识别芯片，返回芯片名字符串；`esploader.chip.CHIP_NAME` / `.getChipDescription()` 供信息面板）。
2. **烧录**：`esploader.writeFlash({ fileArray: [{ data, address: FLASH_OFFSET }], flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: false, compress: true, reportProgress, calculateMD5Hash })`。进度条直接用 `reportProgress(fileIndex, written, total)` 的真实进度（不像参考项目那样按时间估算）。
3. **校验**：esptool 内部完成，MD5 由 `calculateMD5Hash` 回调提供——必须是**同步**函数，Web Crypto 没有 MD5，所以有 `js/md5.js`（纯 JS 同步实现，已对标准向量校验）。
4. **重启**：`esploader.after('hard_reset')` 硬复位进应用，然后 `transport.disconnect()` 关串口。
5. **擦除**：`esploader.eraseFlash()` 整片擦除。

### 关键约定 / 坑

- `FLASH_OFFSET = 0x0`（`js/config.js`）：当前固件是 ESP-IDF `merge_bin` 合并镜像（bootloader @0x2000、分区表 @0x8000、app @0x20000），整包从 0x0 烧。换成单 app 镜像时必须改偏移（P4 首个 app 分区通常是 0x20000）。
- 串口操作不包前端超时（与参考项目不同）：esptool-js 内部管理超时，`Promise.race` 超时只会让 UI 失控而传输还在跑。只有网络请求用 `withTimeout`。
- esptool 的 `terminal` 回调桥接到活动日志：`writeLine` 进日志区，`write`（无换行的零散输出）只进控制台防刷屏。
- 版本选择 UI（稳定版/最新版切换）已按需求**注释**在 `index.html` 里，`app.js` 也没有渠道逻辑；恢复时在 `resolveFirmwareSource` 类似位置扩展（参考 `../pico-hid-mapper-flash/js/app.js` 的 `resolveFirmwareSource()` + KV hash 接口）。
- 统计上报（STATS_*）预留但 `STATS_ENABLED = false`。
- 复用参考项目样式：`style.css` 是整份拷贝，版本切换的样式留着以备恢复 UI。

//
// p4-hid-mapper 在线烧录工具前端。
// 与 pico-hid-mapper-flash（WebUSB + PICOBOOT）不同，这里面向 ESP32-P4，
// 通过 Web Serial API + esptool-js 连接芯片的串口下载模式完成烧录。
//

//
// Imports（相对路径，兼容二级目录/根目录/自定义域名部署）
//

import { Transport, ESPLoader } from '../vendor/esptool/bundle.js';
import {
    FIRMWARE_URL,
    FETCH_TIMEOUT,
    FLASH_OFFSET,
    FLASH_SIZE,
    ROM_BAUDRATE,
    FLASH_BAUDRATE,
} from './config.js';
import { md5Hex } from './md5.js';

//
// Type definitions
//

/**
 * @typedef {Object} FirmwareData
 * @property {string} name
 * @property {Uint8Array} data
 * @property {number} origSize
 * @property {number} downloadSpeed 下载网速（字节/秒）
 * @property {string} sha256Short 下载固件的短 SHA-256 校验值（小写十六进制）
 * @property {string} md5 固件 MD5（esptool-js 烧录后校验用）
 */

//
// Globals
//

/** @type {SerialPort|null} */
let port = null;
/** @type {Transport|null} */
let transport = null;
/** @type {ESPLoader|null} 已连接并完成芯片识别的 loader */
let esploader = null;
/** @type {boolean} 是否正在执行获取/烧录/擦除等操作（防止重复点击） */
let busy = false;

// Progress bar
/** @type {number} */
let progressPercent = 0;
/** @type {HTMLElement} */
const progressFill = document.getElementById('progressFill');
/** @type {HTMLElement} */
const progressPercentText = document.getElementById('progressPercentText');

// 连接按钮
const connectBtn = /** @type {HTMLButtonElement} */ (document.getElementById('connectBtn'));

// 状态行
/** @type {HTMLElement} */
const statusLine = document.getElementById('statusLine');

// 设备信息面板
/** @type {HTMLElement} */
const deviceInfoPanel = document.getElementById('deviceInfoPanel');
/** @type {HTMLElement} */
const deviceTarget = document.getElementById('deviceTarget');
/** @type {HTMLElement} */
const deviceVidPid = document.getElementById('deviceVidPid');
/** @type {HTMLElement} */
const deviceFlashRange = document.getElementById('deviceFlashRange');
/** @type {HTMLElement} */
const deviceFlashOffset = document.getElementById('deviceFlashOffset');
/** @type {HTMLElement} */
const deviceEraseBlock = document.getElementById('deviceEraseBlock');
/** @type {HTMLElement} */
const deviceChipDesc = document.getElementById('deviceChipDesc');

// 烧录操作
const flashBtn = /** @type {HTMLButtonElement} */ (document.getElementById('flashBtn'));
const eraseBtn = /** @type {HTMLButtonElement} */ (document.getElementById('eraseBtn'));

// 活动日志
/** @type {HTMLElement} */
const activityContent = document.getElementById('activityContent');

// Web Serial 不可用引导
const firmwareHint = document.getElementById('firmwareHint');
const downloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('downloadBtn'));
const webserialModal = document.getElementById('webserialModal');
const modalCloseBtn = /** @type {HTMLButtonElement} */ (document.getElementById('modalCloseBtn'));

//
// 日志与格式化
//

/**
 * 启动代码。
 * @return {void}
 */
function startup() {
    // 记录已加载
    logActivity('p4flash 已加载', 'info');

    // Web Serial 可用：在线烧录是唯一路径，不展示「下载固件」按钮（HTML 中默认 hidden）
    // Web Serial 不可用：弹窗告知，并把「烧录固件」替换为「下载固件」——
    // 不支持的环境只允许下载，不允许在线烧录（擦除 / 连接同样禁用）
    if (!('serial' in navigator)) {
        showWebserialModal();
        flashBtn.hidden = true;
        // 下载固件成为此环境下唯一可用操作，升级为主按钮样式
        downloadBtn.hidden = false;
        downloadBtn.classList.add('btn-primary');
        eraseBtn.disabled = true;
        connectBtn.disabled = true;
        updateStatus('当前浏览器不支持 Web Serial，可下载固件后用 esptool 手动烧录');
        logActivity('当前浏览器不支持 Web Serial：已切换为下载固件 + esptool 手动烧录模式', 'info');
    }

    // 更新界面
    updateUi();
}

/**
 * 把字节数格式化为可读字符串。
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * 把网速（字节/秒）格式化为可读字符串。
 * @param {number} bps
 * @returns {string}
 */
function formatSpeed(bps) {
    if (bps >= 1024 * 1024) return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
    return (bps / 1024).toFixed(1) + ' KB/s';
}

/**
 * 写入一条活动日志（同时写入控制台）。
 * @param {string} message
 * @param {string} type
 * @return {void}
 */
function logActivity(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${timestamp}] ${message}`;

    if (type === 'error') {
        console.error(entry.textContent);
    } else {
        console.log(entry.textContent);
    }

    activityContent.appendChild(entry);
    activityContent.scrollTop = activityContent.scrollHeight; // 自动滚动到底部
}

/**
 * 是否已连接到芯片下载模式（完成识别）。
 * @returns {boolean}
 */
function connected() {
    return (esploader != null && transport != null && port != null);
}

/**
 * 更新状态显示。
 * @param {string} message
 * @return {void}
 */
function updateStatus(message) {
    statusLine.textContent = message;
}

/**
 * 填充设备信息面板。
 * @return {void}
 */
function updateDeviceInfo() {
    if (!port) {
        deviceInfoPanel.classList.add('hidden');
        return;
    }

    // VID:PID 在 requestPort 之后即可读（USB 串口设备）
    try {
        const info = port.getInfo();
        deviceVidPid.textContent = `${info.usbVendorId.toString(16).padStart(4, '0')}:${info.usbProductId.toString(16).padStart(4, '0')}`;
    } catch {
        deviceVidPid.textContent = '-';
    }

    deviceFlashRange.textContent = `0x0 - 0x${FLASH_SIZE.toString(16)}（${formatBytes(FLASH_SIZE)}）`;
    deviceFlashOffset.textContent = `0x${FLASH_OFFSET.toString(16)}`;
    deviceEraseBlock.textContent = formatBytes(4096);

    // 芯片信息要等 esptool 完成识别（esploader.main()）之后才有
    if (esploader) {
        try {
            deviceTarget.textContent = esploader.chip.CHIP_NAME;
        } catch {
            deviceTarget.textContent = '-';
        }
        try {
            deviceChipDesc.textContent = esploader.chip.getChipDescription();
        } catch {
            deviceChipDesc.textContent = '-';
        }
    } else {
        deviceTarget.textContent = '-';
        deviceChipDesc.textContent = '-';
    }

    deviceInfoPanel.classList.remove('hidden');
}

/**
 * 更新进度条显示。
 * @param {boolean} error
 * @return {void}
 */
function updateProgress(error = false) {
    if (!connected()) {
        progressPercent = 0;
    }

    progressFill.style.width = `${progressPercent}%`;
    progressPercentText.textContent = progressPercent > 0 ? `${Math.round(progressPercent)}%` : '待机';

    if (error) {
        progressFill.style.backgroundColor = 'var(--color-danger)';
    } else {
        progressFill.style.backgroundColor = 'var(--color-accent)';
    }
}

//
// 按钮状态
//

/**
 * 更新连接按钮。
 * @return {void}
 */
function updateConnectBtn() {
    connectBtn.disabled = busy;
    connectBtn.textContent = connected() ? '断开连接' : '连接设备';
}

/**
 * 更新烧录按钮。
 * @return {void}
 */
function updateFlashBtn() {
    flashBtn.disabled = busy;
}

/**
 * 更新清空flash按钮。
 * @return {void}
 */
function updateEraseBtn() {
    eraseBtn.disabled = busy;
}

/**
 * 更新全部界面元素。
 * @return {void}
 */
function updateUi() {
    updateConnectBtn();
    updateFlashBtn();
    updateEraseBtn();
    updateDeviceInfo();
    updateProgress();
}

//
// 进度工具
//

/**
 * 设置进度百分比并刷新显示。
 * @param {number} percent
 * @return {void}
 */
function setProgress(percent) {
    progressPercent = Math.min(100, Math.max(0, percent));
    updateProgress();
}

/**
 * 重置进度条到待机。
 * @return {void}
 */
function resetProgress() {
    progressPercent = 0;
    updateProgress();
}

//
// esptool 终端桥接
//

/**
 * esptool-js 的 terminal 接口：把 loader 的输出接到活动日志 / 控制台。
 */
const espTerminal = {
    /** @param {string} line */
    clean() {
        activityContent.textContent = '';
    },
    /** @param {string} line */
    write(line) {
        // 无换行的零散输出只进控制台，避免日志区刷屏
        console.log('[esp] ' + line);
    },
    /** @param {string} line */
    writeLine(line) {
        console.log('[esp] ' + line);
        const entry = document.createElement('div');
        entry.className = 'log-entry log-info';
        entry.textContent = `[esp] ${line}`;
        activityContent.appendChild(entry);
        activityContent.scrollTop = activityContent.scrollHeight;
    },
};

//
// 固件获取
//

/**
 * 给 URL 追加一个不同的时间戳参数，保证每次请求不命中缓存。
 * @param {string} url
 * @returns {string}
 */
function addCacheBuster(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}t=${Date.now()}`;
}

/**
 * 从 CDN 下载固件并计算校验值。
 * 每次调用都会带新的缓存规避参数，保证不命中缓存；失败时抛错。
 * @returns {Promise<FirmwareData>}
 */
async function fetchFirmwareData() {
    const startTime = Date.now();
    const res = await withTimeout(
        async () => fetch(addCacheBuster(FIRMWARE_URL), { cache: 'no-store' }),
        FETCH_TIMEOUT,
        '获取固件'
    );

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const fwData = new Uint8Array(await res.arrayBuffer());
    const elapsedMs = Date.now() - startTime;
    const downloadSpeed = elapsedMs > 0 ? (fwData.length * 1000) / elapsedMs : 0;

    // SHA-256 短校验值（展示用）
    const hashBuf = await crypto.subtle.digest('SHA-256', fwData);
    const hashHex = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const sha256Short = hashHex.slice(0, 8);

    // MD5（esptool 烧录后整包校验用）
    const md5 = md5Hex(fwData);

    return { name: 'p4-hid-mapper.bin', data: fwData, origSize: fwData.length, downloadSpeed, sha256Short, md5 };
}

/**
 * 直接把固件下载为文件（不经 Web Serial）。
 * 供不支持 Web Serial 的浏览器走「下载 + esptool 手动烧录」路径，也可随时手动取固件。
 * @returns {Promise<void>}
 */
async function downloadFirmwareFile() {
    try {
        updateStatus('下载固件中…');
        logActivity('下载固件…', 'info');
        const res = await withTimeout(
            async () => fetch(addCacheBuster(FIRMWARE_URL), { cache: 'no-store' }),
            FETCH_TIMEOUT,
            '下载固件'
        );
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'p4-hid-mapper.bin';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        updateStatus('固件已下载');
        logActivity(`固件已下载（${formatBytes(blob.size)}）`, 'info');
    } catch (error) {
        updateStatus('下载失败');
        logActivity(`错误：${error.message}`, 'error');
    }
}

/** 显示 Web Serial 不可用引导弹窗。 */
function showWebserialModal() {
    if (webserialModal) webserialModal.hidden = false;
}

/** 关闭引导弹窗。 */
function hideWebserialModal() {
    if (webserialModal) webserialModal.hidden = true;
}

//
// 超时工具（仅用于网络请求；串口操作由 esptool 内部超时管理）
//

/**
 * 给一个 Promise 包装超时。
 * @param {() => Promise<any>} promiseFn
 * @param {number} timeoutMs
 * @param {string} operation
 * @returns {Promise<any>}
 */
async function withTimeout(promiseFn, timeoutMs, operation) {
    const roundedTimeout = Math.round(timeoutMs / 100) * 100;

    return Promise.race([
        promiseFn(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${operation} 超时（${roundedTimeout}ms）`)), roundedTimeout)
        ),
    ]);
}

//
// 设备连接
//

/**
 * 连接设备：请求授权串口、进入下载模式并识别芯片。
 * @returns {Promise<void>}
 */
async function connect() {
    updateStatus('连接中…');

    // 1. 请求用户选择串口设备（不做 VID 过滤，避免挡住 USB 转串口桥接方案的板子）
    try {
        port = await navigator.serial.requestPort();
    } catch (error) {
        if (error.message && error.message.includes('No port selected')) {
            updateStatus('未选择设备');
            logActivity('设备选择已取消', 'info');
        } else {
            updateStatus('连接错误');
            logActivity(`错误：${error.message}`, 'error');
        }
        port = null;
        return;
    }

    // 选择设备后即可读取 VID:PID
    updateDeviceInfo();

    // 2. 建立 esptool 连接（打开串口 → 复位进下载模式 → sync → 识别芯片）
    try {
        transport = new Transport(port);
        esploader = new ESPLoader({
            transport,
            baudrate: FLASH_BAUDRATE,
            romBaudrate: ROM_BAUDRATE,
            terminal: espTerminal,
            debugLogging: false,
        });

        const chipName = await esploader.main();

        logActivity(`连接成功：${chipName}`, 'success');
        updateStatus(`已连接（${chipName}）`);
        updateDeviceInfo();
    } catch (error) {
        logActivity(`连接失败：${error.message}`, 'error');
        logActivity('提示：请按住板上 BOOT 键，同时按一下复位（或重新插拔 USB）让芯片进入下载模式，再重试', 'warning');
        esploader = null;
        transport = null;
        port = null;
        updateStatus('连接失败');
    }
}

/**
 * 断开连接。失败时抛出错误。
 * @returns {Promise<void>}
 */
async function disconnect() {
    if (!connected()) {
        esploader = null;
        transport = null;
        port = null;
        console.log('没有已连接的设备');
        throw new Error('没有已连接的设备');
    }

    try {
        await transport.disconnect();
        console.log('已断开连接');
    } catch (error) {
        console.log(`断开连接时出错：${error.message}`);
        throw error;
    } finally {
        esploader = null;
        transport = null;
        port = null;
    }
}

/**
 * 断开连接，不抛错。
 * @returns {Promise<void>}
 */
async function disconnectNoThrow() {
    try {
        await disconnect();
        updateStatus('已断开连接');
        logActivity('已断开连接', 'success');
    } catch (error) {
        updateStatus('断开连接出错');
        logActivity(`断开连接出错：${error.message}`, 'error');
    }
}

/**
 * 检查是否已连接，未连接则尝试连接。
 * @returns {Promise<boolean>}
 */
async function checkAndTryConnect() {
    if (connected()) {
        return true;
    }

    await connect();
    updateUi();

    if (connected()) {
        return true;
    } else {
        logActivity('未连接设备，无法继续', 'error');
        updateStatus('未连接设备');
        return false;
    }
}

//
// 烧录
//

/**
 * 烧录流程：每次点击都先重新拉取固件，再连接设备并烧录，成功后自动重启。
 * @returns {Promise<void>}
 */
async function flash() {
    if (busy) return;

    busy = true;
    updateUi();
    updateStatus('正在获取固件…');

    // 1. 每次烧录都重新拉取固件（带新的缓存规避参数）
    let firmware;
    try {
        firmware = await fetchFirmwareData();
        logActivity(`固件获取成功：[${firmware.sha256Short}] ${formatBytes(firmware.origSize)} , ${formatSpeed(firmware.downloadSpeed)}`, 'success');
    } catch (error) {
        logActivity(`获取固件失败：${error.message}`, 'error');
        updateStatus('获取固件失败');
        busy = false;
        updateUi();
        return;
    }

    // 2. 连接设备（未连接则先请求选择设备）
    if (!(await checkAndTryConnect())) {
        busy = false;
        updateUi();
        return;
    }

    // 3. 烧录（进度直接来自 esptool 的写入回调）
    updateStatus('正在烧录…');
    resetProgress();
    logActivity(`正在烧录 [${firmware.sha256Short}]（${formatBytes(firmware.origSize)}）到 0x${FLASH_OFFSET.toString(16)}…`, 'info');

    try {
        await esploader.writeFlash({
            fileArray: [{ data: firmware.data, address: FLASH_OFFSET }],
            flashMode: 'keep',
            flashFreq: 'keep',
            flashSize: 'keep',
            eraseAll: false,
            compress: true,
            reportProgress: (fileIndex, written, total) => {
                setProgress((written / total) * 100);
            },
            calculateMD5Hash: (image) => md5Hex(image),
        });

        setProgress(100);
        logActivity('烧录成功（MD5 校验通过）', 'success');
        updateStatus('烧录完成');

        // 4. 烧录成功后硬复位重启进应用，然后断开
        await rebootAndDisconnect();
    } catch (error) {
        updateProgress(true);
        logActivity(`烧录失败：${error.message}`, 'error');
        logActivity('提示：可尝试按住 BOOT 键复位进下载模式后重新连接再烧录', 'warning');
        updateStatus('烧录失败');
        busy = false;
        updateUi();
        return;
    }

    busy = false;
    updateUi();
}

//
// 重启与清空flash
//

/**
 * 硬复位重启设备，然后断开连接。
 * 出错时不抛异常，只记录日志。
 * @returns {Promise<void>}
 */
async function rebootAndDisconnect() {
    updateStatus('正在重启…');

    let rebootFailed = true;
    try {
        await esploader.after('hard_reset');
        rebootFailed = false;
    } catch (error) {
        logActivity(`重启出错：${error.message}`, 'error');
    }

    // 无论重启成功与否都断开连接（重启后串口由芯片释放，关闭失败是正常现象）
    try {
        await disconnect();
    } catch (error) {
        logActivity(`断开连接出错：${error.message}`, 'error');
        if (!rebootFailed) {
            updateStatus('断开连接出错');
            return;
        }
    }

    if (rebootFailed) {
        updateStatus('重启失败');
    } else {
        logActivity('设备已重启', 'success');
        updateStatus('已重启（已断开）');
    }
}

/**
 * 清空flash流程：对整片 flash 执行 chip erase，完成后重启设备。
 * @returns {Promise<void>}
 */
async function eraseFlash() {
    if (busy) return;

    const ok = window.confirm('清空flash 将擦除芯片的全部 flash（固件和所有已保存的数据都会被删除），擦除完成后设备会重启并处于等待烧录状态。确定继续吗？');
    if (!ok) {
        logActivity('已取消清空flash', 'info');
        return;
    }

    busy = true;
    updateUi();
    updateStatus('正在擦除 flash…');
    resetProgress();
    logActivity('正在整片擦除 flash（16MB 需要一些时间）…', 'info');

    try {
        if (!(await checkAndTryConnect())) {
            busy = false;
            updateUi();
            return;
        }

        await esploader.eraseFlash();
        setProgress(100);
        logActivity('flash 擦除完成', 'success');

        updateStatus('正在重启…');
        await rebootAndDisconnect();

        logActivity('清空完成，请重新烧录固件', 'warning');
        updateStatus('已清空（已断开）');
    } catch (error) {
        updateProgress(true);
        logActivity(`清空失败：${error.message}`, 'error');
        updateStatus('清空失败');
    } finally {
        busy = false;
        updateUi();
    }
}

//
// 事件绑定
//

connectBtn.addEventListener('click', async () => {
    if (busy) return;

    if (connected()) {
        await disconnectNoThrow();
    } else {
        await connect();
    }

    updateUi();
});

flashBtn.addEventListener('click', async () => {
    await flash();
});

eraseBtn.addEventListener('click', async () => {
    await eraseFlash();
});

downloadBtn.addEventListener('click', () => {
    downloadFirmwareFile();
});

modalCloseBtn.addEventListener('click', () => {
    hideWebserialModal();
});

// 点遮罩空白处也可关闭（点卡片本身不关）
webserialModal.addEventListener('click', (e) => {
    if (e.target === webserialModal) hideWebserialModal();
});

//
// 启动
//

startup();

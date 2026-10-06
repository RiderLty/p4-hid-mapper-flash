//
// 配置文件：固件地址与各项常量
//

/** @type {string} 只接受的目标芯片型号（连接后按 esptool 识别结果过滤） */
export const REQUIRED_CHIP = 'ESP32-P4';

/**
 * 支持的芯片版本 → 稳定版固件 hash 的 KV 接口地址。
 * key 是从 esptool 芯片描述（如 "ESP32-P4 (revision v3.1)"）里提取的版本号，
 * 扩充新版本时在这里加一行即可；不在表里的版本连接时会被拒绝。
 * @type {Object<string, string>}
 */
export const FIRMWARE_HASH_URLS = {
    'v1.3': 'https://kvstore.rd5isto.org/api/kv/p4-hid-mapper-stable-hash-5_5_2',
    'v3.1': 'https://kvstore.rd5isto.org/api/kv/p4-hid-mapper-stable-hash-6_1_0',
};

/** @type {string} 固件 CDN 前缀，拼接版本 hash 与后缀得到完整下载地址 */
export const FIRMWARE_CDN_PREFIX = 'https://1833788059.cdn.123clouddisk.com/1833788059/direct/projects/p4-hid-mapper/p4-hid-mapper-';

/** @type {string} 固件文件后缀 */
export const FIRMWARE_CDN_SUFFIX = '.bin';

/** @type {number} 网络获取固件的超时时间（毫秒） */
export const FETCH_TIMEOUT = 30000;

/**
 * @type {number} 固件烧录偏移地址（字节）
 * 当前固件是 ESP-IDF merge_bin 输出的合并镜像：bootloader @0x2000、分区表 @0x8000、app @0x20000，
 * 整包从 0x0 开始烧录。若换成单独的 app 镜像，需改为对应分区偏移（如 0x20000）。
 */
export const FLASH_OFFSET = 0x0;

/** @type {number} 板上 flash 芯片容量（字节），实测失败时的兜底显示值（整片擦除由 esptool chip erase 完成） */
export const FLASH_SIZE = 16 * 1024 * 1024;

/** @type {number} ROM bootloader 阶段波特率 */
export const ROM_BAUDRATE = 115200;

/** @type {number} 上传 stub 后的烧录波特率 */
export const FLASH_BAUDRATE = 921600;

/** @type {string} 使用统计上报地址（暂未启用，预留） */
export const STATS_ENDPOINT = 'https://statistics.rd5isto.org/a/4a4c4cf9-7e2a-4abb-a202-53ab864af193';

/** @type {boolean} 是否开启使用统计上报 */
export const STATS_ENABLED = false;

/** @type {string} 统计上报中的站点标识 */
export const STATS_SITE = 'p4flash.rd5isto.org';

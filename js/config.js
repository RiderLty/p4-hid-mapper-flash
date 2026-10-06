//
// 配置文件：固件地址与各项常量
//

/** @type {string} 测试用固件下载地址（先跑通流程：固定 URL，不走版本 hash 接口） */
export const FIRMWARE_URL = 'https://1833788059.cdn.123clouddisk.com/1833788059/direct/projects/p4-hid-mapper/p4-hid-mapper-4493638a1a8980f69141746f5c65941c3bfce6685eaa71f4ab59a1f1f30f1036.bin';

/** @type {number} 网络获取固件的超时时间（毫秒） */
export const FETCH_TIMEOUT = 30000;

/**
 * @type {number} 固件烧录偏移地址（字节）
 * 当前固件是 ESP-IDF merge_bin 输出的合并镜像：bootloader @0x2000、分区表 @0x8000、app @0x20000，
 * 整包从 0x0 开始烧录。若换成单独的 app 镜像，需改为对应分区偏移（如 0x20000）。
 */
export const FLASH_OFFSET = 0x0;

/** @type {number} 板上 flash 芯片容量（字节），用于容量显示（整片擦除由 esptool chip erase 完成） */
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

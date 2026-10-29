/* =========================================================
 * 诊断知识库：与 data/diagnostics_rules.json 保持一致
 * 每个主板必须在这里登记，否则 runHardwareDiagnostics 会直接返回“未知主控”，
 * 引脚冲突/strapping/USB 占用等诊断会全部静默失效。
 * ========================================================= */
let ruleKnowledgeBase = {
    "ESP32-S3-WROOM-1 N16R8": {
        "max_pin": 48, "internal_used": [35, 36, 37], "internal_used_reason": "内部 Octal PSRAM 占用",
        "strapping": [0, 3, 45, 46], "strapping_reason": "启动时决定电压/启动模式，极易导致无法开机",
        "usb_pins": [19, 20], "uart_pins": [43, 44], "default_i2c": [8, 9], "default_spi": [10, 11, 12, 13]
    },
    "ESP32-S3 N16R8 CAM": {
        "max_pin": 48,
        "internal_used": [35, 36, 37, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18],
        "internal_used_reason": "内部 Octal PSRAM + 板载摄像头排线直连占用",
        "strapping": [0, 3, 45, 46], "strapping_reason": "启动时决定电压/启动模式，极易导致无法开机",
        "usb_pins": [19, 20], "uart_pins": [43, 44], "default_i2c": [42, 41], "default_spi": [10, 11, 12, 13]
    },
    // 目前只维护两块实拍板：WROOM-1 N16R8 与 S3 N16R8 CAM。
    // 新增主板时必须在这里登记同名一条，否则引脚冲突 / strapping / USB 检查会静默跳过。
};

function initDiagnosticsEngine() {
    console.log("✅ 诊断引擎知识库加载成功");
}

/* ---------- 提示文案统一为三层 ----------
   message：一句话结论（面板主行，尽量 ≤ 20 字，用户扫一眼就懂）
   hint   ：一句「怎么做」（面板第二行，小字灰色）
   tip    ：完整原理（只在悬停 title 里出现，不占版面）
   面板一条最多两行，避免开一次面板被上百字淹没。 */
function checkPinOutOfBounds(connections, boardSpec) {
    return connections.filter(c => c.pin < 0 || c.pin > boardSpec.max_pin).map(c => ({
        level: 'ERROR', code: 'E1', pin: c.pin,
        message: '这个引脚不存在',
        hint: `本板最大 GPIO ${boardSpec.max_pin}`,
        tip: `GPIO ${c.pin} 超出本主控的引脚范围（0~${boardSpec.max_pin}），模组配置可能写错了。`
    }));
}

function checkInternalUsed(connections, boardSpec) {
    return connections.filter(c => boardSpec.internal_used.includes(c.pin)).map(c => ({
        level: 'ERROR', code: 'E2', pin: c.pin,
        message: '主控内部占用，不能外接',
        hint: '内部占用，换一根空闲脚',
        tip: `GPIO ${c.pin} 已被主控自己占用（${boardSpec.internal_used_reason || '内部功能'}），外接会直接冲突。`
    }));
}

/* 引脚冲突检测：SDA/SCL/MOSI/MISO/SCK/BCLK/LRC 是总线信号，多设备并联本就合法
   （麦克风与功放共用同一组 I2S 时钟是标准接法），不能算冲突；
   但「总线信号压到独占信号上」或「同一脚上挂了两种不同总线信号」仍是真冲突 */
function checkPinConflict(connections) {
    const SHAREABLE = ['SDA', 'SCL', 'MOSI', 'MISO', 'SCK', 'BCLK', 'LRC'];
    const errors = [];
    const strongMap = {};   // pin -> 独占该脚的模组名
    const busMap = {};      // pin -> { 信号名: [模组名] }

    connections.forEach(c => {
        const sig = String(c.signal || '').toUpperCase();
        if (SHAREABLE.includes(sig)) {
            if (!busMap[c.pin]) busMap[c.pin] = {};
            (busMap[c.pin][sig] = busMap[c.pin][sig] || []).push(c.module);
            return;
        }
        if (strongMap[c.pin]) {
            errors.push({
                level: 'ERROR', code: 'E3', pin: c.pin,
                message: '两个模组抢同一根脚',
                hint: `${strongMap[c.pin]} 与 ${c.module} 只能留一个`,
                tip: `引脚冲突：GPIO ${c.pin} 同时被 ${strongMap[c.pin]} 和 ${c.module} 占用。`
            });
        } else {
            strongMap[c.pin] = c.module;
        }
    });

    Object.keys(busMap).forEach(pin => {
        const sigs = Object.keys(busMap[pin]);
        if (strongMap[pin]) {
            errors.push({
                level: 'ERROR', code: 'E3', pin: Number(pin),
                message: '这根脚被模组和总线同时用',
                hint: `${strongMap[pin]} 与 ${sigs.join('/')} 二选一`,
                tip: `引脚冲突：GPIO ${pin} 同时接了 ${strongMap[pin]} 和 ${sigs.join('/')} 总线信号。`
            });
        } else if (sigs.length > 1) {
            const names = sigs.map(s => `${s}(${busMap[pin][s].join('/')})`).join(' 与 ');
            errors.push({
                level: 'ERROR', code: 'E3', pin: Number(pin),
                message: '一根脚挂了两种总线信号',
                hint: `${sigs.join(' 与 ')} 只能留一组`,
                tip: `引脚冲突：GPIO ${pin} 上同时挂了两种总线信号 ${names}。`
            });
        }
    });
    return errors;
}

function checkStrapping(connections, boardSpec) {
    return connections.filter(c => boardSpec.strapping.includes(c.pin)).map(c => ({
        level: 'WARNING', code: 'W1', pin: c.pin,
        message: '启动脚，接了可能开不了机',
        hint: '换个脚最稳',
        tip: `GPIO ${c.pin} 是 Strapping 引脚，芯片启动瞬间会读它的电平决定启动模式/电压。接入 ${c.module} 后若上电时被拉低，可能直接进下载模式或起不来。`
    }));
}

/* 19/20 是 ESP32-S3 的原生 USB（D-/D+，即 USB-Serial-JTAG）。
   芯片层面它们就是两根普通 GPIO —— 不接 USB 时完全可以外接屏幕/I2C，很多人确实这么做。
   代价只有一个：这个 USB 口的 CDC 串口 / JTAG 调试 / 原生下载会失效。
   如果板上还有 UART0 引到排针（本工具两块板都是 TX=43 RX=44），外接 USB-TTL 仍能烧录，所以是「警告」不是「错误」。 */
function checkUsbPins(connections, boardSpec) {
    const usb = boardSpec.usb_pins || [];
    if (!usb.length) return [];
    const uart = boardSpec.uart_pins || [43, 44];
    return connections.filter(c => usb.includes(c.pin)).map(c => ({
        level: 'WARNING', code: 'W2', pin: c.pin,
        message: 'USB 脚，占用后不能再下载',
        hint: `改走 UART0 烧录即可`,
        tip: `GPIO ${c.pin} 是 USB ${c.pin === usb[0] ? 'D-' : 'D+'}（与 GPIO ${c.pin === usb[0] ? usb[1] : usb[0]} 组成 USB-Serial-JTAG）。`
            + `外接 ${c.module} 后这个 USB 口就不能当串口/下载口了，但芯片本身没坏：接 UART0 的 TX=GPIO ${uart[0]} / RX=GPIO ${uart[1]} 用 USB-TTL 照样能烧录。`
    }));
}

/* 43/44（C3 为 20/21）是 UART0 调试串口：被 I2S/SPI 等外设征用后，串口日志与下载会失效 */
function checkUartPins(connections, boardSpec) {
    const uart = boardSpec.uart_pins || [];
    if (!uart.length) return [];
    return connections.filter(c => uart.includes(c.pin)).map(c => ({
        level: 'WARNING', code: 'W3', pin: c.pin,
        message: '调试串口，占用后看不到日志',
        hint: '改用板载 USB 口烧录',
        tip: `GPIO ${c.pin} 是 UART0 的 ${c.pin === uart[0] ? 'TX' : 'RX'}，被外设占用后串口日志与一键下载会失效，此时改用板载 USB-JTAG 口烧录。`
    }));
}

/* SPI 高速脚是否落在 IO_MUX 上：
   只有 IO_MUX 直连的 FSPI 脚能跑到 80MHz；经 GPIO 矩阵路由时时钟上限约 40MHz。
   驱动 ST7789 这类屏 40MHz 已经够用（320×240 全屏刷新还有 15~20fps），
   但用户如果想「按 80MHz 配」，就必须换回芯片手册里的 IO_MUX 脚，否则一定花屏。 */
function checkSpiRouting(connections, boardName) {
    const boards = (typeof globalBoards !== 'undefined') ? globalBoards : null;
    if (!boards) return [];
    const board = Object.values(boards).find(b => b && b.boardName === boardName);
    if (!board || !board.ioMuxSpi) return [];
    const mux = board.ioMuxSpi;
    const out = [];
    connections.forEach(c => {
        const sig = String(c.signal || '').toUpperCase();
        if (sig !== 'SCK' && sig !== 'MOSI') return;
        const def = mux[sig];
        if (def === undefined || Number(c.pin) === Number(def)) return;
        out.push({
            level: 'WARNING', code: 'W4', pin: c.pin,
            message: 'SPI 没走高速脚，最快 40MHz',
            hint: `要 80MHz 就换 GPIO ${def}`,
            tip: `${sig === 'SCK' ? '时钟 SCL/SCK' : '数据 SDA/MOSI'} 接在 GPIO ${c.pin}，不是本芯片 IO_MUX 的专用脚（GPIO ${def}）。`
                + (board.ioMuxSpiBlocked ? `${board.ioMuxSpiBlocked}。` : '')
                + `经 GPIO 矩阵路由时 SPI 时钟上限约 40MHz，驱动 ST7789 这类屏完全够用；要按 80MHz 配置必须换回 GPIO ${def}，否则会花屏。`
        });
    });
    return out;
}

/* W5 背光/使能脚改走 GPIO
   模组字典里 BLK 挂在 power_pins（connect_to 3.3V），那是「默认接法 = 常亮」，
   不是「只能接 3.3V」：改接 GPIO 才能用 LEDC 做 PWM 无级调光，本身合法。
   但这一步有真实代价，之前没有任何规则覆盖，线才会一直显示成「正常紫」，容易误以为无脑可用。 */
function checkBacklightGpio(connections, boardSpec) {
    // 只认背光类脚名；SHDN/EN 这类芯片使能脚语义不同，不在这里误报
    const BLK_RE = /^(BLK|BL_?EN|BACKLIGHT|LED|LEDA|LEDK|LED_?EN)$/i;
    return connections.filter(c => BLK_RE.test(String(c.signal || ''))).map(c => ({
        level: 'WARNING', code: 'W5', pin: c.pin,
        message: '背光接 GPIO，上电会黑一下',
        hint: '电流大要加三极管',
        tip: `BLK 默认接 3.3V 是「常亮」，改接 GPIO ${c.pin} 才能 PWM 调光，属于合法用法，但要确认三点：`
            + `① GPIO 上电默认低电平/高阻，上电瞬间屏会先黑一下，固件初始化后拉高才亮；`
            + `② 若这块屏的 BLK 直接吃背光电流（常见 20~60mA，远超 GPIO 的 20mA 推荐值），必须经三极管/MOS 驱动，不能直驱；`
            + `③ 若 BLK 只是背光升压 IC 的 EN 脚（电流 <1mA），可直驱。`
    }));
}

/* 容错匹配：主板数据里的 boardName 常带后缀说明（如 "ESP32-C3 (RISC-V)"），
   精确匹配失败时回退到最长包含匹配，避免新增主板后诊断静默失效 */
function resolveBoardSpec(boardName) {
    if (!boardName) return null;
    if (ruleKnowledgeBase[boardName]) return ruleKnowledgeBase[boardName];
    const upper = String(boardName).toUpperCase();
    let bestKey = null;
    Object.keys(ruleKnowledgeBase).forEach(k => {
        if (upper.includes(k.toUpperCase()) && (!bestKey || k.length > bestKey.length)) bestKey = k;
    });
    if (bestKey) return ruleKnowledgeBase[bestKey];
    console.warn(`⚠️ [Diagnostics] 主板【${boardName}】尚未登记诊断规则，引脚冲突/strapping 检查已跳过。`);
    return null;
}

function runHardwareDiagnostics(connections, boardName) {
    const boardSpec = resolveBoardSpec(boardName);
    if (!boardSpec) return { errors: [], warnings: [], infos: [] };
    
    let report = { errors: [], warnings: [], infos: [] };
    report.errors.push(...checkPinOutOfBounds(connections, boardSpec));
    report.errors.push(...checkInternalUsed(connections, boardSpec));
    report.errors.push(...checkPinConflict(connections));
    report.warnings.push(...checkStrapping(connections, boardSpec));
    report.warnings.push(...checkUsbPins(connections, boardSpec));
    report.warnings.push(...checkUartPins(connections, boardSpec));
    report.warnings.push(...checkSpiRouting(connections, boardName));
    report.warnings.push(...checkBacklightGpio(connections, boardSpec));
    // 同一根脚可能被多个模组共享（如 I2S 时钟），同类同脚提示只保留一条
    const dedupe = (list) => {
        const seen = new Set();
        return list.filter(x => {
            const key = `${x.code}:${x.pin}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };
    report.errors = dedupe(report.errors);
    report.warnings = dedupe(report.warnings);
    return report;
}
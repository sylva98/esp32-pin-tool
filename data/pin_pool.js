/* =========================================================
 * 各接口族市面常见引线名池（用于「引脚配置」弹窗候选勾选）
 * power  : 电源/地脚候选（按实物有无勾选）
 * signals: 信号脚候选（字典外扩展脚，如 RST/INT/ADDR/BLK…）
 * 来源：常见模块厂商标注整理（SSD1306/TFT/MAX98357A/INMP441/AHT20/DHT11 等）
 * ========================================================= */
const INTERFACE_PIN_POOL = {
    'I2C': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['RST', 'RESET', 'INT', 'IT', 'IRQ', 'ADDR', 'A0', 'D/C', 'NC']
    },
    'SPI': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['SS', 'CE', 'NCS', 'RS', 'A0', 'RESET', 'BL', 'LED', 'NC']
    },
    'I2S_IN': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['MCLK', 'MCK', 'SCK', 'SCLK', 'WS', 'LRCLK', 'DIN', 'IN', 'DOUT', 'OUT', 'L/R', 'LRSEL', 'SD', 'GAIN', 'NC']
    },
    'I2S_OUT': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['MCLK', 'MCK', 'SCK', 'SCLK', 'WS', 'LRCLK', 'DOUT', 'OUT', 'L/R', 'LRSEL', 'SHDN', 'NC']
    },
    'GPIO': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['DO', 'D1', 'S', 'SIG', 'OUT', 'IN', 'AOUT', 'AO', 'NC']
    },
    'ADC': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['AOUT', 'AO', 'DATA', 'DO', 'SIG', 'NC']
    },
    'PWM': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['PULSE', 'CTRL', 'NC']
    },
    'UART': {
        power: ['VCC', 'VIN', '5V', '3.3V', '3V3', 'GND'],
        signals: ['RST', 'RESET', 'CTS', 'RTS', 'NC']
    },
    'DVP': { power: [], signals: [] },
    'INTERNAL': { power: [], signals: [] }
};

/* 必接电源脚：缺了模组无法工作（VCC/VIN/GND）。
   BLK、EN、SHDN 这类「使能/背光」脚不是供电，是可选接法 —— 实物没这根脚（如 7 针屏）
   就要允许取消勾选，不能锁死。 */
function isEssentialPower(sig) {
    return ['GND', 'VCC', 'VIN'].includes(String(sig || '').toUpperCase());
}

/* 常见信号脚的作用说明（弹窗里悬停显示，帮用户对上实物丝印） */
const SIGNAL_HINTS = {
    // SPI 屏族（丝印 → 标准信号）
    SCK: 'SPI 时钟。屏上丝印写 SCL/CLK 的都是它',
    MOSI: 'SPI 数据（主控→模组）。屏上丝印写 SDA/DIN 的都是它；屏只写不读，没有 MISO',
    MISO: 'SPI 数据（模组→主控）。屏一般没有这根脚',
    RST: '复位，低电平有效：拉低会重启模组的驱动芯片',
    RES: '复位（丝印写法），= 标准信号的 RST',
    DC: '数据/命令选择：高电平=显示数据，低电平=命令',
    CS: '片选，低电平有效：拉低后模组才接收数据',
    SS: '片选（丝印写法），= 标准信号的 CS',
    BLK: '背光：接 3.3V=常亮；接 GPIO 可 PWM 调光；部分 7 针屏没有这根脚',
    BL: '背光（丝印写法），= 字典里的 BLK',
    LED: '背光（有的屏这么印），= 字典里的 BLK',
    NCS: '片选（带 N 前缀=低有效），= 标准信号的 CS',
    NC: '悬空脚：模组上存在但不接任何东西',
    // I2S 音频族
    BCLK: 'I2S 位时钟',
    LRC: 'I2S 左右声道选择（也叫 WS/LRCLK）',
    WS: 'I2S 字选择（也叫 LRC/LRCLK）',
    DIN: '数据输入（麦克风方向：模组→主控）',
    DOUT: '数据输出（功放方向：主控→模组）',
    SD: '数据（丝印写法）；在功放上也可能是 Shutdown 使能，看丝印旁注',
    GAIN: '功放增益选择：接 GND=9dB / 悬空=12dB / 接 VCC=15dB',
    'L/R': '麦克风左右声道：接 GND=左声道，接 VDD=右声道',
    'L/R ': '麦克风左右声道：接 GND=左声道，接 VDD=右声道',
    MCLK: 'I2S 主时钟（多数板不需要）',
    // 传感器/其它
    SDA: 'I2C 数据；接 SPI 屏时是 MOSI 的丝印写法',
    INT: '中断输出：模组有事件时拉低通知主控（可选）',
    ADDR: 'I2C 地址选择：接 GND/VCC 切换两个可选地址',
    A0: '地址选择或数据/命令选择，看模组手册',
    DATA: '单总线数据（DHT11 等）',
    AOUT: '模拟输出，接主控 ADC 脚',
    IN: '控制输入（继电器/按键等）',
    OUT: '信号输出',
    SHDN: '关断/使能脚：拉低进入休眠（可选）'
};

/* 电源脚 → 主板电源轨推断：
   GND→GND；5V→5V；3.3V/3V3→3.3V；VCC/VIN→沿用模组已定义 VCC 的供电目标，否则默认 3.3V */
function inferPowerTarget(sig, modData) {
    const s = String(sig || '').toUpperCase();
    if (s.includes('GND')) return 'GND';
    if (s === '5V') return '5V';
    if (s === '3.3V' || s === '3V3') return '3.3V';
    if (modData && modData.power_pins) {
        const vcc = modData.power_pins.find(pp => ['VCC', 'VIN'].includes(String(pp.pin).toUpperCase()) && pp.connect_to);
        if (vcc) return vcc.connect_to;
    }
    return '3.3V';
}

/* 模组默认启用引脚：字典内定义全部勾选 */
function defaultEnabledPins(modData) {
    const set = {};
    (modData.requirements || []).forEach(r => { set[r.signal] = true; });
    (modData.power_pins || []).forEach(pp => { set[pp.pin] = true; });
    (modData.local_links || []).forEach(l => { set[l.from] = true; set[l.to] = true; });
    return set;
}

/* 确保 activeModules 项有 enabledPins */
function ensureEnabledPins(mod) {
    if (!mod || mod.enabledPins) return;
    const modData = (typeof moduleLibrary !== 'undefined' && moduleLibrary[mod.id]) ? moduleLibrary[mod.id] : {};
    mod.enabledPins = defaultEnabledPins(modData);
}

/* =========================================================
 * 型号引脚预设：把调整好的勾选组合保存为该型号的默认参数
 * key: esp_pin_preset_<modId>  { enabledPins, customPins, updatedAt }
 * ========================================================= */
function getPinPreset(modId) {
    try {
        const raw = localStorage.getItem('esp_pin_preset_' + modId);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}
function savePinPreset(modId, enabledPins, customPins) {
    try {
        localStorage.setItem('esp_pin_preset_' + modId, JSON.stringify({ enabledPins, customPins: customPins || [], updatedAt: Date.now() }));
    } catch (e) { console.warn('保存引脚预设失败', e); }
}
function clearPinPreset(modId) {
    try { localStorage.removeItem('esp_pin_preset_' + modId); } catch (e) {}
}

/* 添加模组时应用该型号已保存的默认引脚配置 */
function applyPinPresetToMod(mod) {
    if (!mod) return;
    const preset = getPinPreset(mod.id);
    const modData = (typeof moduleLibrary !== 'undefined' && moduleLibrary[mod.id]) ? moduleLibrary[mod.id] : {};
    if (preset && preset.enabledPins) {
        // 合并预设与锁定项（必需信号 / 必接电源脚恒勾选；BLK 等可选电源尊重预设）
        const merged = defaultEnabledPins(modData);
        Object.keys(preset.enabledPins).forEach(k => { merged[k] = preset.enabledPins[k]; });
        (modData.requirements || []).forEach(r => { if (!r.optional) merged[r.signal] = true; });
        (modData.power_pins || []).forEach(pp => { if (isEssentialPower(pp.pin)) merged[pp.pin] = true; });
        mod.enabledPins = merged;
        mod.customPins = (preset.customPins || []).filter(c => moduleLibrary[mod.id] === undefined || !(modData.requirements || []).some(r => r.signal === c));
    } else {
        mod.enabledPins = defaultEnabledPins(modData);
        mod.customPins = mod.customPins || [];
    }
}

/* 为预设勾选的扩展/自定义信号补分配 GPIO（添加模组/更换模组后调用） */
function presetExtraAllocate(mod, modData) {
    if (!mod || !mod.enabledPins || typeof allocateNewSignal !== 'function') return;
    const reqSigs = (modData.requirements || []).map(r => r.signal);
    const pool = (typeof INTERFACE_PIN_POOL !== 'undefined' && INTERFACE_PIN_POOL[modData.interface]) ? INTERFACE_PIN_POOL[modData.interface] : { power: [], signals: [] };
    const pKeys = new Set((modData.power_pins || []).map(pp => pp.pin).concat(pool.power || []));
    const lKeys = new Set();
    (modData.local_links || []).forEach(l => { lKeys.add(l.from); lKeys.add(l.to); });
    Object.keys(mod.enabledPins).forEach(sig => {
        if (mod.enabledPins[sig] === true && !reqSigs.includes(sig) && !mod.connections[sig] && !pKeys.has(sig) && !lKeys.has(sig)) {
            allocateNewSignal(mod, sig, modData);
        }
    });
}

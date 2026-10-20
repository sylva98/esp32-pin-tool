/**
 * ESP32 硬件诊断规则引擎 (Diagnostics Engine)
 * 依赖数据格式：connections = [{ pin: 8, module: "OLED", signal: "SDA" }, ...]
 */

// 加载知识库
let ruleKnowledgeBase = null;

async function initDiagnosticsEngine() {
    try {
        const res = await fetch('./data/diagnostics_rules.json');
        ruleKnowledgeBase = await res.json();
        console.log("✅ 诊断引擎知识库加载成功");
    } catch (e) {
        console.error("❌ 诊断规则加载失败", e);
    }
}

// ==========================================
// 规则库 (Rules)
// ==========================================

// 🔴 规则 E1：引脚越界
function checkPinOutOfBounds(connections, boardSpec) {
    let errors = [];
    connections.forEach(conn => {
        if (conn.pin < 0 || conn.pin > boardSpec.max_pin) {
            errors.push({
                level: 'ERROR', code: 'E1', pin: conn.pin,
                message: `引脚越界：GPIO ${conn.pin} 不存在于当前主控。`
            });
        }
    });
    return errors;
}

// 🔴 规则 E2：内部硬占用 (如 PSRAM 引脚)
function checkInternalUsed(connections, boardSpec) {
    let errors = [];
    connections.forEach(conn => {
        if (boardSpec.internal_used.includes(conn.pin)) {
            errors.push({
                level: 'ERROR', code: 'E2', pin: conn.pin,
                message: `严重冲突：GPIO ${conn.pin} 已被主控${boardSpec.internal_used_reason}，严禁外接 ${conn.module}！`
            });
        }
    });
    return errors;
}

// 🔴 规则 E3：引脚冲突 (同一个引脚被分配了两次)
function checkPinConflict(connections) {
    let errors = [];
    let pinMap = {};
    connections.forEach(conn => {
        if (pinMap[conn.pin]) {
            errors.push({
                level: 'ERROR', code: 'E3', pin: conn.pin,
                message: `引脚冲突：GPIO ${conn.pin} 同时被 ${pinMap[conn.pin]} 和 ${conn.module} 占用。`
            });
        } else {
            pinMap[conn.pin] = conn.module;
        }
    });
    return errors;
}

// 🟡 规则 W1：Strapping 敏感引脚
function checkStrapping(connections, boardSpec) {
    let warnings = [];
    connections.forEach(conn => {
        if (boardSpec.strapping.includes(conn.pin)) {
            warnings.push({
                level: 'WARNING', code: 'W1', pin: conn.pin,
                message: `启动风险：GPIO ${conn.pin} 是 Strapping 引脚（${boardSpec.strapping_reason}）。接入 ${conn.module} 可能导致芯片无法启动。`
            });
        }
    });
    return warnings;
}

// 🟡 规则 W2：USB 引脚冲突
function checkUsbPins(connections, boardSpec) {
    let warnings = [];
    connections.forEach(conn => {
        if (boardSpec.usb_pins.includes(conn.pin)) {
            warnings.push({
                level: 'WARNING', code: 'W2', pin: conn.pin,
                message: `功能妥协：GPIO ${conn.pin} 默认是 USB 数据线。外接 ${conn.module} 将导致无法通过 USB 烧录和调试。`
            });
        }
    });
    return warnings;
}

// 🔵 规则 I1：硬件 I2C 未对齐优化建议
function checkHardwareI2C(connections, boardSpec) {
    let infos = [];
    let i2cConnections = connections.filter(c => c.signal.includes('SDA') || c.signal.includes('SCL'));
    
    // 如果有 I2C 设备，且没使用默认的硬件引脚
    if (i2cConnections.length > 0) {
        let isUsingDefault = i2cConnections.some(c => boardSpec.default_i2c.includes(c.pin));
        if (!isUsingDefault) {
            infos.push({
                level: 'INFO', code: 'I1', pin: null,
                message: `优化建议：当前 I2C 接口未使用硬件默认引脚 (GPIO ${boardSpec.default_i2c.join(', ')})。软件模拟 I2C 可能会限制通信速率。`
            });
        }
    }
    return infos;
}


// ==========================================
// 总调度器 (Engine Scheduler)
// ==========================================

/**
 * 运行硬件体检
 * @param {Array} connections 当前接线状态
 * @param {String} boardName 主控型号
 * @returns {Object} 报告对象 { errors, warnings, infos }
 */
function runHardwareDiagnostics(connections, boardName) {
    // 1. 从知识库获取主控规格
    const boardSpec = ruleKnowledgeBase[boardName];
    if (!boardSpec) {
        return { errors: [{ level: 'ERROR', message: "未知的主控型号，无法诊断。" }], warnings: [], infos: [] };
    }

    let report = { errors: [], warnings: [], infos: [] };

    // 2. 执行所有致命错误检查
    report.errors.push(...checkPinOutOfBounds(connections, boardSpec));
    report.errors.push(...checkInternalUsed(connections, boardSpec));
    report.errors.push(...checkPinConflict(connections));

    // 3. 执行严重警告检查
    report.warnings.push(...checkStrapping(connections, boardSpec));
    report.warnings.push(...checkUsbPins(connections, boardSpec));

    // 4. 执行优化建议检查
    report.infos.push(...checkHardwareI2C(connections, boardSpec));

    // 5. 返回最终报告
    return report;
}

// 初始化引擎 (页面加载时调用)
document.addEventListener('DOMContentLoaded', initDiagnosticsEngine);
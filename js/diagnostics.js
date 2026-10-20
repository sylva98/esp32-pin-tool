/**
 * ESP32 硬件诊断规则引擎 (Diagnostics Engine)
 */
let ruleKnowledgeBase = null;

// 使用 XMLHttpRequest 加载规则，绕过 fetch 的 CSP 限制
function initDiagnosticsEngine() {
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', './data/diagnostics_rules.json');
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    ruleKnowledgeBase = JSON.parse(xhr.responseText);
                    console.log("✅ 诊断引擎知识库加载成功");
                } catch (e) {
                    console.error("❌ 诊断规则 JSON 解析失败");
                }
            } else {
                console.error("❌ 诊断规则加载失败，状态码:", xhr.status);
            }
            resolve();
        };
        xhr.onerror = () => {
            console.error("❌ 诊断规则请求失败");
            resolve(); 
        };
        xhr.send();
    });
}

function checkPinOutOfBounds(connections, boardSpec) {
    let errors = [];
    connections.forEach(conn => {
        if (conn.pin < 0 || conn.pin > boardSpec.max_pin) {
            errors.push({ level: 'ERROR', code: 'E1', pin: conn.pin, message: `引脚越界：GPIO ${conn.pin} 不存在于当前主控。` });
        }
    });
    return errors;
}

function checkInternalUsed(connections, boardSpec) {
    let errors = [];
    connections.forEach(conn => {
        if (boardSpec.internal_used.includes(conn.pin)) {
            errors.push({ level: 'ERROR', code: 'E2', pin: conn.pin, message: `严重冲突：GPIO ${conn.pin} 已被主控${boardSpec.internal_used_reason}，严禁外接 ${conn.module}！` });
        }
    });
    return errors;
}

function checkPinConflict(connections) {
    let errors = [];
    let pinMap = {};
    connections.forEach(conn => {
        if (pinMap[conn.pin]) {
            errors.push({ level: 'ERROR', code: 'E3', pin: conn.pin, message: `引脚冲突：GPIO ${conn.pin} 同时被 ${pinMap[conn.pin]} 和 ${conn.module} 占用。` });
        } else {
            pinMap[conn.pin] = conn.module;
        }
    });
    return errors;
}

function checkStrapping(connections, boardSpec) {
    let warnings = [];
    connections.forEach(conn => {
        if (boardSpec.strapping.includes(conn.pin)) {
            warnings.push({ level: 'WARNING', code: 'W1', pin: conn.pin, message: `启动风险：GPIO ${conn.pin} 是 Strapping 引脚（${boardSpec.strapping_reason}）。接入 ${conn.module} 可能导致芯片无法启动。` });
        }
    });
    return warnings;
}

function checkUsbPins(connections, boardSpec) {
    let warnings = [];
    connections.forEach(conn => {
        if (boardSpec.usb_pins.includes(conn.pin)) {
            warnings.push({ level: 'WARNING', code: 'W2', pin: conn.pin, message: `功能妥协：GPIO ${conn.pin} 默认是 USB 数据线。外接 ${conn.module} 将导致无法通过 USB 烧录和调试。` });
        }
    });
    return warnings;
}

function checkHardwareI2C(connections, boardSpec) {
    let infos = [];
    let i2cConnections = connections.filter(c => c.signal.includes('SDA') || c.signal.includes('SCL'));
    if (i2cConnections.length > 0) {
        let isUsingDefault = i2cConnections.some(c => boardSpec.default_i2c.includes(c.pin));
        if (!isUsingDefault) {
            infos.push({ level: 'INFO', code: 'I1', pin: null, message: `优化建议：当前 I2C 接口未使用硬件默认引脚 (GPIO ${boardSpec.default_i2c.join(', ')})。软件模拟 I2C 可能会限制通信速率。` });
        }
    }
    return infos;
}

function runHardwareDiagnostics(connections, boardName) {
    const boardSpec = ruleKnowledgeBase[boardName];
    if (!boardSpec) {
        return { errors: [{ level: 'ERROR', message: "未知的主控型号，无法诊断。" }], warnings: [], infos: [] };
    }

    let report = { errors: [], warnings: [], infos: [] };
    report.errors.push(...checkPinOutOfBounds(connections, boardSpec));
    report.errors.push(...checkInternalUsed(connections, boardSpec));
    report.errors.push(...checkPinConflict(connections));
    report.warnings.push(...checkStrapping(connections, boardSpec));
    report.warnings.push(...checkUsbPins(connections, boardSpec));
    report.infos.push(...checkHardwareI2C(connections, boardSpec));
    
    return report;
}

// 不再需要在这里监听 DOMContentLoaded，由 app.js 控制加载顺序
// document.addEventListener('DOMContentLoaded', initDiagnosticsEngine);
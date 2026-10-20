let ruleKnowledgeBase = {
    "ESP32-S3-WROOM-1 N16R8": {
        "max_pin": 48, "internal_used": [35, 36, 37], "internal_used_reason": "内部 Octal PSRAM 占用",
        "strapping": [0, 3, 45, 46], "strapping_reason": "启动时决定电压/启动模式，极易导致无法开机",
        "usb_pins": [19, 20], "default_i2c": [8, 9], "default_spi": [10, 11, 12, 13]
    }
};

function initDiagnosticsEngine() {
    console.log("✅ 诊断引擎知识库加载成功");
}

function checkPinOutOfBounds(connections, boardSpec) {
    return connections.filter(c => c.pin < 0 || c.pin > boardSpec.max_pin).map(c => ({ level: 'ERROR', code: 'E1', pin: c.pin, message: `引脚越界：GPIO ${c.pin} 不存在。` }));
}

function checkInternalUsed(connections, boardSpec) {
    return connections.filter(c => boardSpec.internal_used.includes(c.pin)).map(c => ({ level: 'ERROR', code: 'E2', pin: c.pin, message: `严重冲突：GPIO ${c.pin} 已被主控占用，严禁外接！` }));
}

function checkPinConflict(connections) {
    let errors = [], pinMap = {};
    connections.forEach(c => {
        if (pinMap[c.pin]) errors.push({ level: 'ERROR', code: 'E3', pin: c.pin, message: `引脚冲突：GPIO ${c.pin} 同时被 ${pinMap[c.pin]} 和 ${c.module} 占用。` });
        else pinMap[c.pin] = c.module;
    });
    return errors;
}

function checkStrapping(connections, boardSpec) {
    return connections.filter(c => boardSpec.strapping.includes(c.pin)).map(c => ({ level: 'WARNING', code: 'W1', pin: c.pin, message: `启动风险：GPIO ${c.pin} 是 Strapping 引脚，接入 ${c.module} 可能导致无法启动。` }));
}

function checkUsbPins(connections, boardSpec) {
    return connections.filter(c => boardSpec.usb_pins.includes(c.pin)).map(c => ({ level: 'WARNING', code: 'W2', pin: c.pin, message: `功能妥协：GPIO ${c.pin} 默认是 USB，外接 ${c.module} 将导致无法 USB 烧录。` }));
}

function runHardwareDiagnostics(connections, boardName) {
    const boardSpec = ruleKnowledgeBase[boardName];
    if (!boardSpec) return { errors: [{ level: 'ERROR', message: "未知主控。" }], warnings: [], infos: [] };
    
    let report = { errors: [], warnings: [], infos: [] };
    report.errors.push(...checkPinOutOfBounds(connections, boardSpec));
    report.errors.push(...checkInternalUsed(connections, boardSpec));
    report.errors.push(...checkPinConflict(connections));
    report.warnings.push(...checkStrapping(connections, boardSpec));
    report.warnings.push(...checkUsbPins(connections, boardSpec));
    return report;
}
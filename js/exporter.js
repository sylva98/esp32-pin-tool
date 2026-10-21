// ==========================================
// 导出与生成层 (Exporter)
// ==========================================

function generateCodePreview() {
    let code = `/*\n * 自动生成\n * 平台: ${boardConfig.boardName}\n */\n\n#ifndef PIN_CONFIG_H\n#define PIN_CONFIG_H\n\n`;
    let hasI2C = false, hasSPI = false;
    activeModules.forEach(mod => { if (mod.interface === 'I2C') hasI2C = true; if (mod.interface === 'SPI') hasSPI = true; });
    
    if (hasI2C) {
        code += `/* --- I2C Bus --- */\n`;
        const i2cMod = activeModules.find(m => m.interface === 'I2C');
        if (i2cMod?.connections['SDA'] && i2cMod.connections['SDA'] !== "dropped") code += `#define I2C_MASTER_SDA_IO  ${i2cMod.connections['SDA']}\n`;
        if (i2cMod?.connections['SCL'] && i2cMod.connections['SCL'] !== "dropped") code += `#define I2C_MASTER_SCL_IO  ${i2cMod.connections['SCL']}\n\n`;
    }
    if (hasSPI) {
        code += `/* --- SPI Bus --- */\n`;
        const spiMod = activeModules.find(m => m.interface === 'SPI');
        ['MOSI', 'MISO', 'SCK', 'CS'].forEach(sig => {
            if (spiMod?.connections[sig] && spiMod.connections[sig] !== "dropped") code += `#define SPI_MASTER_${sig}_IO  ${spiMod.connections[sig]}\n`;
        });
        code += `\n`;
    }
    
    activeModules.forEach((mod) => {
        const modData = moduleLibrary[mod.id];
        const specificSignals = Object.keys(mod.connections).filter(sig => 
            !(mod.interface === 'I2C' && ['SDA', 'SCL'].includes(sig)) && !(mod.interface === 'SPI' && ['MOSI', 'MISO', 'SCK', 'CS'].includes(sig))
        );
        if (specificSignals.length > 0) {
            code += `/* --- ${modData.name} --- */\n`;
            specificSignals.forEach(sig => {
                const pinStr = mod.connections[sig];
                const prefix = mod.id.toUpperCase();
                if (pinStr === "dropped") { code += `// #define ${prefix}_${sig}  (未连接)\n`; } 
                else if (String(pinStr).includes(',')) { String(pinStr).split(',').forEach((p, i) => { code += `#define ${prefix}_${sig}_${i}  ${p}\n`; }); } 
                else {
                    if (mod.interface === 'GPIO') {
                        code += `#define ${prefix}_${sig}  ${pinStr}\n// ⚠️ 若外接按键或无源传感器，请务必启用内部上拉：\n// pinMode(${prefix}_${sig}, INPUT_PULLUP);\n`;
                    } else { code += `#define ${prefix}_${sig}  ${pinStr}\n`; }
                }
            });
            code += `\n`;
        }
    });
    code += `#endif\n`;
    document.getElementById('code-preview').textContent = code;
    document.getElementById('code-panel').style.display = 'block';
}

function printWiringSheet() {
    if (activeModules.length === 0) { return alert('当前没有接入任何模组，无需打印。'); }
    
    let totalCurrent = 0;
    activeModules.forEach(mod => {
        const mData = moduleLibrary[mod.id];
        totalCurrent += (mod.overrides?.current !== undefined ? mod.overrides.current : (mData.peak_current_ma || 0));
    });
    const maxCurrent = boardConfig.max_current_ma || 500;
    const isOverload = totalCurrent > maxCurrent;

    const printSection = document.getElementById('print-section');
    let html = `
        <div class="print-header">
            <h1 class="print-title">硬件接线施工单</h1>
            <div class="print-meta">
                主控型号：<strong>${boardConfig.boardName}</strong> &nbsp;|&nbsp; 
                生成日期：${new Date().toLocaleDateString()} &nbsp;|&nbsp; 
                模组总数：${activeModules.length} 个
            </div>
        </div>
    `;

    if (typeof checkHighSpeedWarning === 'function' && checkHighSpeedWarning()) {
        html += `
            <div class="print-warning-box">
                <div class="print-warning-title">⚠️ 物理走线警告</div>
                <div>本项目包含 SPI/I2S 等高频信号引脚。为确保通信稳定，请确保信号线（特别是时钟线与数据线）长度不超过 10cm，且尽量不要平行缠绕，尽量包地处理。</div>
            </div>
        `;
    }

    if (isOverload) {
        html += `
            <div style="border: 2px solid #dc3545; background: #fff3f3; padding: 12px; margin-bottom: 20px; font-size: 13px; color: #333;">
                <strong style="color: #dc3545; font-size: 15px;">⚠️ 系统总功耗已超载</strong><br>
                为避免满桌飞线，建议采用如下供电方案（只需一个电源）：<br>
                1. 请使用一个 <strong>5V/2A 以上的电源</strong>（如大功率充电宝）插在主控 USB 口上。<br>
                2. 将 <strong>大功耗模组（如功放）</strong> 的 VCC 接至主控板上的 <strong>5V 或 VIN 引脚</strong>（直通充电宝）。<br>
                3. 将 <strong>屏幕、传感器</strong> 的 VCC 接至主控板上的 <strong>3.3V 引脚</strong>。<br>
                4. 将它们的 GND 统一接在主控板 GND 上（主板上天然共地）。
            </div>
        `;
    }
    
    activeModules.forEach((mod, index) => {
        const modData = moduleLibrary[mod.id];
        
        html += `
            <div class="print-module-block">
                <div class="print-module-name">${index + 1}. ${modData.name}</div>
                <table class="print-table">
                    <thead><tr><th style="width: 15%; text-align: center;">完成</th><th style="width: 30%;">信号/电源名称</th><th style="width: 55%;">目标引脚</th></tr></thead>
                    <tbody>
        `;
        
        for (const [signal, pinNum] of Object.entries(mod.connections)) {
            if (pinNum === "dropped") {
                html += `<tr><td style="text-align: center;">-</td><td><strong>${signal}</strong></td><td style="color: #dc3545; text-decoration: line-through;">已放弃连接</td></tr>`;
            } else {
                let isShared = (mod.interface === 'I2C' || mod.interface === 'SPI') && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK');
                let note = isShared ? ' <span style="font-size:12px; color:#666;">(总线共享)</span>' : '';
                html += `<tr><td style="text-align: center;"><div class="print-checkbox"></div></td><td><strong>${signal}</strong></td><td>GPIO ${pinNum} ${note}</td></tr>`;
            }
        }

        if (modData.power_pins && modData.power_pins.length > 0) {
            modData.power_pins.forEach(p => {
                // 提取最简短的指导语，抛弃长句
                let displayWarning = "";
                let isDanger = false;

                if (isOverload) {
                    if (p.connect_to === '5V') {
                        displayWarning = "接外部 5V 供电";
                        isDanger = true;
                    } else if (p.connect_to === '3.3V') {
                        displayWarning = "接降压模块输出";
                        isDanger = false; // 降压模块输出一般不算致命危险，不标红
                    } else {
                        displayWarning = "统一共地";
                    }
                } else {
                    displayWarning = p.connect_to === 'GND' ? "接主板 GND" : "接主板 " + p.connect_to;
                }

                let connectHtml = isDanger 
                    ? `<strong style="color:#dc3545;">${p.connect_to}</strong> <span style="color:#dc3545; font-size:12px;">(${displayWarning})</span>`
                    : `<strong style="color:#333;">${p.connect_to}</strong> <span style="color:#888; font-size:12px;">(${displayWarning})</span>`;

                html += `
                    <tr>
                        <td style="text-align: center;"><div class="print-checkbox"></div></td>
                        <td><strong>${p.pin}</strong></td>
                        <td>${connectHtml}</td>
                    </tr>
                `;
            });
        }

        html += `</tbody></table></div>`;
    });
    
    html += `
        <div class="print-footer">
            接线人签字：____________________ &nbsp;&nbsp;&nbsp;&nbsp; 检查人签字：____________________ &nbsp;&nbsp;&nbsp;&nbsp; 日期：____________________
            <br><br>由 ESP32 智能配置系统自动生成
        </div>
    `;
    printSection.innerHTML = html;
    window.print();
}

function exportConfig() { downloadFile("esp32_config.json", JSON.stringify(activeModules, null, 2)); }
function exportCHeader() { downloadFile("pin_config.h", document.getElementById('code-preview').textContent); }
function downloadFile(filename, content) {
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
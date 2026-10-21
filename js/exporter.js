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
            
            // 代码层降功耗注释
            const modCurrent = mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0);
            if (modCurrent > 100) {
                 code += `\n// ⚠️ 【供电警告】该模组峰值功耗较高（${modCurrent}mA），请确保使用外部电源供电并与主控共地。\n// 若设备发生重启（Brownout），请尝试在代码中降低输出（如降低音量/亮度）。\n`;
            }
            code += `\n`;
        }
    });
    code += `#endif\n`;
    document.getElementById('code-preview').textContent = code;
    document.getElementById('code-panel').style.display = 'block';
}

function printWiringSheet() {
    if (activeModules.length === 0) { return alert('当前没有接入任何模组，无需打印。'); }
    
    // 计算总功耗，用于判断是否超标
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
    
    activeModules.forEach((mod, index) => {
        const modData = moduleLibrary[mod.id];
        
        html += `
            <div class="print-module-block">
                <div class="print-module-name">${index + 1}. ${modData.name}</div>
                <table class="print-table">
                    <thead><tr><th style="width: 15%; text-align: center;">完成</th><th style="width: 30%;">信号名称</th><th style="width: 55%;">目标引脚</th></tr></thead>
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
        html += `</tbody></table>`;

        // 🔥 修复：打印单上的外部供电强提醒。直接复用 power_pins 的配置，不再一刀切写死。
        if (modData.power_pins && modData.power_pins.length > 0) {
            const isDanger = isOverload || modData.power_pins.some(p => p.warning.includes('外部') || p.warning.includes('严禁'));
            if (isDanger) {
                let powerHtml = `<div style="border: 2px solid #dc3545; background: #fff3f3; padding: 10px; margin-bottom: 25px; font-size: 14px; color: #333;">
                    <strong style="color: #dc3545;">🔴 【电源接线警告】</strong><br>`;
                
                modData.power_pins.forEach(p => {
                    let displayWarning = p.warning;
                    if (p.warning.includes('/') && isOverload) {
                        displayWarning = p.warning.split('/')[1].trim();
                    } else if (p.warning.includes('/')) {
                        displayWarning = p.warning.split('/')[0].trim();
                    }
                    powerHtml += `- 请将模组的 <strong>${p.pin}</strong> 接至 <strong>${p.connect_to}</strong>（${displayWarning}）。<br>`;
                });
                powerHtml += `</div>`;
                html += powerHtml;
            }
        }
        
        html += `</div>`;
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
// ==========================================
// 打印模块 (exporter.js)
// ==========================================

/**
 * 纯净打印接线单（采用影子 iframe 方案，绝对不打印侧边栏和弹窗）
 */
function printWiringSheet() {
    if (!boardConfig) {
        uiToast('当前没有加载任何主控板配置', { type: 'warn' });
        return;
    }

    // 1. 准备打印的 HTML 内容
    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>ESP32 硬件接线指导单</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #000; padding: 20px; }
                .print-header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
                .print-title { font-size: 24px; font-weight: bold; margin: 0 0 10px 0; }
                .print-meta { font-size: 14px; color: #555; }
                .print-warning-box { border: 2px solid #dc3545; background: #fff3f3; padding: 10px; margin-bottom: 20px; font-size: 14px; page-break-inside: avoid; }
                .print-warning-title { color: #dc3545; font-weight: bold; margin-bottom: 5px; }
                .print-module-block { margin-bottom: 25px; page-break-inside: avoid; }
                .print-module-name { font-size: 18px; font-weight: bold; background: #eee; padding: 8px; margin-bottom: 10px; border-left: 5px solid #333; }
                .print-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                .print-table th, .print-table td { border: 1px solid #999; padding: 10px; text-align: left; font-size: 14px; }
                .print-table th { background: #f0f0f0; font-weight: bold; }
                .print-footer { text-align: center; font-size: 12px; color: #888; margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; }
                
                /* 本地短接提示框 */
                .print-short-box { background: #f0fdf4; border: 2px dashed #bbf7d0; padding: 12px; border-radius: 4px; margin-bottom: 15px; font-size: 14px; color: #166534; }
                .print-short-title { font-weight: bold; margin-bottom: 5px; font-size: 15px; }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h1 class="print-title">ESP32 硬件接线指导单</h1>
                <div class="print-meta">主控型号：${boardConfig.boardName} | 打印时间：${new Date().toLocaleString()}</div>
            </div>
    `;

    // 计算是否超载
    let totalCurrent = 0;
    if (typeof _onboardSlots !== 'undefined') {
        _onboardSlots.forEach(slot => totalCurrent += resolveOnboardPeak(slot));
    }
    activeModules.forEach(mod => {
        const mData = moduleLibrary[mod.id];
        const isPure5V = mData.power_pins && mData.power_pins.some(p => p.connect_to === '5V') && !mData.power_pins.some(p => p.connect_to === '3.3V');
        if (!isPure5V) {
            totalCurrent += (mod.overrides?.current !== undefined ? mod.overrides.current : (mData.peak_current_ma || 0));
        }
    });

    if (totalCurrent > (boardConfig.max_current_ma || 500)) {
        html += `
            <div class="print-warning-box">
                <div class="print-warning-title">⚠️ 供电超载警告</div>
                当前总功耗预估为 ${totalCurrent} mA，已超过主板安全上限。请焊接工程师务必注意：大电流设备（如屏幕、功放）请直接接外部独立供电，切勿全部连接主板 3.3V 排针。
            </div>
        `;
    }

    // 3.1 板载设备
    if (typeof _onboardSlots !== 'undefined') {
        _onboardSlots.forEach(slot => {
            const mod = moduleLibrary[slot.moduleId] || {};
            html += `
                <div class="print-module-block">
                    <div class="print-module-name">🔒 ${mod.name || slot.label} (板载焊接)</div>
                    <table class="print-table">
                        <tr><th style="width: 30%;">信号名称</th><th style="width: 30%;">对应引脚</th><th style="width: 40%;">备注</th></tr>
                        <tr><td>说明</td><td colspan="2">该设备已由 PCB 直连，无需飞线焊接。</td></tr>
                    </table>
                </div>
            `;
        });
    }

    // 3.2 外接模组
    activeModules.forEach((mod, index) => {
        const modData = moduleLibrary[mod.id] || {};
        html += `
            <div class="print-module-block">
                <div class="print-module-name">${index + 1}. ${modData.name || '未知模组'}</div>
        `;

        // 🔥 打印本地短接提示
        if (modData.local_links && modData.local_links.length > 0) {
            html += `<div class="print-short-box">
                <div class="print-short-title">⚙️ 硬件特殊配置（必须短接）</div>
                <ul style="margin: 5px 0 0 0; padding-left: 20px;">`;
            modData.local_links.forEach(link => {
                html += `<li>请用短接线将模块上的 <strong>${link.from}</strong> 引脚连接到 <strong>${link.to}</strong>（${link.reason}）。</li>`;
            });
            html += `</ul></div>`;
        }

        html += `<table class="print-table">
                    <tr><th style="width: 12%;">引脚号</th><th style="width: 28%;">模组丝印</th><th style="width: 28%;">连接目标</th><th style="width: 32%;">备注</th></tr>
        `;

        // 按实物引脚顺序出接线单（pinOrder）：1→8 从上到下，和手里那块屏的排线一一对应
        const order = (modData.pinOrder && modData.pinOrder.length) ? modData.pinOrder.slice() : [];
        const printed = new Set();
        const rowOf = (silk, target, note, no) => `<tr><td>${no}</td><td><strong>${silk}</strong></td><td>${target}</td><td style="font-size:12px;color:#666;">${note || ''}</td></tr>`;

        let pinNo = 0;
        order.forEach(name => {
            const pp = (modData.power_pins || []).find(p => p.pin === name);
            if (pp) {
                printed.add(name);
                html += rowOf(pp.pin, `<strong>${pp.connect_to}</strong>`, pp.warning || '', ++pinNo);
                return;
            }
            const pinNum = mod.connections[name];
            if (pinNum === 'dropped') { printed.add(name); html += rowOf(signalDisplayName(modData, name), '<span style="color:#999;">未接</span>', '已放弃连接', ++pinNo); return; }
            if (pinNum) { printed.add(name); html += rowOf(signalDisplayName(modData, name), `<span style="font-weight:bold; color:#d32f2f;">GPIO ${pinNum}</span>`, '', ++pinNo); }
        });

        // 字典里有、但 pinOrder 没排到的信号/电源，补在后面，避免漏打
        for (const [signal, pinNum] of Object.entries(mod.connections)) {
            if (printed.has(signal)) continue;
            if (pinNum === 'dropped') { html += rowOf(signalDisplayName(modData, signal), '<span style="color:#999;">未接</span>', '已放弃连接', ++pinNo); continue; }
            html += rowOf(signalDisplayName(modData, signal), `<span style="font-weight:bold; color:#d32f2f;">GPIO ${pinNum}</span>`, '', ++pinNo);
        }
        // 该接却没接上的脚也要打出来（否则打印单看起来是「全都接好了」）
        (modData.requirements || []).forEach(r => {
            if (printed.has(r.signal) || mod.connections[r.signal]) return;
            if (mod.enabledPins && mod.enabledPins[r.signal] === false) return;
            html += rowOf(signalDisplayName(modData, r.signal), '<span style="color:#dc3545; font-weight:bold;">未分配</span>', '缺这根线，模组无法工作', ++pinNo);
        });
        (modData.power_pins || []).forEach(p => {
            if (printed.has(p.pin)) return;
            if (mod.enabledPins && mod.enabledPins[p.pin] === false) return; // 实物没这根脚（如 7 针屏无 BLK）
            html += rowOf(p.pin, `<strong>${p.connect_to}</strong>`, p.warning || '', ++pinNo);
        });

        html += `</table></div>`;
    });

    html += `<div class="print-footer">由 ESP32 引脚智能配置系统生成</div></body></html>`;

    // 🔥 2. 核心黑科技：利用隐藏的 iframe 进行纯净打印
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = 'none';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    // 等待 iframe 内容加载完成后触发打印
    printFrame.onload = () => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
        
        // 打印完成后（或取消后）销毁 iframe
        setTimeout(() => {
            document.body.removeChild(printFrame);
        }, 1000);
    };
}
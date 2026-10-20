function renderPins() {
    const grid = document.getElementById('pin-grid');
    grid.innerHTML = '';
    
    // 创建全局 Tooltip 元素 (如果不存在)
    let globalTooltip = document.getElementById('global-tooltip');
    if (!globalTooltip) {
        globalTooltip = document.createElement('div');
        globalTooltip.id = 'global-tooltip';
        document.body.appendChild(globalTooltip);
    }

    let allConnections = [];
    activeModules.forEach(mod => {
        for (const [signal, pinStr] of Object.entries(mod.connections)) {
            if (pinStr === "dropped") continue;
            String(pinStr).split(',').forEach(p => {
                allConnections.push({ pin: Number(p), module: moduleLibrary[mod.id].name, signal: signal });
            });
        }
    });

    let report = { errors: [], warnings: [] };
    if (typeof runHardwareDiagnostics === 'function' && typeof ruleKnowledgeBase !== 'undefined' && ruleKnowledgeBase) {
        report = runHardwareDiagnostics(allConnections, boardConfig.boardName);
    }

    for (let i = 0; i <= 48; i++) {
        if (i > 21 && i < 35) continue; 

        const pin = pinsState[i];
        const div = document.createElement('div');
        
        let className = `pin ${pin.state}`;
        const errorObj = report.errors.find(e => e.pin === i);
        const warningObj = report.warnings.find(w => w.pin === i);
        
        let tooltipText = "";
        
        if (errorObj) {
            className += ' diagnostic-error';
            tooltipText = "❌ " + errorObj.message;
        } else if (warningObj) {
            className += ' diagnostic-warning';
            tooltipText = "⚠️ " + warningObj.message;
        }
        
        div.className = className;
        let labelHtml = `<div class="io-num">IO${i}</div>`;
        
        if (pin.state === 'used') {
            labelHtml += `<div class="pin-label">${pin.owner}<br>${pin.signal}</div>`;
            div.onclick = () => releasePin(i);
            if (!tooltipText) tooltipText = `点击可强制释放此引脚。\n当前使用: ${pin.owner} (${pin.signal})`;
        } else if (pin.state === 'strapping') {
            labelHtml += `<div class="pin-label">启动敏感</div>`;
            if (!tooltipText) tooltipText = `Strapping 引脚。请谨慎接入外设。`;
        } else if (pin.state === 'fixed') {
             labelHtml += `<div class="pin-label">${pin.label}</div>`;
             if (!tooltipText) tooltipText = `主控系统占用，严禁外接。`;
        } else {
             if (!tooltipText) tooltipText = "空闲可用";
        }

        if (errorObj || warningObj) {
             labelHtml += `<div style="position:absolute; top:2px; right:2px; font-size:14px;">${errorObj ? '❌' : '⚠️'}</div>`;
        }

        // ================= 核心修改：绑定鼠标事件来移动 Tooltip =================
        div.onmouseenter = (e) => {
            if (!tooltipText) return;
            globalTooltip.textContent = tooltipText;
            globalTooltip.style.display = 'block';
            
            // 计算位置：鼠标指向的格子的上方中央
            const rect = div.getBoundingClientRect();
            globalTooltip.style.left = `${rect.left + rect.width / 2}px`;
            globalTooltip.style.top = `${rect.top}px`;
            
            // 如果格子在最顶部，把 Tooltip 放到下方显示
            if (rect.top < 100) {
                globalTooltip.style.transform = 'translate(-50%, 0)';
                globalTooltip.style.marginTop = '15px';
            } else {
                globalTooltip.style.transform = 'translate(-50%, -100%)';
                globalTooltip.style.marginTop = '-10px';
            }
        };
        
        div.onmouseleave = () => {
            globalTooltip.style.display = 'none';
        };
        // =====================================================================

        div.innerHTML = labelHtml;
        grid.appendChild(div);
    }
}
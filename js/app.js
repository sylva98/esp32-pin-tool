// ==========================================
// 全局状态管理
// ==========================================
let boardConfig = null;
let moduleLibrary = null;
let pinsState = {}; 
let activeModules = []; 
let activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} }; 
let pendingModule = null; 
let pendingOptionalDrops = []; 
let editingModuleIndex = -1;
let currentCategory = 'ALL';
let currentSearch = '';
let selectedModuleId = '';

// ==========================================
// 1. 初始化 (读取单板数据)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    try {
        moduleLibrary = globalModuleData;
        boardConfig = globalBoardData;
        
        document.getElementById('board-title').innerText = "当前配置: " + boardConfig.boardName;
        
        // 初始化引脚
        for (let i = 0; i <= boardConfig.max_pin; i++) {
            if (boardConfig.fixedPins.includes(i)) { pinsState[i] = { state: 'fixed', label: 'Fixed' }; } 
            else if (!boardConfig.availableGpios.includes(i)) { pinsState[i] = { state: 'fixed', label: 'N/A' }; } 
            else if (boardConfig.strappingPins[i]) { pinsState[i] = { state: 'strapping', label: 'Strap' }; } 
            else { pinsState[i] = { state: 'free', label: 'Free' }; }
        }
        
        if (typeof initCombobox === 'function') { initCombobox(); }
        if (typeof initDiagnosticsEngine === 'function') { initDiagnosticsEngine(); }
        
        renderPins();
        renderModules();
        updatePowerBudget();
    } catch (error) {
        console.error(error);
        document.getElementById('board-title').innerText = "❌ 初始化失败";
    }
});

// ==========================================
// 2. 渲染逻辑
// ==========================================
function renderPins() {
    const grid = document.getElementById('pin-grid');
    grid.innerHTML = '';
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
            String(pinStr).split(',').forEach(p => { allConnections.push({ pin: Number(p), module: moduleLibrary[mod.id].name, signal: signal }); });
        }
    });
    let report = { errors: [], warnings: [] };
    if (typeof runHardwareDiagnostics === 'function' && typeof ruleKnowledgeBase !== 'undefined' && ruleKnowledgeBase) { 
        report = runHardwareDiagnostics(allConnections, boardConfig.boardName); 
    }
    for (let i = 0; i <= boardConfig.max_pin; i++) {
        const pin = pinsState[i];
        if (!pin) continue; 
        
        const div = document.createElement('div');
        let className = `pin ${pin.state}`;
        const errorObj = report.errors.find(e => e.pin === i);
        const warningObj = report.warnings.find(w => w.pin === i);
        let tooltipText = "";
        if (errorObj) { className += ' diagnostic-error'; tooltipText = "❌ " + errorObj.message; } 
        else if (warningObj) { className += ' diagnostic-warning'; tooltipText = "⚠️ " + warningObj.message; }
        div.className = className;
        let labelHtml = `<div class="io-num">IO${i}</div>`;
        if (pin.state === 'used') {
            labelHtml += `<div class="pin-label">${pin.owner}<br>${pin.signal}</div>`;
            div.onclick = () => releasePin(i);
            if (!tooltipText) tooltipText = `点击可强制释放此引脚。\n当前使用: ${pin.owner} (${pin.signal})`;
        } else if (pin.state === 'strapping') { labelHtml += `<div class="pin-label">启动敏感</div>`; if (!tooltipText) tooltipText = `Strapping 引脚。请谨慎接入外设。`; } 
        else if (pin.state === 'fixed') { labelHtml += `<div class="pin-label">${pin.label}</div>`; if (!tooltipText) tooltipText = `主控系统占用，严禁外接。`; } 
        else { if (!tooltipText) tooltipText = "空闲可用"; }
        if (errorObj || warningObj) { labelHtml += `<div style="position:absolute; top:2px; right:2px; font-size:14px;">${errorObj ? '❌' : '⚠️'}</div>`; }
        div.onmouseenter = () => {
            if (!tooltipText) return;
            globalTooltip.textContent = tooltipText;
            globalTooltip.style.display = 'block';
            const rect = div.getBoundingClientRect();
            globalTooltip.style.left = `${rect.left + rect.width / 2}px`;
            globalTooltip.style.top = `${rect.top}px`;
            if (rect.top < 100) { globalTooltip.style.transform = 'translate(-50%, 0)'; globalTooltip.style.marginTop = '15px'; } 
            else { globalTooltip.style.transform = 'translate(-50%, -100%)'; globalTooltip.style.marginTop = '-10px'; }
        };
        div.onmouseleave = () => { globalTooltip.style.display = 'none'; };
        div.innerHTML = labelHtml;
        grid.appendChild(div);
    }
}

function renderModules() {
    const list = document.getElementById('active-modules-list');
    const wiringPanel = document.getElementById('wiring-panel');
    const wiringList = document.getElementById('connection-list');
    const codePanel = document.getElementById('code-panel');
    if (activeModules.length === 0) {
        list.innerHTML = '<p style="color:#888; font-size:12px; text-align:center;">暂无模组</p>';
        wiringPanel.style.display = 'none'; codePanel.style.display = 'none'; return;
    }
    list.innerHTML = ''; wiringList.innerHTML = '';
    if (typeof checkHighSpeedWarning === 'function' && checkHighSpeedWarning()) {
        const hwWarning = document.createElement('div');
        hwWarning.style.cssText = "font-size:13px; color:#856404; background-color:#fff3cd; border:1px solid #ffeeba; padding:10px; border-radius:4px; margin-bottom:15px; font-weight:bold;";
        hwWarning.innerHTML = `⚠️ <strong>物理走线警告</strong>：您的项目使用了 SPI/I2S 等高频信号引脚。请确保排线长度不超过 10cm，且信号线尽量分开或包地。`;
        wiringList.appendChild(hwWarning);
    }
    const smartTip = document.createElement('div');
    smartTip.style.cssText = "font-size:12px; color:#28a745; margin-bottom:15px; background:#e8f5e9; padding:8px; border-radius:4px;";
    smartTip.innerHTML = `💡 <strong>智能避雷生效</strong>：已在后台自动过滤“5V烧板风险”、“启动引脚电平冲突”、“高频串扰”及“ADC2-WiFi冲突”。`;
    wiringList.appendChild(smartTip);
    activeModules.forEach((mod, index) => {
        const modDiv = document.createElement('div');
        modDiv.className = 'module-tag';
        modDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <strong>${moduleLibrary[mod.id].name}</strong> 
                <div>
                    <span style="margin-right:10px;">#${index+1}</span>
                    <button onclick="openEditPanel(${index})" style="background:none; border:none; cursor:pointer; font-size:16px; padding:0; width:auto; margin:0;" title="微调参数">⚙️</button>
                </div>
            </div>
        `;
        list.appendChild(modDiv);
        const title = document.createElement('h3');
        title.innerText = `${moduleLibrary[mod.id].name} (实例 #${index+1})`;
        title.style.fontSize = '1rem'; title.style.marginTop = '15px';
        wiringList.appendChild(title);
        for (const [signal, pinNum] of Object.entries(mod.connections)) {
            const item = document.createElement('div');
            item.className = 'connection-item';
            if (pinNum === "dropped") {
                item.innerHTML = `<strong>${signal}</strong> <span style="margin: 0 10px;">➡</span> <span style="color:#dc3545; font-weight:bold; text-decoration:line-through;">已放弃连接</span>`;
                item.style.borderColor = '#dc3545';
            } else {
                let isShared = (mod.interface === 'I2C' || mod.interface === 'SPI') && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK');
                item.innerHTML = `<strong>${signal}</strong> <span style="margin: 0 10px;">➡</span> <span style="color:var(--pin-fixed); font-weight:bold; font-size:1.1rem;">GPIO ${pinNum}</span> ${isShared ? '<span style="font-size:10px; color:#888; margin-left:10px;">(总线共享)</span>' : ''}`;
            }
            wiringList.appendChild(item);
        }
    });
    wiringPanel.style.display = 'block';
    generateCodePreview();
    updatePowerBudget();
}

// ==========================================
// 3. 交互操作
// ==========================================
function addModule() {
    const modId = selectedModuleId;
    if (!modId) return alert('请先选择模组');
    const modData = moduleLibrary[modId];
    if (modData.interface === 'DVP' && boardConfig.max_pin <= 21) {
        return alert(`❌ 资源不足：${boardConfig.boardName} 的引脚数量较少，无法支撑 DVP 摄像头。`);
    }
    let currentTotal = 0;
    activeModules.forEach(mod => {
        const mData = moduleLibrary[mod.id];
        currentTotal += (mod.overrides?.current || mData.peak_current_ma || 0);
    });
    const newTotal = currentTotal + (modData.peak_current_ma || 0);
    const maxCurrent = boardConfig.max_current_ma || 500;
    if (newTotal > maxCurrent) {
        if (!confirm(`⚠️ 供电超载拦截\n\n总功耗将达到：${newTotal} mA\n已超过主控 LDO 安全上限 (${maxCurrent} mA)！\n是否继续添加？`)) return;
    }
    if (activeModules.find(m => m.id === modId) && !confirm(`已经添加了【${moduleLibrary[modId].name}】。\n强行添加可能会导致冲突，确定继续吗？`)) return;
    let pinsStateCopy = {};
    for (let i = 0; i <= boardConfig.max_pin; i++) { if(pinsState[i]) { pinsStateCopy[i] = { ...pinsState[i] }; } }
    const result = tryAllocate(modData, pinsStateCopy);
    if (result.missingRequired.length > 0) {
        return alert(`引脚严重不足或存在电气冲突！\n无法满足必选信号 (${result.missingRequired.join(', ')})。\n系统已为您拦截不安全的引脚。`);
    }
    if (result.missingOptional.length === 0) { 
        commitAllocation(modId, result.allocations); 
        checkWifiAdcConflict(modId);
        return; 
    }
    pendingModule = { id: modId, allocations: result.allocations };
    pendingOptionalDrops = result.missingOptional; 
    const optionsDiv = document.getElementById('negotiation-options');
    optionsDiv.innerHTML = '';
    result.missingOptional.forEach(signal => {
        const label = document.createElement('label');
        label.style.display = 'block'; label.style.marginBottom = '5px';
        label.innerHTML = `<input type="checkbox" value="${signal}" checked> 放弃 ${signal} 引脚 (余量不足)`;
        optionsDiv.appendChild(label);
    });
    document.getElementById('negotiation-modal').style.display = 'flex';
}

function cancelNegotiation() {
    document.getElementById('negotiation-modal').style.display = 'none';
    pendingModule = null;
}

function confirmNegotiation() {
    document.getElementById('negotiation-modal').style.display = 'none';
    const confirmedDrops = Array.from(document.querySelectorAll('#negotiation-options input[type="checkbox"]:checked')).map(cb => cb.value);
    const finalAllocations = { ...pendingModule.allocations };
    confirmedDrops.forEach(signal => { finalAllocations[signal] = "dropped"; });
    const stubbornSignals = pendingOptionalDrops.filter(s => !confirmedDrops.includes(s));
    if (stubbornSignals.length > 0) { stubbornSignals.forEach(sig => finalAllocations[sig] = "dropped"); }
    const modId = pendingModule.id;
    commitAllocation(modId, finalAllocations);
    checkWifiAdcConflict(modId);
    pendingModule = null;
}

function resetAll() {
    if(confirm('确定要清空所有配置吗？')) { 
        location.reload();
    }
}
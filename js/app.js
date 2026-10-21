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
// 1. 初始化与多芯片切换
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    try {
        moduleLibrary = globalModuleData;
        const boardSelect = document.getElementById('board-select');
        
        boardSelect.innerHTML = '';
        boardSelect.style.display = 'block';
        boardSelect.disabled = false;
        
        boardSelect.style.height = '42px';
        boardSelect.style.padding = '0 10px';
        boardSelect.style.boxSizing = 'border-box';
        boardSelect.style.lineHeight = '42px';
        
        for (const [key, data] of Object.entries(globalBoards)) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = data.boardName;
            boardSelect.appendChild(option);
        }
        const firstBoardKey = Object.keys(globalBoards)[0];
        loadBoard(firstBoardKey);
        
    } catch (error) {
        console.error(error);
        document.getElementById('board-title').innerText = "❌ 初始化失败";
    }
});

function initPins() {
    pinsState = {};
    for (let i = 0; i <= boardConfig.max_pin; i++) {
        if (boardConfig.fixedPins.includes(i)) { pinsState[i] = { state: 'fixed', label: 'Fixed' }; } 
        else if (!boardConfig.availableGpios.includes(i)) { pinsState[i] = { state: 'fixed', label: 'N/A' }; } 
        else if (boardConfig.strappingPins[i]) { pinsState[i] = { state: 'strapping', label: 'Strap' }; } 
        else { pinsState[i] = { state: 'free', label: 'Free' }; }
    }
}

function loadBoard(boardKey) {
    boardConfig = globalBoards[boardKey];
    document.getElementById('board-title').innerText = "当前配置: " + boardConfig.boardName;
    
    activeModules = []; 
    activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
    
    initPins();
    
    if (typeof initCombobox === 'function') { initCombobox(); }
    if (typeof initDiagnosticsEngine === 'function') { initDiagnosticsEngine(); }
    
    renderPins();
    renderModules();
    updatePowerBudget();
}

function switchBoard() {
    if (activeModules.length > 0) {
        if (!confirm('⚠️ 切换主控芯片将清空当前已配置的所有模组及引脚分配，是否继续？')) {
            document.getElementById('board-select').value = boardConfig.boardName;
            return;
        }
    }
    loadBoard(document.getElementById('board-select').value);
}

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
    
    // 计算总功耗
    let totalCurrent = 0;
    activeModules.forEach(mod => {
        const mData = moduleLibrary[mod.id];
        totalCurrent += (mod.overrides?.current !== undefined ? mod.overrides.current : (mData.peak_current_ma || 0));
    });
    const maxCurrent = boardConfig.max_current_ma || 500;
    const isOverload = totalCurrent > maxCurrent;

    if (typeof checkHighSpeedWarning === 'function' && checkHighSpeedWarning()) {
        const hwWarning = document.createElement('div');
        hwWarning.style.cssText = "font-size: 13px; color: #856404; background-color: #fff3cd; border: 1px solid #ffeeba; padding: 12px; border-radius: 6px; margin-bottom: 10px; display: flex; align-items: center; line-height: 1.5;";
        hwWarning.innerHTML = `<span style="font-size: 16px; margin-right: 8px;">⚠️</span> <div><strong>物理走线警告：</strong>您的项目使用了 SPI/I2S 等高频信号引脚。请确保排线长度不超过 10cm，且信号线尽量分开或包地。</div>`;
        wiringList.appendChild(hwWarning);
    }
    
    const smartTip = document.createElement('div');
    smartTip.style.cssText = "font-size: 13px; color: #155724; background-color: #d4edda; border: 1px solid #c3e6cb; padding: 12px; border-radius: 6px; margin-bottom: 15px; display: flex; align-items: center; line-height: 1.5;";
    smartTip.innerHTML = `<span style="font-size: 16px; margin-right: 8px;">💡</span> <div><strong>智能避雷生效：</strong>已在后台自动过滤“5V烧板风险”、“启动引脚电平冲突”、“高频串扰”及“ADC2-WiFi冲突”。</div>`;
    wiringList.appendChild(smartTip);
    
    activeModules.forEach((mod, index) => {
        const modData = moduleLibrary[mod.id];
        const modCurrent = mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0);
        
        const modDiv = document.createElement('div');
        modDiv.className = 'module-tag';
        modDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <strong>${modData.name}</strong> 
                <div>
                    <span style="margin-right:10px;">#${index+1}</span>
                    <button onclick="openEditPanel(${index})" style="background:none; border:none; cursor:pointer; font-size:16px; padding:0; width:auto; margin:0;" title="微调参数">⚙️</button>
                </div>
            </div>
        `;
        list.appendChild(modDiv);
        
        const title = document.createElement('h3');
        title.innerText = `${modData.name} (实例 #${index+1})`;
        title.style.fontSize = '1rem'; title.style.marginTop = '15px';
        wiringList.appendChild(title);
        
        // 渲染信号线
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

        // 渲染物理电源线
        if (modData.power_pins && modData.power_pins.length > 0) {
            modData.power_pins.forEach(p => {
                const item = document.createElement('div');
                item.className = 'connection-item';
                
                let displayWarning = p.warning;
                let isDangerousPower = isOverload; 

                if (p.warning.includes('/')) {
                    const parts = p.warning.split('/');
                    if (isOverload) {
                        displayWarning = parts[1].trim(); 
                    } else {
                        displayWarning = parts[0].trim(); 
                        if (displayWarning.includes('必须外部') || displayWarning.includes('严禁接主板')) {
                            isDangerousPower = true;
                        }
                    }
                }
                
                if (isDangerousPower) {
                    item.style.backgroundColor = '#fff3f3';
                    item.style.borderColor = '#dc3545';
                    item.style.marginTop = '5px';
                    item.innerHTML = `<strong style="color:#dc3545;">${p.pin}</strong> <span style="margin: 0 10px;">➡</span> <strong style="color:#dc3545;">${p.connect_to}</strong> <span style="font-size:11px; color:#dc3545; margin-left:10px;">(${displayWarning})</span>`;
                } else {
                    item.style.backgroundColor = '#f8f9fa';
                    item.innerHTML = `<strong>${p.pin}</strong> <span style="margin: 0 10px;">➡</span> <strong style="color:var(--pin-fixed);">${p.connect_to}</strong> <span style="font-size:11px; color:#888; margin-left:10px;">(${displayWarning})</span>`;
                }
                wiringList.appendChild(item);
            });
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
    
    // 功耗拦截
    let currentTotal = 0;
    activeModules.forEach(mod => {
        const mData = moduleLibrary[mod.id];
        currentTotal += (mod.overrides?.current || mData.peak_current_ma || 0);
    });
    const newTotal = currentTotal + (modData.peak_current_ma || 0);
    const maxCurrent = boardConfig.max_current_ma || 500;
    
    if (newTotal > maxCurrent) {
        const choice = confirm(
            `⚠️ 供电超载警告\n\n` +
            `当前系统总功耗：${currentTotal} mA\n` +
            `添加该模组后：${newTotal} mA\n` +
            `主控安全上限：${maxCurrent} mA\n\n` +
            `【后果】若继续从主板取电，可能会触发电压保护，导致设备无限重启。\n\n` +
            `【方案 1】如果您能在软件/硬件上限制功耗（如调小音量、调暗背光），请点“确定”，然后在左侧模组旁边的 ⚙️ 微调面板中降低电流预估。\n\n` +
            `【方案 2】如果您打算给该模组接外部独立电源，请点“确定”，稍后查看接线指导。\n\n` +
            `是否继续添加？`
        );
        if (!choice) return;
    }
    
    if (activeModules.find(m => m.id === modId) && !confirm(`已经添加了【${moduleLibrary[modId].name}】。\n强行添加可能会导致冲突，确定继续吗？`)) return;
    
    let pinsStateCopy = {};
    for (let i = 0; i <= boardConfig.max_pin; i++) { if(pinsState[i]) { pinsStateCopy[i] = { ...pinsState[i] }; } }
    
    const result = tryAllocate(modData, pinsStateCopy);
    
    if (result.missingRequired.length > 0) {
        // 🔥 优化：计算清晰的缺口账单
        let totalNeed = 0;
        modData.requirements.forEach(r => { if (!r.optional) totalNeed += r.count; });
        
        let availableCount = 0;
        for (let i = 0; i <= boardConfig.max_pin; i++) {
            if (pinsState[i] && pinsState[i].state === 'free') availableCount++;
        }

        let errMsg = `⚠️ 资源分配失败\n\n`;
        errMsg += `【模组需求】总计 ${totalNeed} 根引脚\n`;
        errMsg += `【当前空闲】仅剩 ${availableCount} 根引脚\n\n`;
        errMsg += `系统无法满足必选信号：${result.missingRequired.join(', ')}。\n`;
        errMsg += `强行分配会导致严重的引脚冲突（甚至烧板）。\n\n`;
        errMsg += `💡 解决方案：\n1. 移除部分已接入的模组以释放引脚。\n2. 或在微调面板中裁剪可选/批量引脚数量。`;
        
        return alert(errMsg);
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
        const currentBoard = document.getElementById('board-select').value || Object.keys(globalBoards)[0];
        loadBoard(currentBoard);
    }
}
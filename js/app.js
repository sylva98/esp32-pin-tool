// ==========================================
// 1. 全局状态管理
// ==========================================
let boardConfig = null;
let moduleLibrary = null;
let pinsState = {}; 
let activeModules = []; 
let activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} }; 
let pendingModule = null; 
let pendingOptionalDrops = []; 

// 微调编辑器的暂存状态
let editingModuleIndex = -1;

// ==========================================
// 2. 初始化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    try {
        boardConfig = globalBoardData;
        moduleLibrary = globalModuleData;
        
        document.getElementById('board-title').innerText = boardConfig.boardName;
        initPins();
        populateModuleSelect();
        
        if (typeof initDiagnosticsEngine === 'function') {
            initDiagnosticsEngine(); 
        }

        renderPins();
        renderModules();
        updatePowerBudget();
        
    } catch (error) {
        console.error(error);
        document.getElementById('board-title').innerText = "❌ 初始化失败";
    }
});

function initPins() {
    for (let i = 0; i <= 48; i++) {
        if (boardConfig.fixedPins.includes(i)) {
            pinsState[i] = { state: 'fixed', label: 'Fixed' };
        } else if (!boardConfig.availableGpios.includes(i)) {
            pinsState[i] = { state: 'fixed', label: 'N/A' };
        } else if (boardConfig.strappingPins.includes(i)) {
            pinsState[i] = { state: 'strapping', label: 'Strap' };
        } else {
            pinsState[i] = { state: 'free', label: 'Free' };
        }
    }
}

function populateModuleSelect() {
    const select = document.getElementById('module-select');
    for (const [key, data] of Object.entries(moduleLibrary)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = data.name;
        select.appendChild(option);
    }
}

// ==========================================
// 3. 渲染逻辑
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

        div.onmouseenter = () => {
            if (!tooltipText) return;
            globalTooltip.textContent = tooltipText;
            globalTooltip.style.display = 'block';
            const rect = div.getBoundingClientRect();
            globalTooltip.style.left = `${rect.left + rect.width / 2}px`;
            globalTooltip.style.top = `${rect.top}px`;
            if (rect.top < 100) {
                globalTooltip.style.transform = 'translate(-50%, 0)';
                globalTooltip.style.marginTop = '15px';
            } else {
                globalTooltip.style.transform = 'translate(-50%, -100%)';
                globalTooltip.style.marginTop = '-10px';
            }
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
        wiringPanel.style.display = 'none';
        codePanel.style.display = 'none';
        return;
    }

    list.innerHTML = '';
    wiringList.innerHTML = '';
    
    const smartTip = document.createElement('div');
    smartTip.style.cssText = "font-size:12px; color:#28a745; margin-bottom:15px; background:#e8f5e9; padding:8px; border-radius:4px;";
    smartTip.innerHTML = `💡 <strong>智能避雷生效</strong>：系统已在后台自动过滤“5V烧板风险”、“启动引脚上下拉冲突”及“特殊电压域限制”。`;
    wiringList.appendChild(smartTip);

    activeModules.forEach((mod, index) => {
        const modDiv = document.createElement('div');
        modDiv.className = 'module-tag';
        // 新增了编辑按钮
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
        title.style.fontSize = '1rem';
        title.style.marginTop = '15px';
        wiringList.appendChild(title);

        for (const [signal, pinNum] of Object.entries(mod.connections)) {
            const item = document.createElement('div');
            item.className = 'connection-item';
            
            if (pinNum === "dropped") {
                item.innerHTML = `<strong>${signal}</strong> <span style="margin: 0 10px;">➡</span> <span style="color:#dc3545; font-weight:bold; text-decoration:line-through;">已放弃连接</span>`;
                item.style.borderColor = '#dc3545';
            } else {
                let isShared = (mod.interface === 'I2C' || mod.interface === 'SPI') && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK');
                item.innerHTML = `
                    <strong>${signal}</strong> 
                    <span style="margin: 0 10px;">➡</span> 
                    <span style="color:var(--pin-fixed); font-weight:bold; font-size:1.1rem;">GPIO ${pinNum}</span>
                    ${isShared ? '<span style="font-size:10px; color:#888; margin-left:10px;">(总线共享)</span>' : ''}
                `;
            }
            wiringList.appendChild(item);
        }
    });

    wiringPanel.style.display = 'block';
    generateCodePreview();
    updatePowerBudget();
}

// ==========================================
// 4. 静默防呆核心分配引擎
// ==========================================
function isSafePin(pin, modData, req) {
    if (boardConfig.special_domains && boardConfig.special_domains[pin]) {
        if (boardConfig.special_domains[pin] !== `${modData.signal_voltage}V`) return false;
    }
    if (modData.signal_voltage > boardConfig.safe_voltage) {
        if (!boardConfig.power_rails["5V"]) return false;
    }
    if (boardConfig.strappingPins.includes(pin) && req.internal_pull) {
        return false; 
    }
    return true;
}

function tryAllocate(modData, pinsStateCopy) {
    let allocations = {}; 
    let missingRequired = [];
    let missingOptional = [];
    let pinsAllocatedInThisMod = []; 

    let reqs = [...modData.requirements].sort((a, b) => a.optional === b.optional ? 0 : a.optional ? 1 : -1);

    for (const req of reqs) {
        let pinsToAllocate = req.count;
        let allocated = [];
        
        if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][req.signal]) {
            const existingPin = activeBuses[modData.interface][req.signal];
            if (!pinsAllocatedInThisMod.includes(existingPin)) {
                allocated.push(existingPin);
                pinsAllocatedInThisMod.push(existingPin);
                pinsToAllocate--;
            }
        }

        if (pinsToAllocate > 0 && modData.interface && boardConfig.defaultInterfaces[modData.interface]) {
            const defaultPins = boardConfig.defaultInterfaces[modData.interface];
            const dp = defaultPins[req.signal];
            if (dp !== undefined && pinsStateCopy[dp] === 'free' && !pinsAllocatedInThisMod.includes(dp) && isSafePin(dp, modData, req)) {
                allocated.push(dp);
                pinsAllocatedInThisMod.push(dp);
                pinsToAllocate--;
            }
        }

        if (pinsToAllocate > 0 && modData.preferredPins) {
            for (const p of modData.preferredPins) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[p] === 'free' && !pinsAllocatedInThisMod.includes(p) && isSafePin(p, modData, req)) {
                    allocated.push(p);
                    pinsAllocatedInThisMod.push(p);
                    pinsToAllocate--;
                }
            }
        }

        if (pinsToAllocate > 0) {
            for (let i = 0; i <= 48; i++) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[i] === 'free' && !pinsAllocatedInThisMod.includes(i) && isSafePin(i, modData, req)) {
                    allocated.push(i);
                    pinsAllocatedInThisMod.push(i);
                    pinsToAllocate--;
                }
            }
        }

        if (pinsToAllocate > 0) {
            if (req.optional) missingOptional.push(req.signal);
            else missingRequired.push(req.signal);
        } else {
            allocations[req.signal] = allocated;
            allocated.forEach(p => { pinsStateCopy[p] = 'used'; });
        }
    }

    return { allocations, missingRequired, missingOptional };
}

function addModule() {
    const modId = document.getElementById('module-select').value;
    if (!modId) return alert('请先选择模组');

    const modData = moduleLibrary[modId];
    let currentTotal = 0;
    activeModules.forEach(mod => {
        const mData = moduleLibrary[mod.id];
        const c = mod.overrides?.current || mData.peak_current_ma || 0;
        currentTotal += c;
    });
    const newTotal = currentTotal + (modData.peak_current_ma || 0);
    const maxCurrent = boardConfig.max_current_ma || 500;

    if (newTotal > maxCurrent) {
        const force = confirm(`⚠️ 供电超载拦截\n\n当前系统功耗：${currentTotal} mA\n该模组新增：${modData.peak_current_ma} mA\n总功耗将达到：${newTotal} mA\n\n已超过主控 LDO 安全上限 (${maxCurrent} mA)！\n是否继续添加？`);
        if (!force) return;
    }

    const existing = activeModules.find(m => m.id === modId);
    if (existing && !confirm(`已经添加了【${moduleLibrary[modId].name}】。\n强行添加可能会导致冲突，确定继续吗？`)) return;
    
    let pinsStateCopy = {};
    for (let i = 0; i <= 48; i++) { if(pinsState[i]) pinsStateCopy[i] = pinsState[i].state; }

    const result = tryAllocate(modData, pinsStateCopy);

    if (result.missingRequired.length > 0) {
        alert(`引脚严重不足或存在电气冲突！\n无法满足核心必选信号 (${result.missingRequired.join(', ')})。\n系统已为您拦截了不安全的引脚。`);
        return;
    }
    
    if (result.missingOptional.length === 0) {
        commitAllocation(modId, result.allocations);
        return;
    }

    pendingModule = { id: modId, allocations: result.allocations };
    pendingOptionalDrops = result.missingOptional; 
    
    const optionsDiv = document.getElementById('negotiation-options');
    optionsDiv.innerHTML = '';
    result.missingOptional.forEach(signal => {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.marginBottom = '5px';
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
    const checkboxes = document.querySelectorAll('#negotiation-options input[type="checkbox"]:checked');
    const confirmedDrops = Array.from(checkboxes).map(cb => cb.value);

    const finalAllocations = { ...pendingModule.allocations };
    confirmedDrops.forEach(signal => { finalAllocations[signal] = "dropped"; });
    
    const stubbornSignals = pendingOptionalDrops.filter(s => !confirmedDrops.includes(s));
    if (stubbornSignals.length > 0) {
        stubbornSignals.forEach(sig => finalAllocations[sig] = "dropped");
    }
    commitAllocation(pendingModule.id, finalAllocations);
    pendingModule = null;
}

function commitAllocation(modId, allocations) {
    const modData = moduleLibrary[modId];
    const newConnections = {};
    for (const [signal, pins] of Object.entries(allocations)) {
        if (pins === "dropped") {
            newConnections[signal] = "dropped";
        } else {
            newConnections[signal] = pins.length > 1 ? pins.join(',') : pins[0];
            pins.forEach(p => { pinsState[p] = { state: 'used', owner: modId, signal: signal }; });
            if (modData.interface && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK' || signal === 'BCLK' || signal === 'LRC')) {
                if (!activeBuses[modData.interface]) activeBuses[modData.interface] = {};
                activeBuses[modData.interface][signal] = Number(pins[0]);
            }
        }
    }
    activeModules.push({ id: modId, interface: modData.interface, connections: newConnections, overrides: {} });
    renderPins();
    renderModules();
}

function releasePin(pinNum) {
    if (pinsState[pinNum].state !== 'used') return;
    if(confirm(`确定要强制释放 GPIO ${pinNum} 吗？对应的模组将被移除。`)) {
        const ownerId = pinsState[pinNum].owner;
        const modIndex = activeModules.findIndex(m => m.id === ownerId && Object.values(m.connections).some(val => String(val).split(',').includes(String(pinNum))));
        if (modIndex > -1) {
            activeModules.splice(modIndex, 1);
            activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
            initPins();
            activeModules.forEach(mod => {
                for (const [signal, pinStr] of Object.entries(mod.connections)) {
                    if (pinStr === "dropped") continue;
                    String(pinStr).split(',').forEach(p => {
                        pinsState[p] = { state: 'used', owner: mod.id, signal: signal };
                        if (mod.interface && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK' || signal === 'BCLK' || signal === 'LRC')) {
                            activeBuses[mod.interface][signal] = Number(p);
                        }
                    });
                }
            });
            renderPins();
            renderModules();
        }
    }
}

function resetAll() {
    if(confirm('确定要清空所有配置吗？')) {
        activeModules = []; activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
        initPins(); renderPins(); renderModules(); updatePowerBudget();
    }
}

// ==========================================
// 5. 功耗预算计算引擎
// ==========================================
function updatePowerBudget() {
    let totalCurrent = 0;
    activeModules.forEach(mod => {
        const modData = moduleLibrary[mod.id];
        // 优先使用用户微调的电流值
        const current = mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0);
        totalCurrent += current;
    });

    const maxCurrent = boardConfig.max_current_ma || 500;
    const percentage = Math.min(Math.round((totalCurrent / maxCurrent) * 100), 100);
    
    const bar = document.getElementById('power-bar');
    const text = document.getElementById('power-text');

    if (bar && text) {
        bar.style.width = `${percentage}%`;
        text.innerText = `${totalCurrent} mA / ${maxCurrent} mA (${percentage}%)`;

        if (percentage < 70) {
            bar.style.backgroundColor = '#28a745';
            text.style.color = '#28a745';
        } else if (percentage < 100) {
            bar.style.backgroundColor = '#fd7e14';
            text.style.color = '#fd7e14';
        } else {
            bar.style.backgroundColor = '#dc3545';
            text.style.color = '#dc3545';
        }
    }
}

// ==========================================
// 6. 导出与代码生成
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
                if (pinStr === "dropped") code += `// #define ${prefix}_${sig}  (未连接)\n`;
                else if (String(pinStr).includes(',')) String(pinStr).split(',').forEach((p, i) => { code += `#define ${prefix}_${sig}_${i}  ${p}\n`; });
                else code += `#define ${prefix}_${sig}  ${pinStr}\n`;
            });
            code += `\n`;
        }
    });
    code += `#endif\n`;
    document.getElementById('code-preview').textContent = code;
    document.getElementById('code-panel').style.display = 'block';
}

function exportConfig() { downloadFile("esp32s3_config.json", JSON.stringify(activeModules, null, 2)); }
function exportCHeader() { downloadFile("pin_config.h", document.getElementById('code-preview').textContent); }
function downloadFile(filename, content) {
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function importConfig(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!Array.isArray(importedData)) throw new Error("格式错误");
            activeModules = [];
            activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
            initPins();
            importedData.forEach(mod => {
                if (moduleLibrary[mod.id]) {
                    activeModules.push(mod);
                    for (const [signal, pinStr] of Object.entries(mod.connections)) {
                        if (pinStr === "dropped") continue;
                        String(pinStr).split(',').forEach(p => {
                            const pinNum = Number(p);
                            if (pinsState[pinNum]) pinsState[pinNum] = { state: 'used', owner: mod.id, signal: signal };
                            if (mod.interface && ['SDA', 'SCL', 'MOSI', 'MISO', 'SCK', 'BCLK', 'LRC'].includes(signal)) {
                                if (!activeBuses[mod.interface]) activeBuses[mod.interface] = {};
                                activeBuses[mod.interface][signal] = pinNum;
                            }
                        });
                    }
                }
            });
            renderPins();
            renderModules();
            updatePowerBudget();
        } catch (error) {
            alert("导入失败！");
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}

// ==========================================
// 7. 微调面板 UI 与逻辑 (新增)
// ==========================================
function openEditPanel(index) {
    editingModuleIndex = index;
    const mod = activeModules[index];
    const modData = moduleLibrary[mod.id];

    // 1. 填充电流
    const currentVal = mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0);
    document.getElementById('edit-current').value = currentVal;
    document.getElementById('edit-current').placeholder = `默认: ${modData.peak_current_ma || 0} mA`;

    // 2. 填充引脚数量 (针对有批量引脚的需求，如 D0-D7)
    const pinCountSelect = document.getElementById('edit-pin-count');
    pinCountSelect.innerHTML = '';
    
    // 找到当前模组是否有批量需求
    const batchReq = modData.requirements.find(r => r.count > 1);
    const countContainer = document.getElementById('pin-count-container');
    
    if (batchReq) {
        countContainer.style.display = 'block';
        document.getElementById('pin-count-label').innerText = `${batchReq.signal} 数量裁剪:`;
        
        for (let i = 1; i <= batchReq.count; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `${i} 根`;
            // 检查当前分配了多少根
            const currentAssignedCount = String(mod.connections[batchReq.signal] || "").split(',').filter(x => x && x !== "dropped").length;
            if (currentAssignedCount === i) option.selected = true;
            pinCountSelect.appendChild(option);
        }
    } else {
        countContainer.style.display = 'none';
    }

    // 3. 渲染引脚自动重排列表
    const pinListContainer = document.getElementById('edit-pin-list');
    pinListContainer.innerHTML = '';
    
    for (const [signal, pinStr] of Object.entries(mod.connections)) {
        if (pinStr === "dropped") continue;
        
        const pinDiv = document.createElement('div');
        pinDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding:5px; background:#f8f9fa; border-radius:4px;";
        pinDiv.innerHTML = `
            <span><strong>${signal}</strong> ➡ GPIO ${pinStr}</span>
            <button onclick="autoReroutePin('${signal}')" style="background:#007bff; color:white; padding:3px 8px; border-radius:4px; border:none; cursor:pointer; width:auto; margin:0; font-size:12px;">🔄 换一个</button>
        `;
        pinListContainer.appendChild(pinDiv);
    }

    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditPanel() {
    document.getElementById('edit-modal').style.display = 'none';
    editingModuleIndex = -1;
}

function autoReroutePin(signal) {
    const mod = activeModules[editingModuleIndex];
    const modData = moduleLibrary[mod.id];

    // 1. 找到当前占用的引脚并将其释放
    const currentPins = String(mod.connections[signal]).split(',').map(Number);
    currentPins.forEach(p => {
        if (pinsState[p]) pinsState[p] = { state: 'free', label: 'Free' };
    });

    // 2. 清理旧的分配记录
    delete mod.connections[signal];
    if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][signal]) {
        delete activeBuses[modData.interface][signal];
    }

    // 3. 尝试重新分配这一个信号
    const req = modData.requirements.find(r => r.signal === signal);
    
    // 临时构建一个可用状态副本
    let pinsStateCopy = {};
    for (let i = 0; i <= 48; i++) { if(pinsState[i]) pinsStateCopy[i] = pinsState[i].state; }

    let allocated = [];
    // 走一遍分配逻辑
    if (modData.interface && boardConfig.defaultInterfaces[modData.interface] && boardConfig.defaultInterfaces[modData.interface][signal]) {
        const dp = boardConfig.defaultInterfaces[modData.interface][signal];
        if (pinsStateCopy[dp] === 'free' && isSafePin(dp, modData, req)) {
            allocated.push(dp);
            pinsStateCopy[dp] = 'used';
        }
    }
    if (allocated.length === 0) {
        for (let i = 0; i <= 48; i++) {
            if (pinsStateCopy[i] === 'free' && isSafePin(i, modData, req)) {
                allocated.push(i);
                break;
            }
        }
    }

    if (allocated.length > 0) {
        // 4. 写回全局状态并渲染
        mod.connections[signal] = allocated.join(',');
        allocated.forEach(p => { pinsState[p] = { state: 'used', owner: mod.id, signal: signal }; });
        renderPins();
        renderModules();
        openEditPanel(editingModuleIndex); // 刷新面板UI
    } else {
        alert(`找不到其他空闲且安全的引脚给 ${signal} 了！`);
        // 恢复原有引脚
        currentPins.forEach(p => { pinsState[p] = { state: 'used', owner: mod.id, signal: signal }; });
        renderPins();
    }
}

function saveModuleParams() {
    const newCurrent = Number(document.getElementById('edit-current').value);
    const mod = activeModules[editingModuleIndex];
    const modData = moduleLibrary[mod.id];
    
    mod.overrides = mod.overrides || {};
    mod.overrides.current = newCurrent;

    // 处理引脚数量裁剪
    const batchReq = modData.requirements.find(r => r.count > 1);
    const countContainer = document.getElementById('pin-count-container');
    if (batchReq && countContainer.style.display !== 'none') {
        const targetCount = Number(document.getElementById('edit-pin-count').value);
        let currentPins = String(mod.connections[batchReq.signal] || "").split(',').filter(x => x && x !== "dropped");
        
        if (targetCount < currentPins.length) {
            // 释放多余引脚
            const toDrop = currentPins.splice(targetCount);
            toDrop.forEach(p => {
                if (pinsState[Number(p)]) pinsState[Number(p)] = { state: 'free', label: 'Free' };
            });
            mod.connections[batchReq.signal] = currentPins.join(',');
        } else if (targetCount > currentPins.length) {
            alert("目前仅支持裁剪引脚数量，暂不支持微调面板内自动增配引脚。请重置后重新分配。");
        }
    }

    renderPins();
    renderModules();
    updatePowerBudget();
    closeEditPanel();
}
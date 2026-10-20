// ==========================================
// 1. 全局状态管理
// ==========================================
let boardConfig = null;
let moduleLibrary = null;
let pinsState = {}; 
let activeModules = []; 
let activeBuses = { I2C: {}, SPI: {} }; 

let pendingModule = null; 
let pendingOptionalDrops = []; 

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
        
    } catch (error) {
        console.error(error);
        document.getElementById('board-title').innerText = "❌ 初始化失败";
        alert("初始化失败：" + error.message);
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
    
    activeModules.forEach((mod, index) => {
        const modDiv = document.createElement('div');
        modDiv.className = 'module-tag';
        modDiv.innerHTML = `<strong>${moduleLibrary[mod.id].name}</strong> <span>#${index+1}</span>`;
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
}

// ==========================================
// 4. 智能分配与协商 (核心修复区)
// ==========================================
function tryAllocate(modData, pinsStateCopy) {
    let allocations = {}; 
    let missingRequired = [];
    let missingOptional = [];
    
    // 记录当前模组已经抢到的引脚，用于全局防重
    let pinsAllocatedInThisMod = []; 

    // 排序：先必选，后可选
    let reqs = [...modData.requirements].sort((a, b) => a.optional === b.optional ? 0 : a.optional ? 1 : -1);

    for (const req of reqs) {
        let pinsToAllocate = req.count;
        let allocated = [];
        
        // 策略 1: 总线复用 (必须检查该引脚是否已经被本模组的其他信号占用)
        if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][req.signal]) {
            const existingPin = activeBuses[modData.interface][req.signal];
            if (!pinsAllocatedInThisMod.includes(existingPin)) {
                allocated.push(existingPin);
                pinsAllocatedInThisMod.push(existingPin);
                pinsToAllocate--;
            }
        }

        // 策略 2: 默认引脚推荐
        if (pinsToAllocate > 0 && modData.interface && boardConfig.defaultInterfaces[modData.interface]) {
            const defaultPins = boardConfig.defaultInterfaces[modData.interface];
            const dp = defaultPins[req.signal];
            if (dp !== undefined && pinsStateCopy[dp] === 'free' && !pinsAllocatedInThisMod.includes(dp)) {
                allocated.push(dp);
                pinsAllocatedInThisMod.push(dp);
                pinsToAllocate--;
            }
        }

        // 策略 3: 模组专属推荐引脚
        if (pinsToAllocate > 0 && modData.preferredPins) {
            for (const p of modData.preferredPins) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[p] === 'free' && !pinsAllocatedInThisMod.includes(p)) {
                    allocated.push(p);
                    pinsAllocatedInThisMod.push(p);
                    pinsToAllocate--;
                }
            }
        }

        // 策略 4: 兜底寻找 (核心修复：过滤掉被占用的、已被当前模组占用的，并优先避开 Strapping 引脚)
        if (pinsToAllocate > 0) {
            // 先找安全的空闲引脚
            for (let i = 0; i <= 48; i++) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[i] === 'free' && !pinsAllocatedInThisMod.includes(i) && !boardConfig.strappingPins.includes(i)) {
                    allocated.push(i);
                    pinsAllocatedInThisMod.push(i);
                    pinsToAllocate--;
                }
            }
            // 如果实在不够了，只能去动用 Strapping 引脚了
            for (let i = 0; i <= 48; i++) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[i] === 'free' && !pinsAllocatedInThisMod.includes(i)) {
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
            // 立刻在沙盘推演状态里把分配出去的引脚标记为 used，防止后续循环抢走
            allocated.forEach(p => { pinsStateCopy[p] = 'used'; });
        }
    }

    return { allocations, missingRequired, missingOptional };
}

function addModule() {
    const modId = document.getElementById('module-select').value;
    if (!modId) return alert('请先选择模组');
    
    const existing = activeModules.find(m => m.id === modId);
    if (existing && !confirm(`你已经添加了【${moduleLibrary[modId].name}】。\n强行添加可能会导致引脚严重冲突，确定继续吗？`)) return;

    const modData = moduleLibrary[modId];
    
    let pinsStateCopy = {};
    for (let i = 0; i <= 48; i++) { if(pinsState[i]) pinsStateCopy[i] = pinsState[i].state; }

    const result = tryAllocate(modData, pinsStateCopy);

    if (result.missingRequired.length > 0) {
        alert(`引脚严重不足！无法满足核心必选信号 (${result.missingRequired.join(', ')})。\n请先释放其他引脚，或减少模组数量。`);
        return;
    }
    
    if (result.missingOptional.length === 0) {
        commitAllocation(modId, result.allocations);
        return;
    }

    // 触发协商弹窗
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
            if (modData.interface && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK')) {
                if (!activeBuses[modData.interface]) activeBuses[modData.interface] = {};
                activeBuses[modData.interface][signal] = Number(pins[0]);
            }
        }
    }
    activeModules.push({ id: modId, interface: modData.interface, connections: newConnections });
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
            activeBuses = { I2C: {}, SPI: {} };
            initPins();
            activeModules.forEach(mod => {
                for (const [signal, pinStr] of Object.entries(mod.connections)) {
                    if (pinStr === "dropped") continue;
                    String(pinStr).split(',').forEach(p => {
                        pinsState[p] = { state: 'used', owner: mod.id, signal: signal };
                        if (mod.interface && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK')) {
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
        activeModules = []; activeBuses = { I2C: {}, SPI: {} };
        initPins(); renderPins(); renderModules();
    }
}

// ==========================================
// 5. 导出与代码生成
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
            activeBuses = { I2C: {}, SPI: {} };
            initPins();
            importedData.forEach(mod => {
                if (moduleLibrary[mod.id]) {
                    activeModules.push(mod);
                    for (const [signal, pinStr] of Object.entries(mod.connections)) {
                        if (pinStr === "dropped") continue;
                        String(pinStr).split(',').forEach(p => {
                            const pinNum = Number(p);
                            if (pinsState[pinNum]) pinsState[pinNum] = { state: 'used', owner: mod.id, signal: signal };
                            if (mod.interface && ['SDA', 'SCL', 'MOSI', 'MISO', 'SCK'].includes(signal)) {
                                if (!activeBuses[mod.interface]) activeBuses[mod.interface] = {};
                                activeBuses[mod.interface][signal] = pinNum;
                            }
                        });
                    }
                }
            });
            renderPins();
            renderModules();
        } catch (error) {
            alert("导入失败！");
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}
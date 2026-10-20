// ==========================================
// 1. 全局状态管理
// ==========================================
let boardConfig = null;
let moduleLibrary = null;
let pinsState = {}; 
let activeModules = []; 
let activeBuses = { I2C: {}, SPI: {} }; 

// 用于协商弹窗的暂存状态
let pendingModule = null; 
let pendingOptionalDrops = []; 

// ==========================================
// 2. 初始化与数据加载
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [boardRes, moduleRes] = await Promise.all([
            fetch('./data/board.json'),
            fetch('./data/modules.json')
        ]);
        
        if(!boardRes.ok || !moduleRes.ok) throw new Error("无法加载数据文件");
        
        boardConfig = await boardRes.json();
        moduleLibrary = await moduleRes.json();
        
        document.getElementById('board-title').innerText = boardConfig.boardName;
        initPins();
        populateModuleSelect();
        
        if (typeof initDiagnosticsEngine === 'function') {
            await initDiagnosticsEngine();
        }

        renderPins();
        renderModules();
        
    } catch (error) {
        console.error(error);
        alert("数据加载失败！请确保你是通过 http 协议访问。");
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

        div.setAttribute('data-tooltip', tooltipText);
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
// 4. 智能分配与协商核心逻辑
// ==========================================

// 尝试分配逻辑抽取（返回成功分配的计划和失败的必选、可选引脚）
function tryAllocate(modData, pinsStateCopy) {
    let allocations = {}; // 记录当前尝试的分配结果
    let assignedPins = []; 
    let missingRequired = [];
    let missingOptional = [];

    // 排序：先分配必选，再分配可选，保证核心总线绝对能抢到资源
    let reqs = [...modData.requirements].sort((a, b) => a.optional === b.optional ? 0 : a.optional ? 1 : -1);

    for (const req of reqs) {
        let pinsToAllocate = req.count;
        let allocated = [];
        
        // 1. 复用总线
        if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][req.signal]) {
            const existingPin = activeBuses[modData.interface][req.signal];
            allocated.push(existingPin);
            pinsToAllocate--;
        }

        // 2. 默认引脚
        if (pinsToAllocate > 0 && modData.interface && boardConfig.defaultInterfaces[modData.interface]) {
            const defaultPins = boardConfig.defaultInterfaces[modData.interface];
            if (defaultPins[req.signal] && pinsStateCopy[defaultPins[req.signal]] === 'free' && !allocated.includes(defaultPins[req.signal])) {
                allocated.push(defaultPins[req.signal]);
                pinsToAllocate--;
            }
        }

        // 3. 推荐引脚
        if (pinsToAllocate > 0 && modData.preferredPins) {
            for (const p of modData.preferredPins) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[p] === 'free' && !allocated.includes(p)) {
                    allocated.push(p);
                    pinsToAllocate--;
                }
            }
        }

        // 4. 兜底
        if (pinsToAllocate > 0) {
            for (let i = 0; i <= 48; i++) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[i] === 'free') {
                    allocated.push(i);
                    pinsToAllocate--;
                }
            }
        }

        // 记录结果
        if (pinsToAllocate > 0) {
            if (req.optional) missingOptional.push(req.signal);
            else missingRequired.push(req.signal);
        } else {
            allocations[req.signal] = allocated;
            // 模拟占用
            allocated.forEach(p => { pinsStateCopy[p] = 'used'; });
            assignedPins.push(...allocated);
        }
    }

    return { allocations, missingRequired, missingOptional };
}

function addModule() {
    const select = document.getElementById('module-select');
    const modId = select.value;
    if (!modId) return alert('请先选择模组');

    const modData = moduleLibrary[modId];
    
    // 复制一份当前引脚状态用于沙盘推演
    let pinsStateCopy = {};
    for (let i = 0; i <= 48; i++) {
        if(pinsState[i]) pinsStateCopy[i] = pinsState[i].state;
    }

    const result = tryAllocate(modData, pinsStateCopy);

    // 情况 A：必选引脚都不够，直接报错
    if (result.missingRequired.length > 0) {
        alert(`引脚严重不足！无法满足核心必选信号 (${result.missingRequired.join(', ')})，请先释放其他引脚。`);
        return;
    }

    // 情况 B：完美分配（甚至可选引脚也够了）
    if (result.missingOptional.length === 0) {
        commitAllocation(modId, result.allocations);
        return;
    }

    // 情况 C：可选引脚不够，触发协商弹窗
    pendingModule = { id: modId, allocations: result.allocations };
    pendingOptionalDrops = result.missingOptional; // 记录哪些可选引脚分不到了
    
    // 渲染弹窗 UI
    const optionsDiv = document.getElementById('negotiation-options');
    optionsDiv.innerHTML = '';
    result.missingOptional.forEach(signal => {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.marginBottom = '5px';
        // 默认勾选（同意放弃）
        label.innerHTML = `<input type="checkbox" value="${signal}" checked> 放弃 ${signal} 引脚 (余量不足)`;
        optionsDiv.appendChild(label);
    });
    
    document.getElementById('negotiation-modal').style.display = 'flex';
}

function cancelNegotiation() {
    document.getElementById('negotiation-modal').style.display = 'none';
    pendingModule = null;
    pendingOptionalDrops = [];
}

function confirmNegotiation() {
    document.getElementById('negotiation-modal').style.display = 'none';
    
    // 读取用户勾选的放弃项
    const checkboxes = document.querySelectorAll('#negotiation-options input[type="checkbox"]:checked');
    const confirmedDrops = Array.from(checkboxes).map(cb => cb.value);

    // 将用户同意放弃的引脚标记为 "dropped"
    const finalAllocations = { ...pendingModule.allocations };
    confirmedDrops.forEach(signal => {
        finalAllocations[signal] = "dropped"; 
    });

    // 把那些分不到的，但用户又死活不想放弃的（取消了勾选）找出来
    // 如果用户取消了勾选，但引脚确实不够，我们只能强行标记 dropped，并提示
    const stubbornSignals = pendingOptionalDrops.filter(s => !confirmedDrops.includes(s));
    if (stubbornSignals.length > 0) {
        stubbornSignals.forEach(sig => finalAllocations[sig] = "dropped");
        alert(`注意：因为引脚确实不够，${stubbornSignals.join(', ')} 依然无法分配。`);
    }

    commitAllocation(pendingModule.id, finalAllocations);
    pendingModule = null;
    pendingOptionalDrops = [];
}

function commitAllocation(modId, allocations) {
    const modData = moduleLibrary[modId];
    const newConnections = {};

    for (const [signal, pins] of Object.entries(allocations)) {
        if (pins === "dropped") {
            newConnections[signal] = "dropped";
        } else {
            newConnections[signal] = pins.length > 1 ? pins.join(',') : pins[0];
            
            // 真正在全局状态中占用引脚
            pins.forEach(p => {
                pinsState[p] = { state: 'used', owner: modId, signal: signal };
            });
            
            // 记录总线
            if (modData.interface && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK')) {
                if (!activeBuses[modData.interface]) activeBuses[modData.interface] = {};
                activeBuses[modData.interface][signal] = Number(pins[0]);
            }
        }
    }

    activeModules.push({ 
        id: modId, 
        interface: modData.interface, 
        connections: newConnections 
    });
    
    renderPins();
    renderModules();
}

function releasePin(pinNum) {
    const pin = pinsState[pinNum];
    if (pin.state !== 'used') return;
    
    if(confirm(`确定要强制释放 GPIO ${pinNum} 吗？对应的模组将被移除。`)) {
        const ownerId = pin.owner;
        const modIndex = activeModules.findIndex(m => 
            m.id === ownerId && Object.values(m.connections).some(val => String(val).split(',').includes(String(pinNum)))
        );

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
        activeModules = [];
        activeBuses = { I2C: {}, SPI: {} };
        initPins();
        renderPins();
        renderModules();
    }
}

// ==========================================
// 5. 导出功能
// ==========================================
function generateCodePreview() {
    const pre = document.getElementById('code-preview');
    let code = `/*\n * 自动生成的引脚配置头文件\n * 目标平台: ${boardConfig.boardName}\n * 生成时间: ${new Date().toLocaleString()}\n */\n\n#ifndef PIN_CONFIG_H\n#define PIN_CONFIG_H\n\n`;

    let hasI2C = false, hasSPI = false;
    activeModules.forEach(mod => {
        if (mod.interface === 'I2C') hasI2C = true;
        if (mod.interface === 'SPI') hasSPI = true;
    });

    if (hasI2C) {
        code += `/* --- I2C Bus Configuration --- */\n`;
        const i2cMod = activeModules.find(m => m.interface === 'I2C');
        if (i2cMod && i2cMod.connections['SDA'] && i2cMod.connections['SDA'] !== "dropped") code += `#define I2C_MASTER_SDA_IO  ${i2cMod.connections['SDA']}\n`;
        if (i2cMod && i2cMod.connections['SCL'] && i2cMod.connections['SCL'] !== "dropped") code += `#define I2C_MASTER_SCL_IO  ${i2cMod.connections['SCL']}\n`;
        code += `\n`;
    }

    if (hasSPI) {
        code += `/* --- SPI Bus Configuration --- */\n`;
        const spiMod = activeModules.find(m => m.interface === 'SPI');
        ['MOSI', 'MISO', 'SCK', 'CS'].forEach(sig => {
            if (spiMod && spiMod.connections[sig] && spiMod.connections[sig] !== "dropped") {
                code += `#define SPI_MASTER_${sig}_IO  ${spiMod.connections[sig]}\n`;
            }
        });
        code += `\n`;
    }

    activeModules.forEach((mod) => {
        const modData = moduleLibrary[mod.id];
        const specificSignals = Object.keys(mod.connections).filter(sig => 
            !(mod.interface === 'I2C' && ['SDA', 'SCL'].includes(sig)) &&
            !(mod.interface === 'SPI' && ['MOSI', 'MISO', 'SCK', 'CS'].includes(sig))
        );

        if (specificSignals.length > 0) {
            code += `/* --- ${modData.name} --- */\n`;
            specificSignals.forEach(sig => {
                const pinStr = mod.connections[sig];
                const prefix = mod.id.toUpperCase();
                
                if (pinStr === "dropped") {
                    code += `// #define ${prefix}_${sig}  (未连接，请在代码中通过软件处理)\n`;
                } else if (String(pinStr).includes(',')) {
                    String(pinStr).split(',').forEach((p, i) => {
                        code += `#define ${prefix}_${sig}_${i}  ${p}\n`;
                    });
                } else {
                    code += `#define ${prefix}_${sig}  ${pinStr}\n`;
                }
            });
            code += `\n`;
        }
    });

    code += `#endif // PIN_CONFIG_H\n`;
    pre.textContent = code;
    document.getElementById('code-panel').style.display = 'block';
}

function exportConfig() {
    downloadFile("esp32s3_config.json", JSON.stringify(activeModules, null, 2));
}

function exportCHeader() {
    downloadFile("pin_config.h", document.getElementById('code-preview').textContent);
}

function downloadFile(filename, content) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

// ==========================================
// 6. 导入配置文件
// ==========================================
function importConfig(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!Array.isArray(importedData)) throw new Error("配置文件格式不正确");

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
                            if (pinsState[pinNum]) {
                                pinsState[pinNum] = { state: 'used', owner: mod.id, signal: signal };
                            }
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
            alert("配置导入成功！");

        } catch (error) {
            console.error(error);
            alert("解析配置文件失败！");
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}
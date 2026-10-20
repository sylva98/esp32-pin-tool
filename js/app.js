// ==========================================
// 1. 全局状态管理
// ==========================================
let boardConfig = null;
let moduleLibrary = null;
let pinsState = {}; 
let activeModules = []; 
let activeBuses = { I2C: {}, SPI: {} };

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
        
        // 等待诊断引擎的规则库加载完毕
        if (typeof initDiagnosticsEngine === 'function') {
            await initDiagnosticsEngine();
        }

        // 引擎准备就绪后，渲染第一次界面
        renderPins();
        renderModules();
        
    } catch (error) {
        console.error(error);
        alert("数据加载失败！请确保你是通过 http 协议访问，不要直接双击打开 HTML。");
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
            String(pinStr).split(',').forEach(p => {
                allConnections.push({ 
                    pin: Number(p), 
                    module: moduleLibrary[mod.id].name, 
                    signal: signal 
                });
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
            if (!tooltipText) tooltipText = `点击可强制释放此引脚。\n当前使用模组: ${pin.owner}\n信号类型: ${pin.signal}`;
        } else if (pin.state === 'strapping') {
            labelHtml += `<div class="pin-label">启动敏感</div>`;
            if (!tooltipText) tooltipText = `Strapping 引脚。启动时电平会影响芯片模式，请谨慎接入外设。`;
        } else if (pin.state === 'fixed') {
             labelHtml += `<div class="pin-label">${pin.label}</div>`;
             if (!tooltipText) tooltipText = `主控系统占用引脚，严禁外接其他模组。`;
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
            let isShared = (mod.interface === 'I2C' || mod.interface === 'SPI') && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK');
            
            const item = document.createElement('div');
            item.className = 'connection-item';
            item.innerHTML = `
                <strong>${signal}</strong> 
                <span style="margin: 0 10px;">➡</span> 
                <span style="color:var(--pin-fixed); font-weight:bold; font-size:1.1rem;">GPIO ${pinNum}</span>
                ${isShared ? '<span style="font-size:10px; color:#888; margin-left:10px;">(总线共享)</span>' : ''}
            `;
            wiringList.appendChild(item);
        }
    });

    wiringPanel.style.display = 'block';
    generateCodePreview();
}

// ==========================================
// 4. 智能分配核心逻辑
// ==========================================
function addModule() {
    const select = document.getElementById('module-select');
    const modId = select.value;
    if (!modId) return alert('请先选择模组');

    const modData = moduleLibrary[modId];
    const newConnections = {};
    const tempAllocations = []; 

    for (const req of modData.requirements) {
        let pinsToAllocate = req.count;
        let allocated = [];
        
        if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][req.signal]) {
            const existingPin = activeBuses[modData.interface][req.signal];
            allocated.push(existingPin);
            pinsToAllocate--;
        }

        if (pinsToAllocate > 0 && modData.interface && boardConfig.defaultInterfaces[modData.interface]) {
            const defaultPins = boardConfig.defaultInterfaces[modData.interface];
            if (defaultPins[req.signal] && pinsState[defaultPins[req.signal]].state === 'free') {
                const p = defaultPins[req.signal];
                pinsState[p] = { state: 'used', owner: modId, signal: req.signal };
                allocated.push(p);
                tempAllocations.push(p);
                pinsToAllocate--;
                
                if (modData.interface) {
                    activeBuses[modData.interface][req.signal] = p;
                }
            }
        }

        if (pinsToAllocate > 0 && modData.preferredPins) {
            for (const p of modData.preferredPins) {
                if (pinsToAllocate <= 0) break;
                if (pinsState[p].state === 'free' && !allocated.includes(p)) {
                    pinsState[p] = { state: 'used', owner: modId, signal: req.signal };
                    allocated.push(p);
                    tempAllocations.push(p);
                    pinsToAllocate--;
                }
            }
        }

        if (pinsToAllocate > 0) {
            for (let i = 0; i <= 48; i++) {
                if (pinsToAllocate <= 0) break;
                if (pinsState[i] && pinsState[i].state === 'free') {
                    pinsState[i] = { state: 'used', owner: modId, signal: req.signal };
                    allocated.push(i);
                    tempAllocations.push(i);
                    pinsToAllocate--;
                }
            }
        }

        if (pinsToAllocate > 0) {
            alert(`引脚不足！无法满足 ${modData.name} 的 ${req.signal} 需求。`);
            tempAllocations.forEach(p => { pinsState[p] = { state: 'free', label: 'Free' }; });
            if (modData.interface) {
                 for (const [k, v] of Object.entries(activeBuses[modData.interface])) {
                     if (tempAllocations.includes(v)) delete activeBuses[modData.interface][k];
                 }
            }
            return;
        }

        newConnections[req.signal] = req.count > 1 ? allocated.join(',') : allocated[0];
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

    let hasI2C = false;
    let hasSPI = false;
    activeModules.forEach(mod => {
        if (mod.interface === 'I2C') hasI2C = true;
        if (mod.interface === 'SPI') hasSPI = true;
    });

    if (hasI2C) {
        code += `/* --- I2C Bus Configuration --- */\n`;
        const i2cMod = activeModules.find(m => m.interface === 'I2C');
        if (i2cMod && i2cMod.connections['SDA']) code += `#define I2C_MASTER_SDA_IO  ${i2cMod.connections['SDA']}\n`;
        if (i2cMod && i2cMod.connections['SCL']) code += `#define I2C_MASTER_SCL_IO  ${i2cMod.connections['SCL']}\n`;
        code += `\n`;
    }

    if (hasSPI) {
        code += `/* --- SPI Bus Configuration --- */\n`;
        const spiMod = activeModules.find(m => m.interface === 'SPI');
        ['MOSI', 'MISO', 'SCK', 'CS'].forEach(sig => {
            if (spiMod && spiMod.connections[sig]) {
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
                if (String(pinStr).includes(',')) {
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
            alert("解析配置文件失败，请确保文件是由本工具导出的合法 JSON。");
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}
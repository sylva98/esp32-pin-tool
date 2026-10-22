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
    
    let totalCurrent = 0;
    activeModules.forEach(mod => {
        const mData = moduleLibrary[mod.id];
        totalCurrent += (mod.overrides?.current !== undefined ? mod.overrides.current : (mData.peak_current_ma || 0));
    });
    const maxCurrent = boardConfig.max_current_ma || 500;
    const isOverload = totalCurrent > maxCurrent;

    // 物理走线警告
    if (typeof checkHighSpeedWarning === 'function' && checkHighSpeedWarning()) {
        const hwWarning = document.createElement('div');
        hwWarning.style.cssText = "font-size: 13px; color: #856404; background-color: #fff3cd; border: 1px solid #ffeeba; padding: 12px; border-radius: 6px; margin-bottom: 15px; display: flex; align-items: center; line-height: 1.5;";
        hwWarning.innerHTML = `<span style="font-size: 16px; margin-right: 8px;">⚠️</span> <div><strong>物理走线警告：</strong>您的项目使用了 SPI/I2S 等高频信号引脚。请确保排线长度不超过 10cm，且信号线尽量分开或包地。</div>`;
        wiringList.appendChild(hwWarning);
    }
    
    activeModules.forEach((mod, index) => {
        const modData = moduleLibrary[mod.id];
        
        const modDiv = document.createElement('div');
        modDiv.className = 'module-tag';
        // 🔥 修改：去掉了这里的微调齿轮按钮
        modDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <strong>${modData.name}</strong> 
                <div>
                    <span style="margin-right:10px;">#${index+1}</span>
                </div>
            </div>
        `;
        list.appendChild(modDiv);
        
        const title = document.createElement('h3');
        title.innerText = `${modData.name} (实例 #${index+1})`;
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

        if (modData.power_pins && modData.power_pins.length > 0) {
            modData.power_pins.forEach(p => {
                const item = document.createElement('div');
                item.className = 'connection-item';
                
                let displayWarning = "";
                let isDangerousPower = false;

                if (isOverload) {
                    if (p.connect_to === '5V') {
                        displayWarning = "接外部 5V 供电";
                        isDangerousPower = true;
                    } else if (p.connect_to === '3.3V') {
                        displayWarning = "接降压模块输出";
                    } else {
                        displayWarning = "统一共地";
                    }
                } else {
                    displayWarning = p.connect_to === 'GND' ? "接主板 GND" : "接主板 " + p.connect_to;
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
    // 这个函数现在基本用不到了，但为了防止底层报错依然保留
}

// 释放引脚逻辑保持不变
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
            renderPins(); renderModules(); updatePowerBudget();
        }
    }
}

function resetAll() {
    if(confirm('确定要清空所有配置吗？')) { 
        cartSelectedModules = []; // 清空购物车
        const currentBoard = document.getElementById('board-select').value || Object.keys(globalBoards)[0];
        loadBoard(currentBoard);
        closeCartModal();
    }
}

// ==========================================
// 4. 购物车批量分配引擎
// ==========================================
function confirmCartAndAllocate() {
    if (cartSelectedModules.length === 0) {
        return alert('购物车是空的，请先选择需要接入的模组。');
    }

    // 1. 重置当前状态（回到初始干净状态）
    activeModules = [];
    activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
    initPins();

    let successCount = 0;
    let failedModules = [];

    // 2. 按照购物车已经排好的优先级顺序，依次尝试分配
    cartSelectedModules.forEach(item => {
        const modId = item.id;
        const modData = moduleLibrary[modId];

        let pinsStateCopy = {};
        for (let i = 0; i <= boardConfig.max_pin; i++) { 
            if(pinsState[i]) { pinsStateCopy[i] = { ...pinsState[i] }; } 
        }

        const result = tryAllocate(modData, pinsStateCopy);

        if (result.missingRequired.length > 0) {
            failedModules.push(modData.name);
        } else {
            // 提交分配，并把购物车里的 overrides 存进 activeModules 实例里
            commitAllocation(modId, result.allocations, item.overrides);
            checkWifiAdcConflict(modId);
            successCount++;
        }
    });

    // 3. 关闭购物车弹窗，刷新界面
    closeCartModal();
    renderPins();
    renderModules();
    updatePowerBudget();

    // 4. 结果反馈
    if (failedModules.length > 0) {
        alert(`⚠️ 全局分配完成，但有部分模组未能成功接入。\n\n✅ 成功接入：${successCount} 个模组\n❌ 因引脚不足失败：${failedModules.join('、')}\n\n建议：请移除部分大功耗/多引脚模组后重试。`);
    } else {
        alert(`🎉 完美！购物车内 ${successCount} 个模组已全部成功分配引脚！`);
    }
}
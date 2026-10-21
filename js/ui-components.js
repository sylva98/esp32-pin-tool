// ==========================================
// UI 组件层：组合框与微调面板
// ==========================================

// --- 1. 高级组合框逻辑 ---
function initCombobox() {
    const tabsContainer = document.getElementById('combobox-tabs');
    const categories = new Set();
    Object.values(moduleLibrary).forEach(mod => { if (mod.category) categories.add(mod.category); });
    
    let tabHtml = `<div class="custom-tab active" data-cat="ALL" onclick="switchCategory('ALL')">全部</div>`;
    categories.forEach(cat => { tabHtml += `<div class="custom-tab" data-cat="${cat}" onclick="switchCategory('${cat}')">${cat}</div>`; });
    tabsContainer.innerHTML = tabHtml;

    renderComboboxOptions();
    
    // 点击空白处关闭面板
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('module-combobox');
        if (wrapper && !wrapper.contains(e.target)) { document.getElementById('combobox-panel').classList.remove('show'); }
    });
}

function toggleCombobox() {
    const panel = document.getElementById('combobox-panel');
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) { document.getElementById('combobox-search').focus(); }
}

function switchCategory(cat) {
    currentCategory = cat;
    document.querySelectorAll('.custom-tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.cat === cat); });
    renderComboboxOptions();
}

function filterComboboxOptions() {
    currentSearch = document.getElementById('combobox-search').value.toLowerCase();
    renderComboboxOptions();
}

function renderComboboxOptions() {
    const optionsContainer = document.getElementById('combobox-options');
    optionsContainer.innerHTML = '';
    
    let count = 0;
    for (const [key, data] of Object.entries(moduleLibrary)) {
        const matchCat = (currentCategory === 'ALL' || data.category === currentCategory);
        const matchSearch = (data.name.toLowerCase().includes(currentSearch) || key.toLowerCase().includes(currentSearch));
        
        if (matchCat && matchSearch) {
            const div = document.createElement('div');
            div.className = 'custom-option';
            if (key === selectedModuleId) div.style.background = '#e2e6ea';
            div.innerText = data.name;
            div.onclick = () => selectModule(key, data.name);
            optionsContainer.appendChild(div);
            count++;
        }
    }
    if (count === 0) { optionsContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#888; font-size:12px;">未找到匹配的模组</div>'; }
}

function selectModule(key, name) {
    selectedModuleId = key;
    document.getElementById('combobox-text').innerText = name;
    document.getElementById('combobox-text').style.color = '#333';
    document.getElementById('combobox-panel').classList.remove('show');
    document.getElementById('combobox-search').value = ''; 
    currentSearch = '';
    renderComboboxOptions();
}

// --- 2. 微调面板逻辑 ---
function openEditPanel(index) {
    editingModuleIndex = index;
    const mod = activeModules[index];
    const modData = moduleLibrary[mod.id];

    // 填充电流
    const currentVal = mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0);
    document.getElementById('edit-current').value = currentVal;
    document.getElementById('edit-current').placeholder = `默认: ${modData.peak_current_ma || 0} mA`;

    // 填充引脚数量裁剪
    const pinCountSelect = document.getElementById('edit-pin-count');
    pinCountSelect.innerHTML = '';
    const batchReq = modData.requirements.find(r => r.count > 1);
    const countContainer = document.getElementById('pin-count-container');
    
    if (batchReq) {
        countContainer.style.display = 'block';
        document.getElementById('pin-count-label').innerText = `${batchReq.signal} 数量裁剪:`;
        for (let i = 1; i <= batchReq.count; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `${i} 根`;
            const currentAssignedCount = String(mod.connections[batchReq.signal] || "").split(',').filter(x => x && x !== "dropped").length;
            if (currentAssignedCount === i) option.selected = true;
            pinCountSelect.appendChild(option);
        }
    } else {
        countContainer.style.display = 'none';
    }

    // 渲染单线重排列表
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

// 检查指定引脚是否引发串扰
function checkCrosstalkWarning(pin, currentReq) {
    if (!currentReq || !currentReq.high_speed) return null;
    const adjPins = [pin - 1, pin + 1];
    for (const adj of adjPins) {
        if (pinsState[adj] && pinsState[adj].state === 'used') {
            const ownerModId = pinsState[adj].owner;
            const ownerSignal = pinsState[adj].signal;
            const ownerModData = moduleLibrary[ownerModId];
            if (ownerModData) {
                const ownerReq = ownerModData.requirements.find(r => r.signal === ownerSignal);
                if (ownerReq && ownerReq.high_speed) {
                    return `⚠️ 严重警告：GPIO ${pin} 紧邻 GPIO ${adj}（已有高频信号 ${ownerSignal}）。强行相邻布线会导致严重的电磁串扰，极易导致数据错乱或死机！建议换一个引脚。`;
                }
            }
        }
    }
    return null;
}

// 单线智能重排
function autoReroutePin(signal) {
    const mod = activeModules[editingModuleIndex];
    const modData = moduleLibrary[mod.id];

    const currentPins = String(mod.connections[signal]).split(',').map(Number);
    currentPins.forEach(p => { if (pinsState[p]) pinsState[p] = { state: 'free', label: 'Free' }; });
    delete mod.connections[signal];
    if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][signal]) {
        delete activeBuses[modData.interface][signal];
    }

    const req = modData.requirements.find(r => r.signal === signal);
    let pinsStateCopy = {};
    for (let i = 0; i <= 48; i++) { if(pinsState[i]) pinsStateCopy[i] = { ...pinsState[i] }; }

    let allocated = [];
    if (modData.interface && boardConfig.defaultInterfaces[modData.interface] && boardConfig.defaultInterfaces[modData.interface][signal]) {
        const dp = boardConfig.defaultInterfaces[modData.interface][signal];
        if (pinsStateCopy[dp] === 'free' && isSafePin(dp, modData, req, pinsStateCopy)) {
            allocated.push(dp);
            pinsStateCopy[dp].state = 'used';
        }
    }
    if (allocated.length === 0) {
        for (let i = 0; i <= 48; i++) {
            if (pinsStateCopy[i].state === 'free' && isSafePin(i, modData, req, pinsStateCopy)) {
                allocated.push(i);
                break;
            }
        }
    }

    if (allocated.length > 0) {
        mod.connections[signal] = allocated.join(',');
        allocated.forEach(p => { pinsState[p] = { state: 'used', owner: mod.id, signal: signal }; });
        renderPins();
        renderModules();
        openEditPanel(editingModuleIndex);
    } else {
        alert(`找不到其他安全的空闲引脚给 ${signal} 了！（已为您避开高频干扰区）`);
        currentPins.forEach(p => { pinsState[p] = { state: 'used', owner: mod.id, signal: signal }; });
        renderPins();
    }
}

// 保存微调参数
function saveModuleParams() {
    const newCurrent = Number(document.getElementById('edit-current').value);
    const mod = activeModules[editingModuleIndex];
    const modData = moduleLibrary[mod.id];
    
    mod.overrides = mod.overrides || {};
    mod.overrides.current = newCurrent;

    const batchReq = modData.requirements.find(r => r.count > 1);
    const countContainer = document.getElementById('pin-count-container');
    if (batchReq && countContainer.style.display !== 'none') {
        const targetCount = Number(document.getElementById('edit-pin-count').value);
        let currentPins = String(mod.connections[batchReq.signal] || "").split(',').filter(x => x && x !== "dropped");
        
        if (targetCount < currentPins.length) {
            const toDrop = currentPins.splice(targetCount);
            toDrop.forEach(p => { if (pinsState[Number(p)]) pinsState[Number(p)] = { state: 'free', label: 'Free' }; });
            mod.connections[batchReq.signal] = currentPins.join(',');
        } else if (targetCount > currentPins.length) {
            alert("目前仅支持裁剪引脚数量，暂不支持微调面板内自动增配引脚。请重置后重新分配。");
        }
    }

    // 强行微调后的串扰检查
    for (const [signal, pinStr] of Object.entries(mod.connections)) {
        if (pinStr === "dropped") continue;
        const req = modData.requirements.find(r => r.signal === signal);
        const pins = String(pinStr).split(',').map(Number);
        for (const p of pins) {
            const warnMsg = checkCrosstalkWarning(p, req);
            if (warnMsg) { alert(warnMsg); }
        }
    }

    renderPins();
    renderModules();
    updatePowerBudget();
    closeEditPanel();
}
// ==========================================
// UI 组件层：微调面板
// ==========================================

function openEditPanel(index) {
    editingModuleIndex = index;
    const mod = activeModules[index];
    const modData = moduleLibrary[mod.id];

    const currentVal = mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0);
    document.getElementById('edit-current').value = currentVal;
    document.getElementById('edit-current').placeholder = `默认: ${modData.peak_current_ma || 0} mA`;

    const warningContainerId = 'edit-physics-warning';
    let warningContainer = document.getElementById(warningContainerId);
    
    if (!warningContainer) {
        warningContainer = document.createElement('div');
        warningContainer.id = warningContainerId;
        warningContainer.style.cssText = "background: #fff8e1; border-left: 4px solid #ffc107; color: #8a6d3b; padding: 12px; border-radius: 4px; font-size: 12px; margin-bottom: 15px; line-height: 1.6;";
        const currentInput = document.getElementById('edit-current');
        currentInput.parentNode.insertBefore(warningContainer, currentInput.nextSibling);
    }
    
    if (modData.peak_current_ma > 100) {
        warningContainer.style.display = 'block';
        warningContainer.innerHTML = `
            <strong>⚠️ 自定义功耗风险提示：</strong><br>
            修改此数值仅用于调整系统的规划预算。<strong>降低数值并不会减少模组实际物理耗电</strong>。<br>
            如果您为了通过预算检查而强行改小数值，请务必确保在代码或硬件上采取了降功耗措施。
        `;
    } else {
        warningContainer.style.display = 'none';
    }

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
                    return `⚠️ 严重警告：GPIO ${pin} 紧邻 GPIO ${adj}（已有高频信号 ${ownerSignal}）。强行相邻布线会导致严重的电磁串扰！`;
                }
            }
        }
    }
    return null;
}

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
        }
    }

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
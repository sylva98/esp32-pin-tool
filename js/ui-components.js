// ==========================================
// UI 组件层：模组参数微调弹窗（唯一实现）
// 画布模组与购物车项共用同一个弹窗，靠 _mpTarget 区分作用对象：
//   { kind: 'active', index }  画布上的模组 —— 可改电流 + 裁剪信号数量 + 逐根换脚
//   { kind: 'cart',   id    }  购物车里的候选 —— 只能改电流（此时还没分引脚）
// ==========================================

let _mpTarget = null;

/* 把两种作用对象统一成同一份视图数据，渲染和保存都只认这份结构 */
function _mpResolve(target) {
    if (!target) return null;

    if (target.kind === 'active') {
        const mod = activeModules[target.index];
        if (!mod) return null;
        const modData = moduleLibrary[mod.id];
        if (!modData) return null;
        return {
            kind: 'active',
            mod,
            modData,
            isOnboard: false,
            name: modData.name,
            currentVal: mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0),
            defaultCurrent: modData.peak_current_ma || 0
        };
    }

    const item = cartSelectedModules.find(m => m.id === target.id);
    if (!item) return null;
    const modData = moduleLibrary[target.id];
    if (!modData) return null;
    return {
        kind: 'cart',
        mod: item,
        modData,
        isOnboard: !!item.isOnboard,
        name: modData.name + (item.isOnboard ? ' (板载)' : ''),
        currentVal: item.overrides?.current !== undefined ? item.overrides.current : (modData.peak_current_ma || 0),
        defaultCurrent: modData.peak_current_ma || 0
    };
}

function openModuleParams(target) {
    const ctx = _mpResolve(target);
    if (!ctx) {
        uiToast('找不到该模组，可能已被移除', { type: 'warn' });
        return;
    }
    _mpTarget = { kind: ctx.kind, index: target.index, id: target.id };
    // 画布上下文依赖这个全局变量做「换一个」的重入
    editingModuleIndex = ctx.kind === 'active' ? target.index : -1;

    document.getElementById('mp-name').textContent = ctx.name;
    document.getElementById('mp-current').value = ctx.currentVal;
    document.getElementById('mp-current').placeholder = `默认: ${ctx.defaultCurrent} mA`;

    const warn = document.getElementById('mp-warning');
    warn.innerHTML = ctx.isOnboard
        ? '<strong>🔒 板载设备提示：</strong>此设备已焊接在 PCB 上，不可移除。功耗微调仅影响供电预算计算，不会改变真实物理功耗。'
        : '<strong>⚠️ 风险提示：</strong>降低数值不会减少模组实际物理耗电。若强行改小以通过预算检查，请务必在代码或硬件上采取降功耗措施。';

    // 只有画布上的模组才谈得上「已经分了脚」，购物车阶段没有引脚可裁
    const batchReq = ctx.kind === 'active' ? (ctx.modData.requirements || []).find(r => r.count > 1) : null;
    const countWrap = document.getElementById('mp-pin-count-wrap');
    const pinListWrap = document.getElementById('mp-pin-list-wrap');
    const pinList = document.getElementById('mp-pin-list');

    if (batchReq) {
        countWrap.style.display = 'block';
        document.getElementById('mp-pin-count-label').textContent = `${batchReq.signal} 数量裁剪:`;
        const sel = document.getElementById('mp-pin-count');
        sel.innerHTML = '';
        const assigned = String(ctx.mod.connections[batchReq.signal] || '').split(',').filter(x => x && x !== 'dropped').length;
        for (let i = 1; i <= batchReq.count; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${i} 根`;
            if (assigned === i) opt.selected = true;
            sel.appendChild(opt);
        }
    } else {
        countWrap.style.display = 'none';
    }

    if (ctx.kind === 'active') {
        pinListWrap.style.display = 'block';
        pinList.innerHTML = '';
        for (const [signal, pinStr] of Object.entries(ctx.mod.connections)) {
            if (pinStr === 'dropped') continue;
            const row = document.createElement('div');
            row.className = 'mp-pin-row';
            row.innerHTML = `<span><strong>${escapeHtml(signal)}</strong> ➡ GPIO ${escapeHtml(String(pinStr))}</span>
                <button class="mp-pin-route" data-signal="${escapeHtml(signal)}">🔄 换一个</button>`;
            row.querySelector('.mp-pin-route').addEventListener('click', () => autoReroutePin(signal));
            pinList.appendChild(row);
        }
    } else {
        pinListWrap.style.display = 'none';
        pinList.innerHTML = '';
    }

    const modal = document.getElementById('module-params-modal');
    modal.style.display = 'flex';
    // 购物车弹窗里再开这一层，必须压在购物窗之上
    modal.style.zIndex = ctx.kind === 'cart' ? '9999999' : '';
}

function closeModuleParams() {
    document.getElementById('module-params-modal').style.display = 'none';
    _mpTarget = null;
    editingModuleIndex = -1;
}

function saveModuleParams() {
    const ctx = _mpResolve(_mpTarget);
    if (!ctx) { closeModuleParams(); return; }

    const newCurrent = Number(document.getElementById('mp-current').value);
    ctx.mod.overrides = ctx.mod.overrides || {};
    ctx.mod.overrides.current = newCurrent;

    if (ctx.kind === 'cart') {
        ctx.mod.failed = false;
        // 板载项要同步到槽位与板级兼容数据，否则功耗预算仍读旧值
        if (ctx.isOnboard && typeof _onboardSlots !== 'undefined') {
            const slot = _onboardSlots.find(s => s.slotId === ctx.mod.slotId);
            if (slot) {
                slot._peakOverride = newCurrent;
                const compatDev = (boardConfig.onboard_devices || []).find(d => d.id === ctx.mod.id);
                if (compatDev) compatDev.peak_current_ma = newCurrent;
            }
        }
        renderCartRightList();
        closeModuleParams();
        if (typeof renderModules === 'function') renderModules();
        else updatePowerBudget();
        return;
    }

    // 画布模组：裁剪批量信号后要真的把多出来的引脚放回空闲池
    const batchReq = (ctx.modData.requirements || []).find(r => r.count > 1);
    const countWrap = document.getElementById('mp-pin-count-wrap');
    if (batchReq && countWrap.style.display !== 'none') {
        const targetCount = Number(document.getElementById('mp-pin-count').value);
        const pins = String(ctx.mod.connections[batchReq.signal] || '').split(',').filter(x => x && x !== 'dropped');
        if (targetCount < pins.length) {
            pins.splice(targetCount).forEach(p => {
                if (pinsState[Number(p)]) pinsState[Number(p)] = { state: 'free', label: 'Free' };
            });
            ctx.mod.connections[batchReq.signal] = pins.join(',');
        }
    }

    for (const [signal, pinStr] of Object.entries(ctx.mod.connections)) {
        if (pinStr === 'dropped') continue;
        const req = (ctx.modData.requirements || []).find(r => r.signal === signal);
        String(pinStr).split(',').map(Number).forEach(p => {
            const warnMsg = checkCrosstalkWarning(p, req);
            if (warnMsg) uiToast(warnMsg, { type: 'warn', duration: 4200 });
        });
    }

    renderPins();
    renderModules();
    updatePowerBudget();
    closeModuleParams();
}

// ---------- 兼容入口：旧调用点仍然可用 ----------
function openEditPanel(index) { openModuleParams({ kind: 'active', index }); }
function closeEditPanel() { closeModuleParams(); }
function openCartEditModal(modId) { openModuleParams({ kind: 'cart', id: modId }); }
function closeCartEditModal() { closeModuleParams(); }
function saveCartModuleParams() { saveModuleParams(); }

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
    if (!mod) return;
    const modData = moduleLibrary[mod.id];

    const currentPins = String(mod.connections[signal]).split(',').map(Number);
    currentPins.forEach(p => { if (pinsState[p]) pinsState[p] = { state: 'free', label: 'Free' }; });
    delete mod.connections[signal];
    if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][signal]) {
        delete activeBuses[modData.interface][signal];
    }

    const req = modData.requirements.find(r => r.signal === signal);
    let pinsStateCopy = {};
    for (let i = 0; i <= boardConfig.max_pin; i++) { if (pinsState[i]) pinsStateCopy[i] = { ...pinsState[i] }; }

    let allocated = [];
    if (modData.interface && boardConfig.defaultInterfaces[modData.interface] && boardConfig.defaultInterfaces[modData.interface][signal]) {
        const dp = boardConfig.defaultInterfaces[modData.interface][signal];
        if (pinsStateCopy[dp] && pinsStateCopy[dp].state === 'free' && isSafePin(dp, modData, req, pinsStateCopy)) {
            allocated.push(dp);
            pinsStateCopy[dp] = { state: 'used', owner: mod.id, signal: signal };
        }
    }
    if (allocated.length === 0) {
        for (let i = 0; i <= boardConfig.max_pin; i++) {
            const st = pinsStateCopy[i];
            if (!st || st.state !== 'free') continue;
            if (boardConfig.availableGpios && !boardConfig.availableGpios.includes(i)) continue;
            if (typeof isHeaderPin === 'function' && !isHeaderPin(i)) continue;
            if (isSafePin(i, modData, req, pinsStateCopy)) {
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
        uiToast(`找不到其他安全的空闲引脚给 ${signal}（已避开高频干扰区）`, { type: 'warn', duration: 4200 });
        currentPins.forEach(p => { pinsState[p] = { state: 'used', owner: mod.id, signal: signal }; });
        renderPins();
    }
}

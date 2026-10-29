// ==========================================
// 购物车与模组选择管理 (极简版)
// ==========================================

let cartSelectedModules = []; 
let cartCategory = 'ALL'; 
let currentCartEditId = null;
let currentReplaceId = null; 

function openCartModal() {
    document.getElementById('cart-modal').style.display = 'flex';
    document.getElementById('cart-search').value = '';
    cartCategory = 'ALL';
    
    const rightContainer = document.querySelector('.cart-right');
    if (rightContainer) {
        rightContainer.style.overflow = 'hidden'; 
        rightContainer.style.display = 'flex';
        rightContainer.style.flexDirection = 'column';
    }
    const rightList = document.getElementById('cart-right-list');
    if (rightList) {
        rightList.style.overflowY = 'auto'; 
        rightList.onclick = function(e) {
            const btn = e.target.closest('.cart-action-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            const id = btn.getAttribute('data-id');
            if (action === 'replace') openReplaceModal(id);
            else if (action === 'edit') openCartEditModal(id);
            else if (action === 'remove') removeFromCart(id);
        };
    }

    renderCartTabs();
    renderCartLeftList();
    renderCartRightList();
}

function closeCartModal() {
    document.getElementById('cart-modal').style.display = 'none';
}

function renderCartTabs() {
    const tabsContainer = document.getElementById('cart-tabs');
    const categories = new Set();
    Object.values(moduleLibrary).forEach(mod => { if (mod.category) categories.add(mod.category); });
    
    let tabHtml = `<div class="custom-tab ${cartCategory === 'ALL' ? 'active' : ''}" data-act="switchCartCategory" data-arg="ALL" style="padding: 6px 12px; border: 1px solid ${cartCategory === 'ALL' ? '#007bff' : '#ddd'}; border-radius: 20px; color: ${cartCategory === 'ALL' ? '#007bff' : '#666'}; cursor: pointer;">全部</div>`;
    
    categories.forEach(cat => {
        const isActive = cartCategory === cat;
        tabHtml += `<div class="custom-tab ${isActive ? 'active' : ''}" data-act="switchCartCategory" data-arg="${cat}" style="padding: 6px 12px; border: 1px solid ${isActive ? '#007bff' : '#ddd'}; border-radius: 20px; color: ${isActive ? '#007bff' : '#666'}; cursor: pointer;">${cat}</div>`;
    });
    tabsContainer.innerHTML = tabHtml;
}

function switchCartCategory(cat) {
    cartCategory = cat;
    renderCartTabs();
    renderCartLeftList();
}

function renderCartLeftList() {
    const listContainer = document.getElementById('cart-left-list');
    listContainer.innerHTML = '';
    const search = document.getElementById('cart-search').value.toLowerCase();
    
    const pinnedModules = JSON.parse(localStorage.getItem('esp_pinned_modules') || '[]');

    let validMods = [];
    for (const [key, data] of Object.entries(moduleLibrary)) {
        const matchCat = (cartCategory === 'ALL' || data.category === cartCategory);
        const matchSearch = (data.name.toLowerCase().includes(search));
        
        if (matchCat && matchSearch) {
            if (boardConfig.onboard_devices && boardConfig.onboard_devices.some(dev => dev.id === key)) continue;
            if (cartSelectedModules.some(m => m.id === key)) continue; 
            
            validMods.push({ id: key, data: data });
        }
    }

    validMods.sort((a, b) => {
        const aPinned = pinnedModules.includes(a.id);
        const bPinned = pinnedModules.includes(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0; 
    });

    validMods.forEach(mod => {
        const div = document.createElement('div');
        div.className = 'cart-left-item';
        const star = pinnedModules.includes(mod.id) ? '⭐ ' : '';
        div.innerHTML = `
            <span class="cart-left-item-name">${star}${mod.data.name}</span>
            <span class="cart-left-item-plus">+</span>
        `;
        div.onclick = () => {
            cartSelectedModules.push({ id: mod.id, name: mod.data.name, priority: mod.data.priority || 50, overrides: {}, failed: false });
            renderCartLeftList();
            renderCartRightList();
        };
        listContainer.appendChild(div);
    });
}

function renderCartRightList() {
    const listContainer = document.getElementById('cart-right-list');
    listContainer.innerHTML = '';

    const pinnedModules = JSON.parse(localStorage.getItem('esp_pinned_modules') || '[]');

    cartSelectedModules.sort((a, b) => {
        const aPinned = pinnedModules.includes(a.id);
        const bPinned = pinnedModules.includes(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return b.priority - a.priority;
    });

    if (cartSelectedModules.length === 0) {
        listContainer.innerHTML = '<p class="empty-tip">暂无已选模组</p>';
        updateConfirmBtnStatus();
        return;
    }

    const baseBtnStyle = 'display: inline-flex; align-items: center; justify-content: center; height: 28px; border-radius: 4px; cursor: pointer; box-sizing: border-box; user-select: none; font-family: inherit;';
    const replaceBtnStyle = baseBtnStyle + ' padding: 0 12px; font-size: 13px; border: 1px solid #007bff; color: #007bff; background: #f0f7ff;';
    const iconBtnStyle = baseBtnStyle + ' width: 28px; font-size: 15px; border: 1px solid #ccc; color: #333; background: #fff;';
    const removeBtnStyle = baseBtnStyle + ' width: 28px; font-size: 16px; line-height: 1; border: 1px solid #dc3545; color: #dc3545; background: #fff3f3;';

    cartSelectedModules.forEach((item, index) => {
        const isOnboard = item.isOnboard;
        const isPinned = pinnedModules.includes(item.id);
        const hasModifiedCurrent = item.overrides?.current !== undefined && item.overrides.current !== moduleLibrary[item.id]?.peak_current_ma;
        
        const card = document.createElement('div');
        card.className = 'cart-right-item';
        card.style.cssText = 'display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box; margin-bottom: 10px; padding: 12px 15px; background: #fff; border: 1px solid #eee; border-radius: 8px;';
        
        if (item.failed) {
            card.classList.add('failed');
            card.style.borderColor = '#dc3545';
            card.style.background = '#fff8f8';
        }

        let circleClass = 'normal';
        if (isOnboard) circleClass = 'onboard';
        if (item.failed) circleClass = 'failed';

        // 板载设备如果可换型，提示去工作台换
        const btnReplaceHtml = isOnboard 
            ? `<div class="cart-action-btn" data-action="replace" data-id="${item.id}" style="${replaceBtnStyle}" title="请回到主工作台点击左侧卡片直接更换">换</div>`
            : `<div class="cart-action-btn" data-action="replace" data-id="${item.id}" style="${replaceBtnStyle}">更换</div>`;

        const btnIconHtml = `<div class="cart-action-btn" data-action="edit" data-id="${item.id}" title="微调参数" style="${iconBtnStyle}">⚙️</div>`;
        
        const btnRemoveHtml = isOnboard 
            ? `<span style="font-size: 12px; color: #888; margin-left: 6px; white-space: nowrap;">🔒 板载</span>` 
            : `<div class="cart-action-btn" data-action="remove" data-id="${item.id}" title="移除" style="${removeBtnStyle}">✕</div>`;

        const pinMark = isPinned ? '<span style="color: #ffc107; font-size: 14px; margin-right: 4px;" title="已置顶">⭐</span>' : '';

        card.innerHTML = `
            <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px;">
                <span class="cart-index-circle ${circleClass}" style="flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; color: white; background: ${isOnboard ? '#6c757d' : (item.failed ? '#dc3545' : '#007bff')};">${index + 1}</span>
                <div style="min-width: 0; flex: 1;">
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; color: #333; font-size: 14px; line-height: 1.2;" title="${item.name}">
                        ${pinMark}${item.name} 
                        ${item.failed ? '<span style="color:#dc3545; font-size:12px;">(引脚不足)</span>' : ''}
                    </div>
                    <div style="margin-top: 6px; display: flex; gap: 5px;">
                        <span style="background: #e9ecef; color: #6c757d; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: bold;">优先级 ${item.priority}</span>
                        ${hasModifiedCurrent ? `<span style="font-size: 11px; color: #dc3545; font-weight: bold;">(已改功耗)</span>` : ''}
                    </div>
                </div>
            </div>
            <div style="flex-shrink: 0; display: flex; align-items: center; gap: 6px; margin-left: 10px;">
                ${btnReplaceHtml}
                ${btnIconHtml}
                ${btnRemoveHtml}
            </div>
        `;
        
        listContainer.appendChild(card);
    });

    updateConfirmBtnStatus();
}

function updateConfirmBtnStatus() {
    const btn = document.querySelector('#cart-modal button[data-act="confirmCartAndAllocate"]');
    if (!btn) return;
    
    const hasFailed = cartSelectedModules.some(m => m.failed);
    
    if (cartSelectedModules.length === 0) {
        btn.disabled = true;
        btn.innerText = '购物车为空';
    } else if (hasFailed) {
        btn.disabled = false;
        btn.style.background = '#ffc107';
        btn.style.color = '#333';
        btn.innerText = '⚠️ 存在冲突，点击重试分配';
    } else {
        btn.disabled = false;
        btn.style.background = '#28a745';
        btn.style.color = 'white';
        btn.innerText = '⚡ 确认并智能分配';
    }
}

function removeFromCart(id) {
    const item = cartSelectedModules.find(m => m.id === id);
    if (item && item.isOnboard) {
        uiAlert({
            title: '板载设备不可移除',
            body: '这个设备是焊接在开发板上的，不能从购物车里删掉。\n如需更换型号，请回到工作台左侧卡片点「🔄 换」。',
            icon: '🔒'
        });
        return;
    }

    cartSelectedModules = cartSelectedModules.filter(m => m.id !== id);
    cartSelectedModules.forEach(m => m.failed = false);

    renderCartLeftList();
    renderCartRightList();
}

async function clearCart() {
    const ok = await uiConfirm({
        title: '清空购物车？',
        body: '已选的模组会被全部移除，板载固定设备会保留。',
        confirmText: '清空',
        danger: true
    });
    if (!ok) return;
    cartSelectedModules = cartSelectedModules.filter(m => m.isOnboard);
    cartSelectedModules.forEach(m => m.failed = false);
    renderCartLeftList();
    renderCartRightList();
}

// ==========================================
// 更换模组逻辑 (购物车内的非板载设备)
// ==========================================
function openReplaceModal(modId) {
    currentReplaceId = modId;
    const oldMod = cartSelectedModules.find(m => m.id === modId);
    if (!oldMod) {
        uiToast('找不到该模组，可能已被移除', { type: 'warn' });
        return;
    }

    // 🔥 核心拦截：如果发现是板载设备，直接提示去工作台换
    if (oldMod.isOnboard) {
        uiAlert({ title: '请到工作台更换板载设备', body: '为了不丢失已解析的外设，板载设备（如摄像头）请直接在左侧工作台的模组卡片上点「🔄 换」。', icon: '🔒' });
        return;
    }
    
    const oldModData = moduleLibrary[modId];
    let candidateIds = [];

    if (oldModData && oldModData.category) {
        candidateIds = Object.entries(moduleLibrary)
            .filter(([key, data]) => data.category === oldModData.category && key !== modId)
            .map(([key]) => key);
    }

    const inCartIds = cartSelectedModules.map(m => m.id);
    candidateIds = candidateIds.filter(cid => !inCartIds.includes(cid));

    if (candidateIds.length === 0) {
        uiToast('该分类下没有其他可选模组了（可能都已在购物车里）', { type: 'info' });
        return;
    }

    document.getElementById('replace-old-name').innerText = oldMod.name;

    const select = document.getElementById('replace-select');
    select.innerHTML = '';
    candidateIds.forEach(cid => {
        const data = moduleLibrary[cid];
        if (!data) return;
        const option = document.createElement('option');
        option.value = cid;
        option.textContent = data.name;
        select.appendChild(option);
    });

    const replaceModal = document.getElementById('replace-modal');
    if (replaceModal) {
        // 修改确认按钮的 onclick 指向购物车的替换逻辑
        const confirmBtn = replaceModal.querySelector('.btn-primary');
        confirmBtn.setAttribute('onclick', 'executeReplace()');

        replaceModal.style.display = 'flex';
        replaceModal.style.zIndex = '9999999'; 
    }
}

// 🔥 购物车内的替换逻辑 (只针对普通外设)
function executeReplace() {
    if (!currentReplaceId) return;

    const newId = document.getElementById('replace-select').value;
    if (!newId) return;

    const newModData = moduleLibrary[newId];
    if (!newModData) {
        closeReplaceModal();
        uiToast('目标模组不存在', { type: 'error' });
        return;
    }

    const oldItem = cartSelectedModules.find(m => m.id === currentReplaceId);
    if (!oldItem) {
        closeReplaceModal();
        return;
    }

    const index = cartSelectedModules.findIndex(m => m.id === currentReplaceId);
    cartSelectedModules[index] = {
        id: newId,
        name: newModData.name, 
        priority: newModData.priority || 50,
        overrides: {}, 
        isOnboard: false,
        failed: false
    };

    cartSelectedModules.forEach(m => m.failed = false);
    closeReplaceModal();
    renderCartLeftList();
    renderCartRightList();
}


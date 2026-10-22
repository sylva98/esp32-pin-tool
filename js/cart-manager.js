// ==========================================
// 购物车与模组选择管理 (全量版)
// ==========================================

let cartSelectedModules = []; // 购物车暂存数据
let cartCategory = 'ALL'; // 购物车当前分类
let currentCartEditId = null; // 当前正在微调的购物车模组ID

// 1. 打开/关闭弹窗
function openCartModal() {
    document.getElementById('cart-modal').style.display = 'flex';
    document.getElementById('cart-search').value = '';
    cartCategory = 'ALL';
    renderCartTabs();
    renderCartLeftList();
    renderCartRightList();
}

function closeCartModal() {
    document.getElementById('cart-modal').style.display = 'none';
}

// 2. 渲染左侧分类标签
function renderCartTabs() {
    const tabsContainer = document.getElementById('cart-tabs');
    const categories = new Set();
    Object.values(moduleLibrary).forEach(mod => { if (mod.category) categories.add(mod.category); });
    
    let tabHtml = `<div class="custom-tab ${cartCategory === 'ALL' ? 'active' : ''}" onclick="switchCartCategory('ALL')" style="padding: 6px 12px; border: 1px solid ${cartCategory === 'ALL' ? '#007bff' : '#ddd'}; border-radius: 20px; color: ${cartCategory === 'ALL' ? '#007bff' : '#666'}; cursor: pointer;">全部</div>`;
    
    categories.forEach(cat => {
        const isActive = cartCategory === cat;
        tabHtml += `<div class="custom-tab ${isActive ? 'active' : ''}" onclick="switchCartCategory('${cat}')" style="padding: 6px 12px; border: 1px solid ${isActive ? '#007bff' : '#ddd'}; border-radius: 20px; color: ${isActive ? '#007bff' : '#666'}; cursor: pointer;">${cat}</div>`;
    });
    tabsContainer.innerHTML = tabHtml;
}

function switchCartCategory(cat) {
    cartCategory = cat;
    renderCartTabs();
    renderCartLeftList();
}

// 3. 渲染左侧模组库 (根据分类和搜索过滤)
function renderCartLeftList() {
    const listContainer = document.getElementById('cart-left-list');
    listContainer.innerHTML = '';
    const search = document.getElementById('cart-search').value.toLowerCase();

    for (const [key, data] of Object.entries(moduleLibrary)) {
        const matchCat = (cartCategory === 'ALL' || data.category === cartCategory);
        const matchSearch = (data.name.toLowerCase().includes(search));
        
        if (matchCat && matchSearch) {
            // 如果已经在购物车里，就不在左侧显示
            const isSelected = cartSelectedModules.some(m => m.id === key);
            if (isSelected) continue; 

            const div = document.createElement('div');
            div.className = 'cart-left-item';
            div.innerHTML = `
                <span style="font-size:13px; font-weight:bold;">${data.name}</span>
                <span style="color:#28a745; font-size:18px; font-weight:bold;">+</span>
            `;
            div.onclick = () => {
                // 加入购物车，并初始化一个空的 overrides 对象用于存自定义参数
                cartSelectedModules.push({ 
                    id: key, 
                    name: data.name, 
                    priority: data.priority || 50, 
                    overrides: {} 
                });
                renderCartLeftList();
                renderCartRightList();
            };
            listContainer.appendChild(div);
        }
    }
}

// 4. 渲染右侧购物车清单 (按优先级排序)
function renderCartRightList() {
    const listContainer = document.getElementById('cart-right-list');
    listContainer.innerHTML = '';

    // 🔥 核心：根据模组预设的 priority 分数从大到小排序
    cartSelectedModules.sort((a, b) => b.priority - a.priority);

    if (cartSelectedModules.length === 0) {
        listContainer.innerHTML = '<p style="color:#888; font-size:12px; text-align:center; margin-top:20px;">暂无已选模组</p>';
        return;
    }

    cartSelectedModules.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'cart-right-item';
        
        // 判断是否修改过电流参数
        const hasModifiedCurrent = item.overrides?.current !== undefined && item.overrides.current !== moduleLibrary[item.id].peak_current_ma;

        div.innerHTML = `
            <div class="item-info">
                <span style="background:#007bff; color:white; border-radius:50%; width:24px; height:24px; display:flex; justify-content:center; align-items:center; font-size:12px; font-weight:bold;">${index + 1}</span>
                <div>
                    <div style="font-weight:bold; font-size:14px; margin-bottom:4px;">${item.name}</div>
                    <span class="priority-badge">优先级 ${item.priority}</span>
                    ${hasModifiedCurrent ? `<span style="font-size:11px; color:#dc3545; margin-left:5px; font-weight:bold;">(已改功耗)</span>` : ''}
                </div>
            </div>
            <div class="item-actions">
                <button class="btn-icon" title="微调参数" onclick="openCartEditPanel('${item.id}')">⚙️</button>
                <button class="btn-icon" title="移除" onclick="removeFromCart('${item.id}')">❌</button>
            </div>
        `;
        listContainer.appendChild(div);
    });
}

// 5. 移出购物车 / 清空购物车
function removeFromCart(id) {
    cartSelectedModules = cartSelectedModules.filter(m => m.id !== id);
    renderCartLeftList();
    renderCartRightList();
}

function clearCart() {
    if(confirm('确定清空已选模组吗？')) {
        cartSelectedModules = [];
        renderCartLeftList();
        renderCartRightList();
    }
}

// ==========================================
// 6. 购物车专属：微调面板逻辑
// ==========================================
function openCartEditPanel(modId) {
    currentCartEditId = modId;
    const cartItem = cartSelectedModules.find(m => m.id === modId);
    const modData = moduleLibrary[modId];

    // 1. 填充电流 (优先使用购物车里的覆盖值，否则用默认值)
    const currentVal = cartItem.overrides?.current !== undefined ? cartItem.overrides.current : (modData.peak_current_ma || 0);
    document.getElementById('edit-current').value = currentVal;
    document.getElementById('edit-current').placeholder = `默认: ${modData.peak_current_ma || 0} mA`;

    // 2. 功耗风险提示
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

    // 3. 数据线数量裁剪 (暂时隐藏，因为还没实际分配引脚，暂不支持在购物车阶段裁剪，避免逻辑冲突)
    document.getElementById('pin-count-container').style.display = 'none';

    // 4. 移除单线重排功能 (因为还没分配引脚)
    const pinListContainer = document.getElementById('edit-pin-list');
    pinListContainer.innerHTML = '<p style="color:#888; font-size:12px; text-align:center; padding:10px;">引脚尚未分配，请先确认分配后再进行单独重排。</p>';

    // 5. 修改“保存”按钮的绑定事件，让它存进购物车
    const saveBtn = document.querySelector('#edit-modal button[onclick="saveModuleParams()"]');
    if(saveBtn) {
        saveBtn.setAttribute('onclick', 'saveCartModuleParams()');
    }

    document.getElementById('edit-modal').style.display = 'flex';
}

// 专门用于保存购物车参数的函数
function saveCartModuleParams() {
    const newCurrent = Number(document.getElementById('edit-current').value);
    const cartItem = cartSelectedModules.find(m => m.id === currentCartEditId);
    
    if (cartItem) {
        cartItem.overrides = cartItem.overrides || {};
        cartItem.overrides.current = newCurrent;
    }

    // 重新渲染右侧列表以更新“已改功耗”的标记
    renderCartRightList();
    
    // 关闭弹窗
    closeEditPanel(); 
    
    // 恢复原来主界面的保存按钮事件（防止冲突）
    const saveBtn = document.querySelector('#edit-modal button[onclick="saveCartModuleParams()"]');
    if(saveBtn) {
        saveBtn.setAttribute('onclick', 'saveModuleParams()');
    }
}
// ==========================================
// 购物车与模组选择管理
// ==========================================

let cartSelectedModules = []; // 购物车暂存数据

function openCartModal() {
    document.getElementById('cart-modal').style.display = 'flex';
    document.getElementById('cart-search').value = '';
    renderCartLeftList();
    renderCartRightList();
}

function closeCartModal() {
    document.getElementById('cart-modal').style.display = 'none';
}

function renderCartLeftList() {
    const listContainer = document.getElementById('cart-left-list');
    listContainer.innerHTML = '';
    const search = document.getElementById('cart-search').value.toLowerCase();

    for (const [key, data] of Object.entries(moduleLibrary)) {
        if (data.name.toLowerCase().includes(search)) {
            // 如果已经在购物车里，就不在左边显示
            const isSelected = cartSelectedModules.some(m => m.id === key);
            if (isSelected) continue;

            const div = document.createElement('div');
            div.className = 'cart-item';
            div.style.cursor = 'pointer';
            div.innerHTML = `
                <span style="font-size:13px;">${data.name}</span>
                <span style="color:#28a745; font-weight:bold;">+</span>
            `;
            div.onclick = () => {
                cartSelectedModules.push({ id: key, name: data.name, priority: data.priority || 50 });
                renderCartLeftList();
                renderCartRightList();
            };
            listContainer.appendChild(div);
        }
    }
}

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
        div.className = 'cart-item';
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="background:#007bff; color:white; border-radius:50%; width:20px; height:20px; display:flex; justify-content:center; align-items:center; font-size:12px;">${index + 1}</span>
                <span style="font-weight:bold;">${item.name}</span>
                <span style="font-size:10px; color:#888;">(优先级: ${item.priority})</span>
            </div>
            <button style="background:none; border:none; color:#dc3545; cursor:pointer; font-size:16px;" onclick="removeFromCart('${item.id}')">❌</button>
        `;
        listContainer.appendChild(div);
    });
}

function removeFromCart(id) {
    cartSelectedModules = cartSelectedModules.filter(m => m.id !== id);
    renderCartLeftList();
    renderCartRightList();
}

function clearCart() {
    cartSelectedModules = [];
    renderCartLeftList();
    renderCartRightList();
}
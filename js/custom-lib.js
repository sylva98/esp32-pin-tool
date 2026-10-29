// ==========================================
// 极简硬件管理器 (custom-lib.js)
// 功能：合并本地自定义数据，提供主控/模组的 JSON 增删改查及置顶排序
// ==========================================

(function initCustomLib() {
    // 1. 记录系统自带的数据 ID 集合
    window.nativeBoardIds = new Set(Object.keys(window.globalBoards || {}));
    window.nativeModuleIds = new Set(Object.keys(window.globalModuleData || {}));

    // 2. 从本地读取自定义数据并合并
    //    ⚠️ 内置数据优先：自定义条目若与内置 ID 重名，一律忽略。
    //    历史版本允许「编辑内置主板 → 保存」，这会把内置板冻结成一份旧快照写进 localStorage，
    //    之后 data/boards.js 再怎么更新都不会生效（画布显示的还是旧引脚）。这里记录被忽略项并提示清理。
    window.shadowedCustomIds = [];
    try {
        const customBoards = JSON.parse(localStorage.getItem('esp_custom_boards') || '{}');
        const customModules = JSON.parse(localStorage.getItem('esp_custom_modules') || '{}');

        const mergeCustom = (store, target, natives, type) => {
            Object.keys(store).forEach(id => {
                if (natives.has(id)) {
                    window.shadowedCustomIds.push({ type, id });
                    return;
                }
                target[id] = store[id];
            });
        };
        mergeCustom(customBoards, window.globalBoards, window.nativeBoardIds, 'boards');
        mergeCustom(customModules, window.globalModuleData, window.nativeModuleIds, 'modules');

        if (window.shadowedCustomIds.length) {
            console.warn('[Hardware Manager] 以下本地自定义数据与内置硬件重名，已忽略（内置优先）：',
                window.shadowedCustomIds.map(x => x.id).join('、'));
        }
    } catch (e) {
        console.error("[Hardware Manager] 加载本地硬件数据失败:", e);
    }

    // 清理与内置重名的历史脏数据（供提示条按钮调用）
    window.purgeShadowedCustom = function () {
        const stores = [
            { key: 'esp_custom_boards', natives: window.nativeBoardIds },
            { key: 'esp_custom_modules', natives: window.nativeModuleIds }
        ];
        stores.forEach(({ key, natives }) => {
            let data = {};
            try { data = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return; }
            let changed = false;
            Object.keys(data).forEach(id => {
                if (natives.has(id)) { delete data[id]; changed = true; }
            });
            if (!changed) return;
            if (Object.keys(data).length) localStorage.setItem(key, JSON.stringify(data));
            else localStorage.removeItem(key);
        });
        location.reload();
    };

    function renderShadowedBanner() {
        if (!window.shadowedCustomIds || !window.shadowedCustomIds.length) return;
        const names = window.shadowedCustomIds.map(x => x.id).join('、');
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:99999; background:#fff3cd; color:#664d03; border:1px solid #ffe69c; border-radius:10px; padding:10px 14px; font-size:13px; line-height:1.5; display:flex; gap:12px; align-items:center; box-shadow:0 8px 24px rgba(0,0,0,.18); width:min(680px, calc(100vw - 32px)); box-sizing:border-box;';
        box.innerHTML = `<span style="flex:1 1 auto; min-width:0;">⚠️ 本地存有与内置硬件同名的旧数据（${names}），已按内置版本显示，否则旧快照会一直覆盖内置引脚。</span>
            <button data-act="purgeShadowedCustom" style="flex:0 0 auto; width:auto; white-space:nowrap; background:#ffc107; border:0; border-radius:6px; padding:6px 10px; font-weight:bold; cursor:pointer; font-size:13px;">清理旧数据</button>
            <button data-act="removeCurrentRow" data-pass-el title="关闭" style="flex:0 0 auto; width:auto; background:transparent; border:0; color:#664d03; cursor:pointer; font-size:18px; line-height:1; padding:0 4px;">×</button>`;
        document.body.appendChild(box);
    }

    // 3. 注入 UI 和管理弹窗
    window.addEventListener('DOMContentLoaded', () => {
        const boardSelect = document.getElementById('board-select');
        if (boardSelect) {
            const container = boardSelect.closest('div[style*="margin-bottom"]');
            if (container) {
                const label = container.querySelector('label');
                if (label) {
                    label.style.display = 'flex';
                    label.style.justifyContent = 'space-between';
                    label.style.alignItems = 'center';
                    label.innerHTML = '<span>当前主控型号：</span>';

                    const gearBtn = document.createElement('span');
                    gearBtn.innerHTML = '⚙️';
                    gearBtn.title = '主控 / 模组管理';
                    gearBtn.style.cssText = `font-size: 16px; cursor: pointer; transition: transform 0.3s ease; user-select: none; margin-right: 2px;`;
                    
                    gearBtn.onmouseenter = () => { gearBtn.style.transform = 'scale(1.15) rotate(45deg)'; };
                    gearBtn.onmouseleave = () => { gearBtn.style.transform = 'scale(1) rotate(0deg)'; };
                    gearBtn.onclick = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        openHardwareManager();
                    };
                    label.appendChild(gearBtn);
                }
            }
        }

        const btnBaseStyle = 'height: 28px; line-height: 26px; padding: 0 12px; font-size: 12px; border-radius: 4px; cursor: pointer; outline: none; box-sizing: border-box; width: auto; margin: 0; display: inline-flex; align-items: center; justify-content: center; font-weight: bold;';
        const btnEditStyle = btnBaseStyle + ' border: 1px solid #007bff; background: #f0f7ff; color: #007bff;';
        const btnDeleteStyle = btnBaseStyle + ' border: 1px solid #dc3545; background: #fff3f3; color: #dc3545;';
        const btnDisabledStyle = btnBaseStyle + ' border: 1px solid #ddd; background: #f8f9fa; color: #aaa; cursor: not-allowed;';
        const btnPinActiveStyle = btnBaseStyle + ' border: 1px solid #ffc107; background: #fff3cd; color: #d39e00; padding: 0 8px;';
        const btnPinInactiveStyle = btnBaseStyle + ' border: 1px solid #ccc; background: #fff; color: #888; padding: 0 8px;';

        const modalsHtml = `
            <div id="hardware-manager-modal" class="modal-overlay" style="z-index: 10000;">
                <div class="modal-content" style="width: 800px; height: 75vh; padding: 20px; display: flex; flex-direction: column;">
                    <button class="modal-close-btn" data-act="closeHardwareManager">×</button>
                    
                    <h2 class="modal-title" style="margin: 0 0 15px 0; font-size: 18px;">⚙️ 硬件库管理</h2>

                    <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid #ddd; margin-bottom: 15px;">
                        <div style="display: flex;">
                            <div id="tab-boards" data-act="switchManagerTab" data-arg="boards" style="padding: 10px 25px; cursor: pointer; font-size: 14px; font-weight: bold; border-bottom: 3px solid #007bff; color: #007bff; margin-bottom: -1px; transition: all 0.2s;">主控板</div>
                            <div id="tab-modules" data-act="switchManagerTab" data-arg="modules" style="padding: 10px 25px; cursor: pointer; font-size: 14px; font-weight: bold; border-bottom: 3px solid transparent; color: #666; margin-bottom: -1px; transition: all 0.2s;">模组库</div>
                        </div>
                        
                        <div style="display: flex; gap: 10px; padding-bottom: 8px; margin-right: 35px;">
                            <button id="btn-copy-prompt" class="btn-info" data-act="copyPromptTemplate" style="width: auto; margin: 0; padding: 6px 15px; font-size: 13px; border-radius: 4px; height: 30px; display: inline-flex; align-items: center; justify-content: center;">📋 AI生成主板提示词</button>
                            <button id="btn-add-hardware" class="btn-success" data-act="showJsonEditor" data-arg="new" style="width: auto; margin: 0; padding: 6px 15px; font-size: 13px; border-radius: 4px; height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;"><span style="font-size: 16px; line-height: 1;">+</span> 新增主板</button>
                        </div>
                    </div>

                    <div id="manager-list-container" style="flex: 1; overflow-y: auto; border: 1px solid #eee; border-radius: 6px; background: #fafafa;"></div>
                </div>
            </div>

            <div id="json-editor-modal" class="modal-overlay" style="z-index: 10001; display: none;">
                <div class="modal-content" style="width: 600px; height: 60vh; padding: 20px; display: flex; flex-direction: column;">
                    <h3 style="margin-top: 0; font-size: 16px; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">📝 编辑 JSON 数据</h3>
                    <p style="font-size: 12px; color: #666; margin-bottom: 10px;">请确保输入的是合法的 JSON 格式（包含大括号）。</p>
                    <textarea id="json-editor-textarea" style="flex: 1; width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; font-size: 13px; resize: none; outline: none; margin-bottom: 15px;" spellcheck="false"></textarea>
                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button data-act="closeJsonEditor" style="height: 32px; padding: 0 20px; background: #f8f9fa; color: #333; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; width: auto; margin: 0; font-size: 14px;">取消</button>
                        <button data-act="saveHardwareJson" class="btn-primary" style="height: 32px; padding: 0 20px; border-radius: 4px; cursor: pointer; width: auto; margin: 0; font-size: 14px;">保存并应用</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalsHtml);
        
        window._managerBtnStyles = { btnEditStyle, btnDeleteStyle, btnDisabledStyle, btnPinActiveStyle, btnPinInactiveStyle };

        // 提示「内置数据被本地旧快照遮蔽」，并提供一键清理
        renderShadowedBanner();
    });
})();

// ==========================================
// 全局状态
// ==========================================
let currentManagerTab = 'boards'; 
let editingHardwareId = null;     
let editingType = 'boards';

function openHardwareManager() {
    document.getElementById('hardware-manager-modal').style.display = 'flex';
    switchManagerTab('boards'); 
}

function closeHardwareManager() {
    document.getElementById('hardware-manager-modal').style.display = 'none';
}

function switchManagerTab(tab) {
    currentManagerTab = tab;
    const tabBoards = document.getElementById('tab-boards');
    const tabModules = document.getElementById('tab-modules');
    const btnCopy = document.getElementById('btn-copy-prompt');
    const btnAdd = document.getElementById('btn-add-hardware');
    
    if (tab === 'boards') {
        tabBoards.style.borderBottomColor = '#007bff'; tabBoards.style.color = '#007bff';
        tabModules.style.borderBottomColor = 'transparent'; tabModules.style.color = '#666';
        if(btnCopy) btnCopy.innerHTML = '📋 AI生成主板提示词';
        if(btnAdd) btnAdd.innerHTML = '<span style="font-size: 16px; line-height: 1;">+</span> 新增主板';
    } else {
        tabModules.style.borderBottomColor = '#007bff'; tabModules.style.color = '#007bff';
        tabBoards.style.borderBottomColor = 'transparent'; tabBoards.style.color = '#666';
        if(btnCopy) btnCopy.innerHTML = '📋 AI生成模组提示词';
        if(btnAdd) btnAdd.innerHTML = '<span style="font-size: 16px; line-height: 1;">+</span> 新增模组';
    }
    renderManagerList();
}

function togglePin(id) {
    const isBoards = currentManagerTab === 'boards';
    const pinnedKey = isBoards ? 'esp_pinned_boards' : 'esp_pinned_modules';
    let pinnedIds = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
    
    if (pinnedIds.includes(id)) {
        pinnedIds = pinnedIds.filter(pid => pid !== id);
    } else {
        pinnedIds.push(id);
    }
    localStorage.setItem(pinnedKey, JSON.stringify(pinnedIds));
    renderManagerList(); 
}

function renderManagerList() {
    const container = document.getElementById('manager-list-container');
    const isBoards = currentManagerTab === 'boards';
    const data = isBoards ? window.globalBoards : window.globalModuleData;
    const nativeIds = isBoards ? window.nativeBoardIds : window.nativeModuleIds;
    
    const styles = window._managerBtnStyles || {};
    const pinnedKey = isBoards ? 'esp_pinned_boards' : 'esp_pinned_modules';
    const pinnedIds = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
    
    const keys = Object.keys(data).sort((a, b) => {
        const aPinned = pinnedIds.includes(a);
        const bPinned = pinnedIds.includes(b);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return a.localeCompare(b);
    });
    
    let html = '';
    keys.forEach(key => {
        const item = data[key];
        const isNative = nativeIds.has(key);
        const isPinned = pinnedIds.includes(key);
        const displayName = isBoards ? item.boardName : item.name;
        
        const pinBtnStyle = isPinned ? styles.btnPinActiveStyle : styles.btnPinInactiveStyle;
        const pinBtnText = isPinned ? '⭐ 已置顶' : '☆ 设为常用';
        
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #eee; background: ${isPinned ? '#fffdf5' : 'white'};">
                <div>
                    <div style="font-weight: bold; font-size: 14px; color: #333;">
                        ${displayName} 
                        ${isNative 
                            ? '<span style="font-size: 11px; background: #e9ecef; color: #888; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">系统内置</span>' 
                            : '<span style="font-size: 11px; background: #d4edda; color: #155724; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">自定义</span>'}
                    </div>
                    <div style="font-size: 12px; color: #888; font-family: monospace; margin-top: 4px;">ID: ${key}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button data-act="togglePin" data-arg="${key}" style="${pinBtnStyle}" title="${isPinned ? '取消常用' : '设为常用(置顶)'}">
                        ${pinBtnText}
                    </button>
                    <button data-act="showJsonEditor" data-arg="${key}" style="${styles.btnEditStyle}">编辑</button>
                    ${isNative 
                        ? `<button disabled style="${styles.btnDisabledStyle}">禁删</button>` 
                        : `<button data-act="deleteHardware" data-arg="${key}" style="${styles.btnDeleteStyle}">删除</button>`}
                </div>
            </div>
        `;
    });
    
    if (keys.length === 0) {
        html = '<div style="text-align: center; padding: 40px; color: #999;">暂无数据，点击右上角“新增”。</div>';
    }
    container.innerHTML = html;
}

function showJsonEditor(id) {
    editingHardwareId = (id === 'new') ? null : id;
    editingType = currentManagerTab;
    
    const textarea = document.getElementById('json-editor-textarea');
    document.getElementById('json-editor-modal').style.display = 'flex';
    
    if (editingHardwareId) {
        const data = editingType === 'boards' ? window.globalBoards[editingHardwareId] : window.globalModuleData[editingHardwareId];
        textarea.value = JSON.stringify({ [editingHardwareId]: data }, null, 2);
        textarea.readOnly = true; 
        textarea.style.background = '#f8f9fa';
    } else {
        const template = editingType === 'boards' 
            ? { "new_board_id": { "boardName": "新主板", "safe_voltage": 3.3, "max_current_ma": 500, "max_pin": 48, "fixedPins": [], "availableGpios": [], "strappingPins": {}, "special_domains": {}, "adcPins": {}, "busPins": {}, "defaultInterfaces": {}, "onboard_devices": [], "onboard_slots": [] } }
            : { "new_module_id": { "name": "新模组名称", "category": "传感器类", "interface": "GPIO", "signal_voltage": 3.3, "peak_current_ma": 10, "priority": 50, "requirements": [], "power_pins": [] } };
        textarea.value = JSON.stringify(template, null, 2);
        textarea.readOnly = false;
        textarea.style.background = '#fff';
    }
}

function closeJsonEditor() {
    document.getElementById('json-editor-modal').style.display = 'none';
    editingHardwareId = null;
}

function saveHardwareJson() {
    const text = document.getElementById('json-editor-textarea').value.trim();
    if (!text) { uiToast('内容不能为空', { type: 'warn' }); return; }

    try {
        const parsedData = JSON.parse(text);
        const keys = Object.keys(parsedData);
        
        if (keys.length !== 1) {
            uiAlert({ title: '一次只能保存一个硬件', body: '最外层只能有一对大括号，例如：\n{\n  "my_id": { ... }\n}', icon: '📦' });
            return;
        }

        const newId = keys[0];
        const newData = parsedData[newId];

        // 内置硬件一律不允许写成本地快照：
        // 以前只拦「新增」，编辑内置板时保存会把内置数据整份复制进 localStorage，从此永久遮蔽内置数据，
        // 导致 data/boards.js 后续的任何修正都看不到效果。
        const nativeIds = editingType === 'boards' ? window.nativeBoardIds : window.nativeModuleIds;
        if (nativeIds.has(newId)) {
            if (editingHardwareId) {
                uiAlert({
                    title: '内置硬件不可改写',
                    body: `「${newId}」是系统内置硬件，不能存成本地快照。

内置数据要跟随程序更新；一旦存成本地副本，程序里修好的引脚配置就再也进不来了。

如需自定义，请点「新增」，并把 ID 换成别的名字（例如 ${newId}-custom）。`,
                    danger: true
                });
                return;
            }
            uiAlert({ title: '内部 ID 冲突', body: `ID「${newId}」已被系统内置硬件占用，请换一个名称（例如 ${newId}-custom）。`, danger: true });
            return;
        }

        const storageKey = editingType === 'boards' ? 'esp_custom_boards' : 'esp_custom_modules';
        const customData = JSON.parse(localStorage.getItem(storageKey) || '{}');
        
        customData[newId] = newData;
        localStorage.setItem(storageKey, JSON.stringify(customData));

        uiToast('保存成功，即将刷新页面应用更改', { type: 'success', duration: 1200 });
        location.reload();

    } catch (e) {
        uiAlert({ title: 'JSON 格式错误', body: `${e.message}

请检查括号、引号是否闭合。`, danger: true });
    }
}

async function deleteHardware(id) {
    if (!await uiConfirm({ title: '删除自定义硬件？', body: `「${id}」将从本地库中移除，已接入的模组不会自动重算引脚。`, confirmText: '删除', danger: true })) return;
    
    const storageKey = currentManagerTab === 'boards' ? 'esp_custom_boards' : 'esp_custom_modules';
    const customData = JSON.parse(localStorage.getItem(storageKey) || '{}');
    
    delete customData[id];
    localStorage.setItem(storageKey, JSON.stringify(customData));
    
    uiToast('已删除，即将刷新页面', { type: 'success', duration: 1200 });
    location.reload();
}

// ==========================================
// AI 提示词模板 (终极强化版，明确区分主板与模组规则)
// ==========================================
function copyPromptTemplate() {
    let prompt = "";
    
    if (currentManagerTab === 'boards') {
        prompt = `你现在是一个资深的 ESP32 硬件工程师。请帮我写一份 ESP32 主控开发板的 JSON 配置文件，用于我的智能硬件配置系统。
必须严格遵循以下要求：
1. 不要输出任何 Markdown 标记（不要用 \`\`\`json ），不要有任何解释，直接输出合法的纯 JSON 对象。
2. 最外层的大括号键名（即 board_unique_id），请尽量使用该开发板在市面上的通用标准名，允许使用连字符（如 "ESP32-S3-CAM"）。
3. 逻辑严谨：如果该主板有板载设备（如摄像头、SD卡），你必须从 "availableGpios" 中减去它们占用的引脚，并在 "onboard_slots" 中详细标出这些锁定引脚 (lockedPins)。

【字段说明】
- boardName: 开发板全称。
- fixedPins: 系统固定占用或完全不可用的引脚号数组（如 Strapping 脚、USB 脚、PSRAM 占用脚）。
- availableGpios: 物理排针上真正可供用户接线的引脚号数组。
- strappingPins: 启动敏感引脚对象，如 {"0": {"required_level": "HIGH", "reason": "启动模式"}}。
- special_domains: 特殊电压域，如 {"47": "1.8V"}。
- defaultInterfaces: 推荐的总线引脚，如 {"I2C": {"SDA": 8, "SCL": 9}}。
- onboard_slots: 板载设备插槽，结构如 [{"slotId": "cam", "label": "摄像头", "moduleId": "ov5640", "lockedPins": {"SDA": 4, "SCL": 5, "D0-D7": [11,9,8,10,12,18,17,16]}}]。

【JSON 骨架】
{
  "ESP32-S3-CAM": {
    "boardName": "ESP32-S3 CAM 开发板",
    "safe_voltage": 3.3,
    "power_rails": { "5V": true, "3.3V": true },
    "max_current_ma": 500,
    "max_pin": 48,
    "fixedPins": [0, 3, 19, 20, 45, 46],
    "strappingPins": { "0": { "required_level": "HIGH", "reason": "启动选择" } },
    "special_domains": {},
    "availableGpios": [1, 2, 14, 21, 38, 39, 40, 41, 42, 43, 44],
    "adcPins": { "1": "ADC1_CH0" },
    "busPins": { "uart0": { "TX": 43, "RX": 44 } },
    "defaultInterfaces": { "I2C": { "SDA": 42, "SCL": 41 } },
    "onboard_devices": [],
    "onboard_slots": []
  }
}
请根据我提供的开发板型号生成。如果你无法确定该开发板的特殊排针引出，请在 availableGpios 里保留常规 GPIO 并提示我手动核对。`;
    } else {
        prompt = `你现在是一个资深的 ESP32 硬件工程师。请帮我写一份硬件模组的 JSON 配置文件，用于我的智能硬件配置系统。
必须严格遵循以下要求：
1. 不要输出任何 Markdown 标记（不要用 \`\`\`json ），不要有任何解释，直接输出合法的纯 JSON 对象。
2. 最外层的大括号键名（即 module_unique_id），必须使用全小写英文和下划线，例如 "vl53l0x_sensor"。
3. 严格按照物理引脚定义，不要凭空捏造协议引脚。

【字段说明】
- category: 必选其一 ["显示类", "传感器类", "音频类", "通信类", "执行器类", "视觉类"]。
- interface: 必选其一 ["GPIO", "I2C", "SPI", "UART", "ADC", "PWM", "DVP", "I2S_IN", "I2S_OUT", "INTERNAL"]。
- peak_current_ma: 预估峰值电流（整数）。大电流设备请准确填写。
- priority: 分配优先级（0-100整数），冲突时优先级高的先分配。
- requirements 中的 signal 命名规范：
  - I2C 接口: 必须是 "SDA", "SCL"。
  - SPI 接口: 必须是 "MOSI", "MISO", "SCK", "CS"。
  - UART 接口: 必须是 "TX", "RX"。
  - I2S 接口: 必须是 "BCLK", "LRC", "DIN" 或 "SD"。
  - 模拟量输入: 必须是 "AOUT"。
  - 单根普通数据线: 必须是 "DATA"。
  - 执行器控制线: 必须是 "PWM" 或 "IN"。
  - 多位数据线 (如 DVP摄像头): 使用 "D0-D7" 作为 signal，并将 count 设为 8。
- power_pins 中的 connect_to: 必选其一 ["3.3V", "5V", "GND"]。

【JSON 骨架】
{
  "vl53l0x": {
    "name": "VL53L0X 激光测距传感器",
    "category": "传感器类",
    "interface": "I2C",
    "signal_voltage": 3.3,
    "peak_current_ma": 20,
    "priority": 50,
    "requirements": [
      { "signal": "SDA", "count": 1, "optional": false },
      { "signal": "SCL", "count": 1, "optional": false }
    ],
    "power_pins": [
      { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
      { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
    ]
  }
}
请根据我提供的模组型号生成。`;
    }

    navigator.clipboard.writeText(prompt).then(() => {
        uiAlert({ title: '提示词已复制', body: '直接发给 AI，并在末尾补上你买的具体型号即可。', icon: '📋' });
    }).catch(err => {
uiToast('复制失败，请手动复制', { type: 'error' });
    });
}
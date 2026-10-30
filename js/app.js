// ==========================================
// 全局状态管理
// ==========================================
let boardConfig = null;

/* 板名显示：物理板名 + 对应固件板型 id。
   只写「ESP32-S3-WROOM-1 N16R8」时，拿这个名字去 GitHub 搜不到任何东西 ——
   那是乐鑫的模组型号，不是虾哥的板型名。两边的名字都要出现：
   下拉框用物理板名（短、不会被截断），板型 id 放在它下面单独一行，见 renderBoardFwHint */
function boardDisplayName(board) {
    if (!board || !board.boardName) return '';
    const bid = board.xiaozhi && board.xiaozhi.boardId;
    return bid ? `${board.boardName} · 小智 ${bid}` : board.boardName;
}

/* 下拉框下面那行「小智库型 xxx ↗」：让用户知道当前板在虾哥仓库里叫什么，
   点一下直达那个板型的 GitHub 目录 —— 以后加新板只要补一条 xiaozhi，这里自动跟上 */
function renderBoardFwHint(board) {
    const el = document.getElementById('board-fw-hint');
    if (!el) return;
    const xz = board && board.xiaozhi;
    if (!xz || !xz.boardId) { el.style.display = 'none'; el.innerHTML = ''; return; }
    const url = xz.search || `https://github.com/78/xiaozhi-esp32/tree/main/${xz.dir || 'main/boards/' + xz.boardId}`;
    el.style.display = 'block';
    el.innerHTML = `小智库型 <a href="${url}" target="_blank" rel="noopener" title="打开虾哥仓库里这个板型的目录（排针、固件 build 名都对得上）"><code>${xz.boardId}</code> ↗</a>`;
}
let moduleLibrary = null;
let pinsState = {}; 
let activeModules = []; 
// 统一使用 I2S 作为总线键名，方便底层引擎合流
let activeBuses = { I2C: {}, SPI: {}, I2S: {}, UART: {} }; 
let pendingModule = null; 
let pendingOptionalDrops = []; 
let editingModuleIndex = -1;
let currentCategory = 'ALL';
let currentSearch = '';
let selectedModuleId = '';

let pendingDowngradeModuleId = null; 
let pendingFailedModules = []; 

let _onboardSlots = [];
let _onboardPinMap = {};

window.currentUploadedSource = null; 
window.hasReplacedSource = false;    

let replacingOnboardSlotId = null;
let replacingModuleIndex = null;

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

        let pinnedBoards = [];
        try {
            pinnedBoards = JSON.parse(localStorage.getItem('esp_pinned_boards') || '[]');
        } catch (e) {}

        const boardKeys = Object.keys(globalBoards);
        boardKeys.sort((a, b) => {
            const aIndex = pinnedBoards.indexOf(a);
            const bIndex = pinnedBoards.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return bIndex - aIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return 0; 
        });

        boardKeys.forEach(key => {
            const data = globalBoards[key];
            const option = document.createElement('option');
            option.value = key;
            /* 只写物理板名：下拉框 300px 宽，带上小智库型 id 会被截断成 bread-con…，
               反而两边都看不清。板型 id 放在下拉框下方单独一行（可点击），见 loadBoard */
            option.textContent = data.boardName;
            boardSelect.appendChild(option);
        });

        let defaultBoardKey = boardKeys[0];
        if (pinnedBoards.length > 0) {
            const lastPinned = pinnedBoards[pinnedBoards.length - 1];
            if (globalBoards[lastPinned]) defaultBoardKey = lastPinned;
        }

        boardSelect.value = defaultBoardKey;
        // 优先恢复上次的方案；没存过（或存档已失效）才给空画布
        if (!restoreWiringState()) loadBoard(defaultBoardKey);
        
    } catch (error) {
        console.error(error);
        const bt = document.getElementById('board-title');
        if (bt) bt.innerText = "❌ 初始化失败";
    }
});

// ==========================================
// 1.1 板载槽位归一化与兼容层
// ==========================================
function normalizeOnboardSlots(board) {
    if (board.onboard_slots && board.onboard_slots.length > 0) {
        return board.onboard_slots.map(s => ({
            slotId: s.slotId, label: s.label || s.slotId, moduleId: s.moduleId,
            candidates: Array.isArray(s.candidates) && s.candidates.length > 0 ? s.candidates.slice() : [s.moduleId],
            replaceable: !!s.replaceable, soldered: s.soldered !== false,
            lockedPins: s.lockedPins ? JSON.parse(JSON.stringify(s.lockedPins)) : {}
        }));
    }
    if (board.onboard_devices && board.onboard_devices.length > 0) {
        return board.onboard_devices.map(d => ({
            slotId: d.id, label: d.name || d.id, moduleId: d.id,
            candidates: [d.id], replaceable: false, soldered: true, lockedPins: {}
        }));
    }
    return [];
}

function syncOnboardDevicesCompat(board, slots) {
    board.onboard_devices = slots.map(slot => {
        const mod = moduleLibrary[slot.moduleId] || {};
        return { id: slot.moduleId, name: mod.name ? `${mod.name}` : `${slot.label}`, priority: mod.priority || 50, peak_current_ma: resolveOnboardPeak(slot) };
    });
}

function buildOnboardPinMap(slots) {
    const map = {};
    slots.forEach(slot => {
        const mod = moduleLibrary[slot.moduleId] || {};
        const shortName = getOnboardShortLabel(slot, mod);
        const ownerName = mod.name || slot.label;
        for (const [signal, pinVal] of Object.entries(slot.lockedPins || {})) {
            const pins = Array.isArray(pinVal) ? pinVal : [pinVal];
            pins.forEach((p, idx) => {
                const pinNum = Number(p);
                if (Number.isNaN(pinNum)) return;
                map[pinNum] = { slotId: slot.slotId, signal: pins.length > 1 ? `${signal}[${idx}]` : signal, moduleId: slot.moduleId, moduleName: ownerName, shortName: shortName };
            });
        }
    });
    return map;
}

function getOnboardShortLabel(slot, mod) {
    const name = (mod && mod.name) || slot.label || '';
    if (name.includes('摄像头')) return '摄像头';
    if (name.includes('麦克风')) return '麦克风';
    if (name.includes('功放')) return '功放';
    if (name.includes('屏幕')) return '屏幕';
    return name.split(' ')[0] || '板载';
}

function resolveOnboardPeak(slot) {
    if (typeof cartSelectedModules !== 'undefined' && Array.isArray(cartSelectedModules)) {
        const cartItem = cartSelectedModules.find(c => c.isOnboard && c.slotId === slot.slotId);
        if (cartItem && cartItem.overrides && cartItem.overrides.current !== undefined) return Number(cartItem.overrides.current) || 0;
    }
    if (slot._peakOverride !== undefined) return Number(slot._peakOverride) || 0;
    const mod = moduleLibrary[slot.moduleId];
    return (mod && mod.peak_current_ma) || 0;
}

function initPins() {
    pinsState = {};
    for (let i = 0; i <= boardConfig.max_pin; i++) {
        if (_onboardPinMap[i]) {
            const info = _onboardPinMap[i];
            pinsState[i] = { state: 'onboard', label: info.signal, owner: info.shortName, signal: info.signal, slotId: info.slotId, moduleId: info.moduleId };
        } else if (boardConfig.fixedPins.includes(i)) {
            pinsState[i] = { state: 'fixed', label: 'Fixed' };
        } else if (!boardConfig.availableGpios.includes(i)) {
            pinsState[i] = { state: 'fixed', label: 'N/A' };
        } else if (boardConfig.strappingPins[i]) {
            pinsState[i] = { state: 'strapping', label: 'Strap' };
        } else {
            pinsState[i] = { state: 'free', label: 'Free' };
        }
    }
}

/* ==========================================
 * 排针白名单：只有画布上真实绘制出来的排针才允许被分配
 * 目的：让「分配引擎」与「接线图画布」共用同一份物理事实，
 *       避免出现分配到 GPIO 18、但该脚在 pinLayout 里根本没画出来的情况。
 * 兜底：自定义主板若未提供 pinLayout，则回退到 availableGpios。
 * ========================================== */
let _headerPinSetCache = null;

/* 纯函数：排针丝印标识 → 真实 GPIO 号
 *   "43" / "GPIO43" / "IO43" → 43
 *   "TX" / "RX"              → 43 / 44（经 busPins 反查，WROOM 板丝印就是 TX/RX）
 *   "3V3" / "5VIN" / "GND" / "RST" → null（电源与复位脚，不是 GPIO）
 */
function resolveBoardPinToken(board, token) {
    if (token === undefined || token === null) return null;
    const s = String(token).trim().toUpperCase();
    if (!s) return null;
    const m = s.match(/^(?:GPIO|IO)?\s*(\d+)$/);
    if (m) return Number(m[1]);
    // 电源/地/复位/晶振等非 GPIO 丝印直接排除，避免 "5V" 被误读成 GPIO5、"3V3" 读成 GPIO3
    if (/^(?:\d+V\d*|VCC|VDD|VIN|GND|GROUND|RST|RESET|EN|NC|BOOT|5V|3V3)$/.test(s)) return null;
    const busPins = (board && board.busPins) || {};
    for (const group of Object.keys(busPins)) {
        const groupPins = busPins[group] || {};
        for (const name of Object.keys(groupPins)) {
            if (String(name).toUpperCase() === s) {
                const gpio = Number(groupPins[name]);
                if (!Number.isNaN(gpio)) return gpio;
            }
        }
    }
    return null;
}

/* 纯函数：给定主板数据，算出“画布上真实存在的排针”集合（供画布/引擎/校验共用） */
function computeHeaderPinSet(board) {
    const set = new Set();
    if (!board) return set;
    const layout = board.pinLayout || {};
    const addPin = (raw) => {
        const gpio = resolveBoardPinToken(board, raw);
        if (gpio !== null) set.add(gpio);
    };
    (layout.left || []).forEach(addPin);
    (layout.right || []).forEach(addPin);
    // 无排针布局的自定义主板：退回可用 GPIO 列表
    if (set.size === 0) (board.availableGpios || []).forEach(n => set.add(Number(n)));
    return set;
}

function getHeaderPinSet() {
    if (_headerPinSetCache && _headerPinSetCache.board === boardConfig) return _headerPinSetCache.set;
    const set = computeHeaderPinSet(boardConfig);
    _headerPinSetCache = { board: boardConfig, set };
    return set;
}

function isHeaderPin(pinNum) {
    return getHeaderPinSet().has(Number(pinNum));
}

function loadBoard(boardKey) {
    const nextBoard = globalBoards[boardKey];
    if (!nextBoard) {
        // 自定义主板被删除、或历史配置指向已不存在的型号时，别把页面带进"boardConfig undefined"的崩溃状态
        console.warn(`[Board] 找不到主控配置：${boardKey}`);
        if (typeof uiToast === 'function') uiToast('该主控不存在或已被删除，已保留当前配置', { type: 'error' });
        return;
    }
    boardConfig = nextBoard;
    const bt = document.getElementById('board-title');
    if (bt) {
        bt.innerText = "当前配置: " + boardDisplayName(boardConfig);
        bt.title = boardConfig.xiaozhi
            ? `${boardConfig.boardName} 在小智仓库里叫 ${boardConfig.xiaozhi.boardId}，排针与固件都按这个板型来`
            : boardConfig.boardName;
    }

    // 下拉框可能停在别的板子上（恢复上次配置、删除自定义主板后回退），这里顺手对齐，
    // 否则界面显示 WROOM、实际按 CAM 的排针在分配，用户完全看不出来
    const boardSel = document.getElementById('board-select');
    if (boardSel) {
        if (boardSel.value !== boardKey) {
            const opt = Array.prototype.find.call(boardSel.options, o => o.value === boardKey);
            if (opt) boardSel.value = boardKey;
        }
        // 下拉框宽度有限，长板名会被截断 —— 悬停时给出全名和去哪找源码
        boardSel.title = boardDisplayName(boardConfig);
    }
    renderBoardFwHint(boardConfig);
    
    activeModules = []; 
    activeBuses = { I2C: {}, SPI: {}, I2S: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
    cartSelectedModules = []; 
    window.currentUploadedSource = null; 
    window.hasReplacedSource = false; 

    // 换主板 = 换引脚池，上一份源码适配表（原宏名 → 脚）对新板不再成立。
    // 不清掉的话「生成代码骨架」会把新板的接法套进旧源码的宏名里 ——
    // 贴回源码编译能过，但脚对不上，是最难查的那种错。
    if (typeof resetParser === 'function') { try { resetParser(); } catch (e) { console.warn('[Board] 清理源码解析状态失败', e); } }
    
    _onboardSlots = normalizeOnboardSlots(boardConfig);
    _onboardPinMap = buildOnboardPinMap(_onboardSlots);
    syncOnboardDevicesCompat(boardConfig, _onboardSlots);
    
    _onboardSlots.forEach(slot => {
        const mod = moduleLibrary[slot.moduleId];
        if (!mod) return;
        cartSelectedModules.push({ id: slot.moduleId, name: mod.name, priority: mod.priority || 50, overrides: { current: mod.peak_current_ma || 0 }, isOnboard: true, slotId: slot.slotId, failed: false });
    });
    
    initPins();
    
    if (typeof initCombobox === 'function') { initCombobox(); }
    if (typeof initDiagnosticsEngine === 'function') { initDiagnosticsEngine(); }
    
    updateSoftwareButtonsUI();
    renderPins();
    renderModules();
    updatePowerBudget();
}

async function switchBoard() {
    if (activeModules.length > 0 || cartSelectedModules.length > 0) {
        const ok = await uiConfirm({
            title: '切换主控芯片？',
            body: '当前已配置的模组与引脚分配将被全部清空，此操作不可撤销。',
            confirmText: '切换并清空',
            danger: true,
            icon: '⚠️'
        });
        if (!ok) {
            const currentKey = Object.keys(globalBoards).find(k => globalBoards[k] === boardConfig);
            const sel = document.getElementById('board-select');
            if (currentKey) sel.value = currentKey;
            return;
        }
    }
    loadBoard(document.getElementById('board-select').value);
}

/* ==========================================
 * 1.2 接线方案持久化
 * 刷新页面不丢方案：主板 + 模组 + 每根线的落点 + 勾选状态 + 源码宏映射。
 * 只存「能重建画布的最小事实」，不存 pinsState/activeBuses —— 那些由 rebuildPinState 推出来，
 * 存了反而会和板数据打架。存储带版本号：格式一变就整条丢弃，不做迁移（旧数据只会误导）。
 * ========================================== */
const WIRING_STATE_KEY = 'esp32_wiring_state_v1';
let _restoringWiring = false;
let _persistWiringTimer = null;

function wiringStateSnapshot() {
    const srcMeta = (typeof window._sourceMeta !== 'undefined') ? window._sourceMeta : null;
    const mapping = (typeof currentMappingData !== 'undefined' && currentMappingData) ? currentMappingData : [];
    return {
        v: 1,
        board: boardConfig ? boardConfig.boardName : '',
        savedAt: Date.now(),
        modules: (activeModules || []).map(m => ({
            id: m.id,
            name: m.name || '',
            interface: m.interface || '',
            isOnboard: !!m.isOnboard,
            slotId: m.slotId || null,
            connections: Object.assign({}, m.connections || {}),
            overrides: Object.assign({}, m.overrides || {}),
            enabledPins: Object.assign({}, m.enabledPins || {})
        })),
        source: (srcMeta || mapping.length)
            ? {
                meta: srcMeta || null,
                mapping: mapping,
                project: (typeof currentProjectName !== 'undefined') ? currentProjectName : ''
            }
            : null
    };
}

function persistWiringState(immediate) {
    if (_restoringWiring) return;
    const write = () => {
        try {
            // 画布被清空 → 连存档一起删掉，否则下次刷新又"复活"一套用户已经放弃的接法
            if (!activeModules.length) { localStorage.removeItem(WIRING_STATE_KEY); return; }
            localStorage.setItem(WIRING_STATE_KEY, JSON.stringify(wiringStateSnapshot()));
        } catch (e) {
            console.warn('[持久化] 保存接线失败（可能是存储配额已满）', e);
        }
    };
    clearTimeout(_persistWiringTimer);
    if (immediate) write();
    else _persistWiringTimer = setTimeout(write, 400);
}

function restoreWiringState() {
    const st = readLocalJSON(WIRING_STATE_KEY, null);
    // 主板被删/改名、格式对不上 → 静默按空画布启动，不要拿半套数据把画布画歪
    if (!st || st.v !== 1 || !st.board || !globalBoards[st.board]) return false;

    _restoringWiring = true;
    try {
        loadBoard(st.board);

        let restored = 0;
        (st.modules || []).forEach(sm => {
            if (!sm || !sm.id || !moduleLibrary[sm.id]) return;
            const md = moduleLibrary[sm.id];
            const conns = {};
            Object.entries(sm.connections || {}).forEach(([sig, val]) => {
                if (!val || val === 'dropped') { conns[sig] = val; return; }
                // 板数据升级后某根脚可能已经不存在，留着会让画布画到虚空里。
                // 一根没丢就原样保留（连类型一起），否则拼回字符串 —— 别让 5 变成 "5"
                const parts = String(val).split(',').map(p => p.trim());
                const alive = parts.filter(p => pinsState[Number(p)]);
                if (!alive.length) return;
                conns[sig] = alive.length === parts.length ? val : alive.join(',');
            });
            activeModules.push({
                id: sm.id,
                name: md.name || sm.name,
                interface: md.interface || sm.interface,
                connections: conns,
                overrides: Object.assign({}, sm.overrides || {}),
                enabledPins: Object.assign({}, sm.enabledPins || {}),
                isOnboard: !!sm.isOnboard,
                slotId: sm.slotId || undefined
            });
            restored++;
        });

        if (!restored) return false;
        rebuildPinState();
        renderPins();
        renderModules();
        updatePowerBudget();
        if (typeof refreshSmartPanelIfStale === 'function') refreshSmartPanelIfStale();
        // 源码宏映射要留着：「生成代码骨架」靠它继续按源码原宏名出片；
        // 但不去还原解析结果卡片（那是上一次操作的中间态，弹出来只会让人以为刚解析过）
        if (st.source) {
            window._sourceMeta = st.source.meta || null;
            currentMappingData = Array.isArray(st.source.mapping) ? st.source.mapping : [];
            if (typeof currentProjectName !== 'undefined' && st.source.project) currentProjectName = st.source.project;
        }
        if (typeof uiToast === 'function') {
            uiToast(`已恢复上次接线（${restored} 个模组）`, { type: 'info', duration: 2600 });
        }
        return true;
    } catch (e) {
        console.warn('[持久化] 恢复接线失败，已按空画布启动', e);
        return false;
    } finally {
        _restoringWiring = false;
    }
}

// ==========================================
// 2. 渲染逻辑
// ==========================================
/* 模组型号 id → 便于阅读的短名（去掉括号里的接口备注）
 *   "MAX98357A 功放 (I2S)" → "MAX98357A 功放"（超长再截断）
 *   找不到字典时原样返回，避免显示空白 */
function moduleFullName(id) {
    const d = moduleLibrary[id];
    return (d && d.name) ? d.name : String(id || '未知模组');
}

function moduleShortName(id) {
    const full = moduleFullName(id).replace(/[（(][^）)]*[)）]/g, '').trim() || moduleFullName(id);
    // 按显示宽度截断：中日韩字符算 2、其余算 1，预算 18（引脚卡片约两行）
    // 直接按字符数截会把 "2.0寸 TFT IPS 彩屏" 切成 "2.0寸 TFT IP…"，所以按宽度算
    let width = 0, out = '';
    for (const ch of full) {
        width += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
        if (width > 18) return out + '…';
        out += ch;
    }
    return out;
}

function renderPins() {
    try {
        const grid = document.getElementById('pin-grid');
        grid.innerHTML = '';
        let globalTooltip = document.getElementById('global-tooltip');
        if (!globalTooltip) { globalTooltip = document.createElement('div'); globalTooltip.id = 'global-tooltip'; document.body.appendChild(globalTooltip); }
        
        let allConnections = [];
        activeModules.forEach(mod => {
            const modData = moduleLibrary[mod.id];
            const modName = modData ? modData.name : (mod.name || '未知模组');
            for (const [signal, pinStr] of Object.entries(mod.connections)) {
                if (pinStr === "dropped") continue;
                String(pinStr).split(',').forEach(p => { allConnections.push({ pin: Number(p), module: modName, signal: signal }); });
            }
        });
        
        let report = { errors: [], warnings: [] };
        if (typeof runHardwareDiagnostics === 'function' && typeof ruleKnowledgeBase !== 'undefined' && ruleKnowledgeBase) { report = runHardwareDiagnostics(allConnections, boardConfig.boardName); }

        // 诊断结果落到可见 UI（工具栏胶囊 + 画布自检浮层）；画布引脚外圈也依赖它，
        // 必须在 refreshWiringCanvas 之前更新，否则画布会拿到上一轮结论
        if (typeof renderDiagnosticsUI === 'function') { renderDiagnosticsUI(report); }
        
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
            
            if (pin.state === 'onboard') {
                labelHtml += `<div class="pin-label">${pin.owner}<br>${pin.signal}</div>`;
                div.onclick = () => highlightOnboardSlot(pin.slotId);
                if (!tooltipText) tooltipText = `🔒 板载焊接设备：${pin.owner}\n信号：${pin.signal}\n该引脚被板载设备固定占用，无法释放。\n点击可定位到左侧卡片。`;
            } else if (pin.state === 'used') {
                // 引脚卡片只有 85px 宽，直接显示型号 id（如 mic_inmp441）会撑成两行乱码，
                // 这里换成去掉括号备注的短型号名，完整信息放到 tooltip 里
                labelHtml += `<div class="pin-label">${moduleShortName(pin.owner)}<br>${pin.signal}</div>`;
                div.onclick = () => releasePin(i);
                if (!tooltipText) tooltipText = `点击可断开这根引线。\n当前使用: ${moduleFullName(pin.owner)} · ${pin.signal}`;
            } else if (pin.state === 'strapping') { 
                labelHtml += `<div class="pin-label">启动敏感</div>`; 
                if (!tooltipText) tooltipText = `启动脚：上电瞬间决定启动模式，接了外设可能开不了机。`; 
            } else if (pin.state === 'fixed') { 
                labelHtml += `<div class="pin-label">${pin.label}</div>`; 
                if (!tooltipText) tooltipText = `主控内部占用，不能外接。`; 
            } else { 
                if (!tooltipText) tooltipText = "空闲可用"; 
            }
            
            if (errorObj || warningObj) { labelHtml += `<div style="position:absolute; top:2px; right:2px; font-size:14px;">${errorObj ? '❌' : '⚠️'}</div>`; }
            
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
        if (typeof refreshWiringCanvas === 'function') { try { refreshWiringCanvas(); } catch (e2) { console.error("画布刷新失败", e2); } }
        // renderPins 是「接线发生了实质变化」的汇聚点（加模组/删模组/换方案/勾引脚都会走到这），
        // 顺手存一份，刷新页面不至于从头再点一遍。防抖 400ms 避免拖线时狂写 localStorage
        if (typeof persistWiringState === 'function') persistWiringState();
    } catch (e) {
        console.error("渲染引脚时发生致命错误:", e);
    }
}

function highlightOnboardSlot(slotId) {
    try {
        const card = document.querySelector(`.onboard-slot-card[data-slot-id="${slotId}"]`);
        if (!card) return;
        card.classList.remove('highlight');
        void card.offsetWidth; 
        card.classList.add('highlight');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => card.classList.remove('highlight'), 1100);
    } catch (e) {}
}


/* 信号显示名：以模组实物丝印为准（TFT 是 SCL/SDA/RES/DC/CS，功放是 DIN/BCLK/LRC），
   内部总线名放括号里。照着丝印插线才不会把 SDA 当成 I2C 的 SDA。 */
function signalDisplayName(modData, signal) {
    const req = ((modData && modData.requirements) || []).find(r => r.signal === signal);
    if (!req || !req.label || req.label === signal) return signal;
    return `${req.label}（${signal}）`;
}

function renderModules() {
    try {
        const list = document.getElementById('active-modules-list');
        const wiringPanel = document.getElementById('wiring-panel');
        const wiringList = document.getElementById('connection-list');
        const countLabel = document.getElementById('module-count-label');
        if (countLabel) countLabel.innerText = `接入模组 (${activeModules.length + _onboardSlots.length})`;
        
        if (activeModules.length === 0 && _onboardSlots.length === 0) {
            list.innerHTML = '<p style="color:#888; font-size:12px; text-align:center;">暂无模组，点击上方"添加模组"开始配置</p>';
            if (wiringPanel) wiringPanel.style.display = 'none'; 
            updateSoftwareButtonsUI();
            return;
        }
        
        list.innerHTML = ''; wiringList.innerHTML = '';
        
        let totalCurrent = 0;
        _onboardSlots.forEach(slot => totalCurrent += resolveOnboardPeak(slot));
        
        activeModules.forEach(mod => {
            const mData = moduleLibrary[mod.id];
            let currentToAdd = (mod.overrides?.current !== undefined ? mod.overrides.current : (mData?.peak_current_ma || 0));
            const isPure5VDevice = mData && mData.power_pins && mData.power_pins.some(p => p.connect_to === '5V') && !mData.power_pins.some(p => p.connect_to === '3.3V');
            if (isPure5VDevice) currentToAdd = 0;
            totalCurrent += currentToAdd;
        });
        
        const maxCurrent = boardConfig.max_current_ma || 500;
        const isOverload = totalCurrent > maxCurrent;

        if (typeof checkHighSpeedWarning === 'function' && checkHighSpeedWarning()) {
            const hwWarning = document.createElement('div');
            hwWarning.style.cssText = "font-size: 13px; color: #856404; background-color: #fff3cd; border: 1px solid #ffeeba; padding: 12px; border-radius: 6px; margin-bottom: 15px; display: flex; align-items: center; line-height: 1.5;";
            hwWarning.innerHTML = `<span style="font-size: 16px; margin-right: 8px;">⚠️</span> <div><strong>物理走线警告：</strong>您的项目使用了 SPI/I2S 等高频信号引脚。请确保排线长度不超过 10cm，且信号线尽量分开或包地。</div>`;
            wiringList.appendChild(hwWarning);
        }
        
        // 极简板载卡片
        _onboardSlots.forEach(slot => {
            const mod = moduleLibrary[slot.moduleId] || {};
            const card = document.createElement('div');
            card.className = 'onboard-slot-card';
            card.dataset.slotId = slot.slotId;
            card.style.cssText = 'padding: 14px 16px; margin-bottom: 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; display: flex; flex-direction: column; gap: 10px;';

            let pinCount = 0;
            Object.values(slot.lockedPins || {}).forEach(v => { pinCount += Array.isArray(v) ? v.length : 1; });

            const icon = (mod.name && mod.name.includes('摄像头')) ? '📷' : '🔌';
            const effectivePeak = resolveOnboardPeak(slot);

            const replaceBtnHtml = slot.replaceable 
                ? `<span class="chip-btn chip-btn--primary" data-act="openOnboardReplace" data-arg="${slot.slotId}" data-stop>更换</span>` : '';

            const headerRow = `<div style="display: flex; justify-content: space-between; align-items: center; width: 100%;"><div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;"><span style="font-size: 16px; line-height: 1;">${icon}</span><span style="font-weight: 700; color: #1e293b; font-size: 14px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;">${mod.name || slot.label}</span></div><div style="flex-shrink: 0; margin-left: 12px; display: flex; align-items: center;">${replaceBtnHtml}</div></div>`;

            const footerRow = `<div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #64748b; line-height: 1;"><span style="background: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; line-height: 1.2;">🔒 板载</span><span style="width: 3px; height: 3px; border-radius: 50%; background: #cbd5e1;"></span><span>引脚${pinCount}（PCB 直连）</span></div>`;

            card.innerHTML = headerRow + footerRow;
            list.appendChild(card);

            const title = document.createElement('h3');
            title.innerText = `${mod.name || slot.label} (板载焊接)`;
            title.style.fontSize = '1rem'; title.style.marginTop = '15px'; title.style.color = '#1e3a8a';
            wiringList.appendChild(title);

            const item = document.createElement('div');
            item.className = 'connection-item';
            item.style.backgroundColor = '#eff6ff'; item.style.borderColor = '#bfdbfe';
            item.innerHTML = `<strong style="color:#1e3a8a;">板载接口</strong> <span style="margin: 0 10px;">➡</span> <span style="color:#1e3a8a; font-size:13px;">无需飞线，已由 PCB 直连</span>`;
            wiringList.appendChild(item);
        });

        // 渲染外接设备（卡片：名称 + 更换按钮，换同类模组）
        activeModules.forEach((mod, index) => {
            const modData = moduleLibrary[mod.id] || { name: mod.name || '未知模组', power_pins: [], local_links: [] };
            
            const modCard = document.createElement('div');
            modCard.className = 'module-card';
            modCard.dataset.modId = mod.id;
            modCard.innerHTML = `
                <div class="module-card-row1">
                    <span class="module-card-name">${modData.name}</span>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                        <span class="chip-btn chip-btn--sm" data-act="openPinEditModal" data-arg="${index}" data-stop title="按实物勾选/取消引线名">引脚</span>
                        <span class="chip-btn chip-btn--primary" data-act="openModuleReplace" data-arg="${index}" data-stop>更换</span>
                        <span class="module-card-del" data-act="removeActiveModule" data-arg="${index}" data-stop title="从工作台移除这个模组">✕</span>
                    </div>
                </div>`;
            list.appendChild(modCard);
            
            const title = document.createElement('h3');
            title.innerText = `${modData.name} (实例 #${index+1})`;
            title.style.fontSize = '1rem'; title.style.marginTop = '15px';
            wiringList.appendChild(title);
            
            // 按实物引脚顺序（pinOrder）打印：1→8 从上到下，和手里那块屏的排线一一对应
            const pinOrder = modData.pinOrder || [];
            const rankOf = (name) => { const i = pinOrder.indexOf(name); return i === -1 ? 999 : i; };
            const rows = [];
            for (const [signal, pinNum] of Object.entries(mod.connections)) rows.push({ kind: 'sig', name: signal, pinNum, rank: rankOf(signal) });
            // 该接却没接上的脚：也要在清单里留一行，不能看起来像「全都接好了」
            (modData.requirements || []).forEach(r => {
                if (mod.connections[r.signal] !== undefined) return;
                if (mod.enabledPins && mod.enabledPins[r.signal] === false) return;
                rows.push({ kind: 'miss', name: r.signal, rank: rankOf(r.signal) });
            });
            (modData.local_links || []).forEach(link => rows.push({ kind: 'link', link, rank: rankOf(link.from) }));
            (modData.power_pins || []).forEach(p => {
                if (mod.enabledPins && mod.enabledPins[p.pin] === false) return; // 实物没这根脚（如 7 针屏无 BLK）
                rows.push({ kind: 'pwr', p, rank: rankOf(p.pin) });
            });
            rows.sort((a, b) => a.rank - b.rank);

            rows.forEach(row => {
                const item = document.createElement('div');
                item.className = 'connection-item';

                if (row.kind === 'sig') {
                    const { name: signal, pinNum } = row;
                    if (pinNum === 'dropped') {
                        item.innerHTML = `<strong>${signalDisplayName(modData, signal)}</strong> <span style="margin: 0 10px;">➡</span> <span style="color:#dc3545; font-weight:bold; text-decoration:line-through;">已放弃连接</span>`;
                        item.style.borderColor = '#dc3545';
                    } else {
                        const isShared = (modData.interface === 'I2C' || modData.interface === 'SPI' || modData.interface.includes('I2S')) && BUS_SIGNALS.has(signal);
                        item.innerHTML = `<strong>${signalDisplayName(modData, signal)}</strong> <span style="margin: 0 10px;">➡</span> <span style="color:var(--pin-fixed); font-weight:bold; font-size:1.1rem;">GPIO ${pinNum}</span> ${isShared ? '<span style="font-size:10px; color:#888; margin-left:10px;">(总线共享)</span>' : ''}`;
                    }
                } else if (row.kind === 'miss') {
                    item.innerHTML = `<strong>${signalDisplayName(modData, row.name)}</strong> <span style="margin: 0 10px;">➡</span> <span style="color:#dc3545; font-weight:bold;">未分配 GPIO（可用「引脚」按钮手动指定）</span>`;
                    item.style.borderColor = '#dc3545';
                } else if (row.kind === 'link') {
                    const link = row.link;
                    item.style.backgroundColor = '#f0fdf4';
                    item.style.borderColor = '#bbf7d0';
                    item.innerHTML = `<strong style="color:#166534;">🔗 本地短接</strong> <span style="margin: 0 10px;">➡</span> <strong style="color:#166534;">${link.from} 连 ${link.to}</strong> <span style="font-size:11px; color:#15803d; margin-left:10px;">(${link.reason})</span>`;
                } else {
                    const p = row.p;
                    let displayWarning = ""; let isDangerousPower = false;

                    if (isOverload) {
                        if (p.connect_to === '5V') { displayWarning = "接外部 5V 供电"; isDangerousPower = true; }
                        else if (p.connect_to === '3.3V') { displayWarning = "接降压模块输出"; }
                        else { displayWarning = "统一共地"; }
                    } else {
                        displayWarning = p.connect_to === 'GND' ? "接主板 GND" : "接主板 " + p.connect_to;
                    }

                    if (isDangerousPower) {
                        item.style.backgroundColor = '#fff3f3'; item.style.borderColor = '#dc3545'; item.style.marginTop = '5px';
                        item.innerHTML = `<strong style="color:#dc3545;">${p.label || p.pin}</strong> <span style="margin: 0 10px;">➡</span> <strong style="color:#dc3545;">${p.connect_to}</strong> <span style="font-size:11px; color:#dc3545; margin-left:10px;">(${displayWarning})</span>`;
                    } else {
                        item.style.backgroundColor = '#f8f9fa';
                        item.innerHTML = `<strong>${p.label || p.pin}</strong> <span style="margin: 0 10px;">➡</span> <strong style="color:var(--pin-fixed);">${p.connect_to}</strong> <span style="font-size:11px; color:#888; margin-left:10px;">(${displayWarning})</span>`;
                    }
                }
                wiringList.appendChild(item);
            });
        });
        
        wiringPanel.style.display = 'block';
        updateSoftwareButtonsUI(); 
        updatePowerBudget();
    } catch (e) {
        console.error("渲染模组时发生致命错误:", e);
    }
}

function openModuleReplace(modIndex) {
    replacingModuleIndex = modIndex;
    const mod = activeModules[modIndex];
    if (!mod) return;
    const modData = moduleLibrary[mod.id];
    const iface = modData ? modData.interface : '';
    // 同类模组 = 相同接口的其它模组
    const candidateIds = Object.keys(moduleLibrary).filter(id => id !== mod.id && moduleLibrary[id] && moduleLibrary[id].interface === iface);
    if (candidateIds.length === 0) {
        uiAlert({ title: '没有可更换的型号', body: `【${modData ? modData.name : mod.id}】当前分类下没有其他同类模组。`, icon: '💡' });
        return;
    }

    document.getElementById('replace-old-name').innerText = modData ? modData.name : mod.id;

    const select = document.getElementById('replace-select');
    select.innerHTML = '';
    candidateIds.forEach(cid => {
        const data = moduleLibrary[cid];
        const option = document.createElement('option');
        option.value = cid;
        option.textContent = data.name;
        select.appendChild(option);
    });

    const confirmBtn = document.querySelector('#replace-modal .btn-primary');
    confirmBtn.setAttribute('data-act', 'executeModuleReplace');

    const replaceModal = document.getElementById('replace-modal');
    if (replaceModal) {
        replaceModal.style.display = 'flex';
        replaceModal.style.zIndex = '9999999';
    }
}

function executeModuleReplace() {
    if (replacingModuleIndex === null) return;
    const newId = document.getElementById('replace-select').value;
    if (!newId) return;
    const mod = activeModules[replacingModuleIndex];
    if (!mod) return;
    const oldId = mod.id;
    const oldPeak = moduleLibrary[oldId]?.peak_current_ma || 0;

    // 1) 释放旧模组占用的引脚
    for (const [signal, pinStr] of Object.entries(mod.connections)) {
        if (pinStr === 'dropped') continue;
        String(pinStr).split(',').forEach(p => {
            const pNum = Number(p);
            if (pinsState[pNum] && pinsState[pNum].owner === mod.id) {
                pinsState[pNum] = { state: 'free', owner: null, signal: null };
            }
        });
    }

    // 2) 在释放后的接线状态上为新模组做沙盘分配
    const modData = moduleLibrary[newId];
    if (!modData) return;
    let pinsCopy = {};
    for (let i = 0; i <= boardConfig.max_pin; i++) { if (pinsState[i]) pinsCopy[i] = { ...pinsState[i] }; }
    let busesCopy = JSON.parse(JSON.stringify(activeBuses));
    const result = tryAllocate(modData, pinsCopy, busesCopy);
    if (result.missingRequired.length > 0) {
        uiAlert({ title: '引脚不足，替换失败', body: `【${modData.name}】所需引脚无法全部满足。
可先释放部分连线，或换一块更空闲的主板后重试。`, danger: true });
        return;
    }
    for (let i = 0; i <= boardConfig.max_pin; i++) {
        if (pinsCopy[i] && pinsCopy[i].state === 'used') pinsState[i] = { ...pinsCopy[i] };
    }
    activeBuses = busesCopy;

    // 3) 替换该项为新模组（保留实例位置）
    const newConnections = {};
    for (const [signal, pins] of Object.entries(result.allocations)) {
        newConnections[signal] = (pins === "dropped") ? "dropped" : (pins.length > 1 ? pins.join(',') : pins[0]);
    }
    mod.id = newId;
    mod.name = modData.name;
    mod.interface = modData.interface;
    mod.connections = newConnections;
    mod.overrides = { current: modData.peak_current_ma || 0 };
    // 应用新型号已保存的默认引脚勾选组合，并补分配扩展/自定义信号
    mod.enabledPins = null;
    mod.customPins = [];
    if (typeof applyPinPresetToMod === 'function') applyPinPresetToMod(mod);
    if (typeof presetExtraAllocate === 'function') presetExtraAllocate(mod, modData);

    closeReplaceModal();
    renderPins(); renderModules(); updatePowerBudget();
    if (typeof checkWifiAdcConflict === 'function') checkWifiAdcConflict(newId);

    const newPeak = modData.peak_current_ma || 0;
    if (oldPeak > 0 && Math.abs(newPeak - oldPeak) / oldPeak > 0.2) {
        uiToast(`已更换为【${modData.name}】\n供电预算变化 ${newPeak - oldPeak > 0 ? '+' : ''}${newPeak - oldPeak} mA`, { type: 'success', duration: 3600 });
    }
}

function openOnboardReplace(slotId) {
    replacingOnboardSlotId = slotId;
    const slot = _onboardSlots.find(s => s.slotId === slotId);
    if (!slot || !slot.candidates || slot.candidates.length === 0) {
        uiAlert({ title: '该插槽不支持换型', body: '这块开发板的这个板载槽位没有提供候选型号。', icon: '💡' });
        return;
    }

    const currentModId = slot.moduleId;
    const candidateIds = slot.candidates.filter(cid => cid !== currentModId);

    if (candidateIds.length === 0) {
        uiAlert({ title: '没有其他可选型号', body: '当前插槽已列出全部兼容型号。', icon: '💡' });
        return;
    }

    const currentModData = moduleLibrary[currentModId];
    document.getElementById('replace-old-name').innerText = currentModData ? currentModData.name : currentModId;

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

    const confirmBtn = document.querySelector('#replace-modal .btn-primary');
    confirmBtn.setAttribute('data-act', 'executeOnboardReplace');

    const replaceModal = document.getElementById('replace-modal');
    if (replaceModal) {
        replaceModal.style.display = 'flex';
        replaceModal.style.zIndex = '9999999'; 
    }
}

function executeOnboardReplace() {
    if (!replacingOnboardSlotId) return;
    const newId = document.getElementById('replace-select').value;
    if (!newId) return;

    const slot = _onboardSlots.find(s => s.slotId === replacingOnboardSlotId);
    const oldModId = slot.moduleId;
    
    slot.moduleId = newId;
    const boardSlot = (boardConfig.onboard_slots || []).find(s => s.slotId === replacingOnboardSlotId);
    if (boardSlot) boardSlot.moduleId = newId;

    const cartItem = cartSelectedModules.find(m => m.isOnboard && m.slotId === replacingOnboardSlotId);
    if (cartItem) {
        cartItem.id = newId;
        cartItem.name = moduleLibrary[newId] ? moduleLibrary[newId].name : newId;
        cartItem.overrides = { current: moduleLibrary[newId]?.peak_current_ma || 0 };
    }

    if (typeof buildOnboardPinMap === 'function') _onboardPinMap = buildOnboardPinMap(_onboardSlots);
    if (typeof syncOnboardDevicesCompat === 'function') syncOnboardDevicesCompat(boardConfig, _onboardSlots);

    rebuildPinState();

    closeReplaceModal();
    renderPins();
    renderModules(); 
    updatePowerBudget();
    
    const oldPeak = moduleLibrary[oldModId]?.peak_current_ma || 0;
    const newPeak = moduleLibrary[newId]?.peak_current_ma || 0;
    const delta = newPeak - oldPeak;
    uiToast(`板载设备更换完成：${moduleLibrary[oldModId]?.name || oldModId} → ${moduleLibrary[newId]?.name || newId}` +
        (Math.abs(delta) > 0 ? `\n供电预算 ${delta > 0 ? '+' : ''}${delta} mA` : ''), {
        type: 'success',
        duration: 4200
    });
}

function closeReplaceModal() {
    const modal = document.getElementById('replace-modal');
    if (modal) modal.style.display = 'none';
    replacingOnboardSlotId = null;
    replacingModuleIndex = null;
    const confirmBtn = document.querySelector('#replace-modal .btn-primary');
    if (confirmBtn) confirmBtn.setAttribute('data-act', 'executeOnboardReplace');
}

/* ==========================================
 * 引脚配置（勾选引线名，适配实物与字典差异；支持自定义引线与型号默认预设）
 * ========================================== */
function openPinEditModal(modIndex) {
    editingModuleIndex = modIndex;
    const mod = activeModules[modIndex];
    if (!mod) return;
    ensureEnabledPins(mod);
    const modData = moduleLibrary[mod.id] || {};
    document.getElementById('pin-edit-mod-name').innerText = modData.name || mod.id;
    document.getElementById('pin-edit-custom-input').value = '';
    renderPinEditList();
    const modal = document.getElementById('pin-edit-modal');
    if (modal) { modal.style.display = 'flex'; modal.style.zIndex = '9999999'; }
}

function renderPinEditList() {
    const mod = activeModules[editingModuleIndex];
    if (!mod || editingModuleIndex < 0) return;
    ensureEnabledPins(mod);
    const modData = moduleLibrary[mod.id] || {};
    const pool = INTERFACE_PIN_POOL[modData.interface] || { power: [], signals: [] };

    // 信号区（字典 requirements + 接口族扩展信号 + 自定义引线）
    const sigItems = new Map();
    (modData.requirements || []).forEach(r => {
        sigItems.set(r.signal, { required: !r.optional, defined: true, custom: false, label: r.label || r.signal });
    });
    // 实物丝印名/常见别名已经由 requirements 覆盖（如屏的 SDA/SCL、麦的 SCK/WS），
    // 池里同名候选要去掉，否则勾选框会出现两个 "SCK"，容易重复占用引脚
    const takenNames = new Set();
    (modData.requirements || []).forEach(r => {
        takenNames.add(String(r.label || r.signal).toUpperCase());
        (r.aliases || []).forEach(a => takenNames.add(String(a).toUpperCase()));
    });
    // 内部短接脚（如麦的 L/R─GND）单独成行，不能再作为“可外接信号”出现在候选里
    (modData.local_links || []).forEach(l => {
        takenNames.add(String(l.from).toUpperCase());
        takenNames.add(String(l.to).toUpperCase());
    });
    (pool.signals || []).forEach(s => {
        if (sigItems.has(s) || takenNames.has(String(s).toUpperCase())) return;
        // NC/N.C. 的语义是「这颗脚悬空不接」，给它分配 GPIO 没有意义；
        // 实物真有多余的脚，走下面的「自定义引线」输入即可
        if (/^N\.?C\.?$/i.test(String(s))) return;
        sigItems.set(s, { required: false, defined: false, custom: false });
    });
    (mod.customPins || []).forEach(c => { if (!sigItems.has(c)) sigItems.set(c, { required: false, defined: false, custom: true }); });

    // 电源区（字典 power_pins + 接口族扩展电源）
    const pwrItems = new Map();
    (modData.power_pins || []).forEach(pp => pwrItems.set(pp.pin, { target: pp.connect_to || inferPowerTarget(pp.pin, modData), defined: true, label: pp.label || '' }));
    (pool.power || []).forEach(s => { if (!pwrItems.has(s)) pwrItems.set(s, { target: inferPowerTarget(s, modData), defined: false }); });

    const rowHtml = (sig, checked, locked, tag, key, custom, title) => `
        <label title="${title ? escapeHtml(title) : ''}" style="display:flex; align-items:center; gap:8px; padding:5px 0; font-size:13px; cursor:${locked ? 'not-allowed' : 'pointer'};">
            <input type="checkbox" data-pin-sig="${key || sig}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''} style="width:16px;height:16px;margin:0;cursor:${locked ? 'not-allowed' : 'pointer'};">
            <span style="font-weight:${locked ? '700' : '400'}; color:${locked ? '#1e293b' : '#475569'};">${sig}</span>
            ${tag ? `<span style="font-size:10px; color:#3b82f6; background:#eff6ff; padding:1px 6px; border-radius:4px;">${tag}</span>` : ''}
            ${custom ? `<span data-act="removeCustomPin" data-arg="${key || sig}" data-stop title="删除此自定义引线" style="margin-left:auto; cursor:pointer; color:#dc3545; font-weight:bold; font-size:14px;">×</span>` : ''}
        </label>`;

    let html = '<div style="font-size:12px; color:#64748b; margin:2px 0 6px;">信号引脚<span style="color:#94a3b8;">（鼠标悬停可看每个脚的作用）</span></div>';
    sigItems.forEach((info, sig) => {
        const checked = mod.enabledPins[sig] === true;
        const tag = info.custom ? '自定义' : (info.defined ? '' : '扩展');
        // 有实物丝印名（如屏的 SDA/SCL、麦的 SCK/WS）时优先显示丝印，括号内标注内部标准信号名
        const display = (info.label && info.label !== sig)
            ? `${info.label}<span style="font-size:10px; color:#94a3b8; margin-left:4px;">(${sig})</span>`
            : sig;
        const hint = SIGNAL_HINTS[sig] || (info.label && SIGNAL_HINTS[info.label]) || '';
        html += rowHtml(display, checked, info.required, tag, sig, info.custom, hint);
    });
    html += '<div style="font-size:12px; color:#64748b; margin:12px 0 6px;">电源引脚<span style="color:#94a3b8;">（加粗 = 供电必需；BLK 等使能脚按实物勾选）</span></div>';
    pwrItems.forEach((info, sig) => {
        const checked = mod.enabledPins[sig] === true;
        const locked = info.defined && isEssentialPower(sig);
        let hint;
        if (String(sig).toUpperCase() === 'BLK') {
            hint = '实物有 BLK 脚 → 勾选，接 3.3V 常亮；实物没这根脚（7 针屏）→ 取消勾选即可；'
                + '想用 PWM 调光 → 取消勾选后，在下方「自定义引线」添加 BLK，会自动分配一个 GPIO。';
        } else if (locked) {
            hint = `供电必需：接 ${info.target}，缺了模组无法工作`;
        } else {
            hint = `可选电源脚：勾选后自动接 ${info.target} 轨`;
        }
        // 有丝印名时优先显示丝印（麦是 VDD、功放是 VIN），括号标注内部电源键名，避免核对时以为少了一个脚
        const pwrName = (info.label && info.label !== sig)
            ? `${info.label}<span style="font-size:10px; color:#94a3b8; margin-left:4px;">(${sig})</span>`
            : sig;
        html += rowHtml(`${pwrName} → ${info.target}`, checked, locked, info.defined ? '' : '扩展', sig, false, hint);
    });
    if ((modData.local_links || []).length) {
        html += '<div style="font-size:12px; color:#64748b; margin:12px 0 6px;">内部串联（勾选=模组内部已短接）</div>';
        (modData.local_links || []).forEach(l => {
            const checked = mod.enabledPins[l.from] === true;
            html += rowHtml(`${l.from}─${l.to}　${l.reason || '内部短接'}`, checked, false, '', l.from);
        });
    }
    document.getElementById('pin-edit-list').innerHTML = html;
}

/* 添加自定义引线（池外引线名，如 MCLK / D1） */
function addCustomPin() {
    if (editingModuleIndex < 0) return;
    const mod = activeModules[editingModuleIndex];
    if (!mod) return;
    const modData = moduleLibrary[mod.id] || {};
    const input = document.getElementById('pin-edit-custom-input');
    const name = (input.value || '').trim().toUpperCase();
    if (!name) return;
    if (name.includes('→') || name.includes('─') || name.includes(',')) {
        uiToast('引线名只能用字母、数字和下划线', { type: 'warn' });
        return;
    }
    if ((mod.enabledPins && mod.enabledPins[name] === true) || (modData.requirements || []).some(r => r.signal === name)) {
        uiToast(`引线【${name}】已在列表中`, { type: 'info', duration: 2000 });
        return;
    }
    if ((mod.customPins || []).includes(name)) { uiToast(`引线【${name}】已添加`, { type: 'info', duration: 2000 }); return; }
    // 已被取消勾选的接口族候选（enabledPins[name] === false）：直接重新启用，不再重复登记为自定义引线
    const isKnownCandidate = mod.enabledPins && mod.enabledPins[name] === false;
    mod.customPins = mod.customPins || [];
    if (!isKnownCandidate) mod.customPins.push(name);
    mod.enabledPins[name] = true;
    // 添加即勾选 → 自动分配空闲 GPIO（与扩展候选一致）；无可用 GPIO 则保留灰点待手动拖线
    if (typeof allocateNewSignal === 'function' && !allocateNewSignal(mod, name, modData)) {
        uiToast(`【${name}】暂无可用 GPIO，已保留勾选，可手动拖线`, { type: 'warn' });
    }
    input.value = '';
    renderPinEditList();
    renderPins(); renderModules(); updatePowerBudget();
    if (typeof refreshWiringCanvas === 'function') refreshWiringCanvas();
}

/* 删除自定义引线 */
function removeCustomPin(sig) {
    if (editingModuleIndex < 0) return;
    const mod = activeModules[editingModuleIndex];
    if (!mod) return;
    mod.customPins = (mod.customPins || []).filter(c => c !== sig);
    if (mod.enabledPins) delete mod.enabledPins[sig];
    releaseSignal(mod, sig);
    renderPinEditList();
    renderPins(); renderModules(); updatePowerBudget();
    if (typeof refreshWiringCanvas === 'function') refreshWiringCanvas();
}

/* 保存当前勾选组合为该型号的默认参数 */
function savePresetNow() {
    if (editingModuleIndex < 0) return;
    const mod = activeModules[editingModuleIndex];
    if (!mod) return;
    ensureEnabledPins(mod);
    const modData = moduleLibrary[mod.id] || {};
    const wanted = {};
    document.querySelectorAll('#pin-edit-list input[type="checkbox"]').forEach(cb => { wanted[cb.dataset.pinSig] = cb.checked; });
    // 必需信号 / 必接电源脚强制勾选；BLK 等可选电源尊重当前勾选
    (modData.requirements || []).forEach(r => { if (!r.optional) wanted[r.signal] = true; });
    (modData.power_pins || []).forEach(pp => { if (isEssentialPower(pp.pin)) wanted[pp.pin] = true; });
    const presets = {};
    Object.keys(wanted).forEach(k => { presets[k] = wanted[k] === true; });
    savePinPreset(mod.id, presets, mod.customPins || []);
    uiToast(`已把【${modData.name}】的引脚组合存为该型号默认参数，下次添加自动套用`, { type: 'success', duration: 3600 });
}

/* 清除预设，恢复字典默认勾选 */
function resetPreset() {
    if (editingModuleIndex < 0) return;
    const mod = activeModules[editingModuleIndex];
    if (!mod) return;
    const modData = moduleLibrary[mod.id] || {};
    (mod.customPins || []).forEach(c => releaseSignal(mod, c));
    mod.customPins = [];
    clearPinPreset(mod.id);
    mod.enabledPins = defaultEnabledPins(modData);
    renderPinEditList();
    renderPins(); renderModules(); updatePowerBudget();
    if (typeof refreshWiringCanvas === 'function') refreshWiringCanvas();
    uiToast(`已恢复【${modData.name}】的字典默认引脚`, { type: 'success' });
}

function closePinEditModal() {
    const modal = document.getElementById('pin-edit-modal');
    if (modal) modal.style.display = 'none';
    editingModuleIndex = -1;
}

function executePinEdit() {
    if (editingModuleIndex < 0) return;
    const mod = activeModules[editingModuleIndex];
    if (!mod) return;
    const modData = moduleLibrary[mod.id] || {};
    ensureEnabledPins(mod);
    const pool = INTERFACE_PIN_POOL[modData.interface] || { power: [], signals: [] };

    const wanted = {};
    document.querySelectorAll('#pin-edit-list input[type="checkbox"]').forEach(cb => {
        wanted[cb.dataset.pinSig] = cb.checked;
    });
    // 锁定项强制保留（必需信号 / 必接电源脚；BLK 等可选电源尊重用户勾选）
    (modData.requirements || []).forEach(r => { if (!r.optional) wanted[r.signal] = true; });
    (modData.power_pins || []).forEach(pp => { if (isEssentialPower(pp.pin)) wanted[pp.pin] = true; });

    const prev = { ...mod.enabledPins };

    // 短接键 / 电源键 不参与 GPIO 分配
    const linkKeys = new Set();
    (modData.local_links || []).forEach(l => { linkKeys.add(l.from); linkKeys.add(l.to); });
    const powerKeys = new Set();
    (modData.power_pins || []).forEach(pp => powerKeys.add(pp.pin));
    (pool.power || []).forEach(ps => powerKeys.add(ps));

    // 1) 释放被取消信号的连接
    Object.keys(prev).forEach(sig => {
        if (prev[sig] !== false && wanted[sig] === false) releaseSignal(mod, sig);
    });

    // 2) 新勾选信号自动分配 GPIO（字典内新启用 或 扩展候选首次勾选；电源/短接除外）
    //    分配失败的信号保留勾选状态，在画布上显示为灰色点位，供用户手动拖线
    const allocFailed = [];
    Object.keys(wanted).forEach(sig => {
        if (wanted[sig] === true && prev[sig] !== true && !powerKeys.has(sig) && !linkKeys.has(sig) && !sig.includes('→')) {
            if (!allocateNewSignal(mod, sig, modData)) allocFailed.push(sig);
        }
    });
    if (allocFailed.length > 0) {
        uiToast(`以下引线暂无可用 GPIO：【${allocFailed.join('、')}】\n已保留勾选，可在画布上把这些灰色点位手动拖到目标引脚`, { type: 'warn', duration: 6000 });
    }

    mod.enabledPins = wanted;
    closePinEditModal();
    renderPins(); renderModules(); updatePowerBudget();
    if (typeof refreshWiringCanvas === 'function') refreshWiringCanvas();
}

/* 释放模组某信号的连接（共享总线保护：同信号其他模组仍占用则保留占用） */
function releaseSignal(mod, signal) {
    const pinStr = mod.connections[signal];
    if (!pinStr || pinStr === 'dropped') return;
    const pins = String(pinStr).split(',');
    pins.forEach(p => {
        const pNum = Number(p);
        if (pinsState[pNum] && pinsState[pNum].owner === mod.id) {
            const others = activeModules.filter(m => m.id !== mod.id && m.connections[signal] && String(m.connections[signal]).split(',').includes(String(pNum)));
            if (others.length > 0) {
                pinsState[pNum] = { state: 'used', owner: others[0].id, signal };
            } else {
                pinsState[pNum] = { state: 'free', owner: null, signal: null };
            }
        }
    });
    delete mod.connections[signal];
    // 清理总线池中无主引用
    let ifaceKey = mod.interface;
    if (ifaceKey && ifaceKey.includes('I2S')) ifaceKey = 'I2S';
    if (ifaceKey && activeBuses[ifaceKey] && activeBuses[ifaceKey][signal] !== undefined) {
        const used = activeModules.some(m => m.connections[signal] && String(m.connections[signal]).split(',').includes(String(activeBuses[ifaceKey][signal])));
        if (!used) delete activeBuses[ifaceKey][signal];
    }
}

/* 新勾选信号自动分配：总线信号优先并联共享，否则找空闲 GPIO */
function allocateNewSignal(mod, signal, modData) {
    const isBusSignal = ['SDA', 'SCL', 'MOSI', 'MISO', 'SCK', 'BCLK', 'LRC'].includes(signal);
    let ifaceKey = mod.interface || (modData ? modData.interface : '');
    if (ifaceKey && ifaceKey.includes('I2S')) ifaceKey = 'I2S';

    if (isBusSignal && ifaceKey && activeBuses[ifaceKey] && activeBuses[ifaceKey][signal] !== undefined) {
        // 并联共享现有总线引脚
        const bp = activeBuses[ifaceKey][signal];
        mod.connections[signal] = String(bp);
        pinsState[bp] = { state: 'used', owner: mod.id, signal };
        return true;
    }
    // 找空闲 GPIO（同时满足：可用列表内 + 画布上有这根排针）
    for (let i = 0; i <= boardConfig.max_pin; i++) {
        const st = pinsState[i];
        if (!st || st.state !== 'free') continue;
        if (boardConfig.availableGpios && !boardConfig.availableGpios.includes(i)) continue;
        if (!isHeaderPin(i)) continue;
        pinsState[i] = { state: 'used', owner: mod.id, signal };
        mod.connections[signal] = String(i);
        if (isBusSignal && ifaceKey) {
            if (!activeBuses[ifaceKey]) activeBuses[ifaceKey] = {};
            activeBuses[ifaceKey][signal] = i;
        }
        return true;
    }
    return false;
}

/* 软件区只有一个按钮位，两态二选一：
   导入了源码但还没适配 → 「去适配源码」；其余情况（含适配完成）→ 「生成代码骨架」 */
function updateSoftwareButtonsUI() {
    const skeleton = document.getElementById('btn-code-skeleton');
    const adapt = document.getElementById('btn-go-adapt');
    if (!skeleton || !adapt) return;

    const needAdapt = !!window.currentUploadedSource && !window.hasReplacedSource;
    skeleton.style.display = needAdapt ? 'none' : '';
    adapt.style.display = needAdapt ? '' : 'none';
}

// 剩余逻辑保持不变...
/* ==========================================
 * 引脚状态重建
 * 所有「删模组 / 释放引脚 / 板载设备换型」都走这里，
 * 避免各处手写一遍重放逻辑导致走样（原来 releasePin 与
 * executeOnboardReplace 各有一份，细节已经不一致）。
 * ========================================== */
const BUS_SIGNALS = new Set(['SDA', 'SCL', 'MOSI', 'MISO', 'SCK', 'BCLK', 'LRC']);

function normalizeIfaceKey(iface) {
    if (!iface) return '';
    return iface.includes('I2S') ? 'I2S' : iface;
}

function rebuildPinState() {
    initPins();
    activeBuses = { I2C: {}, SPI: {}, I2S: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
    activeModules.forEach(mod => {
        const iface = normalizeIfaceKey(mod.interface);
        Object.entries(mod.connections || {}).forEach(([signal, pinStr]) => {
            if (!pinStr || pinStr === 'dropped') return;
            String(pinStr).split(',').forEach(p => {
                const pNum = Number(p);
                if (!Number.isFinite(pNum) || !pinsState[pNum]) return;
                // 板载设备优先级最高：外接模组不得覆盖已焊接设备的引脚
                if (pinsState[pNum].state === 'onboard') return;
                pinsState[pNum] = { state: 'used', owner: mod.id, signal };
                if (iface && BUS_SIGNALS.has(signal) && activeBuses[iface]) {
                    activeBuses[iface][signal] = pNum;
                }
            });
        });
    });
}

async function releasePin(pinNum) {
    const st = pinsState[pinNum];
    if (!st) return;
    if (st.state === 'onboard') {
        uiAlert({
            title: '该引脚无法释放',
            body: `GPIO ${pinNum} 已被板载设备占用：${st.owner} · ${st.signal}。\n如需更换型号，请到左侧卡片点击「🔄 换」。`,
            danger: true
        });
        return;
    }
    if (st.state !== 'used') return;

    // 按 connections 反查真正占用该脚的模组，而不是依赖 owner 字段
    // （owner 存的是型号 id，同型号多块时无法区分，历史脏数据也可能对不上）
    let hitMod = null, hitSignal = null;
    for (const mod of activeModules) {
        for (const [signal, pinStr] of Object.entries(mod.connections || {})) {
            if (!pinStr || pinStr === 'dropped') continue;
            if (String(pinStr).split(',').map(Number).includes(pinNum)) { hitMod = mod; hitSignal = signal; break; }
        }
        if (hitMod) break;
    }

    const modData = hitMod ? moduleLibrary[hitMod.id] : null;
    const modName = modData ? modData.name : (hitMod ? hitMod.id : '未知模组');
    const remainCount = hitMod
        ? Object.values(hitMod.connections || {}).filter(v => v && v !== 'dropped').length
        : 0;
    const isLast = remainCount <= 1;

    const ok = await uiConfirm({
        title: isLast ? '移除这个模组？' : `断开 ${hitSignal} 引线？`,
        body: isLast
            ? `GPIO ${pinNum} 是【${modName}】的最后一条连线，释放后该模组将从工作台移除。`
            : `【${modName}】的 ${hitSignal} 会断开，其余引线保持不变。`,
        confirmText: isLast ? '移除模组' : '断开引线',
        danger: true
    });
    if (!ok) return;

    const snapshot = JSON.parse(JSON.stringify(activeModules));

    if (isLast && hitMod) {
        activeModules = activeModules.filter(m => m !== hitMod);
    } else if (hitMod) {
        const rest = String(hitMod.connections[hitSignal]).split(',').map(Number).filter(n => n !== pinNum);
        if (rest.length) hitMod.connections[hitSignal] = rest.join(',');
        else delete hitMod.connections[hitSignal];
    }

    rebuildPinState();
    renderPins(); renderModules(); updatePowerBudget();

    uiToast(isLast ? `已移除【${modName}】` : `已断开【${modName}】的 ${hitSignal}`, {
        type: 'warn',
        duration: 7000,
        action: {
            label: '撤销',
            onClick: () => {
                activeModules = snapshot;
                rebuildPinState();
                renderPins(); renderModules(); updatePowerBudget();
                uiToast('已撤销', { type: 'success', duration: 1600 });
            }
        }
    });
}

/* 移除单个外接模组（左侧列表与接线图共用）
   板载设备不在 activeModules 里，天然走不到这里；这里再兜一层，防止误删焊接件。 */
async function removeActiveModule(modIndex, opts) {
    const mod = activeModules[modIndex];
    if (!mod) return;
    const modData = moduleLibrary[mod.id] || {};
    const name = modData.name || mod.name || mod.id;
    const wiredCount = Object.values(mod.connections || {}).filter(v => v && v !== 'dropped').length;

    // 源码解析带进来的工程：这里只做「从工作台移除」，源码一个字都不改。
    // 删掉的只是这张接线图上的对象，固件里那段初始化代码还在，所以必须当面说清楚。
    const hasSource = !!window.currentUploadedSource;
    let srcVars = '';
    if (hasSource && typeof currentMappingData !== 'undefined' && Array.isArray(currentMappingData)) {
        // 映射表里记录了「源码变量 ↔ 当前接入的实物模组」，能对上就把涉及的宏名列出来
        const matched = currentMappingData
            .filter(r => r && r.varName && (r.physicalModule === name || r.physicalModule === (modData.name || '')))
            .map(r => `${r.varName} = ${r.sourcePinNum}`);
        const uniq = [...new Set(matched)];
        if (uniq.length) srcVars = uniq.slice(0, 6).join('、') + (uniq.length > 6 ? ` 等 ${uniq.length} 条` : '');
    }

    if (!(opts && opts.skipConfirm)) {
        const lines = [];
        lines.push(wiredCount
            ? `它的 ${wiredCount} 根连线会一并释放，占用的 GPIO 重新变回可用。板载设备不受影响。`
            : '这个模组还没有接线，移除后可从「添加模组」重新加入。');
        if (hasSource) {
            lines.push('');
            lines.push(`源码不会被改动：「${window.currentUploadedSource.fileName || '当前工程'}」里的引脚定义原样保留，编译出的固件仍然会初始化这个设备。`);
            if (srcVars) lines.push(`涉及的定义：${srcVars}`);
            lines.push('要让固件里也彻底去掉它，需打开该工程的 config.h，把这几根脚改成 GPIO_NUM_NC，或关掉对应的功能开关。');
        }
        const ok = await uiConfirm({
            title: `从工作台移除【${name}】？`,
            body: lines.join('\n'),
            confirmText: '移除',
            danger: true
        });
        if (!ok) return;
    }

    const snapshot = JSON.parse(JSON.stringify(activeModules));
    const cartSnapshot = (typeof cartSelectedModules !== 'undefined' && Array.isArray(cartSelectedModules))
        ? JSON.parse(JSON.stringify(cartSelectedModules)) : null;

    activeModules = activeModules.filter(m => m !== mod);
    // 购物车同步移除一条同名记录（同型号接多块时只删一条，别把其余的也删掉）
    if (cartSnapshot) {
        const ci = cartSelectedModules.findIndex(m => !m.isOnboard && m.id === mod.id);
        if (ci >= 0) cartSelectedModules.splice(ci, 1);
    }

    const refreshAll = () => {
        if (typeof rebuildPinState === 'function') rebuildPinState();
        renderPins(); renderModules(); updatePowerBudget();
        if (typeof updateSoftwareButtonsUI === 'function') updateSoftwareButtonsUI();
        if (typeof refreshSmartPanelIfStale === 'function') refreshSmartPanelIfStale();
        if (typeof updateDiagChip === 'function') updateDiagChip();
    };
    refreshAll();

    if (typeof uiToast === 'function') {
        uiToast(`已从工作台移除【${name}】${hasSource ? '（源码未改）' : ''}`, {
            type: 'warn',
            duration: 7000,
            action: {
                label: '撤销',
                onClick: () => {
                    activeModules = snapshot;
                    if (cartSnapshot) cartSelectedModules = cartSnapshot;
                    refreshAll();
                    uiToast('已撤销', { type: 'success', duration: 1600 });
                }
            }
        });
    }
}

async function clearActiveModules() {
    if (activeModules.length === 0) return;
    const ok = await uiConfirm({
        title: '清空外接模组？',
        body: '已焊接的板载设备（如摄像头）会保留，外接模组与它们的接线将全部移除。',
        confirmText: '清空',
        danger: true
    });
    if (!ok) return;

    activeModules = [];
    window.currentUploadedSource = null; 
    window.hasReplacedSource = false; 
    
    if (typeof cartSelectedModules !== 'undefined') cartSelectedModules = cartSelectedModules.filter(m => m.isOnboard);
    
    initPins();
    renderPins();
    renderModules();
    updatePowerBudget();
    updateSoftwareButtonsUI();
}

// 🔥 购物车沙盘推演（修改点，传入虚拟总线池）
function confirmCartAndAllocate() {
    if (cartSelectedModules.length === 0) {
        uiAlert({ title: '还没有选择模组', body: '请先在左侧列表里点选需要接入的模组，再点「确认并智能分配」。', icon: '🧩' });
        return;
    }

    let virtualPinsState = {};
    for (let i = 0; i <= boardConfig.max_pin; i++) { if(pinsState[i]) virtualPinsState[i] = { ...pinsState[i] }; }
    let virtualBuses = JSON.parse(JSON.stringify(activeBuses));

    let successCount = 0; let failedModules = []; let downgradeCandidate = null; let successfullyAllocatedData = [];

    cartSelectedModules.forEach(item => {
        if (item.isOnboard) { successCount++; item.failed = false; return; }

        const modId = item.id;
        const modData = moduleLibrary[modId];
        if(!modData) return;

        let pinsStateCopy = JSON.parse(JSON.stringify(virtualPinsState));
        let busesCopy = JSON.parse(JSON.stringify(virtualBuses)); // 🔥 每次给一个独立的沙盘

        const result = tryAllocate(modData, pinsStateCopy, busesCopy);

        if (result.missingRequired.length > 0) {
            failedModules.push(modData.name); item.failed = true; 
            if (modData.can_downgrade && !downgradeCandidate) downgradeCandidate = modId;
        } else {
            for (let i = 0; i <= boardConfig.max_pin; i++) { 
                if (pinsStateCopy[i] && pinsStateCopy[i].state === 'used') virtualPinsState[i] = { ...pinsStateCopy[i] }; 
            }
            virtualBuses = busesCopy; // 🔥 同步回全局虚拟总线池
            successCount++; item.failed = false;
            successfullyAllocatedData.push({ id: modId, allocations: result.allocations, overrides: item.overrides });
        }
    });

    if (failedModules.length === 0) {
        activeModules = [];
        initPins();
        successfullyAllocatedData.forEach(data => { commitAllocation(data.id, data.allocations, data.overrides); checkWifiAdcConflict(data.id); });

        renderPins(); renderModules(); updatePowerBudget(); closeCartModal();
    } else {
        renderCartRightList(); 
        if (downgradeCandidate) {
            pendingDowngradeModuleId = downgradeCandidate;
            pendingFailedModules = failedModules;
            const dModData = moduleLibrary[downgradeCandidate]; const rule = dModData.downgrade_rule;
            document.getElementById('downgrade-options').innerHTML = `
                <div style="margin-bottom:10px; font-weight:bold; color:#333;">发现 <span style="color:#007bff;">【${dModData.name}】</span> 支持降级模式：</div>
                <div style="font-size:13px; color:#666; margin-bottom:10px;">将 ${rule.signal} 数据线从 ${rule.from_count} 根裁剪至 ${rule.to_count} 根。</div>
                <div style="color:#856404; background:#fff3cd; padding:8px; border-radius:4px; font-size:12px;">⚠️ ${rule.warning}</div>
            `;
            document.getElementById('downgrade-modal').style.display = 'flex';
        }
    }
}

function cancelDowngrade() {
    document.getElementById('downgrade-modal').style.display = 'none';
    pendingDowngradeModuleId = null; pendingFailedModules = [];
}

function executeDowngrade() {
    document.getElementById('downgrade-modal').style.display = 'none';
    if (!pendingDowngradeModuleId) return;

    const modId = pendingDowngradeModuleId; const modData = moduleLibrary[modId]; const rule = modData.downgrade_rule;
    const req = modData.requirements.find(r => r.signal === rule.signal);
    if (req) req.count = rule.to_count;

    confirmCartAndAllocate();
    if (req) req.count = rule.from_count;

    pendingDowngradeModuleId = null; pendingFailedModules = [];
}

function updatePowerBudget() {
    let totalCurrent = 0;
    if (typeof _onboardSlots !== 'undefined') _onboardSlots.forEach(slot => totalCurrent += resolveOnboardPeak(slot));
    if (typeof activeModules !== 'undefined') {
        activeModules.forEach(mod => {
            const mData = moduleLibrary[mod.id];
            if (!mData) return;
            const isPure5V = mData.power_pins && mData.power_pins.some(p => p.connect_to === '5V') && !mData.power_pins.some(p => p.connect_to === '3.3V');
            if (isPure5V) return; 
            totalCurrent += (mod.overrides?.current !== undefined ? mod.overrides.current : (mData.peak_current_ma || 0));
        });
    }
    
    const maxCurrent = (typeof boardConfig !== 'undefined' && boardConfig.max_current_ma) ? boardConfig.max_current_ma : 500;
    // 条形宽度最多 100%，但文字必须显示真实百分比：130% 被截成 100% 的话，超载看起来和「刚好满载」一样
    const rawPercent = Math.round((totalCurrent / maxCurrent) * 100);
    const percent = Math.min(100, rawPercent);
    const powerBar = document.getElementById('power-bar'); const powerText = document.getElementById('power-text');
    
    if (powerBar && powerText) {
        powerBar.style.width = `${percent}%`;
        powerText.innerText = `${totalCurrent} mA / ${maxCurrent} mA (${rawPercent}%)`;
        if (rawPercent > 100) { powerBar.style.background = '#dc3545'; powerText.style.color = '#dc3545'; }
        else if (percent >= 90) { powerBar.style.background = '#dc3545'; powerText.style.color = '#dc3545'; } 
        else if (percent >= 70) { powerBar.style.background = '#ffc107'; powerText.style.color = '#d39e00'; } 
        else { powerBar.style.background = '#28a745'; powerText.style.color = '#28a745'; }
    }
}

function openCodeGeneratorModal() {
    if (activeModules.length === 0) {
        uiAlert({ title: '还没有接入模组', body: '请先添加模组并完成引脚分配，再生成代码。', icon: '🧩' });
        return;
    }
    document.getElementById('code-generator-modal').style.display = 'flex';
    generateCodeForModal();
    const btn = document.getElementById('btn-copy-code-modal'); const pre = document.getElementById('code-preview-modal');
    if (btn && pre) {
        btn.onclick = () => {
            copyTextToClipboard(pre.innerText).then((ok) => {
                if (!ok) { uiToast('自动复制被浏览器拦截，请手动全选复制', { type: 'warn' }); return; }
                const origText = btn.innerText; btn.innerText = '✅ 已复制!'; btn.style.background = '#28a745';
                setTimeout(() => { btn.innerText = origText; btn.style.background = '#007bff'; }, 2000);
            });
        };
    }
}

function closeCodeGeneratorModal() { document.getElementById('code-generator-modal').style.display = 'none'; }

/* =========================================================
 * 代码骨架
 *
 * 两种来源，产物必须不一样：
 *
 * 1) 源码解析来的（_sourceMeta 有值 + currentMappingData 有适配表）
 *    必须沿用源码里的原宏名。小智的 board.cc 写的是
 *    `DISPLAY_MOSI_GPIO`、`AUDIO_I2S_MIC_GPIO_SCK`，我们要是自己另起
 *    一个名字（比如 SPI_TFT_MOSI），贴回去就是一堆未定义标识符，直接编译失败。
 *    所以这里只输出「替换哪几行」，并提醒不要整体覆盖 config.h。
 *
 * 2) 纯手工搭接线（没有源码）
 *    没有原宏名可依，只能自己造。造名字有坑：模组名是中文的
 *    （"1.69寸屏"）会把非字母数字全替换成下划线，得到 `1_69__` ——
 *    以数字开头，是非法标识符。这里统一清洗，兜底加 M_ 前缀。
 * ========================================================= */

/* 任意字符串 → 合法 C 标识符 */
function toMacroIdent(s) {
    let t = String(s || '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
    if (!t) return '';
    if (!/^[A-Z_]/.test(t)) t = 'M_' + t;   // 标识符不能以数字开头
    return t;
}

/* 源码模式：还原「原宏名 → 当前引脚」
   引脚优先读画布实时接线（用户可能注入后又手动改过脚），读不到才退回适配结果 */
function buildSourceDefineRows() {
    if (typeof window._sourceMeta === 'undefined' || !window._sourceMeta) return null;
    if (typeof currentMappingData === 'undefined' || !currentMappingData || !currentMappingData.length) return null;

    const rows = currentMappingData.map(m => {
        const wired = !!(m.physicalModule && m.physicalModule !== '(未接)');
        // 没接线的宏一律保持源码原值：用户没接，就没有理由改源码里的数字
        let pin = wired ? m.targetPin : m.sourcePinNum;
        if (wired) {
            const mod = activeModules.find(x => {
                const d = (typeof moduleLibrary !== 'undefined' && moduleLibrary) ? moduleLibrary[x.id] : null;
                return d && d.name === m.physicalModule;
            });
            if (mod && m.physicalSignal) {
                const key = Object.keys(mod.connections || {}).find(k => k.toUpperCase() === String(m.physicalSignal).toUpperCase());
                const cur = key ? mod.connections[key] : null;
                if (cur && cur !== 'dropped') pin = String(cur).split(',')[0].trim();
            }
        }
        return {
            varName: m.varName,
            pin: String(pin),
            sourcePin: String(m.sourcePinNum),
            wired: !!wired,
            inactive: !!m.inactive,
            lineIndex: (m.lineIndex === undefined ? 0 : m.lineIndex)
        };
    }).filter(r => r.varName);

    if (!rows.length) return null;
    rows.sort((a, b) => a.lineIndex - b.lineIndex);   // 按源码原顺序，方便逐行对照
    return rows;
}

function generateSourceConfigSnippet(rows) {
    const meta = window._sourceMeta || {};
    const repo = (meta.owner && meta.repo) ? `${meta.owner}/${meta.repo}` : '';
    const rev = meta.commit ? ` @ ${String(meta.commit).slice(0, 7)}` : '';
    const where = meta.dir ? `${meta.dir}/config.h` : 'config.h';
    const w = Math.max(...rows.map(r => r.varName.length), 8);

    let code = `/* 贴回小智源码：${where}\n`;
    if (repo) code += ` * 来源：${repo}${rev}\n`;
    code += ` *\n`;
    code += ` * 只改这些行（同名行原地改数值），其余行保持原样。\n`;
    code += ` * 不要用这份内容整体覆盖 config.h —— 原文件里还有\n`;
    code += ` * AUDIO_I2S_METHOD_SIMPLEX 这类非引脚宏，覆盖会丢。\n */\n\n`;
    rows.forEach(r => {
        const mark = r.inactive ? '   // 未启用（当前是单工模式），保持原值'
            : !r.wired ? '   // 未接线，保持源码原值'
            : (r.pin !== r.sourcePin ? `   // 源码原值 ${r.sourcePin}` : '');
        code += `#define ${r.varName.padEnd(w)}  ${r.pin}${mark}\n`;
    });
    return code;
}

function generateGenericPinConfigCode() {
    let code = `/*\n * 通用引脚配置（自己搭的接线，没有源码可依）\n * 平台: ${boardConfig.boardName}\n */\n\n#ifndef PIN_CONFIG_H\n#define PIN_CONFIG_H\n\n`;
    if (activeModules.length === 0) { code += `// 当前未接入外接模组\n\n`; }
    else {
        activeModules.forEach((mod, mi) => {
            const modData = moduleLibrary[mod.id];
            const name = modData ? modData.name : (mod.name || '未知模组');
            // 前缀用英文 id（spi_tft → SPI_TFT）；中文名清洗后可能为空，再用序号兜底
            const prefix = toMacroIdent(mod.id) || toMacroIdent(name) || `MODULE_${mi + 1}`;
            code += `/* --- ${name} --- */\n`;
            for (const [signal, pinNum] of Object.entries(mod.connections)) {
                if (pinNum === 'dropped') continue;
                const sig = toMacroIdent(signal) || 'PIN';
                const pins = String(pinNum).split(',');
                if (pins.length > 1) pins.forEach((p, i) => { code += `#define ${prefix}_${sig}_${i}  ${p.trim()}\n`; });
                else code += `#define ${prefix}_${sig}  ${pins[0].trim()}\n`;
            }
            code += '\n';
        });
    }
    code += `#endif // PIN_CONFIG_H\n\n`;
    return code;
}

function generatePinConfigCode() {
    const rows = buildSourceDefineRows();
    return rows ? generateSourceConfigSnippet(rows) : generateGenericPinConfigCode();
}

function generateMainInoTemplate() {
    let code = `#include "pin_config.h"\n`;
    const hasI2C = activeModules.some(m => m.interface === 'I2C'); const hasSPI = activeModules.some(m => m.interface === 'SPI');
    if (hasI2C) code += `#include <Wire.h>\n`; if (hasSPI) code += `#include <SPI.h>\n`; if (hasI2C || hasSPI) code += `\n`;
    code += `void setup() {\n  Serial.begin(115200);\n\n`;
    if (hasI2C) { const sda = activeBuses.I2C?.SDA || '...'; const scl = activeBuses.I2C?.SCL || '...'; code += `  Wire.begin(${sda}, ${scl});\n`; }
    if (hasSPI) { const sck = activeBuses.SPI?.SCK || '...'; const miso = activeBuses.SPI?.MISO || -1; const mosi = activeBuses.SPI?.MOSI || '...'; const cs = activeBuses.SPI?.CS || -1; code += `\n  SPI.begin(${sck}, ${miso}, ${mosi}, ${cs});\n`; }
    code += `\n  // TODO: 在此添加其他外设的初始化代码\n}\n\nvoid loop() {\n  // 你的业务逻辑\n}\n`;
    return code;
}

function generateCodeForModal() {
    const pre = document.getElementById('code-preview-modal');
    if (!pre) return;
    const titleEl = document.querySelector('#code-generator-modal .modal-title');
    if (buildSourceDefineRows()) {
        // 源码模式：只给要替换的 #define 行。小智是 ESP-IDF 工程，
        // 塞一个 main.ino 进去毫无意义，反而误导
        pre.innerText = generatePinConfigCode();
        if (titleEl) titleEl.innerText = '📄 代码骨架 · 贴回源码 config.h';
    } else {
        pre.innerText = generatePinConfigCode() + "\n// 以下是可直接使用的 main.ino 模板\n\n" + generateMainInoTemplate();
        if (titleEl) titleEl.innerText = '📄 代码骨架 · pin_config.h + main.ino';
    }
}

/* 复制纯文本到剪贴板：https/localhost 走异步 API，file:// 打开时降级到 execCommand */
function copyTextToClipboard(text) {
    const legacy = () => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) {
            return false;
        }
    };
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).then(() => true).catch(legacy);
    }
    return Promise.resolve(legacy());
}
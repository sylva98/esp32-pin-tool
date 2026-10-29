// ==========================================
// 接线图画布引擎 (svg-exporter.js) v2
// 常驻无限缩放画布：主板 + 模组 + 手动拖线交互
// 颜色约定：已接=紫 未接=灰 GND=绿 VCC=红 短接=绿虚线 板载=蓝 固定=灰 启动敏感=黄
// ==========================================

/* ---------- 全局状态 ---------- */
let currentRenderData = null;
let currentScale = 1;
let isSpacePressed = false;
let currentTranslateX = 0;
let currentTranslateY = 0;
let _canvasInited = false;

const COLOR_CONNECTED = '#a78bfa';   // 紫：已接
const COLOR_CONNECT_LINE = '#8b5cf6';
const COLOR_FREE = '#e5e7eb';        // 未接/空闲
const COLOR_GND = '#22c55e';         // 绿
const COLOR_PWR = '#ef4444';         // 红
const COLOR_ONBOARD = '#60a5fa';     // 蓝：板载
const COLOR_STRAP = '#fbbf24';       // 黄：启动敏感
const COLOR_FIXED = '#6b7280';       // 灰：系统占用

/* ---------- 对外：刷新画布（由 renderPins 联动调用） ---------- */
function refreshWiringCanvas() {
    try {
        const wrapper = document.getElementById('wiring-canvas-wrapper');
        if (!wrapper) return;
        if (!boardConfig) return;
        if (currentRenderData) {
            const curIds = [...currentRenderData.leftModules, ...currentRenderData.rightModules].map(m => m.id).sort().join(',');
            const newIds = (typeof activeModules !== 'undefined' ? activeModules : []).map(m => m.id).sort().join(',');
            // 换了主控必须整体重排：排针数量、丝印、板身高度全都变了，
            // 只比对模组 id 会让画布继续显示上一块板的针脚（CAM 20 针 / WROOM 22 针最容易露馅）
            const boardChanged = currentRenderData.boardName !== boardConfig.boardName;
            if (boardChanged) {
                currentScale = 1;
                currentTranslateX = 0;
                currentTranslateY = 0;
                if (typeof updateTransform === 'function') updateTransform();
                if (typeof updateZoomLabel === 'function') updateZoomLabel();
            }
            if (boardChanged || curIds !== newIds) resetWiringLayout(false);
            else {
                // 同步 enabledPins 勾选变化（取消/勾选引线后重建引脚列表）
                refreshModulePins(currentRenderData);
                buildFullSVG();
            }
        } else {
            resetWiringLayout(false);
        }
    } catch (e) { console.error('刷新画布失败', e); }
}

/* ---------- 布局存储 ---------- */
function getLayoutStorageKey() {
    if (typeof boardConfig === 'undefined' || typeof activeModules === 'undefined') return null;
    const modsStr = activeModules.map(m => m.id).sort().join('_');
    return `wiring_layout_${boardConfig.boardName}_${modsStr}`;
}
function saveLayoutToStorage() {
    const key = getLayoutStorageKey();
    if (!key || !currentRenderData) return;
    const layoutData = {};
    [...currentRenderData.leftModules, ...currentRenderData.rightModules].forEach(m => { layoutData[m.id] = { x: m.x, y: m.y }; });
    localStorage.setItem(key, JSON.stringify(layoutData));
}
function loadLayoutFromStorage() {
    const key = getLayoutStorageKey();
    if (!key) return;
    try {
        const saved = JSON.parse(localStorage.getItem(key));
        if (saved) {
            [...currentRenderData.leftModules, ...currentRenderData.rightModules].forEach(m => {
                if (saved[m.id]) { m.x = saved[m.id].x; m.y = saved[m.id].y; }
            });
        }
    } catch (e) { console.warn('读取布局失败', e); }
}

/* ---------- 画布初始化（常驻） ---------- */
function initCanvas() {
    if (_canvasInited) return;
    _canvasInited = true;
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    if (!wrapper) return;
    const container = document.getElementById('svg-container');
    if (!container) return;

    resetWiringLayout(false);
    bindCanvasEvents();
    updateZoomLabel();
}

/* ---------- 布局计算 ---------- */
function initDiagramData() {
    const pinSpacing = 36;
    const boardWidth = 280;
    const boardPaddingY = 60;
    const moduleWidth = 170;
    const moduleGap = 40;

    const leftPins = boardConfig.pinLayout?.left || [];
    const rightPins = boardConfig.pinLayout?.right || [];
    const maxPins = Math.max(leftPins.length, rightPins.length);
    const boardHeight = boardPaddingY + (maxPins * pinSpacing) + 40;

    // 点位 key 一律用真实 GPIO 号（TX→43、IO4→4），这样「模组接在 43」和「画布上画的 43」是同一个点；
    // 电源/地等非 GPIO 丝印按丝印做 key，并允许重复（WROOM 有 3 个 GND、2 个 3V3），否则会被合并丢掉
    const bPinsMap = {};
    const addBoardPin = (raw, side, idx) => {
        const gpio = (typeof resolveBoardPinToken === 'function') ? resolveBoardPinToken(boardConfig, raw) : null;
        const baseKey = gpio !== null ? String(gpio) : String(raw).trim().toUpperCase();
        let key = baseKey;
        let dup = 1;
        while (bPinsMap[key]) key = `${baseKey}#${dup++}`;
        bPinsMap[key] = { relY: boardPaddingY + idx * pinSpacing, side, label: String(raw).trim(), gpio };
    };
    leftPins.forEach((p, i) => addBoardPin(p, 'left', i));
    rightPins.forEach((p, i) => addBoardPin(p, 'right', i));

    const resolvePin = (pinName) => {
        if (!pinName) return null;
        const name = String(pinName).trim().toUpperCase();
        for (const key in bPinsMap) { if (key.toUpperCase() === name) return key; }
        const gpioMatch = name.match(/GPIO\s*(\d+)/);
        const targetNum = gpioMatch ? gpioMatch[1] : name;
        for (const key in bPinsMap) { if (key.toUpperCase() === targetNum || extractPinNum(key) === targetNum) return key; }
        return null;
    };

    const isPowerOrGnd = (sig) => {
        const s = (sig || '').toUpperCase();
        return ['VCC', '5V', '3.3V', '3V3', 'VIN', 'GND', 'GROUND'].includes(s);
    };

    const leftModules = [];
    const rightModules = [];

    const dPartial = { bPinsMap };
    activeModules.forEach((mod, modIdx) => {
        const libData = (typeof moduleLibrary !== 'undefined' && moduleLibrary[mod.id]) ? moduleLibrary[mod.id] : { name: mod.id };
        const modData = { id: mod.id, name: libData.name, modIndex: modIdx };
        modData.enabledPins = mod.enabledPins || defaultEnabledPins(libData);
        const built = buildModulePins(mod, libData, dPartial);
        modData.signalPins = built.signalPins;
        modData.pins = built.pins;

        const validPins = modData.signalPins.filter(p => p.pin);
        let lCount = validPins.filter(p => bPinsMap[p.pin].side === 'left').length;
        let rCount = validPins.length - lCount;

        modData.height = 40 + (modData.pins.length * pinSpacing);
        modData.side = lCount > rCount ? 'left' : 'right';

        if (modData.side === 'left') leftModules.push(modData);
        else rightModules.push(modData);
    });

    const layoutModules = (mods) => {
        mods.forEach(mod => {
            const validPins = mod.signalPins.filter(p => p.pin);
            let maxRelY = -999, minRelY = 9999;
            validPins.forEach(p => {
                const relY = bPinsMap[p.pin].relY;
                if (relY > maxRelY) maxRelY = relY;
                if (relY < minRelY) minRelY = relY;
            });
            mod.targetY = validPins.length > 0 ? (maxRelY + minRelY) / 2 : 0;
        });
        mods.sort((a, b) => a.targetY - b.targetY);

        let currentY = -60;
        mods.forEach(m => {
            const validCount = m.signalPins.filter(p => p.pin).length;
            let idealY = m.targetY - (validCount * pinSpacing) / 2;
            if (validCount === 1) idealY = m.targetY - 30;
            m.y = Math.max(currentY, idealY);
            currentY = m.y + m.height + moduleGap;
        });
    };
    layoutModules(leftModules);
    layoutModules(rightModules);

    const canvasWidth = 4000;
    const canvasHeight = 4000;

    const boardX = canvasWidth / 2 - boardWidth / 2;
    const boardY = canvasHeight / 2 - boardHeight / 2;

    const leftModX = boardX - moduleWidth - 180;
    const rightModX = boardX + boardWidth + 180;

    leftModules.forEach(m => { m.y = m.y + boardY + 100; m.x = leftModX; });
    rightModules.forEach(m => { m.y = m.y + boardY + 100; m.x = rightModX; });

    return { boardName: boardConfig.boardName, boardX, boardY, boardWidth, boardHeight, pinSpacing, leftPins, rightPins, bPinsMap, leftModules, rightModules, canvasWidth, canvasHeight, moduleWidth, leftModX, rightModX };
}

/* ---------- 主板引脚颜色（含拖线候选态） ---------- */
function boardPinColor(pinNum, isCandidate, isStrongCandidate) {
    const st = pinsState && pinsState[pinNum];
    if (isStrongCandidate) return '#ffffff';
    if (isCandidate) return '#fde68a';
    if (!st) return COLOR_FIXED;
    if (st.state === 'used') return COLOR_CONNECTED;
    if (st.state === 'onboard') return COLOR_ONBOARD;
    if (st.state === 'strapping') return COLOR_STRAP;
    if (st.state === 'fixed') return COLOR_FIXED;
    return COLOR_FREE;
}

/* ---------- 模组引脚状态 ---------- */
function getActiveModConnections(modId) {
    const am = (typeof activeModules !== 'undefined') ? activeModules.find(m => m.id === modId) : null;
    return am ? am.connections : null;
}
function isSignalConnected(mod, rawSig) {
    const conns = mod.connections || getActiveModConnections(mod.id);
    if (!conns) return false;
    return conns[rawSig] !== undefined && conns[rawSig] !== 'dropped' && conns[rawSig] !== '';
}
function isSignalConnectedToPin(mod, rawSig, pinNum) {
    const conns = mod.connections || getActiveModConnections(mod.id);
    if (!conns || conns[rawSig] === undefined || conns[rawSig] === 'dropped' || conns[rawSig] === '') return false;
    return String(conns[rawSig]).split(',').map(s => s.trim()).includes(String(pinNum));
}

/* ---------- SVG 渲染 ---------- */

/* ---------- 模块引脚列表构建（requirements 为准，未接信号灰显可拖） ---------- */
/* SVG 文本不会自动换行或省略，模组名一长就顶出卡片边框（还会和右上角删除角标挤在一起）。
   这里按「中文 1em / 其他 0.58em」估算宽度，超宽先去掉末尾括号里的规格（(8PIN)/(I2S)），
   仍然超宽才截断加省略号，完整名称始终留在 <title> 里。 */
function svgTextWidth(str, fontSize) {
    let w = 0;
    for (const ch of String(str == null ? '' : str)) {
        w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58;
    }
    return w;
}

function svgEllipsize(text, fontSize, maxWidth) {
    const str = String(text == null ? '' : text);
    if (svgTextWidth(str, fontSize) <= maxWidth) return str;
    const ellW = fontSize * 0.9;
    let out = '', w = 0;
    for (const ch of str) {
        const cw = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58;
        if (w + cw > maxWidth - ellW) break;
        out += ch; w += cw;
    }
    return out + '…';
}

/* 模组卡片标题：整名放不下就先砍掉括号补充信息，再不行才省略 */
function svgModuleTitle(name, fontSize, maxWidth) {
    const full = String(name == null ? '' : name);
    if (svgTextWidth(full, fontSize) <= maxWidth) return full;
    const stripped = full.replace(/\s*[\(（][^\)）]*[\)）]\s*$/, '');
    if (stripped && stripped !== full && svgTextWidth(stripped, fontSize) <= maxWidth) return stripped;
    return svgEllipsize(full, fontSize, maxWidth);
}

function buildModulePins(mod, libData, d) {
    ensureEnabledPins(mod);
    const pinEnabled = (sig) => !(mod.enabledPins && mod.enabledPins[sig] === false);
    const resolvePin = (pinName) => {
        if (!pinName) return null;
        const name = String(pinName).trim().toUpperCase();
        for (const key in d.bPinsMap) { if (key.toUpperCase() === name) return key; }
        const gpioMatch = name.match(/GPIO\s*(\d+)/);
        const targetNum = gpioMatch ? gpioMatch[1] : name;
        for (const key in d.bPinsMap) { if (key.toUpperCase() === targetNum || key === targetNum) return key; }
        return null;
    };
    const isPowerOrGnd = (sig) => {
        const s = (sig || '').toUpperCase();
        return ['VCC', '5V', '3.3V', '3V3', 'VIN', 'GND', 'GROUND'].includes(s);
    };

    const signalPins = [];
    const otherPins = [];

    // 电源脚（字典定义；加粗必接的 VCC/GND 恒画，BLK 等可选电源取消勾选则不画）
    if (libData.power_pins) {
        const liveConnEarly = (typeof activeModules !== 'undefined' && activeModules)
            ? ((activeModules.find(m => m.id === mod.id) || {}).connections || {})
            : {};
        libData.power_pins.forEach(pp => {
            if (mod.enabledPins && mod.enabledPins[pp.pin] === false) return;
            const gpioVal = liveConnEarly[pp.pin];
            const asGpio = gpioVal !== undefined && gpioVal !== 'dropped' && /^\d+$/.test(String(gpioVal));
            let sigLabel = pp.pin;
            if (asGpio) {
                // 电源/使能脚改接 GPIO（典型：BLK 做 PWM 调光）时标出真实脚号，
                // 否则会出现「BLK(3.3V)」却连着 GPIO21 这种自相矛盾的显示
                sigLabel = `${pp.pin} · IO${gpioVal}`;
            } else if (['VCC', '5V', '3.3V', '3V3', 'VIN', 'BLK'].includes(pp.pin.toUpperCase())) {
                // 电源脚标签带上供电轨：VCC(3.3V) / BLK(3.3V)，GND 保持原样
                sigLabel = `${pp.pin}(${pp.connect_to})`;
            }
            otherPins.push({ signal: sigLabel, isPower: true, pin: resolvePin(pp.connect_to), rawSig: pp.pin });
        });
    }
    // 扩展电源（勾选的接口族候选电源脚，按实物补充）
    const pool = (typeof INTERFACE_PIN_POOL !== 'undefined' && INTERFACE_PIN_POOL[libData.interface]) ? INTERFACE_PIN_POOL[libData.interface] : null;
    if (pool && pool.power) {
        pool.power.forEach(psig => {
            if (mod.enabledPins && mod.enabledPins[psig] === true && !otherPins.some(p => p.rawSig === psig)) {
                const target = inferPowerTarget(psig, libData);
                const sigLabel = ['VCC', '5V', '3.3V', '3V3', 'VIN'].includes(String(psig).toUpperCase()) ? `${psig}(${target})` : psig;
                otherPins.push({ signal: sigLabel, isPower: true, pin: resolvePin(target), rawSig: psig });
            }
        });
    }
    // 本地短接脚（from 被取消勾选则整对隐藏）
    if (libData.local_links && libData.local_links.length > 0) {
        libData.local_links.forEach(link => {
            if (!pinEnabled(link.from)) return;
            if (!otherPins.some(p => p.rawSig === link.from)) otherPins.push({ signal: link.from, isPower: false, isLocalLink: true, rawSig: link.from });
            if (!otherPins.some(p => p.rawSig === link.to)) otherPins.push({ signal: link.to, isPower: false, isLocalLink: true, rawSig: link.to });
        });
    }

    // 信号引脚：以 requirements 为准（未接也显示灰色，可拖）
    const activeMod = (typeof activeModules !== 'undefined') ? activeModules.find(m => m.id === mod.id) : null;
    const conns = activeMod ? activeMod.connections : {};
    const reqs = libData.requirements || [];
    reqs.forEach(req => {
        if (!pinEnabled(req.signal)) return;
        const count = req.count || 1;
        const connVal = conns[req.signal];
        // label = 模块丝印名（如 TFT 的 SDA/SCL），signal = 内部标准信号名（MOSI/SCK），保证总线复用逻辑不变
        const displayLabel = req.label || req.signal;
        if (connVal && connVal !== 'dropped') {
            const pins = String(connVal).split(',');
            for (let i = 0; i < count; i++) {
                const resolved = resolvePin(String(pins[i] || '').trim());
                signalPins.push({ pin: resolved, signal: req.signal, label: displayLabel, isPower: false, rawSig: req.signal });
            }
        } else {
            for (let i = 0; i < count; i++) {
                signalPins.push({ pin: null, signal: req.signal, label: displayLabel, isPower: false, rawSig: req.signal });
            }
        }
    });

    // 扩展信号（勾选后分配进 connections、但不在 requirements 的字典外引脚，如 RST/INT/BLK）
    if (activeMod && activeMod.connections) {
        Object.keys(activeMod.connections).forEach(sig => {
            if (sig === 'dropped') return;
            if (reqs.some(r => r.signal === sig)) return;
            if (!pinEnabled(sig)) return;
            const connVal = activeMod.connections[sig];
            String(connVal).split(',').forEach(pinStr => {
                const resolved = resolvePin(String(pinStr || '').trim());
                signalPins.push({ pin: resolved, signal: sig, isPower: false, rawSig: sig });
            });
        });
    }

    // 自定义引线（用户按实物添加的池外引线名；未接也显示灰色点位，可手动拖线）
    (mod.customPins || []).forEach(cSig => {
        if (!pinEnabled(cSig)) return;
        if (reqs.some(r => r.signal === cSig)) return;
        if (signalPins.some(p => p.rawSig === cSig)) return; // 已分配，扩展段已渲染
        const connVal = activeMod && activeMod.connections ? activeMod.connections[cSig] : undefined;
        if (connVal && connVal !== 'dropped') {
            String(connVal).split(',').forEach(pinStr => {
                const resolved = resolvePin(String(pinStr || '').trim());
                signalPins.push({ pin: resolved, signal: cSig, isPower: false, rawSig: cSig });
            });
        } else {
            signalPins.push({ pin: null, signal: cSig, isPower: false, rawSig: cSig });
        }
    });

    // 已勾选、但尚未分配 GPIO 的扩展引线（接口族候选 / 型号预设勾选 / 自定义引线）
    // → 渲染为灰色空点位，用户可直接从画布手动拖线接入
    const pwrKeySet = new Set((libData.power_pins || []).map(pp => pp.pin).concat((pool && pool.power) || []));
    const linkKeySet = new Set();
    (libData.local_links || []).forEach(l => { linkKeySet.add(l.from); linkKeySet.add(l.to); });
    Object.keys(mod.enabledPins || {}).forEach(sig => {
        if (mod.enabledPins[sig] !== true) return;
        if (reqs.some(r => r.signal === sig)) return;
        if (pwrKeySet.has(sig) || linkKeySet.has(sig)) return;
        if (signalPins.some(p => p.rawSig === sig)) return;
        const cv = activeMod && activeMod.connections ? activeMod.connections[sig] : undefined;
        if (cv && cv !== 'dropped') return; // 已分配，扩展段已渲染
        signalPins.push({ pin: null, signal: sig, isPower: false, rawSig: sig });
    });

    // 信号引脚：按 requirements 固定顺序排列（不随连接状态重排，保证拖线时点位位置稳定不跳动）
    const finalPins = [...signalPins];
    otherPins.forEach(p => { if (!finalPins.some(ex => ex.rawSig === p.rawSig)) finalPins.push(p); });

    // 按实物丝印顺序排列（pinOrder，如功放 VCC→GND→SD→GAIN→DIN→BCLK→LRC），
    // 让画布上的模组引脚顺序和手里那块板子一致；未列入 pinOrder 的脚保持原顺序排在后面
    const pinOrder = libData.pinOrder || [];
    if (pinOrder.length) {
        const rankOf = (p) => {
            const i = pinOrder.indexOf(p.rawSig);
            return i === -1 ? 999 : i;
        };
        finalPins.sort((a, b) => rankOf(a) - rankOf(b));
    }

    // 电源/使能脚一旦改接 GPIO（BLK 做 PWM 调光、VCC 走 GPIO 供电等），
    // 标签统一刷成「信号 · IOxx」，让画布上的文字和实际接的脚永远对得上
    const powerKeys = new Set((libData.power_pins || []).map(pp => pp.pin));
    if (powerKeys.size && activeMod && activeMod.connections) {
        finalPins.forEach(p => {
            if (!powerKeys.has(p.rawSig)) return;
            const cv = activeMod.connections[p.rawSig];
            if (cv === undefined || cv === 'dropped' || !/^\d+$/.test(String(cv))) return;
            p.label = `${p.rawSig} · IO${cv}`;
            p.pin = String(cv);
            p.asGpio = true;
        });
    }

    return { signalPins: signalPins, pins: finalPins };
}

/* 用 activeModules 最新连接刷新模组的信号引脚列表（保持 x/y/side 布局不变） */
function refreshModulePins(d) {
    const rebuild = (mod) => {
        // 同步 activeModules 的最新 enabledPins（引脚勾选变化实时生效）
        const live = (typeof activeModules !== 'undefined') ? activeModules.find(m => m.id === mod.id) : null;
        if (live) { mod.enabledPins = live.enabledPins; mod.customPins = live.customPins; }
        const libData = (typeof moduleLibrary !== 'undefined' && moduleLibrary[mod.id]) ? moduleLibrary[mod.id] : { name: mod.id };
        const built = buildModulePins(mod, libData, d);
        const needReorder = JSON.stringify(mod.signalPins) !== JSON.stringify(built.signalPins);
        mod.signalPins = built.signalPins;
        mod.pins = built.pins;
        if (needReorder) {
            mod.height = 40 + (mod.pins.length * d.pinSpacing);
        }
    };
    d.leftModules.forEach(rebuild);
    d.rightModules.forEach(rebuild);
}

function buildFullSVG() {
    if (!currentRenderData) return;
    const d = currentRenderData;
    const container = document.getElementById('svg-container');
    if (!container) return;
    refreshModulePins(d);

    let svg = `<svg id="wiring-svg" xmlns="http://www.w3.org/2000/svg" width="${d.canvasWidth}" height="${d.canvasHeight}" viewBox="0 0 ${d.canvasWidth} ${d.canvasHeight}" style="font-family: sans-serif;">`;
    svg += `<rect width="100%" height="100%" fill="#121212" />`;
    svg += `<g id="group-lines"></g>`;

    // 主板
    svg += `<rect x="${d.boardX}" y="${d.boardY}" width="${d.boardWidth}" height="${d.boardHeight}" rx="12" fill="#2c3e50" stroke="#1a252f" stroke-width="3" filter="drop-shadow(0 8px 16px rgba(0,0,0,0.6))"/>`;
    svg += `<text x="${d.boardX + d.boardWidth/2}" y="${d.boardY + 35}" fill="#ecf0f1" font-size="18" font-weight="bold" text-anchor="middle">${boardConfig.boardName || 'ESP32'}</text>`;
    svg += `<line x1="${d.boardX + 20}" y1="${d.boardY + 50}" x2="${d.boardX + d.boardWidth - 20}" y2="${d.boardY + 50}" stroke="#34495e" stroke-width="2"/>`;

    Object.entries(d.bPinsMap).forEach(([num, info]) => {
        const isLeftPin = info.side === 'left';
        const px = isLeftPin ? d.boardX : d.boardX + d.boardWidth;
        const py = d.boardY + info.relY;
        const isNum = /^\d+$/.test(num);
        const pinFn = (isNum && boardConfig.pinFunctions) ? (boardConfig.pinFunctions[num] || '') : '';
        // 没写死说明文字的脚，退回 ADC 通道表（同一份数据，不另抄一遍，避免两处不一致）
        const adcFn = (!pinFn && isNum && boardConfig.adcPins) ? (boardConfig.adcPins[num] || '') : '';
        const pinState = (isNum && typeof pinsState !== 'undefined' && pinsState) ? pinsState[Number(num)] : null;
        const color = isNum ? boardPinColor(Number(num), false, false) : (info.label.toUpperCase().includes('GND') ? COLOR_GND : (info.label.toUpperCase().includes('VIN') || info.label.toUpperCase().includes('5V') || info.label.toUpperCase().includes('3V3') ? COLOR_PWR : '#94a3b8'));
        const titleText = isNum
            ? `GPIO${num}${(pinFn || adcFn) ? ' · ' + (pinFn || adcFn) : ''}${pinState && pinState.state === 'onboard' ? ' · 已被' + (pinState.owner || '板载设备') + '占用' : ''}`
            : String(info.label);
        // 自检结论：有问题的脚画一圈红/黄涟漪，悬停 title 直接给出原因
        const diagLvl = (isNum && typeof diagLevelOf === 'function') ? diagLevelOf(Number(num)) : null;
        const diagTip = diagLvl ? (typeof diagMessageOf === 'function' ? diagMessageOf(Number(num)) : '') : '';
        if (diagLvl) {
            // 错误 = 红色呼吸；警告 = 琥珀色慢呼吸。圈比引脚大一圈，不遮挡数字丝印
            const ringColor = diagLvl === 'error' ? '#ef4444' : '#f59e0b';
            const ringCls = diagLvl === 'error' ? 'diag-ring diag-ring--error' : 'diag-ring diag-ring--warn';
            svg += `<circle id="diag-ring-${num}" class="${ringCls}" cx="${px}" cy="${py}" r="12" fill="none" stroke="${ringColor}" stroke-width="1.6" opacity="0.9" pointer-events="none"/>`;
        }
        const tipWithDiag = diagTip ? `${titleText}\n${diagLvl === 'error' ? '❌ ' : '⚠️ '}${diagTip}` : titleText;
        svg += `<circle id="board-pin-${num}" cx="${px}" cy="${py}" r="${isNum ? 6 : 4}" fill="#111" stroke="${color}" stroke-width="2.5" data-board-pin="${num}" style="cursor: default;" onmouseover="highlightPinLines('${num}', true)" onmouseout="highlightPinLines('${num}', false)"><title>${tipWithDiag}</title></circle>`;
        svg += `<circle cx="${px}" cy="${py}" r="2" fill="${color}" data-board-pin-inner="${num}" />`;
        const textX = isLeftPin ? px + 14 : px - 14;
        const anchor = isLeftPin ? 'start' : 'end';
        const upperLabel = info.label.toUpperCase();
        const isPowerLabel = upperLabel.includes('3V3') || upperLabel.includes('5V') || upperLabel.includes('VIN');
        let textColor = upperLabel.includes('GND') ? COLOR_GND : (isPowerLabel ? COLOR_PWR : color);
        // 数字后附加简短小字说明：onboard=设备名  strapping=启动  fixed=系统/禁用
        // 其余情况显示实拍图上的丝印第二功能（CAM_SIOD / WS2812 / PSRAM …），与实物图逐行对应
        let suffixHtml = '';
        if (isNum && pinState) {
            if (pinState.state === 'onboard') {
                textColor = COLOR_ONBOARD;
                suffixHtml = `<tspan font-size="10" font-weight="normal" opacity="0.85" fill="${COLOR_ONBOARD}"> ${pinState.owner || '板载'}</tspan>`;
            } else if (pinState.state === 'strapping') {
                suffixHtml = `<tspan font-size="10" font-weight="normal" opacity="0.85" fill="${COLOR_STRAP}"> 启动</tspan>`;
            } else if (pinFn) {
                suffixHtml = `<tspan font-size="9" font-weight="normal" opacity="0.7" fill="#8fa3b8"> ${pinFn}</tspan>`;
            } else if (adcFn) {
                suffixHtml = `<tspan font-size="9" font-weight="normal" opacity="0.62" fill="#8fa3b8"> ${adcFn}</tspan>`;
            } else if (pinState.state === 'fixed') {
                suffixHtml = `<tspan font-size="10" font-weight="normal" opacity="0.85" fill="${COLOR_FIXED}">${pinState.label === 'N/A' ? ' 禁用' : ' 系统'}</tspan>`;
            }
        }
        svg += `<text x="${textX}" y="${py + 4}" fill="${textColor}" font-size="13" text-anchor="${anchor}" font-weight="bold">${info.label}${suffixHtml}</text>`;
    });

    // 模组
    const drawModuleBase = (mods, isLeftMod) => {
        mods.forEach(mod => {
            const modLib = (typeof moduleLibrary !== 'undefined' && moduleLibrary[mod.id]) ? moduleLibrary[mod.id] : null;
            svg += `<g class="module-group" data-id="${mod.id}" data-side="${isLeftMod ? 'left' : 'right'}" style="cursor: grab;" transform="translate(${mod.x}, ${mod.y})">`;
            svg += `<rect x="0" y="0" width="${d.moduleWidth}" height="${mod.height}" rx="8" fill="#252b36" stroke="#34495e" stroke-width="2" filter="drop-shadow(2px 4px 6px rgba(0,0,0,0.5))"/>`;
            const modTitle = svgModuleTitle(mod.name, 14, d.moduleWidth - 14);
            svg += `<text x="${d.moduleWidth/2}" y="22" fill="#ecf0f1" font-size="14" font-weight="bold" text-anchor="middle">${modTitle}<title>${mod.name}</title></text>`;
            svg += `<line x1="15" y1="32" x2="${d.moduleWidth - 15}" y2="32" stroke="#34495e" stroke-width="1"/>`;

            // 右上角移除按钮：模组一多，回左侧列表找对应卡片很费劲，画布上就地能删。
            // 纵向压在标题之上（cy≈2），标题基线在 22，两者不会打架；挪到角落当角标用。
            const delCx = d.moduleWidth - 2;
            svg += `<g class="mod-delete" data-mod-index="${mod.modIndex}" data-act="removeActiveModule" data-arg="${mod.modIndex}" data-stop>`
                + `<title>移除【${mod.name}】</title>`
                + `<circle cx="${delCx}" cy="2" r="9" stroke-width="1.2"/>`
                + `<text x="${delCx}" y="6.5" font-size="12" font-weight="700" text-anchor="middle" style="pointer-events:none;user-select:none;">×</text>`
                + `</g>`;

            // 内部短接：整对同色（含GND→绿=共地；含VCC/VIN/5V/3.3V→红=内部接电源轨）
            const linkColors = {};
            const localLinks = ((typeof moduleLibrary !== 'undefined' && moduleLibrary[mod.id] && moduleLibrary[mod.id].local_links) || [])
                .filter(l => !(mod.enabledPins && mod.enabledPins[l.from] === false));
            localLinks.forEach(link => {
                const both = [link.from, link.to].join(',').toUpperCase();
                const c = both.includes('GND') ? COLOR_GND : (['VCC','VIN','5V','3.3V','3V3'].some(k => both.includes(k)) ? COLOR_PWR : '#94a3b8');
                linkColors[link.from] = c;
                linkColors[link.to] = c;
            });

            // 内部短接虚线：U 形端点落在引脚点位列，竖线贴近点位一侧（右模组点位在左缘 x=12，左模组点位在右缘），整对同色
            localLinks.forEach((link, li) => {
                const idxFrom = mod.pins.findIndex(p => p.rawSig === link.from);
                const idxTo = mod.pins.findIndex(p => p.rawSig === link.to);
                if (idxFrom !== -1 && idxTo !== -1) {
                    const yFrom = 44 + idxFrom * d.pinSpacing;
                    const yTo = 44 + idxTo * d.pinSpacing;
                    const linkColor = linkColors[link.from] || COLOR_GND;
                    // 端点列 = 引脚点位列；竖线在点位内侧 14px，多对时再错开 8px
                    const xPin = isLeftMod ? d.moduleWidth - 12 : 12;
                    const midX = isLeftMod ? xPin - (14 + li * 8) : xPin + (14 + li * 8);
                    svg += `<path d="M ${xPin} ${yFrom} L ${midX} ${yFrom} L ${midX} ${yTo} L ${xPin} ${yTo}" fill="none" stroke="${linkColor}" stroke-width="1.5"/>`;
                }
            });

            mod.pins.forEach((p, pIdx) => {
                const pinY = 44 + pIdx * d.pinSpacing;
                const pinX = isLeftMod ? d.moduleWidth : 0;

                let dotColor = COLOR_FREE;
                let textColor = '#9ca3af';
                let dotR = 4;
                let draggable = false;

                if (p.isPower) {
                    const rawUpper = (p.rawSig || '').toUpperCase();
                    const isGnd = rawUpper.includes('GND');
                    dotColor = isGnd ? COLOR_GND : COLOR_PWR;
                    textColor = dotColor;
                    // 背光使能（BLK/LED/BACKLIGHT）本质是可编程的逻辑脚：接 3.3V 只是「常亮」的默认接法。
                    // 想 PWM 调光就得能拖到 GPIO，所以这里放开拖动；VCC/GND/5V 仍然锁死，绝不把电源灌进 IO。
                    if (/^(BLK|BL_EN|BACKLIGHT|LED|LEDA|LED_EN)$/.test(rawUpper)) draggable = true;
                } else if (p.isLocalLink || linkColors[p.rawSig]) {
                    // 内部短接脚：整对同色（共地绿 / 接电源轨红）
                    dotColor = linkColors[p.rawSig] || '#94a3b8';
                    textColor = dotColor;
                } else {
                    // 信号引脚：已接紫 / 未接灰
                    if (isSignalConnectedToPin(mod, p.rawSig, p.pin)) {
                        dotColor = COLOR_CONNECTED;
                        textColor = COLOR_CONNECTED;
                        dotR = 5.5;
                    } else if (isSignalConnected(mod, p.rawSig)) {
                        dotColor = COLOR_CONNECTED;
                        textColor = COLOR_CONNECTED;
                        dotR = 5.5;
                    } else {
                        dotColor = COLOR_FREE;
                        textColor = '#9ca3af';
                    }
                    draggable = true;
                }

                const dotX = pinX + (isLeftMod ? -12 : 12);
                const pinTitle = draggable
                    ? (p.asGpio
                        // 电源/使能脚被改成 GPIO 控制：说明当前状态 + 怎么退回默认接法
                        ? `<title>${p.rawSig} 已改由 GPIO${p.pin} 控制（可 PWM）· 双击可恢复接 ${((((modLib || {}).power_pins || []).find(x => x.pin === p.rawSig)) || {}).connect_to || '3.3V'}</title>`
                        : (isSignalConnected(mod, p.rawSig)
                            ? '<title>双击断开此连接 · 拖动可移动到其他引脚</title>'
                            : (p.isPower
                                ? '<title>背光使能：默认接电源轨 = 常亮；拖到 GPIO 可做 PWM 调光</title>'
                                : '<title>拖到主板引脚接线</title>')))
                    : '';
                // 外圈 = 热区（适度加大，move 手势）；内圈纯装饰事件穿透，避免误命中模组主体
                svg += `<circle data-mod-pin="${mod.id}" data-mod-signal="${p.rawSig}" data-mod-pin-no="${p.pin || ''}" cx="${dotX}" cy="${pinY}" r="${draggable ? dotR + 6 : dotR}" fill="${draggable ? '#111' : dotColor}" stroke="${dotColor}" stroke-width="${draggable ? 2.5 : 0}" style="${draggable ? 'cursor: move;' : ''}">${pinTitle}</circle>`;
                if (draggable) svg += `<circle cx="${dotX}" cy="${pinY}" r="${dotR}" fill="${dotColor}" style="pointer-events:none;"/>`;

                // 文字与点位拉开间距（给贴近点位的短接虚线留出空间）
                const textX = isLeftMod ? pinX - 44 : pinX + 44;
                const anchor = isLeftMod ? 'end' : 'start';
                svg += `<text x="${textX}" y="${pinY + 4}" fill="${textColor}" font-size="12" text-anchor="${anchor}">${p.label || p.signal}</text>`;
            });
            svg += `</g>`;
        });
    };
    drawModuleBase(d.leftModules, true);
    drawModuleBase(d.rightModules, false);
    svg += `</svg>`;

    container.innerHTML = svg;
    updateAllLines();

    // 空状态提示：挂在未参与缩放的 wrapper 上，钉在可视区底部，
    // 既不会压住主板排针（放画布正中会挡住 GPIO18~37 那一段），也不会跟着画布漂走
    const hasModules = (typeof activeModules !== 'undefined' && activeModules.length > 0);
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    const oldHint = document.getElementById('canvas-empty-hint');
    if (oldHint) oldHint.remove();
    if (!hasModules && wrapper) {
        const hint = document.createElement('div');
        hint.id = 'canvas-empty-hint';
        hint.style.cssText = 'position:absolute; left:50%; bottom:52px; transform:translateX(-50%); max-width:min(560px, calc(100% - 32px)); color:#94a3b8; font-size:12.5px; line-height:1.7; text-align:center; pointer-events:none; background:rgba(0,0,0,0.55); padding:10px 18px; border-radius:10px; border:1px dashed #475569; white-space:pre-line;';
        hint.innerText = '画布就绪 · 从左侧「添加模组」开始\n模组会自动出现在主板两侧，拖拽引脚即可手动接线';
        wrapper.appendChild(hint);
    }
}

/* ---------- 已接连线（统一紫色） ---------- */
/* 从模组端沿连线往回走 dist 像素，返回曲线上的那个点。
   徽标必须压在线身上：只按「引脚行 y 上横向偏移」取点，在斜线上会偏出线外 5~12px，
   数字看着就像浮在线旁边，而不是在线的正中间。 */
function wirePointNearEnd(line, dist, ctrl, isHorizontal) {
    const dir = line.endX > line.startX ? -1 : 1;   // 从模组往主板方向
    if (isHorizontal || !ctrl) return { x: line.endX + dir * dist, y: line.endY };
    const P0 = { x: line.startX, y: line.startY };
    const P1 = { x: ctrl.cX1, y: line.startY };
    const P2 = { x: ctrl.cX2, y: line.endY };
    const P3 = { x: line.endX, y: line.endY };
    const at = (t) => {
        const u = 1 - t;
        return {
            x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
            y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y
        };
    };
    let best = at(1);
    for (let i = 100; i >= 0; i--) {
        const p = at(i / 100);
        if (Math.hypot(p.x - P3.x, p.y - P3.y) >= dist) { best = p; break; }
    }
    return best;
}

function updateAllLines() {
    if (!currentRenderData) return;
    const d = currentRenderData;
    const groupLines = document.getElementById('group-lines');
    if (!groupLines) return;

    let linesSvg = "";
    // 徽标单独收集，最后统一追加，保证不被后画的连线盖住
    let badgesSvg = "";
    const lines = [];

    const collectLines = (mods, isLeftMod) => {
        mods.forEach(mod => {
            mod.signalPins.forEach(p => {
                const bPin = d.bPinsMap[p.pin];
                if (!bPin) return;
                // 只画已接的
                if (!isSignalConnectedToPin(mod, p.rawSig, p.pin)) return;
                const pinIndexInMod = mod.pins.findIndex(x => x.pin === p.pin && !x.isPower && !x.isLocalLink);
                if (pinIndexInMod === -1) return;
                lines.push({
                    startX: bPin.side === 'left' ? d.boardX : d.boardX + d.boardWidth,
                    startY: d.boardY + bPin.relY,
                    endX: isLeftMod ? mod.x + d.moduleWidth : mod.x,
                    endY: mod.y + 44 + pinIndexInMod * d.pinSpacing,
                    isLeft: bPin.side === 'left',
                    modId: mod.id,
                    modName: mod.name,
                    label: p.label || p.signal,
                    signal: p.rawSig,
                    pin: p.pin
                });
            });
        });
    };
    collectLines(d.leftModules, true);
    collectLines(d.rightModules, false);

    lines.sort((a, b) => a.startY - b.startY);

    lines.forEach(line => {
        const isHorizontal = Math.abs(line.startY - line.endY) < 1.5;
        const lineData = `data-line-mod="${line.modId}" data-line-signal="${line.signal}" data-line-pin="${line.pin}"`;
        const lineStyle = 'pointer-events:stroke; cursor:crosshair;';
        const lineTitle = '<title>拖动可移动到其他引脚 · 双击断开此连接</title>';
        // 接线自检结论直接体现在线上：冲突 = 红色呼吸，风险 = 琥珀色，正常 = 紫色
        const lvl = (typeof diagLevelOf === 'function') ? diagLevelOf(Number(line.pin)) : null;
        const wireColor = lvl === 'error' ? '#ef4444' : (lvl === 'warning' ? '#f59e0b' : COLOR_CONNECT_LINE);
        const wireCls = lvl === 'error' ? ' class="wire-diag-error"' : (lvl === 'warning' ? ' class="wire-diag-warn"' : '');
        let pathD;
        let ctrl = null;   // 曲线的两个控制点，徽标要贴着曲线落点，不能只按引脚行 y 摆
        if (isHorizontal) {
            pathD = `M ${line.startX} ${line.startY} L ${line.endX} ${line.endY}`;
        } else {
            const distX = Math.abs(line.endX - line.startX);
            const cOffset = Math.min(120, Math.max(30, distX * 0.4));
            const cX1 = line.isLeft ? line.startX - cOffset : line.startX + cOffset;
            const cX2 = line.isLeft ? line.endX + cOffset : line.endX - cOffset;
            ctrl = { cX1, cX2 };
            pathD = `M ${line.startX} ${line.startY} C ${cX1} ${line.startY}, ${cX2} ${line.endY}, ${line.endX} ${line.endY}`;
        }
        linesSvg += `<path${wireCls} ${lineData} d="${pathD}" fill="none" stroke="${wireColor}" stroke-width="2.5" stroke-linecap="round" style="${lineStyle}">${lineTitle}</path>`;
        linesSvg += `<circle cx="${line.startX}" cy="${line.startY}" r="3.5" fill="#121212" stroke="${wireColor}" stroke-width="1.5" style="pointer-events:none;"/>`;
        linesSvg += `<circle cx="${line.endX}" cy="${line.endY}" r="4" fill="${wireColor}" style="pointer-events:none;"/>`;

        /* 模组出口处的「主板针脚号」徽标：
           线一多就会交叉，光看线尾端分不清接到哪个 GPIO；在模组这一侧贴一个圈起来的小号，
           顺着线往主板找也不用再数格子。只画数字脚（电源/地走电源轨，没有连线）。
           落点取「沿曲线离引脚 20px」的那个点，而不是「引脚行 y 上偏 19px」——
           后者在斜线上会明显偏到线的上方（实测偏 5~12px），数字就不在线的正中间了。 */
        if (/^\d+$/.test(String(line.pin))) {
            const badgePt = wirePointNearEnd(line, 20, ctrl, isHorizontal);
            const badgeX = badgePt.x;
            const badgeY = badgePt.y;
            const badgeCls = lvl === 'error' ? ' pin-badge--error' : (lvl === 'warning' ? ' pin-badge--warn' : '');
            const isTwoDigit = String(line.pin).length > 1;
            badgesSvg += `<g class="pin-badge${badgeCls}" data-badge-pin="${line.pin}" style="cursor:pointer;"`
                + ` onmouseover="highlightPinLines('${line.pin}', true)" onmouseout="highlightPinLines('${line.pin}', false)">`
                + `<title>GPIO ${line.pin} · ${line.modName} ${line.label}</title>`
                + `<circle cx="${badgeX.toFixed(1)}" cy="${badgeY.toFixed(1)}" r="10" fill="#0b1220" stroke="${wireColor}" stroke-width="1.4"/>`
                + `<text x="${badgeX.toFixed(1)}" y="${(badgeY + 3.5).toFixed(1)}" fill="${wireColor}" font-size="${isTwoDigit ? 9.5 : 10}" font-weight="700" text-anchor="middle" letter-spacing="${isTwoDigit ? -0.5 : 0}" style="pointer-events:none;user-select:none;">${line.pin}</text>`
                + `</g>`;
        }
    });

    groupLines.innerHTML = linesSvg + badgesSvg;
}

/* 主板引脚 hover：高亮连接到该引脚的所有线（辅助辨识，不参与接线） */
function highlightPinLines(pinNum, on) {
    const groupLines = document.getElementById('group-lines');
    if (!groupLines) return;
    const lvl = (typeof diagLevelOf === 'function') ? diagLevelOf(Number(pinNum)) : null;
    const baseColor = lvl === 'error' ? '#ef4444' : (lvl === 'warning' ? '#f59e0b' : COLOR_CONNECT_LINE);
    groupLines.querySelectorAll('path[data-line-pin]').forEach(p => {
        if (p.getAttribute('data-line-pin') === String(pinNum)) {
            p.setAttribute('stroke-width', on ? '5' : '2.5');
            p.setAttribute('stroke', on ? '#ffffff' : baseColor);
        }
    });
}

/* ---------- 重新把主板摆到可视区中央 ---------- */
/* 画布可视宽度会随右侧停靠面板变化，宽度一变就得重算 translate，
   否则主板会被挤到面板底下去 */
function recenterCanvas() {
    const d = currentRenderData;
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    if (!d || !wrapper || !wrapper.clientWidth) return;
    currentTranslateX = (wrapper.clientWidth / 2) / currentScale - (d.boardX + d.boardWidth / 2);
    currentTranslateY = (wrapper.clientHeight / 2) / currentScale - (d.boardY + d.boardHeight / 2);
    updateTransform();
}

/* 记录/恢复视图，供侧栏开合时使用 */
function saveCanvasView() {
    return { s: currentScale, x: currentTranslateX, y: currentTranslateY };
}
function restoreCanvasView(v) {
    if (!v) return;
    currentScale = v.s; currentTranslateX = v.x; currentTranslateY = v.y;
    updateTransform(); updateZoomLabel();
}

/* 缩放 + 居中以完整容纳「主板 + 所有模组」：右侧停靠面板吃掉宽度后，
   靠平移是塞不下整张图的，必须把全图缩到可视范围里 */
function fitCanvasToContent() {
    const d = currentRenderData;
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    if (!d || !wrapper || !wrapper.clientWidth) return;
    // 左右各留 80px：主板丝印右侧还带「PSRAM / USB_D- / 启动」这类说明文字，
    // 只按板身宽度算会让右侧那列字被面板或画布边缘切掉
    let minX = d.boardX - 80, maxX = d.boardX + d.boardWidth + 80;
    let minY = d.boardY, maxY = d.boardY + d.boardHeight;
    [...d.leftModules, ...d.rightModules].forEach(m => {
        const h = m.height || 160;
        minX = Math.min(minX, m.x - 30);
        maxX = Math.max(maxX, m.x + d.moduleWidth + 30);
        minY = Math.min(minY, m.y - 20);
        maxY = Math.max(maxY, m.y + h + 20);
    });
    const pad = 30;
    const needW = (maxX - minX) + pad * 2;
    const needH = (maxY - minY) + pad * 2;
    const scale = Math.min(1, wrapper.clientWidth / needW, wrapper.clientHeight / needH);
    currentScale = Math.max(0.3, scale);
    currentTranslateX = (wrapper.clientWidth / 2) / currentScale - (minX + maxX) / 2;
    currentTranslateY = (wrapper.clientHeight / 2) / currentScale - (minY + maxY) / 2;
    updateTransform();
    updateZoomLabel();
    return saveCanvasView();
}

/* ---------- 定位到某个主板引脚（自检面板点条目时调用） ---------- */
function centerOnBoardPin(pinNum) {
    const d = currentRenderData;
    if (!d) return false;
    const info = d.bPinsMap[String(pinNum)];
    if (!info) return false;
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    if (!wrapper) return false;

    const px = info.side === 'left' ? d.boardX : d.boardX + d.boardWidth;
    const py = d.boardY + info.relY;

    // 位置不合理时先恢复到一个能看清细节的缩放级别
    if (currentScale < 0.85) { currentScale = 1; }
    currentTranslateX = (wrapper.clientWidth / 2) / currentScale - px;
    currentTranslateY = (wrapper.clientHeight / 2) / currentScale - py;
    updateTransform();
    updateZoomLabel();

    const flash = (el, cls) => {
        if (!el || !el.classList) return;
        el.classList.remove(cls);
        void el.getBoundingClientRect();
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), 2000);
    };
    flash(document.getElementById(`board-pin-${pinNum}`), 'pin-focus');
    flash(document.getElementById(`diag-ring-${pinNum}`), 'diag-ring-focus');
    highlightPinLines(pinNum, true);
    setTimeout(() => highlightPinLines(pinNum, false), 2000);
    return true;
}

/* ---------- 坐标换算 ---------- */
function clientToCanvas(clientX, clientY) {
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    if (!wrapper) return { x: 0, y: 0 };
    const rect = wrapper.getBoundingClientRect();
    const cx = (clientX - rect.left) / currentScale - currentTranslateX;
    const cy = (clientY - rect.top) / currentScale - currentTranslateY;
    return { x: cx, y: cy };
}

/* ---------- 缩放 ---------- */
function updateTransform() {
    const container = document.getElementById('svg-container');
    if (!container) return;
    container.style.transform = `scale(${currentScale}) translate(${currentTranslateX}px, ${currentTranslateY}px)`;
}
function updateZoomLabel() {
    const label = document.getElementById('zoom-level');
    if (label) label.innerText = `${Math.round(currentScale * 100)}%`;
}
function zoomWiring(dir) {
    const factor = 1.25;
    if (dir === 'in') currentScale = Math.min(3, currentScale * factor);
    else currentScale = Math.max(0.2, currentScale / factor);
    updateTransform();
    updateZoomLabel();
}

/* ---------- 复位布局（对外暴露 resetWiringLayout） ---------- */
function resetWiringLayout(isManualReset = false) {
    if (typeof boardConfig === 'undefined' || !boardConfig) return;
    if (typeof activeModules === 'undefined') return;
    if (isManualReset) {
        const key = getLayoutStorageKey();
        if (key) localStorage.removeItem(key);
        currentScale = 1;
        currentTranslateX = 0;
        currentTranslateY = 0;
        updateTransform();
        updateZoomLabel();
    }
    currentRenderData = initDiagramData();
    if (!isManualReset) loadLayoutFromStorage();
    buildFullSVG();

    const container = document.getElementById('svg-container');
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    if (!container || !wrapper) return;
    const offsetX = (wrapper.clientWidth / 2) - (currentRenderData.boardX + currentRenderData.boardWidth / 2) * currentScale;
    const offsetY = (wrapper.clientHeight / 2) - (currentRenderData.boardY + currentRenderData.boardHeight / 2) * currentScale;
    currentTranslateX = offsetX / currentScale;
    currentTranslateY = offsetY / currentScale;
    container.style.transform = `scale(${currentScale}) translate(${currentTranslateX}px, ${currentTranslateY}px)`;
}

/* ---------- 规则：该主板引脚是否可接 ---------- */
function canConnectPin(pinNum, modData, req) {
    if (typeof pinsState === 'undefined' || !pinsState[pinNum]) return false;
    const st = pinsState[pinNum];
    if (st.state === 'onboard' || st.state === 'fixed') return false;
    if (st.state === 'strapping') return false;
    // 模拟该引脚空闲（若正被其他模组占用，视为可替换）
    const copy = JSON.parse(JSON.stringify(pinsState));
    copy[pinNum] = { state: 'free', label: 'Free' };
    if (typeof isSafePin === 'function') return isSafePin(pinNum, modData, req, copy);
    return true;
}

/* ---------- 拖线交互状态 ---------- */
let _dragLine = null;          // { modId, signal, modData, req, startX, startY }
let _dragPreviewPath = null;
let _highlightedPins = [];     // 当前亮起的候选主板引脚号

/* 画布内最近主板引脚 */
function nearestBoardPin(canvasPt, maxDist) {
    const d = currentRenderData;
    if (!d) return null;
    let best = null, bestDist = maxDist;
    Object.keys(d.bPinsMap).forEach(num => {
        if (!/^\d+$/.test(num)) return;
        const info = d.bPinsMap[num];
        const px = info.side === 'left' ? d.boardX : d.boardX + d.boardWidth;
        const py = d.boardY + info.relY;
        const dist = Math.hypot(canvasPt.x - px, canvasPt.y - py);
        if (dist < bestDist) { bestDist = dist; best = { pin: Number(num), x: px, y: py, info }; }
    });
    return best;
}

/* 计算某模组信号可接的全部候选 */
function collectCandidates(modData, req) {
    const d = currentRenderData;
    const candidates = [];
    if (!d) return candidates;
    Object.keys(d.bPinsMap).forEach(num => {
        if (!/^\d+$/.test(num)) return;
        const pinNum = Number(num);
        if (canConnectPin(pinNum, modData, req)) candidates.push(pinNum);
    });
    return candidates;
}

/* 亮起候选主板引脚（拖拽中） */
function applyCandidateHighlight(candidates, strongPin) {
    const d = currentRenderData;
    if (!d) return;
    // 还原所有引脚颜色
    clearCandidateHighlight();
    candidates.forEach(pinNum => {
        const el = document.getElementById(`board-pin-${pinNum}`);
        if (el) {
            const st = pinsState[pinNum];
            const isStrong = pinNum === strongPin;
            const fill = isStrong ? '#ffffff' : '#fde68a';
            el.setAttribute('stroke', fill);
            el.setAttribute('stroke-width', isStrong ? '5' : '3');
            el.setAttribute('r', isStrong ? '9' : '7');
            _highlightedPins.push(pinNum);
        }
    });
}
function clearCandidateHighlight() {
    const d = currentRenderData;
    if (!d) return;
    _highlightedPins.forEach(pinNum => {
        const el = document.getElementById(`board-pin-${pinNum}`);
        if (el) {
            const st = pinsState[pinNum];
            const color = boardPinColor(pinNum, false, false);
            el.setAttribute('stroke', color);
            el.setAttribute('stroke-width', '2.5');
            el.setAttribute('r', '6');
        }
    });
    _highlightedPins = [];
}

/* 预览线 */
function updateDragPreview(fromPt, toPt, color, dashed) {
    const groupLines = document.getElementById('group-lines');
    if (!groupLines) return;
    if (_dragPreviewPath) _dragPreviewPath.remove();
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.id = 'drag-preview-line';
    const d = currentRenderData;
    const distX = Math.abs(toPt.x - fromPt.x);
    const cOffset = Math.min(100, Math.max(24, distX * 0.35));
    const dir = (toPt.x >= fromPt.x) ? 1 : -1;
    path.setAttribute('d', `M ${fromPt.x} ${fromPt.y} C ${fromPt.x + cOffset * dir} ${fromPt.y}, ${toPt.x - cOffset * dir} ${toPt.y}, ${toPt.x} ${toPt.y}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    if (dashed) path.setAttribute('stroke-dasharray', '7,5');
    groupLines.appendChild(path);
    _dragPreviewPath = path;
}
function removeDragPreview() {
    if (_dragPreviewPath) { _dragPreviewPath.remove(); _dragPreviewPath = null; }
}

/* ---------- 接线数据操作 ---------- */
function busSignalName(signal) { return ['SDA','SCL','MOSI','MISO','SCK','BCLK','LRC'].includes(signal); }
function getIfaceKey(iface) { if (!iface) return null; return iface.includes('I2S') ? 'I2S' : iface; }

/* 可并联共享的总线信号（市场实际：I2C SDA/SCL、SPI MOSI/MISO/SCK、I2S BCLK/LRC 为总线线，多设备并联共享） */
function isShareableBusSignal(signal) { return ['SDA','SCL','MOSI','MISO','SCK','BCLK','LRC'].includes(signal); }

/* 扫描某引脚当前被哪些模组信号占用（含共享） */
function scanPinOccupiers(pinNum) {
    const occupiers = [];
    (typeof activeModules !== 'undefined' ? activeModules : []).forEach(m => {
        for (const [sig, val] of Object.entries(m.connections || {})) {
            if (val === 'dropped' || val === undefined || val === '') continue;
            if (String(val).split(',').map(s => s.trim()).includes(String(pinNum))) {
                occupiers.push({ modId: m.id, signal: sig });
            }
        }
    });
    return occupiers;
}
function pinHasOtherOwner(pinNum, excludeModId) {
    return scanPinOccupiers(pinNum).some(o => o.modId !== excludeModId);
}

function syncBus(ifaceKey, signal, pinNumOrNull) {
    if (!ifaceKey || !busSignalName(signal)) return;
    if (!activeBuses[ifaceKey]) activeBuses[ifaceKey] = {};
    if (pinNumOrNull === null) delete activeBuses[ifaceKey][signal];
    else activeBuses[ifaceKey][signal] = Number(pinNumOrNull);
}

/* 给旧信号自动寻找新的合规引脚（尽力而为） */
function autoReassignSignal(modId, signal, modData, req) {
    const mod = activeModules.find(m => m.id === modId);
    if (!mod) return false;
    for (let i = 0; i <= boardConfig.max_pin; i++) {
        const st = pinsState[i];
        if (!st || st.state !== 'free') continue;
        if (boardConfig.availableGpios && !boardConfig.availableGpios.includes(i)) continue;
        if (typeof isHeaderPin === 'function' && !isHeaderPin(i)) continue;
        const copy = JSON.parse(JSON.stringify(pinsState));
        if (isSafePin(i, modData, req, copy)) {
            mod.connections[signal] = i;
            pinsState[i] = { state: 'used', owner: modId, signal: signal };
            syncBus(getIfaceKey(modData.interface), signal, i);
            return true;
        }
    }
    return false;
}

/* 断开某模组的某个信号连接（不重分配；共享引脚有其他占用者时保留） */
function disconnectSignal(mod, signal) {
    const modData = moduleLibrary[mod.id];
    const val = mod.connections[signal];
    if (val === undefined) return;
    String(val).split(',').forEach(p => {
        const pn = Number(p);
        if (pinsState[pn] && pinsState[pn].owner === mod.id && pinsState[pn].signal === signal) {
            if (pinHasOtherOwner(pn, mod.id)) {
                // 该引脚仍被其他模组共享占用 → 更新占用标记为剩余占用者
                const other = scanPinOccupiers(pn).find(o => o.modId !== mod.id);
                if (other) pinsState[pn] = { state: 'used', owner: other.modId, signal: other.signal };
            } else {
                pinsState[pn] = { state: 'free', label: 'Free' };
            }
        }
    });
    delete mod.connections[signal];
    syncBus(getIfaceKey(modData ? modData.interface : mod.interface), signal, null);
}

/* 建立连接（含替换占用） */
function applyManualConnection(modId, signal, pinNum) {
    const mod = activeModules.find(m => m.id === modId);
    if (!mod) return;
    const modData = moduleLibrary[modId];
    if (!modData) return;
    const req = (typeof resolveSignalReq === 'function')
        ? resolveSignalReq(modData, signal)
        : modData.requirements.find(r => r.signal === signal);
    if (!req) return;

    // 0) 目标引脚被本模组该信号自身占用（拖到自己已接的引脚）→ 无变化
    const targetState = pinsState[pinNum];
    if (targetState && targetState.state === 'used' && targetState.signal === signal && targetState.owner === modId) {
        return;
    }

    // 1) 目标被其他信号占用
    if (targetState && targetState.state === 'used' && targetState.signal !== signal) {
        const oldOwnerId = targetState.owner;
        const oldSignal = targetState.signal;
        const oldMod = activeModules.find(m => m.id === oldOwnerId);
        if (oldMod) {
            // 1a) 总线并联共享：同一条总线、同一个信号（I2C SDA/SCL、SPI MOSI/MISO/SCK、I2S BCLK/LRC）
            //     市场上这些是多设备并联的总线线，允许不同模组共用同一引脚，旧接线保留
            const ifaceKey = getIfaceKey(modData.interface);
            const oldModData = moduleLibrary[oldOwnerId];
            const oldIfaceKey = oldModData ? getIfaceKey(oldModData.interface) : null;
            if (ifaceKey && ifaceKey === oldIfaceKey && oldSignal === signal && isShareableBusSignal(signal)) {
                mod.connections[signal] = String(pinNum);
                pinsState[pinNum] = { state: 'used', owner: modId, signal: signal };
                syncBus(ifaceKey, signal, pinNum);
                if (typeof renderPins === 'function') renderPins();
                if (typeof renderModules === 'function') renderModules();
                refreshWiringCanvas();
                return;
            }
            // 1b) 其余情况（独占类信号 / 不同总线）→ 断开旧连接并尝试自动重分配
            disconnectSignal(oldMod, oldSignal);
            if (oldModData) {
                const oldReq = (typeof resolveSignalReq === 'function')
                    ? resolveSignalReq(oldModData, oldSignal)
                    : oldModData.requirements.find(r => r.signal === oldSignal);
                if (oldReq) {
                    autoReassignSignal(oldMod.id, oldSignal, oldModData, oldReq);
                }
            }
        }
    }

    // 2) 本模组该信号原本已接（重接场景）→ 断开自身旧连接
    if (mod.connections[signal] !== undefined) {
        disconnectSignal(mod, signal);
    }

    // 3) 建立新连接
    mod.connections[signal] = pinNum;
    pinsState[pinNum] = { state: 'used', owner: modId, signal: signal };
    syncBus(getIfaceKey(modData.interface), signal, pinNum);

    // 4) 联动刷新
    if (typeof renderPins === 'function') renderPins();
    if (typeof renderModules === 'function') renderModules();
    if (typeof updatePowerBudget === 'function') updatePowerBudget();
    refreshWiringCanvas();
}

/* ---------- 画布事件 ---------- */
function bindCanvasEvents() {
    const container = document.getElementById('svg-container');
    const wrapper = document.getElementById('wiring-canvas-wrapper');
    if (!container || !wrapper) return;

    let isDraggingModule = false;
    let dragTargetId = null;
    let isPanning = false;
    let startPanX = 0, startPanY = 0;
    let isDraggingLine = false;
    let lineStartPt = null;
    let pointerMoved = false;

    wrapper.onwheel = (e) => {
        e.preventDefault();
        const rect = wrapper.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const beforeX = (px) / currentScale - currentTranslateX;
        const beforeY = (py) / currentScale - currentTranslateY;
        const zoomFactor = 0.03;
        if (e.deltaY < 0) currentScale = Math.min(3, currentScale * (1 + zoomFactor));
        else currentScale = Math.max(0.2, currentScale * (1 - zoomFactor));
        currentTranslateX = (px) / currentScale - beforeX;
        currentTranslateY = (py) / currentScale - beforeY;
        updateTransform();
        updateZoomLabel();
    };

    document.onkeydown = (e) => {
        if (e.code === 'Space' && !isSpacePressed) { isSpacePressed = true; wrapper.style.cursor = 'grab'; if (e.target === document.body) e.preventDefault(); }
    };
    document.onkeyup = (e) => {
        if (e.code === 'Space') { isSpacePressed = false; wrapper.style.cursor = 'default'; }
    };

    // 双击 = 断开连接（命中连接线或已接模组信号引脚）
    wrapper.ondblclick = (e) => {
        if (!currentRenderData) return;
        const lineEl = e.target.closest ? e.target.closest('path[data-line-mod]') : null;
        if (lineEl && lineEl.getAttribute('data-line-mod')) {
            const mod = activeModules.find(m => m.id === lineEl.getAttribute('data-line-mod'));
            const signal = lineEl.getAttribute('data-line-signal');
            if (mod && signal && mod.connections[signal] !== undefined && mod.connections[signal] !== 'dropped') {
                disconnectSignal(mod, signal);
                if (typeof renderPins === 'function') renderPins();
                if (typeof renderModules === 'function') renderModules();
            }
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        const modPinEl = e.target.closest ? e.target.closest('circle[data-mod-pin]') : null;
        if (modPinEl && modPinEl.getAttribute('data-mod-pin')) {
            const mod = activeModules.find(m => m.id === modPinEl.getAttribute('data-mod-pin'));
            const signal = modPinEl.getAttribute('data-mod-signal');
            if (mod && signal && mod.connections[signal] !== undefined && mod.connections[signal] !== 'dropped') {
                disconnectSignal(mod, signal);
                if (typeof renderPins === 'function') renderPins();
                if (typeof renderModules === 'function') renderModules();
            }
            e.preventDefault();
            e.stopPropagation();
        }
    };

    wrapper.onmousedown = (e) => {
        if (!currentRenderData) return;
        pointerMoved = false;
        // 模组卡右上角的移除按钮只响应 click，不能启动"拖动模组"，否则一按按钮模组就跟着飘
        if (e.target.closest && e.target.closest('.mod-delete')) return;
        // 拖拽期间禁止选中页面文本（避免拖动时出现蓝色选中块）
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';

        // 中键 / 空格拖动 → 平移
        if (e.button === 1 || (isSpacePressed && e.button === 0)) {
            isPanning = true; startPanX = e.clientX; startPanY = e.clientY; wrapper.style.cursor = 'grabbing'; e.preventDefault(); return;
        }
        if (e.button !== 0) return;

        // 1) 命中模组信号引脚 → 拖线
        const modPinEl = e.target.closest ? e.target.closest('[data-mod-pin]') : null;
        if (modPinEl && modPinEl.getAttribute('data-mod-pin')) {
            const modId = modPinEl.getAttribute('data-mod-pin');
            const signal = modPinEl.getAttribute('data-mod-signal');
            const mod = activeModules.find(m => m.id === modId);
            const modData = moduleLibrary[modId];
            if (mod && modData) {
                // 扩展/自定义引线走宽松约束，保证「引脚」弹窗里勾选的脚也能拖线
                const req = (typeof resolveSignalReq === 'function')
                    ? resolveSignalReq(modData, signal)
                    : modData.requirements.find(r => r.signal === signal);
                if (req) {
                    isDraggingLine = true;
                    const startPt = clientToCanvas(e.clientX, e.clientY);
                    lineStartPt = { x: startPt.x, y: startPt.y, modId, signal, modData, req };
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }
        }

        // 2) 命中连接线 → 以该线为抓手，摘下并实时试接（线消失跟随鼠标，落到新引脚重接，落空恢复原位）
        const lineEl = e.target.closest ? e.target.closest('path[data-line-mod]') : null;
        if (lineEl && lineEl.getAttribute('data-line-mod')) {
            const lineModId = lineEl.getAttribute('data-line-mod');
            const lineSignal = lineEl.getAttribute('data-line-signal');
            const linePrevPin = Number(lineEl.getAttribute('data-line-pin'));
            const lineMod = activeModules.find(m => m.id === lineModId);
            const lineModData = moduleLibrary[lineModId];
            const lineReq = lineModData
                ? ((typeof resolveSignalReq === 'function') ? resolveSignalReq(lineModData, lineSignal) : lineModData.requirements.find(r => r.signal === lineSignal))
                : null;
            if (lineMod && lineModData && lineReq) {
                e.preventDefault();
                e.stopPropagation();
                // 摘下该线对应的信号（模组引脚变灰、线消失）
                disconnectSignal(lineMod, lineSignal);
                refreshWiringCanvas();
                // 从该模组信号引脚位置启动拖线预览（实时试接其他可用引脚）
                const d = currentRenderData;
                const sideArr = d.leftModules.some(m => m.id === lineModId) ? d.leftModules : d.rightModules;
                const modEl = sideArr.find(m => m.id === lineModId);
                if (modEl) {
                    const isLeftMod = d.leftModules.includes(modEl);
                    const pinIdx = modEl.pins.findIndex(p => p.rawSig === lineSignal && !p.isPower && !p.isLocalLink);
                    if (pinIdx > -1) {
                        const pinX = (isLeftMod ? d.moduleWidth : 0) + (isLeftMod ? -12 : 12);
                        const pinY = 44 + pinIdx * d.pinSpacing;
                        isDraggingLine = true;
                        lineStartPt = { x: modEl.x + pinX, y: modEl.y + pinY, modId: lineModId, signal: lineSignal, modData: lineModData, req: lineReq, prevPin: linePrevPin, fromLine: true };
                        pointerMoved = true;
                        return;
                    }
                }
                // 信号引脚定位失败：直接恢复原连接
                applyManualConnection(lineModId, lineSignal, linePrevPin);
            }
        }

        // 3) 命中主板引脚 → 不承担接线操作（抓手只在模组引脚与连接线上；hover 会高亮其连线用于辨识）

        // 3) 命中模组主体 → 拖模组
        const group = e.target.closest ? e.target.closest('.module-group') : null;
        if (group && e.button === 0) {
            isDraggingModule = true; dragTargetId = group.getAttribute('data-id'); startPanX = e.clientX; startPanY = e.clientY; e.stopPropagation();
            return;
        }
    };

    document.onmousemove = (e) => {
        if (isDraggingLine && lineStartPt) {
            pointerMoved = true;
            const pt = clientToCanvas(e.clientX, e.clientY);
            const startPt = { x: lineStartPt.x, y: lineStartPt.y };
            // 找最近候选
            const candidates = collectCandidates(lineStartPt.modData, lineStartPt.req);
            const nearest = nearestBoardPin(pt, 55);
            let strongPin = null;
            if (nearest && candidates.includes(nearest.pin)) strongPin = nearest.pin;
            applyCandidateHighlight(candidates, strongPin);
            if (strongPin !== null) {
                const info = currentRenderData.bPinsMap[strongPin];
                const tx = info.side === 'left' ? currentRenderData.boardX : currentRenderData.boardX + currentRenderData.boardWidth;
                const ty = currentRenderData.boardY + info.relY;
                updateDragPreview(startPt, { x: tx, y: ty }, COLOR_CONNECT_LINE, true);
            } else {
                updateDragPreview(startPt, pt, 'rgba(148,163,184,0.5)', true);
            }
            return;
        }
        if (isPanning) {
            pointerMoved = true;
            const dx = (e.clientX - startPanX) / currentScale; const dy = (e.clientY - startPanY) / currentScale;
            currentTranslateX += dx; currentTranslateY += dy; updateTransform();
            startPanX = e.clientX; startPanY = e.clientY;
        } else if (isDraggingModule && dragTargetId) {
            pointerMoved = true;
            const dx = (e.clientX - startPanX) / currentScale; const dy = (e.clientY - startPanY) / currentScale;
            const allMods = [...currentRenderData.leftModules, ...currentRenderData.rightModules];
            const targetMod = allMods.find(m => m.id === dragTargetId);
            if (targetMod) {
                targetMod.x += dx; targetMod.y += dy; startPanX = e.clientX; startPanY = e.clientY;
                // 实时判定左右侧：中心越过中线即翻转引脚朝向
                const boardCenter = currentRenderData.boardX + currentRenderData.boardWidth / 2;
                const modCenter = targetMod.x + currentRenderData.moduleWidth / 2;
                const newSide = modCenter < boardCenter ? 'left' : 'right';
                if (newSide !== targetMod.side) {
                    // 换边：移到另一侧数组，x 吸附到该侧标准位
                    const fromArr = targetMod.side === 'left' ? currentRenderData.leftModules : currentRenderData.rightModules;
                    const toArr = newSide === 'left' ? currentRenderData.leftModules : currentRenderData.rightModules;
                    const idx = fromArr.indexOf(targetMod);
                    if (idx > -1) fromArr.splice(idx, 1);
                    targetMod.side = newSide;
                    targetMod.x = newSide === 'left' ? currentRenderData.leftModX : currentRenderData.rightModX;
                    toArr.push(targetMod);
                    buildFullSVG();
                    updateAllLines();
                } else {
                    const targetGroup = container.querySelector(`.module-group[data-id="${dragTargetId}"]`);
                    if (targetGroup) targetGroup.setAttribute('transform', `translate(${targetMod.x}, ${targetMod.y})`);
                    updateAllLines();
                }
            }
        }
    };

    document.onmouseup = (e) => {
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        // 拖线释放
        if (isDraggingLine && lineStartPt) {
            const pt = clientToCanvas(e.clientX, e.clientY);
            const candidates = collectCandidates(lineStartPt.modData, lineStartPt.req);
            const nearest = nearestBoardPin(pt, 55);
            let landedPin = null;
            if (nearest && candidates.includes(nearest.pin)) landedPin = nearest.pin;

            clearCandidateHighlight();
            removeDragPreview();

            if (landedPin !== null) {
                try {
                    applyManualConnection(lineStartPt.modId, lineStartPt.signal, landedPin);
                } catch (err) {
                    console.error('接线失败', err);
                }
            } else if (nearest !== null) {
                // 拖到了规则拒绝的引脚（不可接）→ 无法接入，恢复原位/保持原状
                if (lineStartPt.prevPin !== undefined && lineStartPt.prevPin !== null) {
                    try {
                        applyManualConnection(lineStartPt.modId, lineStartPt.signal, lineStartPt.prevPin);
                    } catch (err) {
                        console.error('恢复连接失败', err);
                    }
                } else {
                    refreshWiringCanvas();
                }
            } else if (lineStartPt.fromLine) {
                // 从连接线抓起并拖到空白 → 拔线断开（连接已摘下，保持断开）
                if (typeof renderPins === 'function') renderPins();
                if (typeof renderModules === 'function') renderModules();
            } else {
                // 从模组引脚拖到空白：试探后放弃，无变化
                refreshWiringCanvas();
            }
            isDraggingLine = false; lineStartPt = null;
            return;
        }

        // 点击已接主板引脚（无拖动）→ 释放
        if (wrapper._boardClickPin !== undefined && wrapper._boardClickPin !== null) {
            const pinNum = wrapper._boardClickPin;
            wrapper._boardClickPin = null;
            if (!pointerMoved) {
                const st = pinsState && pinsState[pinNum];
                if (st && st.state === 'used') {
                    if (typeof releasePin === 'function') releasePin(pinNum);
                }
            }
        }

        if (isDraggingModule) {
            // 松手：定稿左右侧并吸附到该侧标准位（贴主板），避免停留在主板区域
            const targetMod = [...currentRenderData.leftModules, ...currentRenderData.rightModules].find(m => m.id === dragTargetId);
            if (targetMod) {
                const boardCenter = currentRenderData.boardX + currentRenderData.boardWidth / 2;
                const modCenter = targetMod.x + currentRenderData.moduleWidth / 2;
                const finalSide = modCenter < boardCenter ? 'left' : 'right';
                if (finalSide !== targetMod.side) {
                    const fromArr = targetMod.side === 'left' ? currentRenderData.leftModules : currentRenderData.rightModules;
                    const toArr = finalSide === 'left' ? currentRenderData.leftModules : currentRenderData.rightModules;
                    const idx = fromArr.indexOf(targetMod);
                    if (idx > -1) fromArr.splice(idx, 1);
                    targetMod.side = finalSide;
                    toArr.push(targetMod);
                }
                targetMod.x = finalSide === 'left' ? currentRenderData.leftModX : currentRenderData.rightModX;
                buildFullSVG();
                updateAllLines();
            }
            saveLayoutToStorage();
        }
        isPanning = false; isDraggingModule = false; dragTargetId = null; wrapper.style.cursor = isSpacePressed ? 'grab' : 'default';
    };
}

/* ---------- 初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
    try {
        if (document.getElementById('wiring-canvas-wrapper')) {
            initCanvas();
        }
    } catch (e) { console.error('画布初始化失败', e); }
});

/* =========================================================
 * 智能接线（smart-wiring.js）
 *
 * 目标：不再让用户一条条拖线去试，而是按「真实电气规则」一次算出多套
 *       都接得通、但取舍不同的方案，点一下就在画布上整体切换。
 *
 * 规则来源（全部是硬约束，不满足的脚直接不进候选）：
 *   1. 只能落在 pinLayout 里真实引出的排针上（与画布共用一份物理事实）
 *   2. 板载设备占用 / fixedPins / 不在 availableGpios 的脚不能用
 *   3. Strapping 脚的启动电平、内部上拉、仅输入限制
 *   4. ADC 模组必须落在 ADC 通道脚上
 *   5. 高速信号不允许紧贴另一路高速信号（相邻脚串扰 / GPIO 矩阵限制）
 *   6. I2C/SPI/I2S 总线信号可在多设备间复用（MOSI/SCK/SDA/SCL/BCLK/LRC）
 *
 * 策略只是「打分权重」不同，所以每套方案都是合法接线，区别在于：
 * 速度上限、飞线跨度、是否占用调试口、是否让出 FSPI 专用脚、左右是否均衡。
 * ========================================================= */

const SMART_BUS_SIGNALS = new Set(['SDA', 'SCL', 'MOSI', 'MISO', 'SCK', 'BCLK', 'LRC']);

/* 五套策略：权重越大越优先/越回避 */
const SMART_STRATEGIES = [
    {
        id: 'recommended', name: '推荐接法', icon: '⭐', sideMode: 'best',
        desc: '优先落在芯片 IO_MUX 专用脚与主板默认接口上，SPI 可跑满 80MHz，走线也最短。',
        weights: { mux: 640, def: 340, uart: 520, usb: 1000, strap: 280, dist: 9, offSide: 1200, adjacent: 40, reserve: 0, steal: 150 }
    },
    {
        id: 'backup', name: '备选落点', icon: '🔁', sideMode: 'best', avoidRecommended: true,
        desc: '主动避开推荐方案已占的脚，把这些常用脚留给别的设备；落点不同，但同样通过全部规则校验。',
        weights: { mux: 420, def: 240, uart: 520, usb: 1000, strap: 280, dist: 10, offSide: 1200, adjacent: 50, reserve: 0, steal: 150 }
    },
    {
        id: 'compact', name: '同侧紧凑', icon: '📐', sideMode: 'best',
        desc: '所有信号压在同一侧排针、彼此紧挨着取脚，飞线最短最整齐，拍照记录也好看。',
        weights: { mux: 120, def: 120, uart: 800, usb: 1000, strap: 260, dist: 34, offSide: 2600, adjacent: 130, reserve: 0, steal: 220 }
    },
    {
        id: 'quiet', name: '避让调试口', icon: '🛡️', sideMode: 'best',
        desc: '绕开 UART0 调试串口与 USB 脚，烧录、看日志、USB 下载都不受影响。',
        weights: { mux: 480, def: 320, uart: 6000, usb: 1000, strap: 700, dist: 8, offSide: 900, adjacent: 40, reserve: 0, steal: 150 }
    },
    {
        id: 'reserve', name: '保留高速脚', icon: '🧩', sideMode: 'best',
        desc: '不占 FSPI 专用脚（10~15），把好脚留给摄像头或第二块高速设备；SPI 走 GPIO 矩阵，约 40MHz。',
        weights: { mux: 0, def: 120, uart: 200, usb: 1000, strap: 300, dist: 10, offSide: 1000, adjacent: 60, reserve: 900, steal: 0 }
    },
    {
        id: 'opposite', name: '换边接线', icon: '🔀', sideMode: 'worse',
        desc: '把信号整体放到另一侧排针：模组要摆右边、或左侧被摄像头/排线挡住时更顺手。',
        weights: { mux: 640, def: 340, uart: 520, usb: 1000, strap: 280, dist: 9, offSide: 1200, adjacent: 40, reserve: 0, steal: 150 }
    },
    {
        id: 'spread', name: '左右均衡', icon: '⚖️', sideMode: 'alternate',
        desc: '按模组顺序左右分列取脚，单侧排针不拥挤，适合同时挂好几个模组。',
        weights: { mux: 260, def: 300, uart: 140, usb: 1000, strap: 280, dist: 20, offSide: 2200, adjacent: 60, reserve: 0, steal: 100 }
    }
];

let _smartSchemes = [];
let _smartAppliedKey = null;
let _smartPanelOpen = false;
let _smartSignature = '';
let _smartViewBackup = null;
let _smartFitView = null;

/* ---------- 基础数据 ---------- */

function smartBoardSpec() {
    if (typeof resolveBoardSpec !== 'function' || typeof boardConfig === 'undefined' || !boardConfig) return {};
    return resolveBoardSpec(boardConfig.boardName) || {};
}

function smartDefaults(modData) {
    const d = (typeof boardConfig !== 'undefined' && boardConfig && boardConfig.defaultInterfaces) ? boardConfig.defaultInterfaces : {};
    if (!modData) return {};
    return d[modData.interface] || d[smartIfaceKey(modData.interface)] || {};
}

/* 当前接线里，哪些脚是「某个模组某个信号」的默认落点
   只有被别的模组/别的信号预定的脚才算抢占；没人要的 MISO/WP 脚拿去接 RST 完全合理 */
function smartClaimedPins(lib) {
    const claims = {};
    (typeof activeModules !== 'undefined' ? activeModules : []).forEach((mod, i) => {
        const md = lib[mod.id] || (typeof moduleLibrary !== 'undefined' && moduleLibrary[mod.id]) || {};
        const def = smartDefaults(md);
        (md.requirements || []).forEach(r => {
            const pin = def[r.signal];
            if (pin === undefined) return;
            const n = Number(pin);
            if (!claims[n]) claims[n] = [];
            claims[n].push({ modIndex: i, signal: r.signal });
        });
    });
    return claims;
}

function smartIfaceKey(iface) {
    if (!iface) return '';
    return String(iface).includes('I2S') ? 'I2S' : String(iface);
}

/* 排针物理位置：左列 idx 0 起，右列 idx 0 起；用于估算飞线长度 */
function smartPinGeo() {
    const geo = {};
    if (typeof boardConfig === 'undefined' || !boardConfig) return geo;
    const layout = boardConfig.pinLayout || {};
    const add = (arr, side) => {
        (arr || []).forEach((tok, i) => {
            const n = (typeof resolveBoardPinToken === 'function') ? resolveBoardPinToken(boardConfig, tok) : null;
            if (n !== null && geo[n] === undefined) geo[n] = { side: side, idx: i };
        });
    };
    add(layout.left, 'left');
    add(layout.right, 'right');
    return geo;
}

function smartPinDist(a, b, geo) {
    const A = geo[a], B = geo[b];
    if (!A || !B) return 999;
    if (A.side === B.side) return Math.abs(A.idx - B.idx);
    return 14 + Math.abs(A.idx - B.idx);
}

/* 可分配脚：排针上、非系统固定、非板载占用 */
function smartCandidatePins(geo) {
    const fixed = new Set(boardConfig.fixedPins || []);
    const avail = new Set(boardConfig.availableGpios || []);
    const onboard = (typeof _onboardPinMap !== 'undefined' && _onboardPinMap) ? _onboardPinMap : {};
    return Object.keys(geo).map(Number).filter(n =>
        !fixed.has(n) && (avail.size === 0 || avail.has(n)) && !onboard[n]
    ).sort((a, b) => {
        const A = geo[a], B = geo[b];
        if (A.side !== B.side) return A.side === 'left' ? -1 : 1;
        return A.idx - B.idx;
    });
}

/* ---------- 约束判断 ---------- */

function smartPinAllowedFor(pin, req, modData, ctx) {
    const strap = (boardConfig.strappingPins || {})[pin];
    if (strap) {
        if (String(strap.reason || '').includes('仅输入') && req.requires_output) return false;
        if (req.default_state && strap.required_level && req.default_state !== strap.required_level) return false;
        if (req.internal_pull) return false;
    }
    const domain = (boardConfig.special_domains || {})[pin];
    if (domain && domain !== `${modData.signal_voltage}V`) return false;

    const v = Number(modData.signal_voltage || 3.3);
    if (v > Number(boardConfig.safe_voltage || 3.3) && !(boardConfig.power_rails || {})['5V']) return false;

    if (modData.requires_adc && !(boardConfig.adcPins || {})[pin]) return false;
    // 有 Wi-Fi/4G 模组时 ADC2 会被射频强制征用，模拟读数全部失效 → 只能落 ADC1
    if (modData.requires_adc && ctx.wifiActive) {
        const ch = String((boardConfig.adcPins || {})[pin] || '');
        if (ch.startsWith('ADC2')) return false;
    }

    // 高速信号不贴着另一路高速信号，避免相邻脚串扰与矩阵带宽争用
    if (req.high_speed) {
        for (const adj of [pin - 1, pin + 1]) {
            const u = ctx.used[adj];
            if (u && u.highSpeed && u.owner !== ctx.modIndex) {
                const otherIface = ctx.ownerIfaces ? ctx.ownerIfaces[u.owner] : '';
                const sameBus = otherIface && smartIfaceKey(otherIface) === ctx.iface;
                if (!sameBus) return false;
            }
        }
    }
    return true;
}

/* ---------- 打分 ---------- */

function smartScorePin(pin, req, ctx, extraPicked) {
    const w = ctx.weights;
    const sig = req.signal;
    const geo = ctx.geo;
    const extra = extraPicked || [];
    let s = 0;

    const muxPin = (boardConfig.ioMuxSpi || {})[sig];
    const defMap = ctx.defMap || {};
    const defPin = defMap[sig];

    if (muxPin !== undefined && Number(muxPin) === pin) s += w.mux;
    if (defPin !== undefined && Number(defPin) === pin) s += w.def;

    if ((ctx.spec.uart_pins || []).includes(pin)) s -= w.uart;
    if ((ctx.spec.usb_pins || []).includes(pin)) s -= w.usb;
    if ((boardConfig.strappingPins || {})[pin]) s -= w.strap;
    if (ctx.avoid && ctx.avoid.has(pin)) s -= 4000;
    if (w.steal > 0 && ctx.claims && ctx.claims[pin]) {
        const mine = ctx.claims[pin].some(c => c.modIndex === ctx.modIndex && c.signal === sig);
        if (!mine) s -= w.steal;
    }

    // 让出专用脚：占着 IO_MUX / 默认总线脚反而扣分
    if (w.reserve > 0) {
        const spiDefaults = (boardConfig.defaultInterfaces || {}).SPI || {};
        const dedicated = Object.values(boardConfig.ioMuxSpi || {}).map(Number).includes(pin) ||
            Object.values(spiDefaults).map(Number).includes(pin);
        if (dedicated) s -= w.reserve;
    }

    if (ctx.side && geo[pin] && geo[pin].side !== ctx.side) s -= w.offSide;

    const prev = extra.length ? extra[extra.length - 1] : (ctx.chosen.length ? ctx.chosen[ctx.chosen.length - 1] : null);
    if (prev !== null) s -= w.dist * smartPinDist(pin, prev, geo);

    if (ctx.chosen.length || extra.length) {
        let near = Infinity;
        ctx.chosen.concat(extra).forEach(p => {
            const d = smartPinDist(pin, p, geo);
            if (d < near) near = d;
        });
        if (near <= 1) s += w.adjacent;
        else if (near <= 2) s += w.adjacent * 0.45;
        else if (near <= 3) s += w.adjacent * 0.15;
    }

    // ADC 模组优先 ADC1：开 Wi-Fi 后 ADC2 会被征用
    if (modDataRequiresAdc(ctx) && String((boardConfig.adcPins || {})[pin] || '').startsWith('ADC1')) s += 40;

    return s;
}

function modDataRequiresAdc(ctx) { return !!ctx.requiresAdc; }

/* ---------- 单个模组在单侧排针上试排 ---------- */

function smartSortReqs(modData) {
    return (modData.requirements || []).slice()
        .filter(r => r && (r.count || 1) > 0)
        .sort((a, b) => (a.optional ? 1 : 0) - (b.optional ? 1 : 0) || (b.high_speed ? 1 : 0) - (a.high_speed ? 1 : 0));
}

function planModuleOnSide(modData, modIndex, side, baseUsed, baseBus, strategy, geo, pins, spec, reqs, seedPins, claims, ownerIfaces, wifiActive, avoidSet) {
    const iface = smartIfaceKey(modData.interface);
    const ctx = {
        modIndex: modIndex, side: side, weights: strategy.weights, geo: geo, spec: spec,
        modData: modData, claims: claims || {}, ownerIfaces: ownerIfaces || [], wifiActive: !!wifiActive, avoid: avoidSet || null,
        iface: iface, defMap: smartDefaults(modData), requiresAdc: !!modData.requires_adc,
        used: Object.assign({}, baseUsed),
        bus: JSON.parse(JSON.stringify(baseBus)),
        // seed = 第一阶段已经定下的引脚：让控制脚（RST/DC）贴着它们取，而不是从头找最小号
        chosen: (seedPins || []).slice()
    };
    const connections = {};
    const missing = [];
    let score = 0;

    for (const req of (reqs || smartSortReqs(modData))) {
        const count = req.count || 1;
        const sig = req.signal;
        const picked = [];

        // 总线复用：I2C 多设备 / SPI 共用 SCK·MOSI / I2S 共用 BCLK·LRC
        if (count === 1 && SMART_BUS_SIGNALS.has(sig) && ctx.bus[iface] && ctx.bus[iface][sig] !== undefined) {
            const shared = Number(ctx.bus[iface][sig]);
            const owner = ctx.used[shared];
            // 已被上一块设备当同一条总线信号占用 → 并联合法；被其它信号占用才算冲突
            const shareable = !owner || (owner.signal === sig && SMART_BUS_SIGNALS.has(sig));
            if (Number.isFinite(shared) && shareable && smartPinAllowedFor(shared, req, modData, ctx)) {
                picked.push(shared);
            }
        }

        while (picked.length < count) {
            let best = null, bestScore = -Infinity;
            for (const pin of pins) {
                if (ctx.used[pin]) continue;
                if (picked.includes(pin)) continue;
                if (!smartPinAllowedFor(pin, req, modData, ctx)) continue;
                const sc = smartScorePin(pin, req, ctx, picked);
                if (sc > bestScore) { bestScore = sc; best = pin; }
            }
            if (best === null) break;
            picked.push(best);
            score += bestScore;
        }

        if (picked.length < count) {
            if (!req.optional) missing.push(sig);
            continue; // 缺脚就整条信号不接，避免半截接线
        }

        connections[sig] = picked.join(',');
        picked.forEach(p => {
            ctx.used[p] = { owner: modIndex, signal: sig, highSpeed: !!req.high_speed };
        });
        ctx.chosen.push(...picked);
        if (count === 1 && SMART_BUS_SIGNALS.has(sig)) {
            if (!ctx.bus[iface]) ctx.bus[iface] = {};
            ctx.bus[iface][sig] = picked[0];
        }
    }

    return { connections, missing, used: ctx.used, bus: ctx.bus, chosen: ctx.chosen, score: score, side: side };
}

function smartBetter(a, b) {
    if (!b) return true;
    if (a.missing.length !== b.missing.length) return a.missing.length < b.missing.length;
    return a.score > b.score;
}

/* ---------- 整套方案 ---------- */

function planWiringSet(strategy, avoidSet) {
    const geo = smartPinGeo();
    const pins = smartCandidatePins(geo);
    const spec = smartBoardSpec();
    const lib = (typeof moduleLibrary !== 'undefined' && moduleLibrary) ? moduleLibrary : {};
    const mux = boardConfig.ioMuxSpi || {};
    const defaults = boardConfig.defaultInterfaces || {};

    const used = {};
    const bus = { I2C: {}, SPI: {}, I2S: {}, UART: {} };
    const assignments = new Array(activeModules.length);
    const claims = smartClaimedPins(lib);
    const ownerIfaces = activeModules.map(m => (lib[m.id] || {}).interface || '');
    const wifiActive = activeModules.some(m => !!(lib[m.id] || {}).uses_wifi);

    // 先把「总线 / 芯片专用」信号排掉（SCK/MOSI/CS/SDA/SCL/BCLK…），
    // 再排 RST/DC/VSYNC 这类纯控制脚。否则一块屏的 RST 会先把 I2C 的 SCL 抢走。
    const primaryReqs = [], secondaryReqs = [];
    activeModules.forEach((mod, i) => {
        const md = lib[mod.id] || { name: mod.id, requirements: [], interface: '' };
        const defMap = smartDefaults(md);
        const isPrimary = (r) =>
            !!r.high_speed ||
            mux[r.signal] !== undefined ||
            defMap[r.signal] !== undefined;
        const all = smartSortReqs(md);
        primaryReqs[i] = all.filter(isPrimary);
        secondaryReqs[i] = all.filter(r => !isPrimary(r));
    });

    // 先接优先级高的模组（显示/摄像头/音频），小模组后接，避免大模组被切碎
    const order = activeModules.map((mod, i) => i).sort((a, b) => {
        const da = lib[activeModules[a].id] || {}, db = lib[activeModules[b].id] || {};
        return (db.priority || 50) - (da.priority || 50);
    });

    const chosenSides = {};

    const pickSide = (modData, modIndex, reqs, fixedSide, seedPins) => {
        let sides;
        if (fixedSide) sides = [fixedSide];
        else if (strategy.sideMode === 'alternate') sides = [Object.keys(chosenSides).length % 2 === 0 ? 'left' : 'right'];
        else sides = ['left', 'right'];

        let best = null, bestSide = sides[0];
        for (const side of sides) {
            const res = planModuleOnSide(modData, modIndex, side, used, bus, strategy, geo, pins, spec, reqs, seedPins, claims, ownerIfaces, wifiActive, avoidSet);
            if (smartBetter(res, best)) { best = res; bestSide = side; }
        }
        // 换边策略：两侧都能接满时，故意选得分更低（更偏的另一侧）的那套
        if (strategy.sideMode === 'worse' && !fixedSide) {
            const leftRes = planModuleOnSide(modData, modIndex, 'left', used, bus, strategy, geo, pins, spec, reqs, seedPins, claims, ownerIfaces, wifiActive, avoidSet);
            const rightRes = planModuleOnSide(modData, modIndex, 'right', used, bus, strategy, geo, pins, spec, reqs, seedPins, claims, ownerIfaces, wifiActive, avoidSet);
            const bothOk = leftRes.missing.length === 0 && rightRes.missing.length === 0;
            if (bothOk) {
                best = leftRes.score <= rightRes.score ? leftRes : rightRes;
                bestSide = best.side || bestSide;
            }
        }
        // 主选侧缺必需脚时，再试另一侧
        if (best.missing.length && sides.length === 1) {
            const other = sides[0] === 'left' ? 'right' : 'left';
            const res = planModuleOnSide(modData, modIndex, other, used, bus, strategy, geo, pins, spec, reqs, seedPins, claims, ownerIfaces, wifiActive, avoidSet);
            if (smartBetter(res, best)) { best = res; bestSide = other; }
        }
        bestSide = best.side || bestSide;
        Object.assign(used, best.used);
        Object.keys(best.bus).forEach(k => { bus[k] = best.bus[k]; });
        return { res: best, side: bestSide };
    };

    // 阶段 1：总线 / 专用信号，决定模组摆哪一侧
    order.forEach((modIndex) => {
        const mod = activeModules[modIndex];
        const modData = lib[mod.id] || { name: mod.id, requirements: [], interface: '', };
        const pick = pickSide(modData, modIndex, primaryReqs[modIndex], null);
        chosenSides[modIndex] = pick.side;
        assignments[modIndex] = {
            id: mod.id,
            name: (modData.name || mod.id),
            interface: modData.interface || '',
            connections: Object.assign({}, pick.res.connections),
            missing: pick.res.missing.slice(),
            side: pick.side,
            pins: pick.res.chosen.slice()
        };
    });

    // 阶段 2：控制脚，沿用阶段 1 定下的那一侧
    order.forEach((modIndex) => {
        const mod = activeModules[modIndex];
        const modData = lib[mod.id] || { name: mod.id, requirements: [], interface: '' };
        if (!secondaryReqs[modIndex].length) return;
        const a = assignments[modIndex];
        const pick = pickSide(modData, modIndex, secondaryReqs[modIndex], chosenSides[modIndex], a.pins);
        Object.assign(a.connections, pick.res.connections);
        a.missing.push(...pick.res.missing);
        pick.res.chosen.forEach(p => { if (!a.pins.includes(p)) a.pins.push(p); });
    });

    return { assignments: assignments, used: used };
}

/* 方案体检：用同一套诊断引擎复核，保证面板上写的就是真实结论 */
function smartAudit(assignments) {
    const conns = [];
    assignments.forEach(a => {
        Object.entries(a.connections || {}).forEach(([signal, pinStr]) => {
            String(pinStr).split(',').forEach(p => {
                const n = Number(String(p).trim());
                if (Number.isFinite(n)) conns.push({ pin: n, module: a.name, signal: signal });
            });
        });
    });
    let report = { errors: [], warnings: [] };
    if (typeof runHardwareDiagnostics === 'function' && typeof ruleKnowledgeBase !== 'undefined') {
        try { report = runHardwareDiagnostics(conns, boardConfig.boardName); } catch (e) { /* 规则缺失时不阻断方案 */ }
    }
    return { report: report, conns: conns };
}

function smartMuxHits(assignments) {
    const mux = boardConfig.ioMuxSpi || {};
    let hit = 0, total = 0;
    assignments.forEach(a => {
        Object.entries(a.connections || {}).forEach(([sig, pinStr]) => {
            if (sig !== 'SCK' && sig !== 'MOSI') return;
            total++;
            if (Number(pinStr) === Number(mux[sig])) hit++;
        });
    });
    return { hit: hit, total: total };
}

function smartSpan(assignments, geo) {
    let span = 0;
    assignments.forEach(a => {
        if (!a.pins || a.pins.length < 2) return;
        const left = a.pins.filter(p => geo[p] && geo[p].side === 'left').map(p => geo[p].idx);
        const right = a.pins.filter(p => geo[p] && geo[p].side === 'right').map(p => geo[p].idx);
        if (left.length > 1) span += Math.max(...left) - Math.min(...left);
        if (right.length > 1) span += Math.max(...right) - Math.min(...right);
    });
    return span;
}

function smartSchemeList() {
    const geo = smartPinGeo();
    const out = [];
    const seen = new Set();

    let recommendedPins = null;
    SMART_STRATEGIES.forEach(st => {
        if (st.id === 'reserve' && boardConfig.ioMuxSpiBlocked) return;
        const plan = planWiringSet(st, st.avoidRecommended ? recommendedPins : null);
        if (st.id === 'recommended') {
            recommendedPins = new Set();
            plan.assignments.forEach(a => a.pins.forEach(p => recommendedPins.add(p)));
        }
        const audit = smartAudit(plan.assignments);
        const missingTotal = plan.assignments.reduce((n, a) => n + a.missing.length, 0);

        if (missingTotal > 0) return; // 凑不齐必需引线的方案没有可执行性，不展示
        const key = plan.assignments.map(a => JSON.stringify(a.connections)).join('|');
        if (seen.has(key)) return; // 权重不同但落点完全一样 → 只留第一套
        seen.add(key);

        const mux = smartMuxHits(plan.assignments);
        const span = smartSpan(plan.assignments, geo);
        const sides = new Set(plan.assignments.map(a => a.side));
        const sideLabel = sides.size > 1 ? '左右分列' : (sides.has('left') ? '左侧集中' : '右侧集中');

        let badge = '';
        if (st.id === 'recommended') {
            if (mux.total && mux.hit === mux.total) badge = 'IO_MUX · 80MHz';
            else if (mux.total && mux.hit === 0) badge = boardConfig.ioMuxSpiBlocked ? '专用脚被占 · 矩阵 40MHz' : '矩阵 · 40MHz';
            else if (mux.hit) badge = `IO_MUX ${mux.hit}/${mux.total}`;
            else badge = '默认接口';
        }
        else if (st.id === 'compact') badge = `${sideLabel} ${span} 针跨度`;
        else if (st.id === 'quiet') badge = '不占 UART / USB';
        else if (st.id === 'reserve') badge = mux.hit === 0 ? '不占 10~15' : '已让出专用脚';
        else if (st.id === 'backup') badge = '落点不同 · 同规则校验';
        else if (st.id === 'opposite') badge = mux.total && mux.hit === mux.total ? '另一侧 · IO_MUX' : '另一侧 · 矩阵 40MHz';
        else if (st.id === 'spread') badge = sides.size > 1 ? `${sides.size} 侧分列` : '单侧走线';

        out.push({
            key: st.id,
            name: st.name,
            icon: st.icon,
            desc: st.desc,
            badge: badge,
            assignments: plan.assignments,
            missingTotal: missingTotal,
            errors: audit.report.errors || [],
            warnings: audit.report.warnings || [],
            mux: mux,
            span: span
        });
    });

    // 冲突优先、其次风险提示：让“代价最小”的方案排在最上面
    out.sort((a, b) => (a.errors.length * 10 + a.warnings.length) - (b.errors.length * 10 + b.warnings.length));
    return out;
}

/* ---------- 方案摘要（给面板/按钮用） ---------- */

/* ---------- 源码原接线 ----------
   源码解析（导入工程）走的是另一条路径：engine.js 的 tryAllocate + preferredPins，
   按代码里 #define 的引脚号做贪心分配。它不参与本文件的打分策略，也可能带着冲突，
   所以永远不会出现在方案列表里。这里给它单独留一张卡，让「代码里原本接成什么样」可见、可回退。 */
const SOURCE_WIRING_KEY = 'source-wiring';

function captureSourceWiring(name) {
    if (typeof activeModules === 'undefined' || !activeModules.length) { window._sourceWiring = null; return; }
    window._sourceWiring = {
        name: name || '导入的工程',
        modules: activeModules.map(m => ({
            id: m.id,
            connections: JSON.parse(JSON.stringify(m.connections || {}))
        }))
    };
}

/* 快照按模组 id 对齐：允许源码里带着「已从工作台移除」的模组。
   删掉一个不想要的模组（比如那个开关），不该把整张「源码原接线」对照卡一起抹掉 ——
   剩下几个模组仍然有源码接法可看、可回退。只有出现了源码里没有的新模组时才算失效。 */
function smartSourceSnapshot() {
    const snap = window._sourceWiring;
    if (!snap || !snap.modules || !snap.modules.length) return null;
    if (typeof activeModules === 'undefined' || !activeModules.length) return null;

    const pool = snap.modules.map(m => ({ id: m.id, connections: m.connections || {}, used: false }));
    const aligned = [];
    for (const mod of activeModules) {
        const hit = pool.find(p => !p.used && p.id === mod.id);
        if (!hit) return null;                       // 画布上出现了源码里没有的模组 → 不是同一套接法
        hit.used = true;
        aligned.push({ id: hit.id, connections: hit.connections });
    }
    const removedCount = pool.filter(p => !p.used).length;
    return { name: snap.name, modules: aligned, removedCount: removedCount };
}

function isSourceWiringActive() {
    const snap = smartSourceSnapshot();
    if (!snap) return false;
    return snap.modules.every((s, i) => {
        const cur = activeModules[i].connections || {};
        const keys = new Set(Object.keys(s.connections || {}).concat(Object.keys(cur)));
        for (const k of keys) {
            if (String(cur[k] === undefined ? '' : cur[k]) !== String(s.connections[k] === undefined ? '' : s.connections[k])) return false;
        }
        return true;
    });
}

/* 空态里的「去添加模组」：先收面板再开购物窗，避免两层叠在一起 */
function closeSmartPanelAndOpenCart() {
    toggleSmartPanel(false);
    openCartModal();
}

function applySourceWiring(silent) {
    const snap = smartSourceSnapshot();
    if (!snap) return;
    activeModules.forEach((mod, i) => {
        mod.connections = JSON.parse(JSON.stringify(snap.modules[i].connections || {}));
    });
    if (typeof rebuildPinState === 'function') rebuildPinState();
    if (typeof renderPins === 'function') renderPins();
    if (typeof renderModules === 'function') renderModules();
    if (typeof updatePowerBudget === 'function') updatePowerBudget();

    _smartAppliedKey = SOURCE_WIRING_KEY;
    if (_smartPanelOpen) renderSmartPanel();
    if (!silent && typeof uiToast === 'function') {
        uiToast('已回到源码原接线（按代码原样接，未经过规则优化）', { type: 'info', duration: 2600 });
    }
}

/* 当前画布上的接线是否正好等于某套方案（忽略手工追加的扩展引线） */
function detectCurrentSchemeKey() {
    if (!activeModules.length) return null;
    const matchOne = (mod, asg) => {
        if (!mod || !asg) return false;
        const keys = Object.keys(asg.connections || {});
        if (!keys.length) return true;
        return keys.every(k => String(mod.connections[k] === undefined ? '' : mod.connections[k]) === String(asg.connections[k]));
    };
    for (const sc of _smartSchemes) {
        let ok = sc.assignments.length === activeModules.length;
        for (let i = 0; ok && i < activeModules.length; i++) ok = matchOne(activeModules[i], sc.assignments[i]);
        if (ok) return sc.key;
    }
    // 不属于任何一套优化方案，但正好等于源码解析带进来的接法
    if (isSourceWiringActive()) return SOURCE_WIRING_KEY;
    return null;
}

function smartSignalLabel(modData, sig) {
    const req = ((modData && modData.requirements) || []).find(r => r.signal === sig);
    return (req && req.label) ? req.label : sig;
}

function smartPinText(assignments) {
    return assignments.map(a => {
        const modData = (moduleLibrary && moduleLibrary[a.id]) || {};
        const parts = Object.entries(a.connections || {}).map(([sig, pins]) => {
            const label = smartSignalLabel(modData, sig);
            return `${label}→${String(pins).split(',').join('/')}`;
        });
        return parts.length ? `${moduleShortName(a.id)}：${parts.join('  ')}` : `${moduleShortName(a.id)}：无需 GPIO`;
    });
}

/* ---------- 应用 ---------- */

function smartPreserveExtras(mod, assignment, globalUsed) {
    // 方案只覆盖 requirements 里的信号；用户手工加的扩展引线（如屏的 BLK 改 GPIO 调光）
    // 如果目标脚在方案里仍空闲，就原样保留，避免一键切方案把手动配置抹掉
    const modData = moduleLibrary[mod.id] || {};
    const reqSigs = new Set((modData.requirements || []).map(r => r.signal));
    const usedPins = new Set();
    Object.values(assignment.connections || {}).forEach(v => String(v).split(',').forEach(p => usedPins.add(Number(p))));

    const extras = {};
    Object.entries(mod.connections || {}).forEach(([sig, val]) => {
        if (reqSigs.has(sig) || val === 'dropped' || !val) return;
        const pinList = String(val).split(',').map(Number).filter(n => Number.isFinite(n));
        const free = pinList.filter(n => !usedPins.has(n) && !(globalUsed && globalUsed.has(n)) && (typeof isHeaderPin !== 'function' || isHeaderPin(n)));
        if (!free.length) return;
        extras[sig] = free.join(',');
        free.forEach(n => { usedPins.add(n); if (globalUsed) globalUsed.add(n); });
    });
    return Object.assign({}, assignment.connections, extras);
}

function applySmartScheme(index, silent) {
    const scheme = _smartSchemes[index];
    if (!scheme) return;
    if (scheme.missingTotal > 0) {
        if (typeof uiToast === 'function') uiToast('这套方案凑不齐必需引脚，换一套试试', { type: 'error' });
        return;
    }

    // 先把整套方案占用的脚汇总，避免 A 模组保留的扩展引线撞到 B 模组的方案脚
    const globalUsed = new Set();
    scheme.assignments.forEach(a => {
        Object.values(a.connections || {}).forEach(v => String(v).split(',').forEach(p => {
            const n = Number(p);
            if (Number.isFinite(n)) globalUsed.add(n);
        }));
    });

    activeModules.forEach((mod, i) => {
        const asg = scheme.assignments[i];
        if (!asg) return;
        mod.connections = smartPreserveExtras(mod, asg, globalUsed);
    });

    if (typeof rebuildPinState === 'function') rebuildPinState();
    if (typeof renderPins === 'function') renderPins();
    if (typeof renderModules === 'function') renderModules();
    if (typeof updatePowerBudget === 'function') updatePowerBudget();

    _smartAppliedKey = scheme.key;
    _smartPanelOpen && renderSmartPanel();

    if (!silent && typeof uiToast === 'function') {
        const warnText = scheme.warnings.length ? ` · ${scheme.warnings.length} 条提示` : '';
        const rebuildText = window.currentUploadedSource ? ' · 需自行编译固件' : '';
        uiToast(`已切换：${scheme.name}（${scheme.errors.length ? '❌ ' + scheme.errors.length : '✓ 0 冲突'}${warnText}）${rebuildText}`, {
            type: scheme.errors.length ? 'error' : 'success', duration: rebuildText ? 3600 : 2600
        });
    }
}

/* ---------- 面板 ---------- */

function smartSignature() {
    if (typeof boardConfig === 'undefined' || !boardConfig) return '';
    const mods = (typeof activeModules !== 'undefined' ? activeModules : []).map(m => m.id).join(',');
    return `${boardConfig.boardName}|${mods}`;
}

function toggleSmartPanel(force) {
    const panel = document.getElementById('smart-panel');
    if (!panel) return;
    const next = (typeof force === 'boolean') ? force : !_smartPanelOpen;
    _smartPanelOpen = next;
    panel.style.display = next ? 'flex' : 'none';
    const btn = document.getElementById('smart-wiring-btn');
    if (btn) {
        btn.classList.toggle('smart-btn--active', next);
        if (!next) btn.innerText = '⚡ 智能接线';
    }

    if (!next) {
        // 面板收起 → 画布变宽，把视图还原到打开前（用户手动调过就只做居中）
        requestAnimationFrame(() => {
            const sameAsFit = _smartFitView && Math.abs(currentScale - _smartFitView.s) < 1e-6 &&
                Math.abs(currentTranslateX - _smartFitView.x) < 0.5 && Math.abs(currentTranslateY - _smartFitView.y) < 0.5;
            if (sameAsFit && _smartViewBackup && typeof restoreCanvasView === 'function') restoreCanvasView(_smartViewBackup);
            else if (typeof recenterCanvas === 'function') recenterCanvas();
            _smartViewBackup = null;
            _smartFitView = null;
        });
        return;
    }

    // 两个停靠面板会一起挤占画布，打开智能接线时先把自检收起来
    if (typeof _diagPanelOpen !== 'undefined' && _diagPanelOpen && typeof toggleDiagnosticsPanel === 'function') {
        toggleDiagnosticsPanel(false);
    }
    _smartViewBackup = (typeof saveCanvasView === 'function') ? saveCanvasView() : null;
    requestAnimationFrame(() => {
        _smartFitView = (typeof fitCanvasToContent === 'function') ? fitCanvasToContent() : null;
    });

    _smartSignature = smartSignature();
    _smartSchemes = smartSchemeList();
    // 画布上还一根线都没有时，直接给出推荐方案，省掉一次点击
    const hasWiring = (typeof activeModules !== 'undefined' ? activeModules : []).some(m =>
        Object.values(m.connections || {}).some(v => v && v !== 'dropped'));
    _smartAppliedKey = detectCurrentSchemeKey();
    renderSmartPanel();
    if (!hasWiring && _smartSchemes.length && _smartSchemes[0].missingTotal === 0) {
        applySmartScheme(0, true);
    }
}

/* 面板开着时模组/主板变了：只刷新列表，不覆盖用户当前接线 */
function refreshSmartPanelIfStale() {
    if (!_smartPanelOpen) return;
    let needRender = false;
    const sig = smartSignature();
    if (sig !== _smartSignature) {
        _smartSignature = sig;
        _smartSchemes = smartSchemeList();
        needRender = true;
    }
    // 高亮只在「当前落点确实变了」时更新，避免拖线时反复重建列表、把滚动位置顶回去
    const live = detectCurrentSchemeKey();
    if (live !== _smartAppliedKey) { _smartAppliedKey = live; needRender = true; }
    if (needRender) renderSmartPanel();
}

function smartWorstLevel(scheme) {
    if (scheme.errors.length) return 'error';
    if (scheme.warnings.length) return 'warn';
    return 'ok';
}

function smartCardHtml(scheme, index, currentKey) {
    const active = scheme.key === (currentKey === undefined ? _smartAppliedKey : currentKey);
    const lvl = smartWorstLevel(scheme);
    const statusIcon = lvl === 'error' ? '❌' : (lvl === 'warn' ? '⚠️' : '✓');
    const statusText = lvl === 'error'
        ? `${scheme.errors.length} 处冲突`
        : (lvl === 'warn' ? `0 冲突 · ${scheme.warnings.length} 提示` : '0 冲突');
    const disabled = scheme.missingTotal > 0;
    const pinLines = smartPinText(scheme.assignments);

    const missingHtml = disabled
        ? `<div class="smart-card-missing">⚠️ 这套方案差 ${scheme.missingTotal} 根必需线，不能直接使用</div>`
        : '';
    // 导入过源码 = 板子里跑的是现成固件，它的引脚写死在 config.h 里。
    // 这套方案把脚挪了位置，官方固件就不认了，必须自己重编译才能烧。
    const rebuildHtml = window.currentUploadedSource
        ? `<div class="smart-card-rebuild">⟳ 偏离源码引脚 · 需自行编译后才能烧</div>`
        : '';

    return `<button type="button" class="smart-card ${active ? 'smart-card--active' : ''} ${disabled ? 'smart-card--disabled' : ''}"
            data-act="applySmartScheme" data-arg="${index}" ${disabled ? 'disabled' : ''}>
        <div class="smart-card-head">
            <span class="smart-card-idx">${active ? '✓' : index + 1}</span>
            <span class="smart-card-name">${scheme.icon} ${scheme.name}</span>
            <span class="smart-card-badge smart-card-badge--${lvl}">${statusIcon} ${statusText}</span>
        </div>
        <div class="smart-card-desc">${scheme.desc}</div>
        <div class="smart-card-pins">${pinLines.map(l => `<div class="smart-pin-line">${escapeSmartHtml(l)}</div>`).join('')}</div>
        ${rebuildHtml}
        <div class="smart-card-foot">
            <span class="smart-tag">${escapeSmartHtml(scheme.badge)}</span>
            ${active ? '<span class="smart-current">当前方案</span>' : '<span class="smart-apply">点击应用</span>'}
        </div>
        ${missingHtml}
    </button>`;
}

/* 源码原接线卡片：和方案卡并列，但明确标注「不是引擎算的」，不可混为一谈 */
function smartSourceCardHtml(snap, isCurrent) {
    const conns = [];
    snap.modules.forEach(m => {
        Object.entries(m.connections || {}).forEach(([sig, v]) => {
            String(v).split(',').forEach(p => {
                const n = Number(p);
                if (p && p !== 'dropped' && Number.isFinite(n)) conns.push({ pin: n, signal: sig, module: m.id });
            });
        });
    });

    let errors = [], warnings = [];
    if (typeof runHardwareDiagnostics === 'function' && typeof boardConfig !== 'undefined' && boardConfig) {
        const rep = runHardwareDiagnostics(conns, boardConfig.boardName) || {};
        errors = rep.errors || [];
        warnings = rep.warnings || [];
    }
    const lvl = errors.length ? 'error' : (warnings.length ? 'warn' : 'ok');
    const statusIcon = lvl === 'error' ? '❌' : (lvl === 'warn' ? '⚠️' : '✓');
    const statusText = errors.length
        ? `${errors.length} 处冲突`
        : (warnings.length ? `0 冲突 · ${warnings.length} 提示` : '0 冲突');
    const pinLines = smartPinText(snap.modules);
    const removedNote = snap.removedCount
        ? `<div class="smart-card-note">已从工作台移除 ${snap.removedCount} 个模组 · 源码里的定义仍然保留</div>`
        : '';

    return `<button type="button" class="smart-card smart-card--source ${isCurrent ? 'smart-card--active' : ''}"
            data-act="applySourceWiring">
        <div class="smart-card-head">
            <span class="smart-card-idx smart-card-idx--src">📄</span>
            <span class="smart-card-name">源码原接线</span>
            <span class="smart-card-badge smart-card-badge--${lvl}">${statusIcon} ${statusText}</span>
        </div>
        <div class="smart-card-desc">源自 <b>${escapeSmartHtml(snap.name)}</b> 里的 <code>#define</code> 引脚号 —— 按代码原样接，没有经过规则重排。<b>这条接法官方固件可直接烧</b>，是导入工程后的默认方案。</div>
        ${removedNote}
        <div class="smart-card-pins">${pinLines.map(l => `<div class="smart-pin-line">${escapeSmartHtml(l)}</div>`).join('')}</div>
        <div class="smart-card-foot">
            <span class="smart-tag smart-tag--src">✓ 官方固件可用</span>
            ${isCurrent ? '<span class="smart-current">当前接线</span>' : '<span class="smart-apply">回到这个接法</span>'}
        </div>
    </button>`;
}

function renderSmartPanel() {
    const body = document.getElementById('smart-panel-body');
    if (!body) return;
    const sub = document.getElementById('smart-head-sub');
    if (sub && typeof boardConfig !== 'undefined' && boardConfig) {
        sub.innerText = `${boardConfig.boardName} · 按真实电气规则生成，点一下即切换`;
    }

    if (typeof activeModules === 'undefined' || !activeModules.length) {
        body.innerHTML = `<div class="smart-empty">
            <div class="smart-empty-icon">🧩</div>
            <div class="smart-empty-title">先添加一个模组</div>
            <div class="smart-empty-sub">智能接线会按这个模组的真实引脚需求，算出多套能直接照着接的方案。</div>
            <button type="button" class="smart-empty-btn" data-act="closeSmartPanelAndOpenCart">＋ 去添加模组</button>
        </div>`;
        return;
    }

    if (!_smartSchemes.length) {
        // 剩下的模组不需要 GPIO（或者刚被删到只剩无信号脚的模组）：
        // 源码接法这张对照卡仍然有意义，别跟着一起消失
        const snapOnly = smartSourceSnapshot();
        body.innerHTML = `<div class="smart-empty">
            <div class="smart-empty-icon">🤔</div>
            <div class="smart-empty-title">当前模组不需要 GPIO</div>
            <div class="smart-empty-sub">这些模组没有可分配的信号脚（例如 Wi-Fi 内置模块），无需生成接线方案。</div>
        </div>` + (snapOnly ? smartSourceCardHtml(snapOnly, isSourceWiringActive()) : '');
        return;
    }

    const modCount = activeModules.length;
    const okCount = _smartSchemes.filter(s => s.missingTotal === 0).length;
    const subText = okCount <= 1
        ? '这类模组在当前主板上只有这一种合法落点，已避开板载占用、Wi-Fi/ADC 与启动脚冲突'
        : '每套都已按排针白名单、板载占用、strapping、ADC、高速串扰规则校验过';
    const liveKey = detectCurrentSchemeKey();
    _smartAppliedKey = liveKey;
    const snap = smartSourceSnapshot();
    const srcActive = isSourceWiringActive();
    // 源码接法恰好等于某套方案时，列表里那张卡就是它本身，不必再重复一张
    const showSourceCard = !!snap && !(srcActive && liveKey !== SOURCE_WIRING_KEY);
    const summarySub = srcActive
        ? `当前画布是源码解析带进来的原接线 —— 官方固件可直接烧；下面 ${okCount} 套是重新分配过的，烧之前要自己重编译`
        : subText;
    let html = `<div class="smart-summary">
        <div class="smart-summary-main">${modCount} 个模组 · ${okCount} 套可直接用</div>
        <div class="smart-summary-sub">${summarySub}</div>
    </div>`;
    // 导入过源码却选了重排接法：这是唯一会让人「照图接完却发现官方固件不认」的地方，必须显式提示
    if (window.currentUploadedSource && !srcActive) {
        html += `<div class="smart-warnbar">
            <b>当前接法已偏离源码引脚</b>
            <span>板子里那版现成固件不会认这套接法，必须按新的 config.h 重新编译再烧。点「源码原接线」可退回。</span>
        </div>`;
    }
    if (showSourceCard) {
        html += smartSourceCardHtml(snap, srcActive);
        html += `<div class="smart-divider">以下 ${okCount} 套由本工具按电气规则重新分配</div>`;
    }
    html += _smartSchemes.map(sc => smartCardHtml(sc, _smartSchemes.indexOf(sc), liveKey)).join('');
    body.innerHTML = html;
    updateSmartBtn();
}

/* 面板开着时按钮上显示当前方案序号 */
function updateSmartBtn() {
    const btn = document.getElementById('smart-wiring-btn');
    if (!btn) return;
    if (_smartAppliedKey === SOURCE_WIRING_KEY) { btn.innerText = '⚡ 智能接线 · 源码接线'; return; }
    const idx = _smartSchemes.findIndex(s => s.key === _smartAppliedKey);
    if (idx >= 0) btn.innerText = `⚡ 智能接线 ${idx + 1}/${_smartSchemes.length}`;
    else {
        const hasWiring = (typeof activeModules !== 'undefined' ? activeModules : []).some(m =>
            Object.values(m.connections || {}).some(v => v && v !== 'dropped'));
        btn.innerText = hasWiring ? '⚡ 智能接线 · 自定义' : '⚡ 智能接线';
    }
}

/* 面板内的 ‹ › 与 ← → 键共用：只在“可用方案”里循环 */
function cycleSmartScheme(dir) {
    if (!_smartSchemes.length) return;
    const usable = _smartSchemes.map((s, i) => s.missingTotal === 0 ? i : -1).filter(i => i >= 0);
    if (!usable.length) return;
    const cur = usable.indexOf(_smartSchemes.findIndex(s => s.key === _smartAppliedKey));
    const pos = cur < 0 ? (dir > 0 ? -1 : 0) : cur;
    const next = (pos + dir + usable.length) % usable.length;
    applySmartScheme(usable[next]);
}

document.addEventListener('keydown', (e) => {
    if (!_smartPanelOpen) {
        // S 打开智能接线（输入框 / 弹窗内不抢键）
        const t = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        const typing = t === 'input' || t === 'textarea' || t === 'select' || (e.target && e.target.isContentEditable);
        const modalOpen = Array.from(document.querySelectorAll('.modal-overlay')).some(m => m.style.display !== 'none' && m.offsetParent !== null);
        if (!typing && !modalOpen && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            toggleSmartPanel(true);
        }
        return;
    }
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
        toggleSmartPanel(false);
        e.stopPropagation();
        return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        cycleSmartScheme(e.key === 'ArrowRight' ? 1 : -1);
        e.preventDefault();
    }
});

/* 保留旧名：面板模板里调用点很多，统一走 util.js 的 escapeHtml */
function escapeSmartHtml(s) { return escapeHtml(s); }

window.toggleSmartPanel = toggleSmartPanel;
window.applySmartScheme = applySmartScheme;
window.applySourceWiring = applySourceWiring;
window.captureSourceWiring = captureSourceWiring;
window.cycleSmartScheme = cycleSmartScheme;
window.refreshSmartPanelIfStale = refreshSmartPanelIfStale;

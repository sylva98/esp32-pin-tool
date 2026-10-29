/* =========================================================
 * 接线自检面板（diagnostics-ui.js）
 *
 * 背景：diagnostics.js 只负责「算」，算出的结果原本只写到 index.html 里
 * 早已 display:none 的 #pin-grid 上，用户在画布界面完全看不到警告。
 * 本文件负责让结果「被看见」：
 *   1) 工具栏「自检」胶囊：实时显示 ❌n / ⚠️n
 *   2) 画布右侧浮层：逐条列出问题，点一条即把画布平移到该 GPIO 并高亮
 *   3) 主板引脚外圈红/黄涟漪：不开面板也能一眼看到有问题的脚
 * ========================================================= */

let _diagReport = { errors: [], warnings: [], infos: [], gaps: [] };
let _diagPinLevel = {};      // pin -> 'error' | 'warning'
let _diagPinMsg = {};        // pin -> 一句话结论
let _diagPinHint = {};       // pin -> 一句话「怎么做」
let _diagPanelOpen = false;
let _diagHasWiring = false;
let _diagLastErrors = 0;
let _diagViewBackup = null;   // 打开面板前的画布视图
let _diagFitView = null;      // 打开面板后自适应出来的视图（用于判断用户有没有手动调过）

/* 当前画布上的接线摊平成诊断引擎需要的结构：{ pin, module, signal } */
function buildDiagConnections() {
    const conns = [];
    if (typeof activeModules === 'undefined' || !activeModules) return conns;
    const lib = (typeof moduleLibrary !== 'undefined' && moduleLibrary) ? moduleLibrary : {};
    activeModules.forEach(mod => {
        const modData = lib[mod.id];
        const modName = (modData && modData.name) ? modData.name : (mod.name || '未知模组');
        Object.entries(mod.connections || {}).forEach(([signal, pinStr]) => {
            if (pinStr === 'dropped' || pinStr === undefined || pinStr === null) return;
            String(pinStr).split(',').forEach(p => {
                const n = Number(String(p).trim());
                if (!Number.isNaN(n)) conns.push({ pin: n, module: modName, signal });
            });
        });
    });
    return conns;
}

/* 「本该接却没接」的引线：用户在引脚面板里放弃掉的信号 */
function buildDiagGaps() {
    const gaps = [];
    if (typeof activeModules === 'undefined' || !activeModules) return gaps;
    const lib = (typeof moduleLibrary !== 'undefined' && moduleLibrary) ? moduleLibrary : {};
    activeModules.forEach(mod => {
        const modData = lib[mod.id];
        const modName = (modData && modData.name) ? modData.name : (mod.name || '未知模组');
        Object.entries(mod.connections || {}).forEach(([signal, pinStr]) => {
            if (pinStr === 'dropped') gaps.push({ module: modName, signal: signal });
        });
    });
    return gaps;
}

function setDiagReport(report) {
    const r = report || {};
    _diagReport = {
        errors: r.errors || [],
        warnings: r.warnings || [],
        infos: r.infos || [],
        gaps: buildDiagGaps()
    };
    _diagHasWiring = buildDiagConnections().length > 0;

    // 同一根脚既有 error 又有 warning 时以 error 为准
    _diagPinLevel = {};
    _diagPinMsg = {};
    _diagPinHint = {};
    _diagReport.errors.forEach(e => {
        if (e.pin === undefined || e.pin === null) return;
        _diagPinLevel[e.pin] = 'error';
        _diagPinMsg[e.pin] = e.message || '';
        _diagPinHint[e.pin] = e.hint || '';
    });
    _diagReport.warnings.forEach(w => {
        if (w.pin === undefined || w.pin === null) return;
        if (_diagPinLevel[w.pin] === 'error') return;
        _diagPinLevel[w.pin] = 'warning';
        _diagPinMsg[w.pin] = w.message || '';
        _diagPinHint[w.pin] = w.hint || '';
    });
}

/* 供画布渲染读取：某 GPIO 的问题级别 / 提示文案 */
function diagLevelOf(pin) {
    const lv = _diagPinLevel[pin];
    return lv || null;
}
function diagMessageOf(pin) {
    const msg = _diagPinMsg[pin] || '';
    const hint = _diagPinHint[pin] || '';
    return hint ? `${msg}｜${hint}` : msg;
}
window.diagLevelOf = diagLevelOf;
window.diagMessageOf = diagMessageOf;

/* 保留旧名：诊断面板里大量调用点不改，统一走 util.js 的 escapeHtml */
function escapeDiagHtml(s) { return escapeHtml(s); }

/* ---------- 对外入口：renderPins 每次刷新都会调 ---------- */
function renderDiagnosticsUI(report) {
    setDiagReport(report);
    updateDiagChip();
    if (_diagPanelOpen) renderDiagPanelBody();
}

function updateDiagChip() {
    const chip = document.getElementById('diag-chip');
    const text = document.getElementById('diag-chip-text');
    if (!chip || !text) return;

    const e = _diagReport.errors.length;
    const w = _diagReport.warnings.length;
    const g = _diagReport.gaps.length;

    chip.classList.remove('diag-chip--idle', 'diag-chip--ok', 'diag-chip--warn', 'diag-chip--error');

    if (!_diagHasWiring) {
        chip.classList.add('diag-chip--idle');
        text.innerText = '接线自检';
        chip.title = '接线后自动检查冲突、启动脚、USB 与串口';
    } else if (e > 0) {
        chip.classList.add('diag-chip--error');
        text.innerText = `❌ ${e}` + (w ? ` · ⚠️ ${w}` : '');
        chip.title = `${e} 处必须改` + (w ? ` · ${w} 处能用但有代价` : '') + (g ? ` · ${g} 根未接` : '');
    } else if (w > 0) {
        chip.classList.add('diag-chip--warn');
        text.innerText = `⚠️ ${w}`;
        chip.title = `${w} 处能用但有代价` + (g ? ` · ${g} 根未接` : '');
    } else {
        chip.classList.add('diag-chip--ok');
        text.innerText = '✓ 无冲突';
        chip.title = g ? `没有冲突 · ${g} 根未接` : '没有冲突';
    }

    // 刚出现新错误时闪一下，避免用户盯着画布错过
    if (e > _diagLastErrors) {
        chip.classList.remove('diag-chip--flash');
        void chip.offsetWidth;
        chip.classList.add('diag-chip--flash');
    }
    _diagLastErrors = e;

    // 排针版图本身的体检结果：不属于接线问题，但会让画布画错，单独挂到「核对排针」按钮上
    const auditN = currentLayoutAudit().length;
    const auditBtn = document.getElementById('pin-audit-btn');
    if (auditBtn) {
        auditBtn.classList.toggle('pin-audit-btn--bad', auditN > 0);
        auditBtn.title = auditN > 0
            ? `排针布局有 ${auditN} 条待核对，点开逐针对照实物`
            : '按实物顺序逐针列出排针布局，方便和手上板子对照';
    }
    if (auditN > 0) chip.title = (chip.title || '') + `；另有 ${auditN} 条排针数据待核对`;

    // 智能接线面板开着时，若模组/主板变了就重算方案列表（不覆盖用户当前接线）
    if (typeof refreshSmartPanelIfStale === 'function') refreshSmartPanelIfStale();
}

function toggleDiagnosticsPanel(force) {
    const panel = document.getElementById('diag-panel');
    if (!panel) return;
    const wasOpen = _diagPanelOpen;
    _diagPanelOpen = (typeof force === 'boolean') ? force : !_diagPanelOpen;
    if (_diagPanelOpen === wasOpen) return;

    panel.style.display = _diagPanelOpen ? 'flex' : 'none';
    // 面板是停靠式的：给画布区加标记，让缩放条跟着内缩，画布可视宽度同步变化
    const area = document.getElementById('wiring-canvas-area');
    if (area) area.classList.toggle('diag-open', _diagPanelOpen);
    const chip = document.getElementById('diag-chip');
    if (chip) chip.classList.toggle('diag-chip--active', _diagPanelOpen);
    if (_diagPanelOpen) renderDiagPanelBody();

    if (_diagPanelOpen && typeof _smartPanelOpen !== 'undefined' && _smartPanelOpen && typeof toggleSmartPanel === 'function') {
        toggleSmartPanel(false);
    }

    if (_diagPanelOpen) {
        // 打开：画布变窄，先记住原视图，再把「主板 + 全部模组」缩进可视区
        _diagViewBackup = (typeof saveCanvasView === 'function') ? saveCanvasView() : null;
        requestAnimationFrame(() => {
            _diagFitView = (typeof fitCanvasToContent === 'function') ? fitCanvasToContent() : null;
        });
    } else {
        requestAnimationFrame(() => {
            // 关闭：用户没在这期间手动缩放/平移就还原原视图，否则只做居中，避免"跳回去"
            const sameAsFit = _diagFitView && Math.abs(currentScale - _diagFitView.s) < 1e-6 &&
                Math.abs(currentTranslateX - _diagFitView.x) < 0.5 && Math.abs(currentTranslateY - _diagFitView.y) < 0.5;
            if (sameAsFit && _diagViewBackup && typeof restoreCanvasView === 'function') {
                restoreCanvasView(_diagViewBackup);
            } else if (typeof recenterCanvas === 'function') {
                recenterCanvas();
            }
            _diagViewBackup = null;
            _diagFitView = null;
        });
    }
}

function diagEmptyHtml(icon, title, sub) {
    return `<div class="diag-empty">
        <div class="diag-empty-icon">${icon}</div>
        <div class="diag-empty-title">${escapeDiagHtml(title)}</div>
        <div class="diag-empty-sub">${escapeDiagHtml(sub)}</div>
    </div>`;
}

function diagItemHtml(item, level) {
    const hasPin = item.pin !== undefined && item.pin !== null && !Number.isNaN(Number(item.pin));
    const badge = hasPin ? `GPIO ${Number(item.pin)}` : (item.signal ? escapeDiagHtml(item.signal) : '—');
    const msg = hasPin ? (item.message || '') : `【${item.module}】${item.signal} 未接线（已放弃）`;
    // 第二行小字只放「怎么做」，原理一律塞进 hover title，避免一次刷出上百字
    const hint = hasPin ? (item.hint || '') : '';
    const actAttr = hasPin ? ` data-act="focusDiagnosticPin" data-arg="${Number(item.pin)}"` : '';
    const go = hasPin ? '<span class="diag-item-go">定位</span>' : '';
    const tip = item.tip ? ` title="${escapeDiagHtml(item.tip)}"` : '';
    const body = hint
        ? `<span class="diag-item-body"><span class="diag-item-msg">${escapeDiagHtml(msg)}</span><span class="diag-item-hint">${escapeDiagHtml(hint)}</span></span>`
        : `<span class="diag-item-msg">${escapeDiagHtml(msg)}</span>`;
    return `<button type="button" class="diag-item diag-item--${level}"${actAttr}${tip}>
        <span class="diag-item-badge">${badge}</span>${body}${go}
    </button>`;
}

/* 排针数据体检的条目：没有 GPIO 号可定位，点一下打开「排针核对」窗口 */
function diagAuditItemHtml(item) {
    const sideCn = item.side === 'left' ? '左列' : (item.side === 'right' ? '右列' : '数据');
    const badge = (item.index !== undefined) ? `${sideCn} #${item.index + 1}` : sideCn;
    const level = item.level === 'error' ? 'error' : 'warn';
    return `<button type="button" class="diag-item diag-item--${level}" data-act="showPinLayoutDialog">
        <span class="diag-item-badge">${escapeDiagHtml(badge)}</span>
        <span class="diag-item-msg">${escapeDiagHtml(item.msg)}</span><span class="diag-item-go">核对</span>
    </button>`;
}

function currentLayoutAudit() {
    if (typeof boardConfig === 'undefined' || !boardConfig) return [];
    if (typeof getBoardLayoutAudit !== 'function') return [];
    try { return getBoardLayoutAudit(boardConfig.boardName) || []; } catch (e) { return []; }
}

function renderDiagPanelBody() {
    const body = document.getElementById('diag-panel-body');
    if (!body) return;
    const { errors, warnings, gaps } = _diagReport;
    const audit = currentLayoutAudit();
    let html = '';

    const hasItems = errors.length || warnings.length || gaps.length || audit.length;
    if (!_diagHasWiring && !hasItems) {
        html += diagEmptyHtml('📋', '还没有接线', '添加模组后会自动检查冲突、启动脚、USB 与串口。');
    } else if (_diagHasWiring && !errors.length && !warnings.length) {
        html += diagEmptyHtml('✅', '接法没问题', '冲突、启动脚、USB、串口都检查过了。');
    }

    if (errors.length) {
        html += `<div class="diag-group"><div class="diag-group-title diag-group-title--error">必须改 · ${errors.length}</div>`;
        html += errors.map(x => diagItemHtml(x, 'error')).join('');
        html += `</div>`;
    }
    if (warnings.length) {
        html += `<div class="diag-group"><div class="diag-group-title diag-group-title--warn">能用但有代价 · ${warnings.length}</div>`;
        html += warnings.map(x => diagItemHtml(x, 'warn')).join('');
        html += `</div>`;
    }
    if (gaps.length) {
        html += `<div class="diag-group"><div class="diag-group-title diag-group-title--gap">未接的线 · ${gaps.length}</div>`;
        html += gaps.map(x => diagItemHtml(x, 'gap')).join('');
        html += `</div>`;
    }
    // 排针布局本身的可疑之处（抄录错误 / 白名单有洞）
    if (audit.length) {
        html += `<div class="diag-group"><div class="diag-group-title diag-group-title--error">排针数据待核对 · ${audit.length}</div>`;
        html += audit.map(diagAuditItemHtml).join('');
        html += `</div>`;
    }

    body.innerHTML = html;
}

/* 点问题 → 画布平移到该 GPIO 并高亮（实现在 svg-exporter.js） */
function focusDiagnosticPin(pin) {
    const doFocus = () => {
        if (typeof centerOnBoardPin === 'function' && centerOnBoardPin(pin)) return;
        if (typeof uiToast === 'function') uiToast(`当前主板上找不到 GPIO ${pin}，可能是模组接线残留`, { type: 'warn' });
    };
    // 窄屏时面板是浮层，先收起再定位，否则定位完还被自己挡住
    const narrow = window.innerWidth < 900 && _diagPanelOpen;
    if (narrow) {
        toggleDiagnosticsPanel(false);
        requestAnimationFrame(() => requestAnimationFrame(doFocus));
    } else {
        doFocus();
    }
}

/* =========================================================
 * 「排针核对」窗口：把当前主板的 pinLayout 按实物顺序逐针列出来
 * 目的：让使用者能拿手机实拍图和这张清单逐行对照，一眼看出哪一格抄错了
 * ========================================================= */
function pinAuditKindClass(tok) {
    const k = (typeof layoutKindOf === 'function') ? layoutKindOf(tok) : 'gpio';
    if (k === 'power') return 'pin-audit-tok--power';
    if (k === 'gnd') return 'pin-audit-tok--gnd';
    if (k === 'ctrl') return 'pin-audit-tok--ctrl';
    return '';
}

function pinAuditColumnHtml(title, col, side, marks, funcs) {
    let html = `<div class="pin-audit-col"><div class="pin-audit-colhead">${escapeDiagHtml(title)}<span class="pin-audit-colnum">${col.length} 针</span></div>`;
    col.forEach((tok, i) => {
        const lv = marks[i];
        const fn = funcs[String(tok).trim()] || '';
        const cls = ['pin-audit-row'];
        if (lv === 'error') cls.push('pin-audit-row--error');
        else if (lv === 'warn') cls.push('pin-audit-row--warn');
        html += `<div class="${cls.join(' ')}">
            <span class="pin-audit-idx">${i + 1}</span>
            <span class="pin-audit-tok ${pinAuditKindClass(tok)}">${escapeDiagHtml(tok)}</span>
            <span class="pin-audit-fn">${escapeDiagHtml(fn)}</span>
            <span class="pin-audit-flag">${lv === 'error' ? '❌' : (lv === 'warn' ? '⚠️' : '')}</span>
        </div>`;
    });
    html += `</div>`;
    return html;
}

function showPinLayoutDialog() {
    if (typeof boardConfig === 'undefined' || !boardConfig) return;
    closePinLayoutDialog();

    const L = (boardConfig.pinLayout && boardConfig.pinLayout.left) || [];
    const R = (boardConfig.pinLayout && boardConfig.pinLayout.right) || [];
    const funcs = boardConfig.pinFunctions || {};
    const audit = currentLayoutAudit();

    const marksL = {}, marksR = {};
    audit.forEach(it => {
        if (it.index === undefined) return;
        if (it.side === 'left') marksL[it.index] = (marksL[it.index] === 'error' ? 'error' : it.level);
        if (it.side === 'right') marksR[it.index] = (marksR[it.index] === 'error' ? 'error' : it.level);
    });

    const errN = audit.filter(x => x.level === 'error').length;
    const warnN = audit.length - errN;

    let summary;
    if (!audit.length) {
        summary = `<div class="pin-audit-summary pin-audit-summary--ok">✓ 版图自洽：没有重复脚、没有夹在 GPIO 中间的电源脚、白名单与排针一致。<br>
            <span class="pin-audit-dim">自洽只说明「内部没有矛盾」，最终仍以你手上的实物丝印为准。</span></div>`;
    } else {
        summary = `<div class="pin-audit-summary pin-audit-summary--bad">
            ${errN ? `<b>${errN} 条必须核对</b>` : ''}${errN && warnN ? ' · ' : ''}${warnN ? `<b>${warnN} 条建议核对</b>` : ''}
            <div class="pin-audit-list">${audit.map(a => `<div>· ${escapeDiagHtml(a.msg)}</div>`).join('')}</div>
        </div>`;
    }

    const overlay = document.createElement('div');
    overlay.id = 'pin-audit-overlay';
    overlay.className = 'pin-audit-overlay';
    overlay.innerHTML = `
        <div class="pin-audit-modal" role="dialog" aria-modal="true">
            <div class="pin-audit-head">
                <div>
                    <div class="pin-audit-title">排针核对 · ${escapeDiagHtml(boardConfig.boardName || '当前主板')}</div>
                    <div class="pin-audit-sub">按实物丝印顺序：左列从上到下、右列从上到下。灰字是说明，不是丝印。</div>
                </div>
                <button type="button" class="pin-audit-close" data-act="closePinLayoutDialog" title="关闭（Esc）">×</button>
            </div>
            ${summary}
            <div class="pin-audit-grid">
                ${pinAuditColumnHtml('左列', L, 'left', marksL, funcs)}
                ${pinAuditColumnHtml('右列', R, 'right', marksR, funcs)}
            </div>
            <div class="pin-audit-foot">
                发现某一格和实物不符，告诉我就行；也可以直接改 <code>data/boards.js</code> 里对应的 <code>pinLayout</code> 数组。
            </div>
        </div>`;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePinLayoutDialog(); });
    document.body.appendChild(overlay);
}

function closePinLayoutDialog() {
    const el = document.getElementById('pin-audit-overlay');
    if (el) el.remove();
}

window.showPinLayoutDialog = showPinLayoutDialog;
window.closePinLayoutDialog = closePinLayoutDialog;

/* Esc 关面板；I 开关面板（输入框内不拦） */
document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
    const auditOpen = !!document.getElementById('pin-audit-overlay');
    if (e.key === 'Escape' && auditOpen) {
        closePinLayoutDialog();
        e.stopPropagation();
        return;
    }
    const modalOpen = auditOpen ||
        Array.from(document.querySelectorAll('.modal-overlay')).some(m => m.style.display !== 'none' && m.offsetParent !== null);
    if (e.key === 'Escape' && _diagPanelOpen && !modalOpen) {
        toggleDiagnosticsPanel(false);
        e.stopPropagation();
        return;
    }
    if (typing || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        toggleDiagnosticsPanel();
    }
});

window.renderDiagnosticsUI = renderDiagnosticsUI;
window.toggleDiagnosticsPanel = toggleDiagnosticsPanel;
window.focusDiagnosticPin = focusDiagnosticPin;

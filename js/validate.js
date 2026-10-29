// ==========================================
// 全局数据字典校验引擎 (validate.js)
// 作用：在系统启动时，自动校验 boards.js 和 modules.js 的数据完整性
// 防止后续增加新设备时，因拼写错误或漏配导致白屏或逻辑异常
// ==========================================

(function runDataValidation() {
    if (!window.globalBoards || !window.globalModuleData) {
        console.error("❌ [Validate] 致命错误：未找到 globalBoards 或 globalModuleData！请检查脚本引入顺序。");
        return;
    }

    const boards = window.globalBoards;
    const modules = window.globalModuleData;
    let errorCount = 0;
    let warnCount = 0;

    console.log("%c🔍 正在执行硬件配置数据校验...", "color: #17a2b8; font-weight: bold; font-size: 14px;");

    // 校验结果以前只躺在 Console 里 —— 用户永远看不见，配错模组 id 也照样用。
    // 这里在校验期间顺手收一份，跑完在画布上方给一条可展开的提示条。
    const _consoleErr = console.error, _consoleWarn = console.warn;
    const issues = [];
    console.error = function () {
        issues.push({ level: 'error', text: Array.prototype.slice.call(arguments).join(' ') });
        _consoleErr.apply(console, arguments);
    };
    console.warn = function () {
        issues.push({ level: 'warn', text: Array.prototype.slice.call(arguments).join(' ') });
        _consoleWarn.apply(console, arguments);
    };

    // ==========================================
    // 1. 校验板子数据 (boards.js)
    // ==========================================
    for (const [boardKey, board] of Object.entries(boards)) {
        const boardName = board.boardName || boardKey;

        // 1.1 校验新版 onboard_slots
        if (board.onboard_slots && Array.isArray(board.onboard_slots)) {
            board.onboard_slots.forEach(slot => {
                // 检查 moduleId 是否存在
                if (!modules[slot.moduleId]) {
                    console.error(`❌ [Validate] 板子【${boardName}】的插槽【${slot.slotId}】引用了不存在的模组 ID: "${slot.moduleId}"`);
                    errorCount++;
                }

                // 检查 candidates 列表
                if (slot.candidates && Array.isArray(slot.candidates)) {
                    slot.candidates.forEach(cid => {
                        if (!modules[cid]) {
                            console.error(`❌ [Validate] 板子【${boardName}】的插槽【${slot.slotId}】候选列表中包含不存在的模组 ID: "${cid}"`);
                            errorCount++;
                        }
                    });
                }

                // 检查 lockedPins 物理合法性
                if (slot.lockedPins) {
                    Object.entries(slot.lockedPins).forEach(([signal, pins]) => {
                        const pinArr = Array.isArray(pins) ? pins : [pins];
                        pinArr.forEach(pin => {
                            const pinNum = Number(pin);
                            if (isNaN(pinNum)) {
                                console.error(`❌ [Validate] 板子【${boardName}】插槽【${slot.slotId}】引脚 "${signal}" 包含非法数字: "${pin}"`);
                                errorCount++;
                            } else if (pinNum > board.max_pin) {
                                console.error(`❌ [Validate] 板子【${boardName}】插槽【${slot.slotId}】引脚 "${signal}" 超出了最大引脚数 ${board.max_pin} (当前: ${pinNum})`);
                                errorCount++;
                            } else if (board.availableGpios && board.availableGpios.includes(pinNum)) {
                                console.warn(`⚠️ [Validate] 板子【${boardName}】插槽【${slot.slotId}】锁定引脚 GPIO ${pinNum} 仍存在于 availableGpios 中，可能会导致分配冲突。`);
                                warnCount++;
                            }
                        });
                    });
                }
            });
        }

        // 1.2 校验旧版 onboard_devices 兼容性
        if (board.onboard_devices && Array.isArray(board.onboard_devices)) {
            board.onboard_devices.forEach(dev => {
                if (!modules[dev.id]) {
                    console.error(`❌ [Validate] 板子【${boardName}】的 onboard_devices 引用了不存在的模组 ID: "${dev.id}"`);
                    errorCount++;
                }
            });
        }
        // 1.3 排针布局与可用 GPIO 一致性
        //     画布与分配引擎共用「排针白名单」，若 availableGpios 里的脚没画进 pinLayout，
        //     它将永远不会被分配（等于白名单里有个洞），这里显式提示出来。
        if (board.pinLayout && ((board.pinLayout.left || []).length || (board.pinLayout.right || []).length)) {
            const headerPins = (typeof computeHeaderPinSet === 'function')
                ? computeHeaderPinSet(board)
                : new Set([...(board.pinLayout.left || []), ...(board.pinLayout.right || [])]
                    .map(p => String(p).trim()).filter(p => /^\d+$/.test(p)).map(Number));
            const declared = new Set((board.availableGpios || []).map(Number));
            const orphans = [...declared].filter(p => !headerPins.has(p));
            if (orphans.length > 0) {
                console.warn(`⚠️ [Validate] 板子【${boardName}】有 ${orphans.length} 个 availableGpios 未出现在 pinLayout 排针中，将无法被分配：${orphans.join(', ')}`);
                warnCount++;
            }
            const exempt = new Set([...(board.fixedPins || []).map(Number), ...Object.keys(board.strappingPins || {}).map(Number)]);
            // 板载槽位锁定的引脚（如 CAM 板的摄像头排线）虽然出现在排针上，但属于刻意占用，不应报警
            (board.onboard_slots || []).forEach(slot => {
                Object.values(slot.lockedPins || {}).forEach(v => {
                    (Array.isArray(v) ? v : [v]).forEach(p => {
                        const n = Number(p);
                        if (!Number.isNaN(n)) exempt.add(n);
                    });
                });
            });
            const phantom = [...headerPins].filter(p => !declared.has(p) && !exempt.has(p));
            if (phantom.length > 0) {
                console.warn(`⚠️ [Validate] 板子【${boardName}】pinLayout 上这些引脚未声明可用性（也不在 fixed/strapping 中）：${phantom.join(', ')}`);
                warnCount++;
            }
        }
    }

    // ==========================================
    // 2. 校验模组数据 (modules.js)
    // ==========================================
    for (const [modKey, mod] of Object.entries(modules)) {
        const modName = mod.name || modKey;

        // 2.1 校验 requirements 信号定义
        if (mod.requirements && Array.isArray(mod.requirements)) {
            mod.requirements.forEach(req => {
                if (!req.signal) {
                    console.error(`❌ [Validate] 模组【${modName}】的 requirements 中存在缺失 signal 字段的项`);
                    errorCount++;
                }
                if (typeof req.count !== 'number' || req.count <= 0) {
                    console.warn(`⚠️ [Validate] 模组【${modName}】的信号 "${req.signal}" 数量配置异常: ${req.count}`);
                    warnCount++;
                }
            });
        }

        // 2.2 校验 preferredPins
        if (mod.preferredPins && Array.isArray(mod.preferredPins)) {
            mod.preferredPins.forEach(pin => {
                if (typeof pin !== 'number') {
                    console.error(`❌ [Validate] 模组【${modName}】的 preferredPins 包含非数字引脚: ${pin}`);
                    errorCount++;
                }
            });
        }

        // 2.3 校验降级规则 (can_downgrade)
        if (mod.can_downgrade) {
            if (!mod.downgrade_rule || !mod.downgrade_rule.signal || !mod.downgrade_rule.to_count) {
                console.warn(`⚠️ [Validate] 模组【${modName}】标记了可降级，但 downgrade_rule 配置不完整。`);
                warnCount++;
            }
        }
    }

    // ==========================================
    // 3. 输出最终报告
    // ==========================================
    console.error = _consoleErr;
    console.warn = _consoleWarn;
    window.__dataValidationIssues = issues;
    renderDataValidationBar(issues);

    if (errorCount === 0 && warnCount === 0) {
        console.log("%c✅ 数据字典校验通过！所有板载槽位、引脚映射、模组依赖均合法。", "color: #28a745; font-weight: bold; font-size: 13px;");
    } else {
        console.log(`%c⚠️ 数据字典校验完成：发现 ${errorCount} 个严重错误，${warnCount} 个警告。请根据上方提示排查修正。`, "color: #ffc107; font-weight: bold; font-size: 13px;");
    }
})();

/* 数据校验提示条：主板/模组字典配错时，画布上方出现一条可展开的条，
   而不是让人去翻 Console。只在真有问题时才建，正常启动不长这样一条东西。 */
function renderDataValidationBar(issues) {
    const host = document.querySelector('.main-content');
    if (!host) return;
    const old = document.getElementById('data-validate-bar');
    if (old) old.remove();
    if (!issues || !issues.length) return;

    const errN = issues.filter(i => i.level === 'error').length;
    const clean = t => String(t).replace(/^\s*[❌⚠️]\s*\[Validate\]\s*/, '').replace(/\s+/g, ' ').trim();
    const bar = document.createElement('div');
    bar.id = 'data-validate-bar';
    bar.className = 'dv-bar ' + (errN ? 'dv-bar--error' : 'dv-bar--warn');
    bar.innerHTML = `
        <button type="button" class="dv-head" onclick="toggleDataValidateBar(this)">
            <span class="dv-title">${errN ? '数据校验发现 ' + errN + ' 处配置错误' : '数据校验有 ' + issues.length + ' 条提示'}</span>
            <span class="dv-sub">展开看是哪个模组/主板配错了</span>
            <span class="dv-caret">▾</span>
        </button>
        <ul class="dv-list" style="display:none">${issues.map(i => `<li class="dv-item dv-item--${i.level}">${escapeHtml(clean(i.text))}</li>`).join('')}</ul>
        <button type="button" class="dv-close" onclick="closeDataValidateBar()" title="本次会话不再显示">✕</button>`;

    const canvas = document.getElementById('wiring-canvas-area');
    if (canvas) host.insertBefore(bar, canvas); else host.appendChild(bar);
}

function toggleDataValidateBar(btn) {
    const bar = btn && btn.closest('.dv-bar');
    if (!bar) return;
    const list = bar.querySelector('.dv-list');
    const caret = bar.querySelector('.dv-caret');
    const open = list.style.display !== 'none';
    list.style.display = open ? 'none' : 'block';
    if (caret) caret.textContent = open ? '▾' : '▴';
}

function closeDataValidateBar() {
    const bar = document.getElementById('data-validate-bar');
    if (bar) bar.remove();
}

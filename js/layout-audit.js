/* =========================================================
 * 排针布局体检（layout-audit.js）
 *
 * 为什么要有这个文件：
 *   每块主板的排针是「一行一行从实物照片抄进 data/boards.js 的 pinLayout 数组」的，
 *   人工抄录最容易犯的错就是——把某根 GPIO 数字看成了电源脚（或反过来），
 *   少抄/多抄一行，同一根脚踏两个位置。这类错误不会报错，只会让画布静默地画错，
 *   而这块画布是要拿去接线甚至烧板的，错一格就是插错孔。
 *
 *   所以这里做「结构性体检」：不依赖任何外部资料，只用版图自身的规律互相印证，
 *   把不可能成立的组合揪出来。典型规则 L3：电源/控制脚被夹在两根 GPIO 中间——
 *   排针中段不会出现 3V3，一旦出现，几乎必然是把 GPIO 数字抄成了电源脚。
 *
 * 体检结果会被「接线自检」面板读取并显示，也可点工具栏「核对排针」查看逐针清单。
 * ========================================================= */

(function () {

    const TOK_POWER = { '3V3': 1, '3.3V': 1, '3.3': 1, '5V': 1, '5VIN': 1, 'VIN': 1, 'VCC': 1, 'VBUS': 1 };
    const TOK_GND = { 'GND': 1 };
    const TOK_CTRL = { 'EN': 1, 'RST': 1, 'RESET': 1, 'TX': 1, 'RX': 1, 'IO0': 1 };

    function normTok(t) {
        return String(t === undefined || t === null ? '' : t).trim().toUpperCase();
    }

    /* gpio / power / gnd / ctrl / empty / unknown */
    function layoutKindOf(tok) {
        const t = normTok(tok);
        if (!t) return 'empty';
        if (/^\d+$/.test(t)) return 'gpio';
        if (TOK_POWER[t]) return 'power';
        if (TOK_GND[t]) return 'gnd';
        if (TOK_CTRL[t]) return 'ctrl';
        return 'unknown';
    }

    function sideCn(side) {
        return side === 'left' ? '左列' : '右列';
    }

    /* ---------- 单块板体检 ---------- */
    function auditBoardLayout(board) {
        const items = [];
        if (!board || !board.pinLayout) return items;

        const maxPin = Number(board.max_pin) || 48;
        const seen = {};   // gpio -> [{side, idx}]

        ['left', 'right'].forEach(side => {
            const col = board.pinLayout[side] || [];

            col.forEach((tok, i) => {
                const k = layoutKindOf(tok);
                const pos = `${sideCn(side)}第 ${i + 1} 针`;

                if (k === 'empty') {
                    items.push({ level: 'error', code: 'L1', side, index: i, token: tok,
                        msg: `${pos}是空的。空位会让整列针脚顺序错位，画布上后面所有针都会画偏一格` });
                } else if (k === 'unknown') {
                    items.push({ level: 'error', code: 'L1', side, index: i, token: tok,
                        msg: `${pos}写的是「${tok}」，既不是 GPIO 数字也不是已知的电源/地/控制脚，无法解析成可接线的脚` });
                } else if (k === 'gpio') {
                    const n = Number(tok);
                    if (n > maxPin) {
                        items.push({ level: 'error', code: 'L2', side, index: i, pin: n, token: tok,
                            msg: `${pos}的 GPIO${n} 超过这颗芯片的最大引脚号 ${maxPin}` });
                    }
                    (seen[n] = seen[n] || []).push({ side: sideCn(side), idx: i + 1 });
                }
            });

            // L3：电源/地/控制脚夹在两根 GPIO 中间 —— 抄录错误的高发特征
            for (let i = 1; i < col.length - 1; i++) {
                const k = layoutKindOf(col[i]);
                if (k !== 'power' && k !== 'gnd' && k !== 'ctrl') continue;
                if (layoutKindOf(col[i - 1]) === 'gpio' && layoutKindOf(col[i + 1]) === 'gpio') {
                    items.push({ level: 'warn', code: 'L3', side, index: i, token: col[i],
                        msg: `${sideCn(side)}第 ${i + 1} 针写的是「${col[i]}」，但上下两针都是 GPIO（${col[i - 1]} / ${col[i + 1]}）。` +
                             `排针中段不会夹电源脚，极可能是把 GPIO 数字看成了电源脚——请对着实物丝印再核一遍这一格` });
                }
            }
        });

        // L4：同一根 GPIO 出现两次
        Object.keys(seen).forEach(n => {
            const hit = seen[n];
            if (hit.length > 1) {
                items.push({ level: 'error', code: 'L4', pin: Number(n), token: n,
                    msg: `GPIO${n} 在排针上出现了 ${hit.length} 次（${hit.map(x => x.side + '第' + x.idx + '针').join('、')}）。` +
                         `一根脚只有一个孔，多出来那个一定是抄错了` });
            }
        });

        // L5：电源丝印与 power_rails 声明矛盾
        //     注意 5VIN / VIN 是「输入脚」的命名，板子只进不出，不能据此认定它有 5V 输出轨
        const rails = board.power_rails || {};
        const all = [].concat(board.pinLayout.left || [], board.pinLayout.right || []);
        const has33 = all.some(t => ['3V3', '3.3V', '3.3'].includes(normTok(t)));
        const has5Out = all.some(t => ['5V', 'VBUS'].includes(normTok(t)));
        if (has33 && rails['3.3V'] === false) {
            items.push({ level: 'warn', code: 'L5', msg: '排针上画了 3V3，但 power_rails 里声明没有 3.3V 电源轨，供电预算会算错' });
        }
        if (has5Out && rails['5V'] === false) {
            items.push({ level: 'warn', code: 'L5', msg: '排针上画了 5V 输出脚，但 power_rails 里声明没有 5V 电源轨，5V 设备会被判成接不了' });
        }

        // L6：左右针数相差过大，多半是整行漏抄/多抄
        const nl = (board.pinLayout.left || []).length;
        const nr = (board.pinLayout.right || []).length;
        if (Math.abs(nl - nr) >= 3) {
            items.push({ level: 'warn', code: 'L6', msg: `左列 ${nl} 针、右列 ${nr} 针，相差 ${Math.abs(nl - nr)} 针，可能有整行漏抄或多抄` });
        }

        // L7：可用 GPIO 与排针是否对得上（分配器只会分到画得出来的脚）
        const headerPins = headerPinSetOf(board);
        const declared = new Set((board.availableGpios || []).map(Number).filter(n => !Number.isNaN(n)));
        const orphan = [...declared].filter(p => !headerPins.has(p));
        if (orphan.length) {
            items.push({ level: 'warn', code: 'L7',
                msg: `availableGpios 里的 GPIO ${orphan.join(', ')} 没有画在排针上：分配器能分到它，但画布上根本点不到这个孔` });
        }
        const exempt = new Set((board.fixedPins || []).map(Number).filter(n => !Number.isNaN(n)));
        Object.keys(board.strappingPins || {}).forEach(k => exempt.add(Number(k)));
        // 板载槽位锁定的脚（CAM 板的摄像头排线）刻意占用，属于预期内的占用，不算异常
        (board.onboard_slots || []).forEach(slot => {
            Object.values(slot.lockedPins || {}).forEach(v => {
                (Array.isArray(v) ? v : [v]).forEach(p => {
                    const n = Number(p);
                    if (!Number.isNaN(n)) exempt.add(n);
                });
            });
        });
        const phantom = [...headerPins].filter(p => !declared.has(p) && !exempt.has(p));
        if (phantom.length) {
            items.push({ level: 'warn', code: 'L7',
                msg: `排针上的 GPIO ${phantom.join(', ')} 既不在 availableGpios，也不在 fixed/strapping/板载占用里：画得出来但永远分不到` });
        }

        return items;
    }

    function headerPinSetOf(board) {
        if (typeof computeHeaderPinSet === 'function') {
            try {
                const s = computeHeaderPinSet(board);
                if (s && typeof s.has === 'function') return s;
            } catch (e) { /* 退回下面的本地解析 */ }
        }
        const set = new Set();
        ['left', 'right'].forEach(side => {
            (board.pinLayout && board.pinLayout[side] || []).forEach(t => {
                const v = normTok(t);
                if (/^\d+$/.test(v)) set.add(Number(v));
            });
        });
        return set;
    }

    /* ---------- 缓存：按 boardName 取，画布切板时直接读 ---------- */
    function findBoard(boardName) {
        const boards = window.globalBoards || {};
        if (boards[boardName]) return boards[boardName];
        return Object.values(boards).find(b => b && (b.boardName || '') === boardName) || null;
    }

    function getBoardLayoutAudit(boardName) {
        const cache = window.boardLayoutAudit || (window.boardLayoutAudit = {});
        if (Object.prototype.hasOwnProperty.call(cache, boardName)) return cache[boardName];
        const board = findBoard(boardName);
        const items = board ? auditBoardLayout(board) : [];
        cache[boardName] = items;
        return items;
    }

    function clearLayoutAuditCache() {
        window.boardLayoutAudit = {};
    }

    /* ---------- 全量跑一遍（开发期在控制台能直接看到） ---------- */
    function runLayoutAuditAll(quiet) {
        clearLayoutAuditCache();
        const boards = window.globalBoards || {};
        const summary = {};
        let bad = 0;
        Object.keys(boards).forEach(key => {
            const b = boards[key];
            const items = getBoardLayoutAudit(b.boardName || key);
            summary[b.boardName || key] = items;
            if (items.some(x => x.level === 'error')) bad++;
        });
        if (!quiet && typeof console !== 'undefined') {
            const total = Object.values(summary).reduce((a, v) => a + v.length, 0);
            if (total === 0) {
                console.log('%c✅ [排针体检] 所有主板的排针布局自洽（无重复脚、无中段电源脚、白名单与排针一致）',
                    'color:#28a745;font-weight:bold');
            } else {
                console.warn(`⚠️ [排针体检] 共 ${total} 条待核对，涉及 ${bad} 块主板。在画布工具栏点「核对排针」可逐针查看。`);
                Object.entries(summary).forEach(([name, items]) => {
                    if (!items.length) return;
                    console.groupCollapsed(`📋 ${name} · ${items.length} 条`);
                    items.forEach(it => console.log(`[${it.code}][${it.level}] ${it.msg}`));
                    console.groupEnd();
                });
            }
        }
        return summary;
    }

    window.auditBoardLayout = auditBoardLayout;
    window.layoutKindOf = layoutKindOf;
    window.getBoardLayoutAudit = getBoardLayoutAudit;
    window.clearLayoutAuditCache = clearLayoutAuditCache;
    window.runLayoutAuditAll = runLayoutAuditAll;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => runLayoutAuditAll(false));
    } else {
        runLayoutAuditAll(false);
    }
})();

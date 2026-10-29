// ==========================================
// 统一对话框 / 轻提示层
// 目的：替换原生 confirm() / alert()
//   1. 原生弹窗带浏览器域名标题，与工作台视觉割裂，且无法定制按钮文案；
//   2. confirm() 同步阻断 JS 主线程，弹窗期间画布动画/渲染全部冻结；
//   3. 移动端原生弹窗位置漂移，关闭后滚动位置错乱。
// 设计：零依赖、可降级（创建 DOM 失败时回退原生弹窗，保证功能不丢）。
// ==========================================
(function () {
    'use strict';

    const HOST_ID = 'ui-dialog-host';

    /* 单个对话框排队执行：同时只显示一个，避免两层遮罩叠在一起 */
    let active = null;
    const queue = [];

    function normalize(opts) {
        if (typeof opts === 'string') return { body: opts };
        return opts || {};
    }

    const esc = window.escapeHtml || ((s) => String(s == null ? '' : s));

    function getHost() {
        let host = document.getElementById(HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = HOST_ID;
            document.body.appendChild(host);
        }
        return host;
    }

    /* 打开一个对话框；返回 { el, close } */
    function mountDialog(cfg, onSettle) {
        const host = getHost();
        // 上一层可能还在播退出动画，先清掉残留遮罩，避免两层叠在一起
        host.querySelectorAll('.ui-dialog-mask').forEach(n => { if (!n.classList.contains('is-open')) n.remove(); });
        const mask = document.createElement('div');
        mask.className = 'ui-dialog-mask';
        mask.setAttribute('role', 'presentation');

        const danger = cfg.danger ? ' is-danger' : '';
        const cancelHtml = cfg.cancelText === null
            ? ''
            : `<button type="button" class="ui-btn ui-btn-ghost" data-dialog-act="cancel">${esc(cfg.cancelText || '取消')}</button>`;

        mask.innerHTML = `
            <div class="ui-dialog${danger}" role="dialog" aria-modal="true" aria-labelledby="ui-dialog-title">
                <div class="ui-dialog-head">
                    <span class="ui-dialog-icon">${cfg.icon || (cfg.danger ? '⚠️' : '💡')}</span>
                    <h3 class="ui-dialog-title" id="ui-dialog-title">${esc(cfg.title || (cfg.cancelText === null ? '提示' : '请确认'))}</h3>
                </div>
                <div class="ui-dialog-body"></div>
                <div class="ui-dialog-actions">
                    ${cancelHtml}
                    <button type="button" class="ui-btn ${cfg.danger ? 'ui-btn-danger' : 'ui-btn-primary'}" data-dialog-act="ok">${esc(cfg.confirmText || '确定')}</button>
                </div>
            </div>`;

        // body 用 textContent 写入，避免外部文案里的 < > 破坏结构，同时保留换行
        const bodyEl = mask.querySelector('.ui-dialog-body');
        bodyEl.textContent = cfg.body || '';

        const prevFocus = document.activeElement;
        host.appendChild(mask);
        // 触发进入动画
        requestAnimationFrame(() => mask.classList.add('is-open'));

        const okBtn = mask.querySelector('[data-dialog-act="ok"]');
        const cancelBtn = mask.querySelector('[data-dialog-act="cancel"]');

        let settled = false;
        function settle(result) {
            if (settled) return;
            settled = true;
            // 立刻释放"占用位"：Promise 也马上 resolve，
            // 退出动画在后台播放，不会让后续弹窗排队卡住
            active = null;
            document.removeEventListener('keydown', onKey, true);
            mask.classList.remove('is-open');
            setTimeout(() => {
                if (mask.parentNode) mask.parentNode.removeChild(mask);
                if (prevFocus && typeof prevFocus.focus === 'function') { try { prevFocus.focus(); } catch (e) {} }
            }, 200);
            onSettle(result);
        }

        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(false); }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); settle(true); }
            else if (e.key === 'Tab') {
                // 焦点锁在弹窗内
                const focusable = [cancelBtn, okBtn].filter(Boolean);
                if (!focusable.length) return;
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        }

        /* 注意：属性名必须是 data-dialog-act。全局 actions.js 用 data-act 做委托，
           两者若同名，对话框按钮会被当成未注册动作吞掉，点了没反应 */
        mask.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-dialog-act]');
            if (btn) { settle(btn.getAttribute('data-dialog-act') === 'ok'); return; }
            // 点遮罩空白处 = 取消
            if (e.target === mask) settle(false);
        });
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => { (cancelBtn || okBtn).focus(); }, 30);

        return { el: mask, settle };
    }

    function runNext() {
        if (active || queue.length === 0) return;
        const job = queue.shift();
        let dialog;
        try {
            dialog = mountDialog(job.cfg, (result) => { active = null; job.resolve(result); runNext(); });
        } catch (e) {
            // 极端情况下（DOM 不可用）回退原生弹窗，保证业务不中断
            console.warn('[ui-dialog] 无法创建对话框，回退原生弹窗：', e);
            active = null;
            job.resolve(job.cfg.cancelText === null ? undefined : window.confirm(job.cfg.body || ''));
            return;
        }
        active = dialog;
    }

    function enqueue(cfg, wantBoolean) {
        return new Promise((resolve) => {
            queue.push({ cfg, resolve: (r) => resolve(wantBoolean ? !!r : undefined) });
            runNext();
        });
    }

    /* uiConfirm：返回 Promise<boolean>，确认 true / 取消 false */
    window.uiConfirm = function (opts) {
        const cfg = normalize(opts);
        if (!cfg.title) cfg.title = '请确认';
        return enqueue(cfg, true);
    };

    /* uiAlert：仅告知，返回 Promise<void>，只有「知道了」一个按钮 */
    window.uiAlert = function (opts) {
        const cfg = normalize(opts);
        if (cfg.cancelText === undefined) cfg.cancelText = null;
        if (!cfg.title) cfg.title = '提示';
        if (!cfg.confirmText) cfg.confirmText = '知道了';
        return enqueue(cfg, false);
    };

    /* uiToast：不打断操作，右下角浮出，自动消失；可带一个操作按钮（如「撤销」） */
    window.uiToast = function (message, opts) {
        opts = opts || {};
        if (typeof opts === 'string') opts = { type: opts };
        const type = opts.type || 'info';
        const duration = opts.duration === undefined ? (type === 'error' ? 5000 : 3000) : opts.duration;
        const icons = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };

        let host = document.getElementById('ui-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'ui-toast-host';
            document.body.appendChild(host);
        }

        const box = document.createElement('div');
        box.className = `ui-toast is-${type}`;
        box.innerHTML = `<span class="ui-toast-icon">${icons[type] || icons.info}</span><span class="ui-toast-text"></span>`;
        box.querySelector('.ui-toast-text').textContent = message;

        let timer = null;
        const dismiss = () => {
            if (timer) clearTimeout(timer);
            box.classList.remove('is-open');
            setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 220);
        };

        if (opts.action && opts.action.label) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ui-toast-action';
            btn.textContent = opts.action.label;
            btn.addEventListener('click', () => {
                try { opts.action.onClick && opts.action.onClick(); } finally { dismiss(); }
            });
            box.appendChild(btn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ui-toast-close';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', dismiss);
        box.appendChild(closeBtn);

        host.appendChild(box);
        requestAnimationFrame(() => box.classList.add('is-open'));
        // 同时最多保留 4 条，超出丢弃最旧的
        while (host.children.length > 4) host.removeChild(host.firstElementChild);
        if (duration > 0) timer = setTimeout(dismiss, duration);
        return dismiss;
    };
})();

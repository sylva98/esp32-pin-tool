// ==========================================
// 统一事件委托：所有交互元素用 data-act 声明动作
//   <button data-act="openCartModal">
//   <button data-act="applySmartScheme" data-arg="2">      参数按顺序对应 data-arg / data-arg2 / data-arg3
//   需要阻止冒泡（卡片内的按钮）时加 data-stop
//   需要拿事件对象时加 data-pass-event；需要拿元素本身时加 data-pass-el
// 这样 HTML 与 JS 模板里不再出现 onclick="...js代码..."，改函数名只改一处
// ==========================================
(function () {
    const NUM_RE = /^-?\d+(\.\d+)?$/;

    function resolveAction(name) {
        if (!name) return null;
        return typeof window[name] === 'function' ? window[name] : null;
    }

    /* 数字串自动转 number：模板里 ${index} 是数字，但写进属性后变成字符串，
       不转的话 activeModules["0"] 这类下标虽然能取到值，算术场景却会算错 */
    function collectArgs(el) {
        const args = [];
        ['data-arg', 'data-arg2', 'data-arg3'].forEach(attr => {
            if (!el.hasAttribute(attr)) return;
            const raw = el.getAttribute(attr);
            if (raw === 'true') args.push(true);
            else if (raw === 'false') args.push(false);
            else args.push(NUM_RE.test(raw) ? Number(raw) : raw);
        });
        return args;
    }

    function runAction(el, event) {
        const name = el.getAttribute('data-act');
        const fn = resolveAction(name);
        if (!fn) {
            console.error('[WB] 找不到动作处理函数：' + name, el);
            return;
        }
        const args = collectArgs(el);
        if (el.hasAttribute('data-pass-el')) args.unshift(el);
        if (el.hasAttribute('data-pass-event')) args.push(event);
        try {
            fn.apply(el, args);
        } catch (err) {
            console.error('[WB] 动作执行出错：' + name, err);
        }
    }

    document.addEventListener('click', function (event) {
        const target = event.target;
        const el = target && target.closest ? target.closest('[data-act]') : null;
        if (!el) return;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
        if (el.hasAttribute('data-stop')) event.stopPropagation();
        runAction(el, event);
    });

    /* 通用小动作：给不想到处写函数的地方用 */
    function clickById(id) {
        const node = document.getElementById(id);
        if (node) node.click();
    }
    function removeCurrentRow(btn) {
        if (btn && btn.parentNode) btn.parentNode.remove();
    }

    window.WB = window.WB || {};
    window.WB.runAction = runAction;
    window.WB.clickById = clickById;
    window.WB.removeCurrentRow = removeCurrentRow;
    /* 这两个也挂到全局，才能被 data-act 按名字解析 */
    window.clickById = clickById;
    window.removeCurrentRow = removeCurrentRow;
    /* 'name' in WB.actions 即代表该动作可解析，供回归脚本做「按键没接上」的检查 */
    window.WB.actions = new Proxy({}, {
        has: (_, key) => typeof key === 'string' && resolveAction(key) !== null
    });
})();

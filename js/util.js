/* =========================================================
 * 通用工具（util.js）
 * 只放「多处都要用、且与业务无关」的小函数。
 * 以前 escapeHtml 在三个文件里各写了一遍（esc / escapeDiagHtml /
 * escapeSmartHtml），改一处漏两处，这里收成唯一实现。
 * 加载顺序：必须排在所有业务脚本之前。
 * ========================================================= */

/** HTML 转义：把用户/源码里的文本安全地放进 innerHTML 模板 */
function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

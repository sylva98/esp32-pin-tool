// ==========================================
// 源码解析与适配引擎 (code-adapter.js)
// 终极完美版：铁血黑名单 + 前缀强匹配 + 全新表格布局
// ==========================================

let currentAdapterTab = 'parser'; 
let currentParserMode = 'online'; 
let currentProjectFiles = {}; 
let currentProjectName = "";

let smartParsedGroups = { i2s: [], display: [], camera: [], button: [], others: [] };
let currentMappingData = []; 
let availableRealPins = []; 
let currentEditIndex = -1;
let suggestedBoardKey = null; 

/* 在线源码库。board 字段的三种取值：
 *   'xiaozhi'  → 跟随当前主板绑定的官方板型（data/boards.js 里的 xiaozhi.dir）
 *   '任意'      → 通用库，不做板型匹配
 *   具体板名    → 只有该板才标「完全兼容」
 * 之所以不再写死成 'ESP32-S3 N16R8 CAM'：那样只有 CAM 板能亮绿灯，
 * 换到 WROOM 就变成「不适用」，用户只能自己猜该解析哪个目录。 */
const onlineFirmwareDB = [
    { id: 'xiaozhi_esp32', name: '虾哥 AI（小智）官方源码', board: 'xiaozhi', official: true, desc: '虾哥的小智 AI 语音固件。按当前主板自动锁定对应的 main/boards 板型目录，只读那一份 config.h。', pins: '自动', repoOwner: '78', repoName: 'xiaozhi-esp32', isCustom: false, downloadUrl: 'https://gh-proxy.com/https://github.com/78/xiaozhi-esp32/archive/refs/heads/main.zip' },
    { id: 'arduino_esp32', name: 'Espressif Arduino Core', board: '任意', desc: '乐鑫官方 Arduino 核心库。通用，不区分板型（这里只用来对照引脚宏）。', pins: '?', repoOwner: 'espressif', repoName: 'arduino-esp32', isCustom: false, downloadUrl: 'https://gh-proxy.com/https://github.com/espressif/arduino-esp32/archive/refs/heads/master.zip' }
];

/* 当前主板绑定的官方板型；没绑就返回 null（自定义主板会落到这里） */
function currentXiaozhiBoard() {
    if (typeof boardConfig === 'undefined' || !boardConfig || !boardConfig.xiaozhi) return null;
    return boardConfig.xiaozhi;
}

function getCustomRepos() { try { return JSON.parse(localStorage.getItem('esp32_custom_repos') || '[]'); } catch (e) { return []; } }
function saveCustomRepos(repos) { localStorage.setItem('esp32_custom_repos', JSON.stringify(repos)); }

function addCustomRepo() {
    const input = document.getElementById('custom-repo-input').value.trim();
    if (!input) return;
    let owner, repo;
    const match = input.match(/(?:github\.com\/)?([^\/]+)\/([^\/]+?)(?:\.git|\/|$)/);
    if (match) { owner = match[1]; repo = match[2]; } else { uiToast("格式不正确，请输入类似 'espressif/arduino-esp32' 的格式", { type: 'warn', duration: 4200 }); return; }
    const newRepo = { id: 'custom_' + Date.now(), name: `${owner}/${repo} (自定义)`, board: '任意', desc: '用户自定义添加的 GitHub 仓库。', pins: '?', repoOwner: owner, repoName: repo, isCustom: true, downloadUrl: `https://gh-proxy.com/https://github.com/${owner}/${repo}/archive/refs/heads/main.zip` };
    const customRepos = getCustomRepos();
    if (customRepos.some(r => r.repoOwner === owner && r.repoName === repo)) { uiToast('该仓库已在列表里', { type: 'info' }); return; }
    customRepos.push(newRepo); saveCustomRepos(customRepos);
    document.getElementById('custom-repo-input').value = ''; renderOnlineFirmwareList();
}
async function removeCustomRepo(id, event) {
    event.stopPropagation();
    if (!await uiConfirm({ title: '删除这个仓库？', body: '删除后可以重新添加，但已缓存的源码需要重新下载。', confirmText: '删除', danger: true })) return;
    let customRepos = getCustomRepos(); customRepos = customRepos.filter(r => r.id !== id);
    saveCustomRepos(customRepos); renderOnlineFirmwareList();
}

const DB_NAME = 'ESP32ToolCacheDB'; const STORE_NAME = 'source_zips';
function initCacheDB() { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function getCachedData(id) { try { const db = await initCacheDB(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readonly'); const req = tx.objectStore(STORE_NAME).get(id); req.onsuccess = () => resolve(req.result || null); req.onerror = () => resolve(null); }); } catch (e) { return null; } }
async function saveZipToCache(id, blob, commitSha) { try { const db = await initCacheDB(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put({ id: id, blob: blob, commitSha: commitSha }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } catch (e) { console.warn('缓存保存失败', e); } }
async function fetchLatestCommitSha(owner, repo) {
    // 取最新 commit 只是为了生成可追溯的源码链接，拿不到不影响解析流程，所以一律吞掉错误并给 5 秒上限
    try {
        const h = { headers: { 'Accept': 'application/vnd.github.v3+json' } };
        let res = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/commits/main`, h, 5000);
        if (!res.ok) res = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/commits/master`, h, 5000);
        if (!res.ok) return null;
        const data = await res.json();
        return data.sha;
    } catch (e) { return null; }
}

function openCodeAdapter() {
    document.getElementById('code-adapter-modal').style.display = 'flex';
    selectAdapterTab('parser');
    if (Object.keys(currentProjectFiles).length > 0) { showParserResult(); } else { resetParser(); switchParserMode('online'); }
}
function closeCodeAdapter() { document.getElementById('code-adapter-modal').style.display = 'none'; }

/* 底部主按钮的可用状态：只有解析出结果才允许导入，避免点一个灰按钮不知道缺什么 */
function setAdapterConfirmEnabled(on) {
    const btn = document.getElementById('adapter-confirm-btn');
    if (!btn) return;
    btn.disabled = !on;
    btn.classList.toggle('is-disabled', !on);
    btn.title = on ? '把解析结果带入工作台并改写工程里的引脚定义' : '先在上方选择或上传工程';
}

function selectAdapterTab(tab) {
    /* 现在只有一个步骤（解析 → 导入），tab 栏已移除；保留入口做兼容，避免旧调用报错 */
    const area = document.getElementById('parser-area');
    if (area) area.style.display = 'flex';
    if (tab === 'parser') setAdapterConfirmEnabled(Object.keys(currentProjectFiles || {}).length > 0);
}

function switchParserMode(mode) {
    currentParserMode = mode;
    const isOnline = mode === 'online';
    document.getElementById('btn-mode-online').className = isOnline ? 'active' : 'inactive';
    document.getElementById('btn-mode-local').className = !isOnline ? 'active' : 'inactive';
    document.getElementById('parser-loading').style.display = 'none';
    document.getElementById('parser-result-area').style.display = 'none';
    document.getElementById('parser-mode-online').style.display = isOnline ? 'flex' : 'none';
    document.getElementById('parser-mode-local').style.display = !isOnline ? 'flex' : 'none';
    setAdapterConfirmEnabled(false);
    if (isOnline) renderOnlineFirmwareList();
}

function renderOnlineFirmwareList() {
    const listContainer = document.getElementById('online-fw-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    const xb = currentXiaozhiBoard();
    const boardName = (typeof boardConfig !== 'undefined' && boardConfig && boardConfig.boardName) ? boardConfig.boardName : '未选择主控';

    /* 列表顶部先交代清楚「你现在这块板对应哪份源码」，否则用户只能在一堆卡片里猜 */
    const head = document.createElement('div');
    head.className = 'fw-board-hint' + (xb ? '' : ' fw-board-hint--warn');
    head.innerHTML = xb
        ? `<span class="fw-board-hint-label">当前主板</span>
           <strong>${escapeHtml(boardName)}</strong>
           <span class="fw-board-hint-arrow">→</span>
           <code>${escapeHtml(xb.dir)}</code>
           <div class="fw-board-hint-sub">${escapeHtml(xb.label)} · ${escapeHtml(xb.hardware || '')}</div>`
        : `<span class="fw-board-hint-label">当前主板</span>
           <strong>${escapeHtml(boardName)}</strong>
           <div class="fw-board-hint-sub">这块板还没绑定官方板型，解析结果不会自动对齐小智源码，需要自己核对引脚。</div>`;
    listContainer.appendChild(head);

    const allRepos = [...onlineFirmwareDB, ...getCustomRepos()];
    allRepos.forEach(fw => {
        const isOfficial = fw.official === true;
        // 官方源码：只有「本板绑定了板型」才算完全兼容
        const isCompatible = isOfficial ? !!xb : (fw.board === boardName);
        let badge, badgeCls;
        if (isOfficial) {
            badge = xb ? '虾哥官方 · 本板对应' : '虾哥官方 · 未绑定板型';
            badgeCls = xb ? 'success' : 'info';
        } else if (fw.board === '任意') {
            badge = '通用 · 不分板型'; badgeCls = 'info';
        } else {
            badge = isCompatible ? '完全兼容' : `适用于 ${fw.board}`;
            badgeCls = isCompatible ? 'success' : 'info';
        }
        const dirLine = (isOfficial && xb)
            ? `<span class="fw-card-dir">只读 <code>${escapeHtml(xb.dir)}</code> 这一份 config.h</span>`
            : '';
        const card = document.createElement('div');
        card.className = `fw-card ${isCompatible ? 'compatible' : ''}`;
        const delBtn = fw.isCustom ? `<span data-act="removeCustomRepo" data-arg="${fw.id}" data-pass-event class="fw-card-del" title="删除此仓库">🗑️</span>` : '';
        card.innerHTML = `<div class="fw-card-content">
            <div class="fw-card-title"><span>${escapeHtml(fw.name)}</span><span class="fw-card-badge ${badgeCls}">${escapeHtml(badge)}</span>${delBtn}</div>
            <div class="fw-card-desc">${escapeHtml(fw.desc)} ${dirLine}</div>
        </div><button class="fw-card-btn ${isCompatible ? 'primary' : 'secondary'}" data-act="loadOnlineFirmware" data-arg="${fw.id}">选择并解析</button>`;
        listContainer.appendChild(card);
    });
}

async function loadOnlineFirmware(fwId) {
    const fw = [...onlineFirmwareDB, ...getCustomRepos()].find(f => f.id === fwId);
    if (!fw) return;
    document.getElementById('parser-mode-online').style.display = 'none';
    document.getElementById('parser-mode-local').style.display = 'none';
    document.getElementById('parser-result-area').style.display = 'none';
    document.getElementById('parser-mode-tabs').style.display = 'none';
    document.getElementById('parser-loading').style.display = 'flex';
    const loadingText = document.getElementById('parser-loading-text');

    try {
        loadingText.innerText = "正在检查是否有最新更新...";
        const cachedData = await getCachedData(fwId);
        const latestSha = await fetchLatestCommitSha(fw.repoOwner, fw.repoName);
        let blob = null;
        if (cachedData && cachedData.blob) {
            if (!latestSha || cachedData.commitSha === latestSha) { blob = cachedData.blob; loadingText.innerText = "✅ 代码已是最新，正在极速读取本地缓存..."; } 
            else { loadingText.innerText = "发现源码已更新，正在拉取最新代码..."; blob = await downloadZipWithFallback(fw.downloadUrl); await saveZipToCache(fwId, blob, latestSha); loadingText.innerText = "最新代码下载完成，正在缓存并解析..."; }
        } else { loadingText.innerText = `正在从 GitHub 下载源码 (首次下载较慢)...`; blob = await downloadZipWithFallback(fw.downloadUrl); if (latestSha) await saveZipToCache(fwId, blob, latestSha); loadingText.innerText = "下载完成，正在执行智能解压..."; }
        const zip = await JSZip.loadAsync(blob);
        const { fileMap, allCodeContent, targetBoardDir, matchedByBoard } = await extractAndFilterFiles(zip, true);
        if (fileMap.length === 0) throw new Error("未能在源码中匹配到当前主控的配置文件");

        /* 锁对了还是错了要说清楚：锁错目录等于把别的板型的引脚当成本板的接法，
           编译能过、接线全错，是这里最贵的一类沉默失败 */
        const xb2 = currentXiaozhiBoard();
        const hint = document.getElementById('parser-board-hint');
        hint.style.display = 'block';
        if (xb2 && matchedByBoard) {
            hint.style.background = '#e8f5e9'; hint.style.color = '#1b5e20';
            hint.innerHTML = `🎯 <strong>本板官方板型：</strong>只读了 <code>${escapeHtml(xb2.dir)}</code>（${escapeHtml(xb2.label)}）这一份 config.h。`
                + (xb2.note ? `<div class="fw-hint-sub">${escapeHtml(xb2.note)}</div>` : '');
        } else if (xb2) {
            hint.style.background = '#fff3cd'; hint.style.color = '#856404';
            hint.innerHTML = `⚠️ <strong>源码里没找到本板绑定的板型</strong>：找不到 <code>${escapeHtml(xb2.dir)}</code>，`
                + `已回退到 <code>${escapeHtml(targetBoardDir || '通用配置')}</code>。引脚很可能对不上，先核对再导入。`;
        } else {
            hint.style.background = '#e8f5e9'; hint.style.color = '#1b5e20';
            hint.innerHTML = `🎯 <strong>源码精准匹配：</strong>已自动锁定 <code>${escapeHtml(targetBoardDir || '通用配置')}</code> 目录下的配置。`;
        }
        currentProjectName = fw.name;
        // 记下来源，解析结果里给出可点击的 GitHub 链接：
        // 用户能直接翻到对应板型的 config.h 核对每一根脚，而不是只能相信工具算出来的结果
        window._sourceMeta = {
            owner: fw.repoOwner, repo: fw.repoName,
            // targetBoardDir 只是目录名（如 bread-compact-wifi-s3cam），拼成仓库里的真实路径才能直接打开
            dir: targetBoardDir
                ? (String(targetBoardDir).includes('/') ? String(targetBoardDir) : `main/boards/${targetBoardDir}`).replace(/\/+$/, '')
                : '',
            commit: latestSha || null
        };
        setTimeout(() => { parseSourceCodeForPins(allCodeContent, fileMap); }, 300);
    } catch (error) {
        console.error(error); uiAlert({ title: '解析失败', body: error.message, danger: true }); resetParser();
    }
}

/* ---------- 下载源码 ---------- */
/* 带超时的 fetch：GitHub 在国内的典型表现不是立刻报错，而是「一直挂着」，
   没有超时就会出现永远转圈的 loading（刷新前没有任何提示）。
   超时只说明连接不畅，不代表文件不存在，所以给可区分的错误文案。 */
function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 20000);
    return fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }))
        .finally(() => clearTimeout(timer));
}

/* raw.githubusercontent.com 国内经常被墙：先直连、再走 gh-proxy，都拿不到就开新标签让用户自己存 */
async function fetchTextWithFallback(url) {
    const proxied = 'https://gh-proxy.com/' + url;
    for (const u of [url, proxied]) {
        try { const r = await fetchWithTimeout(u, null, 8000); if (r.ok) return await r.text(); } catch (e) { /* 换下一个源再试 */ }
    }
    window.open(proxied, '_blank', 'noopener');
    return null;
}

function triggerTextDownload(filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* 只下这一份 config.h：为了看十几行 #define 去拉整个仓库太重，
   而且用户真正要拿走的也就是这个文件（贴回去改脚 / 自己核对） */
async function downloadSourceConfig() {
    const meta = window._sourceMeta;
    if (!meta || !meta.owner || !meta.dir) { uiToast('还没解析出源码来源，定位不到文件', { type: 'warn' }); return; }
    const ref = meta.commit || 'main';
    const url = `https://raw.githubusercontent.com/${meta.owner}/${meta.repo}/${ref}/${meta.dir}/config.h`;
    const name = (String(meta.dir).split('/').pop() || 'board') + '-config.h';
    const text = await fetchTextWithFallback(url);
    if (text === null) { uiToast('下载失败，已在新标签打开，请右键另存', { type: 'warn', duration: 4200 }); return; }
    triggerTextDownload(name, text);
    uiToast(`已下载 ${name}`, { type: 'success' });
}

/* 整套源码 ZIP：本地编译用；GitHub 不提供单目录下载，只能整仓打包 */
function downloadSourceZip() {
    const meta = window._sourceMeta || {};
    const owner = meta.owner || '78';
    const repo = meta.repo || 'xiaozhi-esp32';
    window.open(`https://gh-proxy.com/https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`, '_blank', 'noopener');
    uiToast('已在新标签开始下载整套源码（约几十 MB）', { type: 'info', duration: 4200 });
}

async function downloadZipWithFallback(url) {
    let response;
    try {
        response = await fetchWithTimeout(url, { method: 'GET', mode: 'cors' }, 25000);
    } catch (e) {
        throw new Error('下载源码超时（25 秒无响应）。GitHub / gh-proxy 当前连不上，请稍后重试，或先下载 ZIP 手动导入。');
    }
    if (!response.ok && url.includes('main.zip')) {
        try {
            response = await fetchWithTimeout(url.replace('main.zip', 'master.zip'), { method: 'GET', mode: 'cors' }, 25000);
        } catch (e) {
            throw new Error('下载源码超时（25 秒无响应）。GitHub / gh-proxy 当前连不上，请稍后重试，或先下载 ZIP 手动导入。');
        }
    }
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}。仓库可能改了名或网络被拦，可改用「整套源码 ZIP」按钮手动导入。`);
    return await response.blob();
}

async function extractAndFilterFiles(zip, isOnline) {
    currentProjectFiles = {}; let allCodeContent = ""; let fileMap = []; let targetBoardDir = null;

    /* 第一优先级：主板绑定的官方板型目录（data/boards.js 的 xiaozhi.dir）。
       以前只靠板名里的 s3/cam/wroom 关键词去猜，WROOM 板会拼出 ['s3','wroom']，
       而小智仓库里根本没有同时含这两个词的目录 → targetBoardDir 为 null →
       所有板型的 config.h 全被读进来混着解析，接法自然是错的。 */
    const xb = isOnline ? currentXiaozhiBoard() : null;
    const preferDir = (xb && xb.dir) ? String(xb.dir).split('/').filter(Boolean).pop().toLowerCase() : '';
    let matchedByBoard = false;
    if (preferDir) {
        zip.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir || matchedByBoard) return;
            if (relativePath.toLowerCase().includes(`/main/boards/${preferDir}/`)) {
                targetBoardDir = preferDir; matchedByBoard = true;
            }
        });
    }

    /* 第二优先级（老逻辑兜底）：自定义主板没有绑定板型时，仍按板名关键词猜 */
    if (!targetBoardDir) {
        const currentBoardName = (boardConfig && boardConfig.boardName) ? boardConfig.boardName.toLowerCase() : '';
        let matchKeywords = [];
        if (currentBoardName.includes('s3')) matchKeywords.push('s3');
        if (currentBoardName.includes('c3')) matchKeywords.push('c3');
        if (currentBoardName.includes('cam')) matchKeywords.push('cam');
        if (currentBoardName.includes('wroom')) matchKeywords.push('wroom');
        if (matchKeywords.length > 0) {
            zip.forEach((relativePath, zipEntry) => {
                if (zipEntry.dir) return;
                const lowerPath = relativePath.toLowerCase();
                if (lowerPath.includes('/main/boards/')) {
                    const boardDir = lowerPath.split('/main/boards/')[1].split('/')[0];
                    if (matchKeywords.every(kw => boardDir.includes(kw))) targetBoardDir = boardDir;
                }
            });
        }
    }

    const promises = [];
    zip.forEach((relativePath, zipEntry) => {
        if (zipEntry.dir) return;
        const lowerPath = relativePath.toLowerCase();
        const isCodeFile = lowerPath.endsWith('.ino') || lowerPath.endsWith('.h') || lowerPath.endsWith('.cpp') || lowerPath.endsWith('.c') || lowerPath.endsWith('.cc');
        if (!isCodeFile || lowerPath.includes('blufi') || lowerPath.includes('power_manager') || lowerPath.includes('movements') || lowerPath.includes('assets')) return;

        let shouldKeep = false;
        if (isOnline) {
            if (targetBoardDir) { if (lowerPath.includes(`/main/boards/${targetBoardDir}/`) || lowerPath.endsWith('main/config.h')) shouldKeep = true; } 
            else { if (lowerPath.endsWith('config.h') || lowerPath.includes('/boards/') || lowerPath.endsWith('pins_arduino.h') || lowerPath.includes('user_setup')) shouldKeep = true; }
        } else {
            if (!lowerPath.includes('/lib/') && !lowerPath.includes('/examples/') && !lowerPath.includes('.git/') && !lowerPath.includes('node_modules/') && !lowerPath.includes('managed_components/')) shouldKeep = true;
        }
        if (shouldKeep) { promises.push(zipEntry.async("string").then(content => { currentProjectFiles[relativePath] = content; allCodeContent += content + "\n"; fileMap.push({ path: relativePath, content: content }); })); }
    });
    await Promise.all(promises);
    return { fileMap, allCodeContent, targetBoardDir, matchedByBoard };
}

async function handleParserFileUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    currentProjectName = file.name;
    window._sourceMeta = null;   // 本地压缩包没有可跳转的仓库地址
    document.getElementById('parser-mode-local').style.display = 'none';
    document.getElementById('parser-mode-tabs').style.display = 'none';
    document.getElementById('parser-loading').style.display = 'flex';
    document.getElementById('parser-loading-text').innerText = "正在解压本地文件...";
    try {
        const zip = await JSZip.loadAsync(file);
        const { fileMap, allCodeContent } = await extractAndFilterFiles(zip, false);
        if (fileMap.length === 0) throw new Error("ZIP 包中未找到任何有效的代码文件");
        parseSourceCodeForPins(allCodeContent, fileMap);
    } catch (error) { console.error(error); uiAlert({ title: '解析失败', body: error.message, danger: true }); resetParser(); }
}

function parseSourceCodeForPins(allContent, fileMap) {
    let rawParsed = [];
    let maxPinFound = 0;
    
    const defineRegex = /^\s*(?:\/\/\s*)?#define\s+(\w+)\s+(?:GPIO_NUM_)?(\d+)/;
    const constRegex = /^\s*(?:\/\/\s*)?(?:const\s+|static\s+)?(?:int|uint8_t|uint16_t|byte|gpio_num_t)\s+(\w+)\s*=\s*(?:GPIO_NUM_)?(\d+)/;
    
    const ignoreKeywords = ['WIDTH', 'HEIGHT', 'OFFSET', 'RATE', 'ADDR', 'TIME', 'DELAY', 'COUNT', 'SPEED', 'VALUE', 'FREQ', 'BUFFER', 'LEVEL', 'MODE', 'SAMPLE', 'BAUD', 'SIZE', 'STAT', 'TICKS', 'BPP', 'AP_NUM', 'WAITED', 'BRIGHTNESS', 'NUM', 'MAX', 'MIN', 'PITCH', 'MASK', 'VOLUME'];
    const requiredKeywords = ['PIN', 'GPIO', 'SDA', 'SCL', 'BCLK', 'LRC', 'WS', 'DIN', 'DOUT', 'SD', 'MOSI', 'MISO', 'SCK', 'SCLK', 'CLK', 'CS', 'DC', 'RST', 'BLK', 'BACKLIGHT', 'GAIN', 'MCLK', 'PWRKEY', 'CAM', 'I2C', 'I2S', 'UART', 'TX', 'RX', 'EN', 'XCLK', 'PCLK', 'VSYNC', 'HREF'];

    fileMap.forEach(file => {
        /* 极简预处理：只关心 #ifdef/#ifndef/#else/#endif 这一层。
           小智的 config.h 里同一个板型往往写了两套 I2S 引脚（Simplex 与 Duplex），
           靠 #ifdef AUDIO_I2S_METHOD_SIMPLEX 切换。逐行硬扫会把两个分支的脚全读进来，
           Duplex 那组（4/5/6/7）本来根本没编译，却会被当成真实接线画到图上。 */
        const macroDefined = new Set();
        const condStack = [];
        let active = true;

        file.content.split('\n').forEach(line => {
            const t = line.trim();
            const ifMatch = t.match(/^#\s*(ifdef|ifndef|if)\s+(\w+)/);
            if (ifMatch) {
                const isIfndef = ifMatch[1] === 'ifndef';
                const cond = isIfndef ? !macroDefined.has(ifMatch[2]) : macroDefined.has(ifMatch[2]);
                condStack.push({ taken: cond, parentActive: active });
                active = active && cond;
                return;
            }
            if (/^#\s*else\b/.test(t)) {
                const top = condStack[condStack.length - 1];
                if (top) { active = top.parentActive && !top.taken; top.taken = true; }
                return;
            }
            if (/^#\s*elif\b/.test(t)) {
                const top = condStack[condStack.length - 1];
                if (top) { active = top.parentActive && !top.taken; top.taken = true; }
                return;
            }
            if (/^#\s*endif\b/.test(t)) {
                const top = condStack.pop();
                if (top) active = top.parentActive;
                return;
            }
            if (!active) return;

            // 无值宏（如 #define AUDIO_I2S_METHOD_SIMPLEX）本身也是开关，必须登记，
            // 否则上面的 #ifdef 会全部判成 false，反手把 #else 里那套废弃引脚读进来
            const anyDefine = t.match(/^#\s*define\s+(\w+)/);
            if (anyDefine) macroDefined.add(anyDefine[1]);

            let varName = null, pinNum = null;
            let match = line.match(defineRegex);
            if (match) { varName = match[1]; pinNum = match[2]; macroDefined.add(match[1]); }
            else { match = line.match(constRegex); if (match) { varName = match[1]; pinNum = match[2]; } }

            if (varName && pinNum) {
                const upperName = varName.toUpperCase();
                const pNum = parseInt(pinNum);
                
                if (pNum > 48 || pNum < 0) return;
                if (ignoreKeywords.some(kw => upperName.includes(kw))) return; 
                if (!requiredKeywords.some(kw => upperName.includes(kw))) return;
                if (pNum === 0 && !upperName.includes('BOOT') && !upperName.includes('GPIO')) return;
                
                const existingIndex = rawParsed.findIndex(p => p.varName === varName);
                if (existingIndex !== -1) rawParsed.splice(existingIndex, 1);
                
                rawParsed.push({ varName: upperName, pinNum: pNum });
                if (pNum > maxPinFound) maxPinFound = pNum;
            }
        });
    });

    smartParsedGroups = { i2s: [], display: [], camera: [], button: [], others: [] };

    rawParsed.forEach(p => {
        const n = p.varName;
        if (n.includes('SPK') || n.includes('AUDIO') || n.includes('MIC') || n.includes('I2S') || n.includes('BCLK') || n.includes('LRC') || n.includes('WS')) {
            smartParsedGroups.i2s.push(p);
        } else if (n.includes('TFT') || n.includes('LCD') || n.includes('DISPLAY') || n.includes('OLED') || n.includes('MOSI') || n.includes('SCK') || n.includes('DC') || n.includes('BLK')) {
            smartParsedGroups.display.push(p);
        } else if (n.includes('CAM') || n.includes('DVP') || n.includes('XCLK') || n.includes('PCLK') || n.includes('VSYNC') || n.includes('HREF')) {
            smartParsedGroups.camera.push(p);
        } else if (n.includes('BTN') || n.includes('KEY') || n.includes('BOOT')) {
            smartParsedGroups.button.push(p);
        } else {
            smartParsedGroups.others.push(p);
        }
    });

    detectBoard(maxPinFound, true); showParserResult();
}

function detectBoard(maxPin, isEspIdf) {
    const currentBoardKey = document.getElementById('board-select').value;
    let hintHtml = ''; suggestedBoardKey = null;
    // 源码里出现的最大 GPIO 超出当前主控的引脚范围 → 大概率选了错的主板
    const curBoard = (typeof globalBoards !== 'undefined' && globalBoards[currentBoardKey]) ? globalBoards[currentBoardKey] : null;
    if (curBoard && maxPin > (curBoard.max_pin || 0)) {
        hintHtml = `⚠️ 检测到源码使用了 GPIO ${maxPin}，但当前选中的是 <strong>${curBoard.boardName}</strong>（最大 GPIO ${curBoard.max_pin}）。这段代码极大概率是为另一块主板编写的。`;
        suggestedBoardKey = Object.keys(globalBoards).find(k => k.includes('S3-WROOM')) || Object.keys(globalBoards)[0];
    }
    const hintBox = document.getElementById('parser-board-hint');
    if (hintHtml) {
        hintBox.style.display = 'block'; hintBox.style.background = '#fff3cd'; hintBox.style.color = '#856404'; hintBox.style.border = '1px solid #ffeeba';
        hintBox.innerHTML = `<div>${hintHtml}</div><div style="margin-top: 10px;"><button data-act="applySuggestedBoard" style="padding: 6px 12px; background: #ffc107; color: #333; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; width: auto; margin: 0;">🔄 一键切换到 ${globalBoards[suggestedBoardKey].boardName}</button></div>`;
    }
}

function applySuggestedBoard() { if (!suggestedBoardKey) return; document.getElementById('board-select').value = suggestedBoardKey; loadBoard(suggestedBoardKey); }

function showParserResult() {
    document.getElementById('parser-mode-online').style.display = 'none';
    document.getElementById('parser-mode-local').style.display = 'none';
    document.getElementById('parser-loading').style.display = 'none';
    document.getElementById('parser-mode-tabs').style.display = 'none';
    const resultArea = document.getElementById('parser-result-area');
    resultArea.style.display = 'flex'; resultArea.style.flexDirection = 'column'; resultArea.style.overflowY = 'auto';

    setAdapterConfirmEnabled(true);

    const parserFileNameEl = document.getElementById('parser-file-name');
    if (parserFileNameEl) {
        const meta = window._sourceMeta;
        const linkHtml = (() => {
            if (!meta || !meta.owner) return '';
            const ref = meta.commit || 'main';
            const filePath = meta.dir ? `${meta.dir}/config.h` : '';
            const url = `https://github.com/${meta.owner}/${meta.repo}${filePath ? '/blob/' + ref + '/' + filePath : ''}`;
            const label = meta.dir ? `${meta.dir}/config.h` : `${meta.owner}/${meta.repo}`;
            return `<a href="${url}" target="_blank" rel="noopener" class="parser-src-link"
                       title="在 GitHub 打开这份 config.h，逐根核对引脚">在 GitHub 查看源码 ↗</a>
                    <span class="parser-src-path">${label}</span>
                    ${filePath
                        ? `<button type="button" class="chip-btn chip-btn--sm" data-act="downloadSourceConfig"
                               title="只下载这一份 config.h（raw 直取，必要时走 gh-proxy）">↓ config.h</button>`
                        : ''}
                    <button type="button" class="chip-btn chip-btn--sm" data-act="downloadSourceZip"
                        title="下载整个仓库的 ZIP，本地编译或再次导入本工具时用">↓ 整套源码 ZIP</button>`;
        })();
        parserFileNameEl.style.display = 'block';
        parserFileNameEl.innerHTML = `<div>工程：${currentProjectName}</div>${linkHtml ? `<div class="parser-src-row">${linkHtml}</div>` : ''}`;
    }

    let html = `<div style="background: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 8px; padding: 20px; margin-bottom: 15px;"><h3 style="margin-top: 0; color: #1b5e20; font-size: 16px; display: flex; align-items: center; gap: 8px;"><span style="font-size: 20px;">🤖</span> 系统智能拓扑分析结果</h3><p style="font-size: 13px; color: #2e7d32; margin-bottom: 20px;">系统已自动剔除非引脚参数，并精准锁定对应模组的信号。请确认。</p><div style="display: flex; flex-direction: column; gap: 15px;">`;

    if (smartParsedGroups.i2s.length > 0) {
        const i2s = smartParsedGroups.i2s;
        const hasDIN = i2s.some(p => p.varName.includes('DIN'));
        const hasDOUT = i2s.some(p => p.varName.includes('DOUT'));
        // 单工(Simplex) 两块设备各有一组时钟；双工(Duplex) 共用一组。文案要如实说明，别再写死"强制合并"
        const micClock = i2s.some(p => p.varName.includes('MIC') && (p.varName.includes('WS') || p.varName.includes('SCK')));
        const spkClock = i2s.some(p => p.varName.includes('SPK') && (p.varName.includes('BCLK') || p.varName.includes('LRC')));
        const modeText = (micClock && spkClock)
            ? '两组独立时钟（Simplex 单工）—— 麦克风与功放各接各的 BCLK/LRC'
            : '共享一组时钟（Duplex 双工）—— 麦克风与功放共用 BCLK/LRC';
        html += `<div style="background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 15px;"><div style="font-weight: bold; color: #333; margin-bottom: 10px;">🎵 检测到 I2S 音频协议</div><div style="font-size: 12px; color: #666; margin-bottom: 10px;">源码引脚: ${i2s.map(p => `${p.varName}: ${p.pinNum}`).join(' | ')}</div><div style="color: #28a745; font-weight: bold; font-size: 14px;">${hasDIN ? '✅ 系统已自动识别：INMP441 麦克风<br>' : ''}${hasDOUT ? '✅ 系统已自动识别：MAX98357A 功放<br>' : ''}<span style="color:#2e7d32;font-weight:400;font-size:12.5px;">${modeText}</span></div></div>`;
    }

    if (smartParsedGroups.button.length > 0) {
        html += `<div style="background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 15px;"><div style="font-weight: bold; color: #333; margin-bottom: 10px;">🔘 检测到按键开关</div><div style="font-size: 12px; color: #666; margin-bottom: 10px;">源码引脚: ${smartParsedGroups.button.map(p => `${p.varName}: ${p.pinNum}`).join(' | ')}</div><div style="color: #28a745; font-weight: bold; font-size: 14px;">✅ 系统已自动锁定，无需配置。</div></div>`;
    }

    if (smartParsedGroups.display.length > 0) {
        const displayOptions = Object.keys(moduleLibrary).filter(k => moduleLibrary[k].interface === 'SPI' || moduleLibrary[k].interface === 'I2C');
        let optionsHtml = displayOptions.map(k => `<option value="${k}">${moduleLibrary[k].name}</option>`).join('');
        html += `<div style="background: #fff; border: 1px solid #007bff; border-radius: 6px; padding: 15px; border-left: 4px solid #007bff;"><div style="font-weight: bold; color: #007bff; margin-bottom: 10px;">📺 检测到显示屏幕 (需确认型号)</div><div style="font-size: 12px; color: #666; margin-bottom: 10px;">源码引脚: ${smartParsedGroups.display.map(p => `${p.varName}: ${p.pinNum}`).join(' | ')}</div><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 14px;">我实际使用的屏幕：</span><select id="ui-select-display" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; width: 250px; height: 34px; box-sizing: border-box; margin: 0;"><option value="ignore" style="color: #dc3545;">⛔ 忽略屏幕 (不接线)</option>${optionsHtml}</select></div></div>`;
    }

    if (smartParsedGroups.camera.length > 0) {
        const camOptions = Object.keys(moduleLibrary).filter(k => moduleLibrary[k].interface === 'DVP');
        
        let onboardCamId = null;
        if (typeof _onboardSlots !== 'undefined') {
            const slot = _onboardSlots.find(s => s.label.includes('摄像头') || s.moduleId.includes('ov'));
            if (slot) onboardCamId = slot.moduleId;
        }
        
        let optionsHtml = camOptions.map(k => {
            const isSelected = (k === onboardCamId) ? 'selected' : '';
            return `<option value="${k}" ${isSelected}>${moduleLibrary[k].name}</option>`;
        }).join('');
        
        let hintHtml = onboardCamId 
            ? `<div style="color: #856404; background: #fff3cd; padding: 8px; border-radius: 4px; font-size: 12px; margin-bottom: 10px; border: 1px solid #ffeeba;">ℹ️ 当前主板已有板载摄像头。您选择型号后，将直接替换板载配置，无需额外接线。</div>` 
            : '';

        let defaultSelectIgnore = onboardCamId ? '' : 'selected';
        
        html += `<div style="background: #fff; border: 1px solid #007bff; border-radius: 6px; padding: 15px; border-left: 4px solid #007bff;">
            <div style="font-weight: bold; color: #007bff; margin-bottom: 10px;">📷 检测到视觉摄像头 (需确认型号)</div>
            <div style="font-size: 12px; color: #666; margin-bottom: 10px;">源码引脚: ${smartParsedGroups.camera.map(p => `${p.varName}: ${p.pinNum}`).join(' | ')}</div>
            ${hintHtml}
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 14px;">我实际使用的摄像头：</span>
                <select id="ui-select-camera" style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; width: 250px; height: 34px; box-sizing: border-box; margin: 0;">
                    <option value="ignore" style="color: #dc3545;" ${defaultSelectIgnore}>⛔ 忽略摄像头 (不接线)</option>
                    ${optionsHtml}
                </select>
            </div>
        </div>`;
    }

    if (smartParsedGroups.others.length > 0) {
        html += `<div style="background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 15px;"><div style="font-weight: bold; color: #666; margin-bottom: 10px;">❓ 未分类/自定义引脚 (${smartParsedGroups.others.length}个)</div><div style="font-size: 12px; color: #999; margin-bottom: 10px;">${smartParsedGroups.others.map(p => p.varName).join(', ')}</div><div style="font-size: 13px; color: #999;">为了保持接线图整洁，这些未识别用途的引脚默认将被忽略。</div></div>`;
    }

    html += `</div></div>`;
    resultArea.innerHTML = html;
}

function resetParser() {
    currentProjectFiles = {}; currentProjectName = ""; window._sourceMeta = null; smartParsedGroups = { i2s: [], display: [], camera: [], button: [], others: [] };
    // 适配表也要清：否则下次「生成代码骨架」会拿上一份源码的宏名去套新接线
    currentMappingData = [];
    document.getElementById('parser-result-area').style.display = 'none';
    document.getElementById('parser-loading').style.display = 'none';
    document.getElementById('parser-board-hint').style.display = 'none';
    document.getElementById('parser-file-input').value = ''; 
    document.getElementById('parser-mode-tabs').style.display = 'flex';
    if (currentParserMode === 'online') document.getElementById('parser-mode-online').style.display = 'flex';
    else document.getElementById('parser-mode-local').style.display = 'flex';
    setAdapterConfirmEnabled(false);
    selectAdapterTab('parser');
}

async function confirmAndInject() {
    if (activeModules.length > 0) {
        const ok = await uiConfirm({
            title: '应用解析出的接线方案？',
            body: '当前工作台已接入的外接模组会被清空，改用源码解析出来的方案。',
            confirmText: '应用并清空',
            danger: true
        });
        if (!ok) return;
    }

    window.currentUploadedSource = { fileName: currentProjectName, files: currentProjectFiles };
    window.hasReplacedSource = false;
    activeModules = [];
    if (typeof cartSelectedModules !== 'undefined') cartSelectedModules = cartSelectedModules.filter(m => m.isOnboard);
    
    // 1. 优先处理板载摄像头的替换
    const camSelect = document.getElementById('ui-select-camera');
    let hasOnboardCam = false;
    if (camSelect && camSelect.value !== 'ignore') {
        const selectedCamId = camSelect.value;
        if (typeof _onboardSlots !== 'undefined') {
            const onboardCamSlot = _onboardSlots.find(s => s.label.includes('摄像头') || s.moduleId.includes('ov'));
            if (onboardCamSlot) {
                hasOnboardCam = true;
                if (onboardCamSlot.moduleId !== selectedCamId) {
                    onboardCamSlot.moduleId = selectedCamId;
                    const boardSlot = (boardConfig.onboard_slots || []).find(s => s.slotId === onboardCamSlot.slotId);
                    if (boardSlot) boardSlot.moduleId = selectedCamId;
                    const cartItem = cartSelectedModules.find(m => m.isOnboard && m.slotId === onboardCamSlot.slotId);
                    if (cartItem) {
                        cartItem.id = selectedCamId;
                        cartItem.name = moduleLibrary[selectedCamId] ? moduleLibrary[selectedCamId].name : selectedCamId;
                        cartItem.overrides = { current: moduleLibrary[selectedCamId]?.peak_current_ma || 0 };
                    }
                    if (typeof buildOnboardPinMap === 'function') _onboardPinMap = buildOnboardPinMap(_onboardSlots);
                    if (typeof syncOnboardDevicesCompat === 'function') syncOnboardDevicesCompat(boardConfig, _onboardSlots);
                }
            }
        }
    }

    initPins();
    activeBuses = { I2C: {}, SPI: {}, I2S: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };

    // 19/20 是原生 USB 的 D-/D+，但芯片层面就是普通 GPIO。之前在这里把它们强制标成 fixed，
    // 结果小智的 bread-compact-wifi-s3cam 这类「把屏接在 19/20」的板型全被顶掉，
    // 屏幕被赶到别的脚，还顺手抢走功放的 I2S 时钟。现在只保留「尽量避开」的权重（engine 里的 usb 惩罚），
    // 源码明确要用的就照用，代价由诊断 W2 讲清楚。

    const injectRequests = [];
    const findPin = (group, keywords) => { for (let p of group) { if (keywords.some(kw => p.varName.includes(kw))) return p.pinNum; } return null; };

    // 源码里的引脚号只是"偏好"：本板不可用（摄像头/PSRAM/已锁定）的必须提前剔掉，
    // 否则贪心分配会先把排序在前的信号分到那根脚上，后面的信号只能去抢别的，越排越乱。
    // strapping 脚（GPIO0/3/45/46）算「可用但需提醒」：BOOT 按键就在 0 上，片选也常在 45 上。
    const pinUsable = (p) => {
        const st = pinsState[Number(p)];
        return !!st && (st.state === 'free' || st.state === 'strapping');
    };
    const usablePrefs = (arr) => (arr || []).filter(p => p !== null && p !== undefined && pinUsable(p));

    if (smartParsedGroups.i2s.length > 0) {
        const i2s = smartParsedGroups.i2s;
        const pickPin = (pred) => { for (const p of i2s) { if (pred(p.varName)) return p.pinNum; } return null; };
        const isMic = n => n.includes('MIC') || n.includes('INMP');
        const isSpk = n => n.includes('SPK') || n.includes('LOUT');

        // 小智的音频有两套接法，靠 AUDIO_I2S_METHOD_SIMPLEX 切换：
        //   单工 Simplex：MIC 与 SPK 各有一对时钟（如 mic 1/2、spk 40/41），两条独立 I2S 总线
        //   双工 Duplex ：只有一套 AUDIO_I2S_GPIO_BCLK/LRC，两个设备共用
        // 旧代码把 MIC_SCK / MIC_WS 当成共享时钟，导致功放被接到麦克风的脚上 —— 必须按角色各取各的。
        const micBclk = pickPin(n => isMic(n) && n.includes('BCLK'));
        const micSck  = pickPin(n => isMic(n) && n.includes('SCK'));
        const micLrc  = pickPin(n => isMic(n) && (n.includes('LRC') || n.includes('WS')));
        const spkBclk = pickPin(n => isSpk(n) && n.includes('BCLK'));
        const spkLrc  = pickPin(n => isSpk(n) && (n.includes('LRC') || n.includes('WS')));

        const micClock = { BCLK: (micBclk !== null ? micBclk : micSck), LRC: micLrc };
        const spkClock = { BCLK: spkBclk, LRC: spkLrc };
        const hasMicClock = micClock.BCLK !== null && micClock.LRC !== null;
        const hasSpkClock = spkClock.BCLK !== null && spkClock.LRC !== null;

        // 只有一套时钟定义（没有 MIC_/SPK_ 前缀）→ 双工
        const oneBclk = pickPin(n => !isMic(n) && !isSpk(n) && n.includes('BCLK'));
        const oneLrc  = pickPin(n => !isMic(n) && !isSpk(n) && (n.includes('LRC') || n.includes('WS')));
        const hasOneClock = oneBclk !== null && oneLrc !== null;

        if (hasMicClock && pinUsable(micClock.BCLK) && pinUsable(micClock.LRC)) {
            activeBuses['I2S_IN'].BCLK = micClock.BCLK;
            activeBuses['I2S_IN'].LRC = micClock.LRC;
        }
        if (hasSpkClock && pinUsable(spkClock.BCLK) && pinUsable(spkClock.LRC)) {
            activeBuses['I2S_OUT'].BCLK = spkClock.BCLK;
            activeBuses['I2S_OUT'].LRC = spkClock.LRC;
        }
        if (!hasMicClock && !hasSpkClock && hasOneClock && pinUsable(oneBclk) && pinUsable(oneLrc)) {
            activeBuses['I2S'].BCLK = oneBclk;
            activeBuses['I2S'].LRC = oneLrc;
        }

        const din  = pickPin(n => isMic(n) && n.includes('DIN'));
        const dout = pickPin(n => isSpk(n) && n.includes('DOUT'));

        if (din !== null) {
            const pref = [din, hasMicClock ? micClock.BCLK : oneBclk, hasMicClock ? micClock.LRC : oneLrc];
            injectRequests.push({
                id: 'mic_inmp441',
                preferredPins: usablePrefs(pref),
                preferredBySignal: { SD: din, BCLK: hasMicClock ? micClock.BCLK : oneBclk, LRC: hasMicClock ? micClock.LRC : oneLrc }
            });
        }
        if (dout !== null) {
            const pref = [dout, hasSpkClock ? spkClock.BCLK : oneBclk, hasSpkClock ? spkClock.LRC : oneLrc];
            injectRequests.push({
                id: 'max98357a',
                preferredPins: usablePrefs(pref),
                preferredBySignal: { DIN: dout, BCLK: hasSpkClock ? spkClock.BCLK : oneBclk, LRC: hasSpkClock ? spkClock.LRC : oneLrc }
            });
        }
    }

    if (smartParsedGroups.button.length > 0) {
        const btnPin = smartParsedGroups.button[0].pinNum;
        let btnModId = Object.keys(moduleLibrary).find(k => k.includes('btn') || k.includes('button')) || 'unknown_btn';
        if (!moduleLibrary[btnModId]) moduleLibrary[btnModId] = { name: "按键开关", category: "执行器类", interface: "GPIO", signal_voltage: 3.3, peak_current_ma: 1, priority: 50, requirements: [{ signal: "IN", count: 1, optional: false }], power_pins: [] };
        injectRequests.push({ id: btnModId, preferredPins: usablePrefs([btnPin]), preferredBySignal: { IN: btnPin } });
    }

    const displaySelect = document.getElementById('ui-select-display');
    if (displaySelect && displaySelect.value !== 'ignore') {
        // 屏幕 6 根线必须按名字一一对应。以前只给一个扁平数组，分配器按顺序抓，
        // 结果 SCL 拿到背光脚、SDA 拿到复位脚 —— 源码写的脚等于没生效。
        const d = smartParsedGroups.display;
        const byName = (pred) => { for (const p of d) { if (pred(p.varName)) return p.pinNum; } return null; };
        const bySignal = {
            BL:  byName(n => n.includes('BACKLIGHT') || n.includes('BLK')),
            SCK: byName(n => n.includes('CLK') && !n.includes('BACKLIGHT')),
            MOSI: byName(n => n.includes('MOSI') || n.includes('SDA')),
            DC:  byName(n => n.includes('DC')),
            RST: byName(n => n.includes('RST') || n.includes('RESET')),
            CS:  byName(n => n.includes('CS'))
        };
        injectRequests.push({
            id: displaySelect.value,
            preferredPins: usablePrefs(d.map(p => p.pinNum)),
            preferredBySignal: bySignal
        });
    }

    if (camSelect && camSelect.value !== 'ignore' && !hasOnboardCam) {
        injectRequests.push({ id: camSelect.value, preferredPins: usablePrefs(smartParsedGroups.camera.map(p => p.pinNum)) });
    }

    injectRequests.forEach(req => {
        const libData = moduleLibrary[req.id];
        if (!libData) return;
        const originalPref = libData.preferredPins;
        const originalBySig = libData.preferredBySignal;
        libData.preferredPins = req.preferredPins || [];
        libData.preferredBySignal = req.preferredBySignal || null;
        let copy = JSON.parse(JSON.stringify(pinsState));
        const result = tryAllocate(libData, copy, activeBuses);
        libData.preferredPins = originalPref;
        libData.preferredBySignal = originalBySig;
        for (let key in copy) { pinsState[key] = copy[key]; }
        commitAllocation(req.id, result.allocations);

        // 背光（DISPLAY_BACKLIGHT_PIN）在模组字典里挂在 power_pins，默认接 3.3V 常亮。
        // 源码既然指定了 GPIO，就把它作为扩展引线接上，画布才会画出这根线，W5 也才有对象可提醒。
        if (req.preferredBySignal && req.preferredBySignal.BL !== null && req.preferredBySignal.BL !== undefined) {
            const blPin = Number(req.preferredBySignal.BL);
            if (pinsState[blPin] && pinsState[blPin].state === 'free') {
                const mod = activeModules.find(m => m.id === req.id);
                if (mod && mod.connections && mod.connections.BLK === undefined) {
                    mod.connections.BLK = blPin;
                    pinsState[blPin] = { state: 'used', owner: req.id, signal: 'BLK' };
                }
            }
        }
    });

    // 记录「源码原接法」：智能接线面板里会作为一张独立卡片展示，和工具算出的方案对照、随时可回退
    if (typeof captureSourceWiring === 'function') captureSourceWiring(currentProjectName);

    renderPins(); renderModules(); updatePowerBudget();
    if (typeof updateSoftwareButtonsUI === 'function') updateSoftwareButtonsUI();
    
    analyzeSourceCode(); 
    executeReplacement(true); 

    // 默认落在「跟随源码」这一边：官方现成固件能直接烧，不用碰编译。
    // 想重排引脚的人自己在智能接线面板里切（那边会明确标「需自行编译」）。
    if (typeof uiToast === 'function') {
        uiToast('已按源码接法接入 · 官方固件可直接烧；右侧「智能接线」里可换重排方案（换完需自己编译）', {
            type: 'success', duration: 5200
        });
    }
}

// 🔥 核心修复：把 targetPin 真正指向适配后的引脚
function analyzeSourceCode() {
    let content = "";
    for (const path in currentProjectFiles) { content += currentProjectFiles[path] + '\n'; }
    const lines = content.split('\n'); currentMappingData = []; availableRealPins = [];
    // 单工模式是否启用：启用后 #else 分支里的 AUDIO_I2S_GPIO_* 全是死代码，不该参与映射
    const simplexActive = /^[ \t]*#define[ \t]+AUDIO_I2S_METHOD_SIMPLEX/m.test(content);
    activeModules.forEach(mod => {
        const modData = moduleLibrary[mod.id];
        for (const [signal, pinStr] of Object.entries(mod.connections)) {
            if (pinStr === "dropped") continue;
            String(pinStr).split(',').forEach(p => { const cleanPin = String(p).trim(); if (cleanPin) availableRealPins.push({ pin: cleanPin, label: `GPIO ${cleanPin} - ${modData.name} (${signal})`, moduleName: modData.name, signal: signal.toUpperCase() }); });
        }
    });

    const defineRegex = /^(\s*#define\s+)(\w+)(\s+)(?:GPIO_NUM_)?(\d+)(.*)$/;
    lines.forEach((line, index) => {
        const match = line.match(defineRegex);
        if (match) {
            const varName = match[2]; const sourcePinNum = match[4].trim(); const upperVarName = varName.toUpperCase();
            
            const ignoreKeywords = ['WIDTH', 'HEIGHT', 'OFFSET', 'RATE', 'ADDR', 'TIME', 'DELAY', 'COUNT', 'SPEED', 'VALUE', 'FREQ', 'BUFFER', 'LEVEL', 'MODE', 'SAMPLE', 'BAUD', 'SIZE', 'STAT', 'TICKS', 'BPP', 'AP_NUM', 'WAITED', 'BRIGHTNESS', 'NUM', 'MAX', 'MIN', 'PITCH', 'MASK', 'VOLUME'];
            if (ignoreKeywords.some(kw => upperVarName.includes(kw))) return;

            let guessedModuleName = "❓ 未知外设"; let guessedSignal = "";
            // 先判定外设类型，再按类型解析信号——否则 "I2S_SCK"(麦克风) 和 "TFT_SCK"(SPI 屏)
            // 会被解析成同一个信号，"I2S_DIN"(功放) 也会被错当成麦克风的 SD
            // LAMP_GPIO 里含 "AMP"，会被误判成功放（xiaoZhi 的 s3cam 板就有这个演示灯），先排除掉
            const isAmp = /SPK|MAX98357/.test(upperVarName) || (/AMP/.test(upperVarName) && !/LAMP/.test(upperVarName));
            const isMic = /MIC|INMP441/.test(upperVarName);
            const isDisp = /DISPLAY|TFT|LCD|ST7789|ILI9341|GC9A01/.test(upperVarName);

            if (isAmp) guessedModuleName = "🎵 音频设备(功放)";
            else if (isMic) guessedModuleName = "🎵 音频设备(麦克风)";
            else if (isDisp) guessedModuleName = "📺 屏幕";
            else if (upperVarName.includes('AUDIO') || upperVarName.includes('I2S')) guessedModuleName = "🎵 音频设备";
            else if (upperVarName.includes('SDA') || upperVarName.includes('SCL')) guessedModuleName = "I2C设备";

            if (upperVarName.includes('BCLK')) guessedSignal = "BCLK";
            else if (upperVarName.includes('LRC') || upperVarName.includes('WS')) guessedSignal = "LRC";
            else if (isDisp) {
                if (upperVarName.includes('MOSI') || upperVarName.includes('SDA') || upperVarName.includes('SDIN') || upperVarName.includes('DATA')) guessedSignal = "MOSI";
                else if (upperVarName.includes('SCK') || upperVarName.includes('SCL') || upperVarName.includes('CLK')) guessedSignal = "SCK";
                else if (upperVarName.includes('CS')) guessedSignal = "CS";
                // RST 判定必须排在 RS 之前：DISPLAY_RST_PIN 里含 "RS"，先判 RS 会把复位当成 DC 抓错脚
                else if (upperVarName.includes('RST') || upperVarName.includes('RESET') || upperVarName.includes('RES')) guessedSignal = "RST";
                else if (upperVarName.includes('DC') || upperVarName.includes('A0') || /(^|_)RS(_|$)/.test(upperVarName)) guessedSignal = "DC";
                // 背光：只有用户把它改接成 GPIO（PWM 调光）时才在接线里，接 3.3V 常亮时不在 connections 里
                else if (upperVarName.includes('BACKLIGHT') || upperVarName.includes('BLK') || /(^|_)BL(_|$)/.test(upperVarName)) guessedSignal = "BLK";
            }
            else if (isMic) {
                // 麦克风丝印 SCK → 内部 BCLK；数据脚 SD/DIN/DOUT 统一按麦克风输出 SD 处理
                if (upperVarName.includes('SCK') || upperVarName.includes('SCL')) guessedSignal = "BCLK";
                else if (upperVarName.includes('SD') || upperVarName.includes('DIN') || upperVarName.includes('DOUT') || upperVarName.includes('DATA')) guessedSignal = "SD";
            }
            else if (isAmp) {
                // 功放丝印 BCLK/LRC/DIN，数据脚一律按 DIN
                if (upperVarName.includes('SCK')) guessedSignal = "BCLK";
                else if (upperVarName.includes('DIN') || upperVarName.includes('DOUT') || upperVarName.includes('SDATA')) guessedSignal = "DIN";
            }
            else {
                if (upperVarName.includes('SCK')) guessedSignal = "BCLK";
                else if (upperVarName.includes('DOUT') || upperVarName.includes('DIN')) guessedSignal = "DIN";
                else if (upperVarName.includes('SDA') || upperVarName.includes('MOSI')) guessedSignal = "SDA";
                else if (upperVarName.includes('SCL')) guessedSignal = "SCL";
                else if (upperVarName.includes('MISO')) guessedSignal = "MISO";
            }

            let physicalPinData = null;
            // 官方 config.h 里定义了 SIMPLEX 时，#else 那段 AUDIO_I2S_GPIO_* 是死代码。
            // 把它们按麦克风/功放映射，等于把双工备用值改成单工值（DOUT 还会和 DIN 撞成同脚），
            // 贴回源码既没用又添乱 → 原样保留，只标注「未启用」
            const isDuplexBackup = simplexActive && /^AUDIO_I2S_GPIO_(WS|BCLK|DIN|DOUT)$/.test(upperVarName);

            // guessedSignal 为空时必须直接放弃匹配：空串对 includes() 永远为真，
            // 会把「没有任何信号特征」的宏（如 DISPLAY_BACKLIGHT_PIN）抓去想当然的第一个脚
            if (!isDuplexBackup && guessedSignal) {
                if (isAmp) {
                    physicalPinData = availableRealPins.find(p => /功放|MAX98357/.test(p.moduleName) && p.signal === guessedSignal);
                } else if (isMic) {
                    physicalPinData = availableRealPins.find(p => /麦克风|INMP441/.test(p.moduleName) && p.signal === guessedSignal);
                } else if (isDisp) {
                    physicalPinData = availableRealPins.find(p => /屏|TFT|LCD/.test(p.moduleName) && p.signal === guessedSignal);
                } else {
                    physicalPinData = availableRealPins.find(p => p.signal === guessedSignal);
                }
            }

            let status = 'keep'; let statusText = '⚪ 保持源码';
            let finalTargetPin = sourcePinNum;

            if (physicalPinData) {
                finalTargetPin = physicalPinData.pin; // 🔥 记录最终分配的引脚
                if (physicalPinData.pin !== sourcePinNum) { 
                    status = 'match'; 
                    statusText = `🟢 已智能适配 (${sourcePinNum} ➡ ${physicalPinData.pin})`; 
                } else {
                    status = 'match'; statusText = '🟢 完全匹配';
                }
            }

            currentMappingData.push({
                lineIndex: index, rawLine: line, varName: varName, sourcePinNum: sourcePinNum, targetPin: finalTargetPin,
                guessedModuleName: guessedModuleName, physicalModule: physicalPinData ? physicalPinData.moduleName : "(未接)",
                physicalSignal: physicalPinData ? physicalPinData.signal : "", status: status, statusText: statusText,
                inactive: isDuplexBackup
            });
        }
    });

    if (currentMappingData.length > 0) {
        sortMappingData();
        renderMappingTable();
    }
}

function sortMappingData() {
    currentMappingData.sort((a, b) => {
        const nameA = a.physicalModule !== '(未接)' ? a.physicalModule : 'zzzzzz';
        const nameB = b.physicalModule !== '(未接)' ? b.physicalModule : 'zzzzzz';
        return nameA.localeCompare(nameB);
    });
}

/* 映射表格的独立页面已取消（解析结果页直接确认导入），这里保留函数只为兼容旧调用；
   表格容器不存在时直接返回，不让 null.innerHTML 把整个导入流程打断 */
function renderMappingTable() {
    const tbody = document.getElementById('mapping-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    const getPhysicalModuleName = (row) => row.physicalModule !== '(未接)' ? row.physicalModule : '-';
    let skipRowspanLeft = 0;

    currentMappingData.forEach((row, index) => {
        const tr = document.createElement('tr');
        let colorStyle = "cursor: pointer; padding: 6px 12px; border-radius: 4px; font-weight: bold; display: inline-block; transition: 0.2s;";
        if (row.status === 'match') colorStyle += " color: #28a745; background: #d4edda;";
        if (row.status === 'conflict') colorStyle += " color: #dc3545; background: #f8d7da;";
        if (row.status === 'comment') colorStyle += " color: #fd7e14; background: #fff3cd;";
        if (row.status === 'keep') colorStyle += " color: #6c757d; background: #e2e3e5;";

        let leftModuleTd = "";
        if (skipRowspanLeft > 0) skipRowspanLeft--;
        else {
            const currentModuleName = getPhysicalModuleName(row);
            let rowspan = 1;
            for (let i = index + 1; i < currentMappingData.length; i++) { if (getPhysicalModuleName(currentMappingData[i]) === currentModuleName) rowspan++; else break; }
            if (rowspan > 1) skipRowspanLeft = rowspan - 1;
            const textColor = currentModuleName === '-' ? '#999' : '#007bff';
            leftModuleTd = `<td rowspan="${rowspan}" style="vertical-align: middle; color: ${textColor}; font-weight: bold;">${currentModuleName}</td>`;
        }

        let displayTargetPin = '-';
        if (row.status === 'match' || row.status === 'keep') {
            displayTargetPin = row.targetPin;
        }

        // 列顺序：左模组 | 源码引脚值 | 源码变量名 | 源码对应模组 | 处理方式 | 参考接入引脚
        tr.innerHTML = `
            ${leftModuleTd}
            <td style="vertical-align: middle; color: #dc3545; font-weight: bold;">${row.sourcePinNum}</td>
            <td style="vertical-align: middle;"><strong>${row.varName}</strong></td>
            <td style="vertical-align: middle;">${row.guessedModuleName}</td>
            <td style="vertical-align: middle;"><span style="${colorStyle}" data-act="openStatusModal" data-arg="${index}">${row.statusText}</span></td>
            <td style="vertical-align: middle; background: #e3f2fd; color: #0d47a1; font-weight: bold; font-size: 15px;">${displayTargetPin}</td>
        `;
        tbody.appendChild(tr);
    });
}

function openStatusModal(index) {
    currentEditIndex = index; const row = currentMappingData[index];
    document.getElementById('modal-var-name').innerText = row.varName;
    const analysisBox = document.getElementById('analysis-box'); const optionsContainer = document.getElementById('options-container');
    analysisBox.innerHTML = `<strong>诊断信息：</strong><br>源码要求：<strong>${row.sourcePinNum}</strong> 号引脚<br>硬件现状：${row.physicalModule !== '(未接)' ? `<strong>${row.physicalModule}</strong> 匹配到信号 ${row.physicalSignal}` : '该引脚未接任何设备'}`;

    let optionsHtml = `<button class="opt-card opt-card--warn" data-act="handleQuickAction" data-arg="comment"><div class="opt-card-title">✂️ 注释此段代码</div><div class="opt-card-desc">废弃这行定义</div></button>`;

    if (row.physicalModule !== '(未接)') {
        const matchedPin = row.physicalSignal ? availableRealPins.find(p => p.moduleName === row.physicalModule && p.signal === row.physicalSignal) : null;
        const finalTargetPin = matchedPin ? matchedPin.pin : row.sourcePinNum;
        optionsHtml += `<button class="opt-card opt-card--primary" data-act="handleQuickAction" data-arg="match" data-arg2="${finalTargetPin}"><div class="opt-card-title">👉 使用我接的线</div><div class="opt-card-desc">将代码修改为 GPIO ${finalTargetPin}</div></button>`;
    } else {
        optionsHtml += `<button class="opt-card opt-card--ghost" data-act="handleQuickAction" data-arg="keep"><div class="opt-card-title">🚫 强制保留源码</div><div class="opt-card-desc">保留 GPIO ${row.sourcePinNum}</div></button>`;
    }

    optionsContainer.innerHTML = optionsHtml; document.getElementById('statusModal').style.display = 'flex';
}

function handleQuickAction(action, targetPin = null) {
    if (currentEditIndex === -1) return;
    const row = currentMappingData[currentEditIndex];
    if (action === 'comment') { row.status = 'comment'; row.statusText = '🟠 已注释'; } 
    else if (action === 'keep') { row.status = 'keep'; row.statusText = '⚪ 保持源码'; row.targetPin = row.sourcePinNum; } 
    else if (action === 'match' && targetPin) { row.targetPin = targetPin; row.status = 'match'; row.statusText = '🟢 手动替换'; }
    sortMappingData(); renderMappingTable(); closeStatusModal();
}

function closeStatusModal() { document.getElementById('statusModal').style.display = 'none'; currentEditIndex = -1; }

async function executeReplacement(isSilent = false) {
    if (Object.keys(currentProjectFiles).length === 0) { uiToast('请先解析源码', { type: 'warn' }); return; }

    const replaceRules = currentMappingData.filter(r => r.status === 'match' && r.sourcePinNum !== r.targetPin);
    const commentRules = currentMappingData.filter(r => r.status === 'comment');

    if (!isSilent && (replaceRules.length > 0 || commentRules.length > 0)) {
        const ok = await uiConfirm({
            title: `覆盖 ${replaceRules.length + commentRules.length} 处引脚定义？`,
            body: '即将把修改后的源码覆盖原文件，并作为当前工程带入工作台。\n原始文件可用「重新解析」还原。',
            confirmText: '覆盖并应用',
            danger: true
        });
        if (!ok) return;
    }

    for (const path in currentProjectFiles) {
        let content = currentProjectFiles[path]; let modified = false;
        replaceRules.forEach(rule => { const regex = new RegExp(`(#define\\s+${rule.varName}\\s+)(?:GPIO_NUM_)?${rule.sourcePinNum}\\b`, 'g'); if (regex.test(content)) { content = content.replace(regex, `$1${rule.targetPin}`); modified = true; } });
        commentRules.forEach(rule => { const regex = new RegExp(`(^\\s*#define\\s+${rule.varName}\\s+.*)`, 'gm'); if (regex.test(content)) { content = content.replace(regex, `// $1`); modified = true; } });
        if (modified) currentProjectFiles[path] = content;
    }

    window.currentUploadedSource = { fileName: currentProjectName, files: currentProjectFiles }; 
    window.hasReplacedSource = true; 
    
    if (typeof updateSoftwareButtonsUI === 'function') updateSoftwareButtonsUI();
    
    if (!isSilent) {
        uiToast('源码适配完成，已带入工作台', { type: 'success', duration: 3600 }); 
    } else {
        closeCodeAdapter();
    }
}
// ==========================================
// 智能代码适配引擎 (Code Adapter Engine)
// ==========================================

let uploadedFile = null;
let uploadedFileContent = "";
let currentMappingData = []; // 存储解析后的映射行数据

// 1. 打开/关闭弹窗
function openCodeAdapter() {
    if (activeModules.length === 0) {
        return alert('当前没有接入任何模组，请先在左侧配置你的硬件接线方案。');
    }
    document.getElementById('code-adapter-modal').style.display = 'flex';
    document.getElementById('adapter-upload-area').style.display = 'block';
    document.getElementById('adapter-mapping-area').style.display = 'none';
    document.getElementById('adapter-confirm-btn').disabled = true;
    document.getElementById('adapter-confirm-btn').style.opacity = '0.5';
    document.getElementById('source-file-input').value = ''; // 清空上次的文件
}

function closeCodeAdapter() {
    document.getElementById('code-adapter-modal').style.display = 'none';
}

// 2. 处理文件上传并解析
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    uploadedFile = file;
    const reader = new FileReader();
    
    reader.onload = function(e) {
        uploadedFileContent = e.target.result;
        parseSourceCode(uploadedFileContent);
    };
    reader.readAsText(file);
}

// 3. 核心解析逻辑：提取 #define 并生成映射表
function parseSourceCode(content) {
    const lines = content.split('\n');
    currentMappingData = [];
    
    // 正则匹配：捕获 #define 宏名 和 引脚号（支持前面有空格，支持行尾注释）
    // 例如：#define TFT_MOSI 11 // 屏幕数据线
    const defineRegex = /^(\s*#define\s+)(\w+)(\s+)(\d+)(.*)$/;

    // 收集所有“已接入模组”的引脚数据，用于匹配
    let allHardwarePins = {};
    activeModules.forEach(mod => {
        const modData = moduleLibrary[mod.id];
        for (const [signal, pinStr] of Object.entries(mod.connections)) {
            if (pinStr === "dropped") continue;
            String(pinStr).split(',').forEach(p => {
                allHardwarePins[p] = { moduleName: modData.name, signal: signal, fullModule: modData };
            });
        }
    });

    lines.forEach((line, index) => {
        const match = line.match(defineRegex);
        if (match) {
            const varName = match[2];
            const originalValue = match[5];
            
            // 1. 尝试通过变量名猜测功能 (比如包含 MOSI, SCK, SDA)
            let guessedModuleName = "❓ 未知外设";
            let guessedSignal = "";
            
            const upperVarName = varName.toUpperCase();
            if (upperVarName.includes('TFT') || upperVarName.includes('LCD')) guessedModuleName = "📺 屏幕";
            else if (upperVarName.includes('MIC')) guessedModuleName = "🎵 麦克风";
            else if (upperVarName.includes('AMP') || upperVarName.includes('SPK') || upperVarName.includes('I2S_DIN')) guessedModuleName = "🎵 功放";
            
            if (upperVarName.includes('MOSI') || upperVarName.includes('SDA')) guessedSignal = "数据(MOSI)";
            if (upperVarName.includes('SCK') || upperVarName.includes('SCL')) guessedSignal = "时钟(SCK)";
            if (upperVarName.includes('DC')) guessedSignal = "控制(DC)";
            if (upperVarName.includes('RST')) guessedSignal = "复位(RST)";

            // 2. 查找这个旧引脚在你的新硬件里对应什么
            const hwPinInfo = allHardwarePins[originalValue];

            // 3. 决定默认处理状态
            let status = 'keep';
            let actionText = '⚪ 保持源码不动';
            let colorClass = 'bg-gray';
            let hasConflict = false;

            if (hwPinInfo) {
                // 找到了对应硬件
                status = 'match';
                colorClass = 'bg-green';
                actionText = '🟢 自动匹配';
                
                // 冲突检测：如果源码名字里明确写了 TFT，但硬件里这个引脚是接的麦克风，说明严重冲突
                if (guessedModuleName !== "❓ 未知外设" && !hwPinInfo.moduleName.includes(guessedModuleName.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, ''))) {
                    status = 'comment';
                    colorClass = 'bg-red';
                    actionText = '🔴 冲突，需处理';
                    hasConflict = true;
                }
            } else {
                // 硬件没分配这个引脚，或者源码有但没接线
                if (varName.includes('RST')) {
                    status = 'comment';
                    colorClass = 'bg-yellow';
                    actionText = '🟡 屏蔽此功能';
                }
            }

            currentMappingData.push({
                lineIndex: index,
                rawLine: line,
                prefix: match[1],
                varName: varName,
                space: match[3],
                originalValue: originalValue,
                suffix: match[5], // 包含注释部分
                guessedModuleName: guessedModuleName + (guessedSignal ? ` (${guessedSignal})` : ''),
                targetPin: hwPinInfo ? hwPinInfo.signal : '(未分配)',
                targetModule: hwPinInfo ? hwPinInfo.moduleName : '(空)',
                newPinValue: hwPinInfo ? String(hwPinInfo.signal === 'MOSI' ? 11 : 7) : '', // 这里的11/7只是占位，实际会在渲染时从activeModules取
                status: status,
                actionText: actionText,
                colorClass: colorClass,
                hasConflict: hasConflict
            });
        }
    });

    if (currentMappingData.length === 0) {
        alert("未在该文件中找到形如 #define XXX 11 的引脚定义。请确认上传的是引脚配置文件。");
        return;
    }

    // 切换到表格视图
    document.getElementById('adapter-upload-area').style.display = 'none';
    document.getElementById('adapter-mapping-area').style.display = 'block';
    document.getElementById('adapter-confirm-btn').disabled = false;
    document.getElementById('adapter-confirm-btn').style.opacity = '1';
    
    renderMappingTable();
}

// 4. 渲染表格
function renderMappingTable() {
    const tbody = document.getElementById('mapping-table-body');
    tbody.innerHTML = '';

    currentMappingData.forEach((row, index) => {
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td><code>${row.varName}</code></td>
            <td>${row.originalValue}</td>
            <td>${row.guessedModuleName}</td>
            <td><strong style="color:#007bff;">${row.targetPin !== '(未分配)' ? 'GPIO ' + row.targetPin : '(未分配)'}</strong></td>
            <td>${row.targetModule}</td>
            <td>
                <span class="status-tag tag-clickable ${row.colorClass}" onclick="openStatusModal(${index})">
                    ${row.actionText}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// 5. 修改状态弹窗逻辑
let currentEditIndex = -1;

function openStatusModal(index) {
    currentEditIndex = index;
    const row = currentMappingData[index];
    
    document.getElementById('modal-var-name').innerText = row.varName;
    
    const analysisBox = document.getElementById('analysis-box');
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    // 分析框文案
    if (row.hasConflict) {
        analysisBox.style.background = '#fff3f3';
        analysisBox.style.borderColor = '#f5c6cb';
        analysisBox.style.color = '#721c24';
        analysisBox.innerHTML = `<strong>🔴 发现引脚占用冲突！</strong><br>源码 <code>${row.varName}</code> 想要使用 ${row.originalValue} 脚，但在您的硬件中该脚已连接 <strong>${row.targetModule}</strong>。`;
    } else if (row.targetPin === '(未分配)') {
        analysisBox.style.background = '#fff3cd';
        analysisBox.style.borderColor = '#ffeeba';
        analysisBox.style.color = '#856404';
        analysisBox.innerHTML = `<strong>🟡 功能缺失提示</strong><br>源码需要此引脚，但您的接线方案未分配。`;
    } else {
        analysisBox.style.background = '#e8f5e9';
        analysisBox.style.borderColor = '#c8e6c9';
        analysisBox.style.color = '#1b5e20';
        analysisBox.innerHTML = `<strong>🟢 引脚现状</strong><br>源码中的 <code>${row.varName}</code> 已经与您的接线引脚完成硬件映射。`;
    }

    // 生成选项
    if (row.targetPin !== '(未分配)') {
        optionsContainer.innerHTML += `
            <label class="modal-option" style="display:block; padding:12px; margin-bottom:8px; border:1px solid #ddd; border-radius:6px; cursor:pointer; font-size:13px;">
                <input type="radio" name="adapter-status" value="match" style="margin-right:8px;"> 
                <strong>自动匹配</strong>
                <span style="display:block; color:#666; font-size:12px; margin-left:24px;">将源码原值替换为您当前分配的引脚号。</span>
            </label>
        `;
    }
    
    optionsContainer.innerHTML += `
        <label class="modal-option" style="display:block; padding:12px; margin-bottom:8px; border:1px solid #ddd; border-radius:6px; cursor:pointer; font-size:13px;">
            <input type="radio" name="adapter-status" value="keep" style="margin-right:8px;"> 
            <strong>强制保持源码不动</strong>
            <span style="display:block; color:#666; font-size:12px; margin-left:24px;">不修改该行代码，保留源码里的 ${row.originalValue} 号引脚。</span>
        </label>
        <label class="modal-option" style="display:block; padding:12px; margin-bottom:8px; border:1px solid #ddd; border-radius:6px; cursor:pointer; font-size:13px;">
            <input type="radio" name="adapter-status" value="comment" style="margin-right:8px;"> 
            <strong>屏蔽此功能（注释此行）</strong>
            <span style="display:block; color:#666; font-size:12px; margin-left:24px;">废弃这行代码，防止在您的新硬件上报错。</span>
        </label>
    `;

    // 回显当前状态
    document.querySelector(`input[name="adapter-status"][value="${row.status}"]`).checked = true;

    document.getElementById('statusModal').style.display = 'flex';
}

function closeStatusModal() {
    document.getElementById('statusModal').style.display = 'none';
    currentEditIndex = -1;
}

function applyStatus() {
    if (currentEditIndex === -1) return;
    const selected = document.querySelector('input[name="adapter-status"]:checked').value;
    
    const row = currentMappingData[currentEditIndex];
    row.status = selected;
    
    if (selected === 'match') {
        row.colorClass = 'bg-green';
        row.actionText = '🟢 自动匹配';
    } else if (selected === 'keep') {
        row.colorClass = 'bg-gray';
        row.actionText = '⚪ 保持源码不动';
    } else if (selected === 'comment') {
        row.colorClass = 'bg-yellow';
        row.actionText = '🟡 屏蔽此功能';
    }

    renderMappingTable();
    closeStatusModal();
}

// 6. 一键恢复智能推荐
function autoMatchAll() {
    // 重新跑一次解析逻辑，重置当前数据
    if (uploadedFileContent) {
        parseSourceCode(uploadedFileContent);
    }
}

// 7. 执行替换并下载
function executeReplacement() {
    // 1. 先复制一份原文件的所有行
    let newLines = uploadedFileContent.split('\n');

    // 2. 根据用户的决定，修改特定行
    currentMappingData.forEach(row => {
        let finalLine = row.rawLine;

        if (row.status === 'match') {
            // 找出这个引脚在你的硬件里具体配到了哪个数字
            let targetNum = row.originalValue; 
            // 去活着的模组里找
            activeModules.forEach(mod => {
                for (const [signal, pinStr] of Object.entries(mod.connections)) {
                    // 这里简单用当前行原始的 pin 去反查
                    if (String(pinStr).split(',').includes(String(row.originalValue))) {
                         targetNum = pinStr;
                    }
                }
            });
            // 重新拼装，精准替换数字
            finalLine = row.prefix + row.varName + row.space + targetNum + row.suffix;
        } else if (row.status === 'comment') {
            // 注释掉这一行，保留缩进
            finalLine = row.prefix.substring(0, row.prefix.length - 7) + '// ' + row.rawLine.trim();
        }
        // 'keep' 状态就不动，直接复制原行

        newLines[row.lineIndex] = finalLine;
    });

    // 3. 触发下载
    const finalContent = newLines.join('\n');
    const blob = new Blob([finalContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = uploadedFile.name || 'modified_config.h';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeCodeAdapter();
}
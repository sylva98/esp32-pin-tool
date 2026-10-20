// ==========================================
// 1. 全局状态管理
// ==========================================
let boardConfig = null;
let moduleLibrary = null;
let pinsState = {}; 
let activeModules = []; 

// ==========================================
// 2. 初始化与数据加载
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 加载 JSON 数据
        const [boardRes, moduleRes] = await Promise.all([
            fetch('./data/board.json'),
            fetch('./data/modules.json')
        ]);
        
        if(!boardRes.ok || !moduleRes.ok) throw new Error("无法加载数据文件");
        
        boardConfig = await boardRes.json();
        moduleLibrary = await moduleRes.json();
        
        document.getElementById('board-title').innerText = boardConfig.boardName;
        initPins();
        renderPins();
        populateModuleSelect();
        
    } catch (error) {
        console.error(error);
        alert("数据加载失败！请确保你是通过本地服务器 (如 VSCode Live Server) 打开的页面，直接双击 HTML 文件会被浏览器的 CORS 策略拦截。");
    }
});

function initPins() {
    // 遍历 0 到 48 引脚
    for (let i = 0; i <= 48; i++) {
        if (boardConfig.fixedPins.includes(i)) {
            pinsState[i] = { state: 'fixed', label: 'Fixed' };
        } else if (!boardConfig.availableGpios.includes(i)) {
            pinsState[i] = { state: 'fixed', label: 'N/A' };
        } else if (boardConfig.strappingPins.includes(i)) {
            pinsState[i] = { state: 'strapping', label: 'Strap' };
        } else {
            pinsState[i] = { state: 'free', label: 'Free' };
        }
    }
}

function populateModuleSelect() {
    const select = document.getElementById('module-select');
    for (const [key, data] of Object.entries(moduleLibrary)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = data.name;
        select.appendChild(option);
    }
}

// ==========================================
// 3. 渲染逻辑
// ==========================================
function renderPins() {
    const grid = document.getElementById('pin-grid');
    grid.innerHTML = '';
    
    // 只渲染 0-48，跳过中间没有引脚的 22-34 (为了美观)
    for (let i = 0; i <= 48; i++) {
        if (i > 21 && i < 35) continue; 

        const pin = pinsState[i];
        const div = document.createElement('div');
        div.className = `pin ${pin.state}`;
        
        let labelHtml = `<div class="io-num">IO${i}</div>`;
        if (pin.state === 'used') {
            labelHtml += `<div class="pin-label">${pin.owner}<br>${pin.signal}</div>`;
            div.onclick = () => releasePin(i);
            div.title = "点击强制释放此引脚";
        } else if (pin.state === 'strapping') {
            labelHtml += `<div class="pin-label">启动敏感</div>`;
        } else if (pin.state === 'fixed') {
             labelHtml += `<div class="pin-label">${pin.label}</div>`;
        }

        div.innerHTML = labelHtml;
        grid.appendChild(div);
    }
}

function renderModules() {
    const list = document.getElementById('active-modules-list');
    const wiringPanel = document.getElementById('wiring-panel');
    const wiringList = document.getElementById('connection-list');
    const codePanel = document.getElementById('code-panel');
    
    if (activeModules.length === 0) {
        list.innerHTML = '<p style="color:#888; font-size:12px; text-align:center;">暂无模组</p>';
        wiringPanel.style.display = 'none';
        codePanel.style.display = 'none';
        return;
    }

    list.innerHTML = '';
    wiringList.innerHTML = '';
    
    activeModules.forEach((mod, index) => {
        // 1. 侧边栏列表
        const modDiv = document.createElement('div');
        modDiv.className = 'module-tag';
        modDiv.innerHTML = `<strong>${moduleLibrary[mod.id].name}</strong> <span>#${index+1}</span>`;
        list.appendChild(modDiv);

        // 2. 接线指导图
        const title = document.createElement('h3');
        title.innerText = `${moduleLibrary[mod.id].name} (实例 #${index+1})`;
        title.style.fontSize = '1rem';
        title.style.marginTop = '15px';
        wiringList.appendChild(title);

        for (const [signal, pinNum] of Object.entries(mod.connections)) {
            const item = document.createElement('div');
            item.className = 'connection-item';
            item.innerHTML = `
                <strong>${signal}</strong> 
                <span style="margin: 0 10px;">➡</span> 
                <span style="color:var(--pin-fixed); font-weight:bold; font-size:1.1rem;">GPIO ${pinNum}</span>
            `;
            wiringList.appendChild(item);
        }
    });

    wiringPanel.style.display = 'block';
    generateCodePreview();
}

// ==========================================
// 4. 智能分配核心逻辑
// ==========================================
function addModule() {
    const select = document.getElementById('module-select');
    const modId = select.value;
    if (!modId) return alert('请先选择模组');

    const modData = moduleLibrary[modId];
    const newConnections = {};
    const tempAllocations = []; // 记录本次临时分配，方便回滚

    // 尝试分配需求的引脚
    for (const req of modData.requirements) {
        let pinsToAllocate = req.count;
        let allocated = [];
        
        // 策略 1: 如果有默认接口推荐（如 I2C/SPI），优先使用推荐引脚
        if (modData.interface && boardConfig.defaultInterfaces[modData.interface]) {
            const defaultPins = boardConfig.defaultInterfaces[modData.interface];
            if (defaultPins[req.signal] && pinsState[defaultPins[req.signal]].state === 'free') {
                const p = defaultPins[req.signal];
                pinsState[p] = { state: 'used', owner: modId, signal: req.signal };
                allocated.push(p);
                tempAllocations.push(p);
                pinsToAllocate--;
            }
        }

        // 策略 2: 如果推荐引脚无效或不需要，优先从 preferredPins 寻找
        if (pinsToAllocate > 0 && modData.preferredPins) {
            for (const p of modData.preferredPins) {
                if (pinsToAllocate <= 0) break;
                if (pinsState[p].state === 'free' && !allocated.includes(p)) {
                    pinsState[p] = { state: 'used', owner: modId, signal: req.signal };
                    allocated.push(p);
                    tempAllocations.push(p);
                    pinsToAllocate--;
                }
            }
        }

        // 策略 3: 兜底策略，在全盘可用引脚中寻找
        if (pinsToAllocate > 0) {
            for (let i = 0; i <= 48; i++) {
                if (pinsToAllocate <= 0) break;
                if (pinsState[i] && pinsState[i].state === 'free') {
                    pinsState[i] = { state: 'used', owner: modId, signal: req.signal };
                    allocated.push(i);
                    tempAllocations.push(i);
                    pinsToAllocate--;
                }
            }
        }

        // 如果遍历完了还不够，说明冲突，回滚
        if (pinsToAllocate > 0) {
            alert(`可用引脚不足！无法满足 ${modData.name} 的 ${req.signal} 需求。请释放其他引脚。`);
            tempAllocations.forEach(p => { pinsState[p] = { state: 'free', label: 'Free' }; });
            return;
        }

        newConnections[req.signal] = req.count > 1 ? allocated.join(',') : allocated[0];
    }

    // 分配成功，记录状态
    activeModules.push({ id: modId, connections: newConnections });
    renderPins();
    renderModules();
}

function releasePin(pinNum) {
    const pin = pinsState[pinNum];
    if (pin.state !== 'used') return;
    
    if(confirm(`确定要强制释放 GPIO ${pinNum} 吗？对应的模组将被移除。`)) {
        const ownerId = pin.owner;
        // 找到并移除该模组
        const modIndex = activeModules.findIndex(m => 
            m.id === ownerId && Object.values(m.connections).some(val => String(val).split(',').includes(String(pinNum)))
        );

        if (modIndex > -1) {
            activeModules.splice(modIndex, 1);
            // 重新初始化全部引脚，重新挂载剩余模组
            initPins();
            activeModules.forEach(mod => {
                for (const [signal, pinStr] of Object.entries(mod.connections)) {
                    String(pinStr).split(',').forEach(p => {
                        pinsState[p] = { state: 'used', owner: mod.id, signal: signal };
                    });
                }
            });
            renderPins();
            renderModules();
        }
    }
}

function resetAll() {
    if(confirm('确定要清空所有配置吗？')) {
        activeModules = [];
        initPins();
        renderPins();
        renderModules();
    }
}

// ==========================================
// 5. 导出功能
// ==========================================
function generateCodePreview() {
    const pre = document.getElementById('code-preview');
    let code = `// 自动生成的引脚配置头文件\n// 目标平台: ${boardConfig.boardName}\n\n`;

    activeModules.forEach((mod) => {
        const modName = mod.id.toUpperCase();
        for (const [signal, pin] of Object.entries(mod.connections)) {
            if (String(pin).includes(',')) {
                String(pin).split(',').forEach((p, i) => {
                    code += `#define ${modName}_${signal}_${i}  ${p}\n`;
                });
            } else {
                code += `#define ${modName}_${signal}  ${pin}\n`;
            }
        }
        code += `\n`;
    });

    pre.textContent = code;
    document.getElementById('code-panel').style.display = 'block';
}

function exportConfig() {
    downloadFile("esp32s3_config.json", JSON.stringify(activeModules, null, 2));
}

function exportCHeader() {
    downloadFile("pin_config.h", document.getElementById('code-preview').textContent);
}

function downloadFile(filename, content) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', filename);
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}
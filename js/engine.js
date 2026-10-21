// ==========================================
// 硬件分配引擎 (纯算法层)
// ==========================================

/**
 * 检查指定引脚对当前模组信号是否安全 (防呆核心)
 */
function isSafePin(pin, modData, req, pinsStateCopy) {
    // 1. 特殊电压域校验
    if (boardConfig.special_domains && boardConfig.special_domains[pin]) {
        if (boardConfig.special_domains[pin] !== `${modData.signal_voltage}V`) return false;
    }
    
    // 2. 5V 烧板风险校验
    if (modData.signal_voltage > boardConfig.safe_voltage) { 
        if (!boardConfig.power_rails["5V"]) return false; 
    }
    
    // 3. 痛点2：Strapping 启动幽灵信号拦截 (极性冲突)
    if (boardConfig.strappingPins[pin]) {
        const reqLevel = boardConfig.strappingPins[pin].required_level;
        const modDefaultLevel = req.default_state; // "HIGH" or "LOW"

        // 如果模组自带电平且与启动引脚要求的电平相反，直接红牌拦截
        if (modDefaultLevel && reqLevel !== modDefaultLevel) {
            return false; 
        }
        // 即使模组没标电平，自带上下拉也可能引发风险，此时依然要避开，交给兜底逻辑
        if (req.internal_pull) {
            return false;
        }
    }
    
    // 4. 引脚能力匹配 (ADC 模拟信号专属校验)
    if (modData.requires_adc && !boardConfig.adcPins[pin]) {
        return false;
    }

    // 5. 高频信号防串扰缓冲逻辑
    if (req.high_speed) {
        const adjacentPins = [pin - 1, pin + 1];
        for (const adj of adjacentPins) {
            if (pinsStateCopy[adj] && pinsStateCopy[adj].state === 'used') {
                const ownerModId = pinsStateCopy[adj].owner;
                const ownerSignal = pinsStateCopy[adj].signal;
                const ownerModData = moduleLibrary[ownerModId];
                if (ownerModData) {
                    const ownerReq = ownerModData.requirements.find(r => r.signal === ownerSignal);
                    if (ownerReq && ownerReq.high_speed) { return false; }
                }
            }
        }
    }
    return true;
}

/**
 * 核心分配逻辑：尝试给一个模组分配所有引脚
 */
function tryAllocate(modData, pinsStateCopy) {
    let allocations = {}; 
    let missingRequired = [];
    let missingOptional = [];
    let pinsAllocatedInThisMod = []; 

    // 排序：必选引脚优先分配，可选引脚兜底
    let reqs = [...modData.requirements].sort((a, b) => a.optional === b.optional ? 0 : a.optional ? 1 : -1);

    for (const req of reqs) {
        let pinsToAllocate = req.count;
        let allocated = [];
        
        // 策略 1: 总线复用（例如已有 I2C 则直接共享）
        if (modData.interface && activeBuses[modData.interface] && activeBuses[modData.interface][req.signal]) {
            const existingPin = activeBuses[modData.interface][req.signal];
            if (!pinsAllocatedInThisMod.includes(existingPin)) { 
                allocated.push(existingPin); 
                pinsAllocatedInThisMod.push(existingPin); 
                pinsToAllocate--; 
            }
        }

        // 策略 2: 默认接口引脚推荐
        if (pinsToAllocate > 0 && modData.interface && boardConfig.defaultInterfaces[modData.interface]) {
            const defaultPins = boardConfig.defaultInterfaces[modData.interface];
            const dp = defaultPins[req.signal];
            if (dp !== undefined && pinsStateCopy[dp] && pinsStateCopy[dp].state === 'free' && !pinsAllocatedInThisMod.includes(dp) && isSafePin(dp, modData, req, pinsStateCopy)) { 
                allocated.push(dp); 
                pinsAllocatedInThisMod.push(dp); 
                pinsToAllocate--; 
            }
        }

        // 策略 3: 模组专属推荐引脚
        if (pinsToAllocate > 0 && modData.preferredPins) {
            for (const p of modData.preferredPins) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[p] && pinsStateCopy[p].state === 'free' && !pinsAllocatedInThisMod.includes(p) && isSafePin(p, modData, req, pinsStateCopy)) { 
                    allocated.push(p); 
                    pinsAllocatedInThisMod.push(p); 
                    pinsToAllocate--; 
                }
            }
        }

        // 策略 4: 兜底全盘搜索
        if (pinsToAllocate > 0) {
            for (let i = 0; i <= 48; i++) {
                if (pinsToAllocate <= 0) break;
                if (pinsStateCopy[i] && pinsStateCopy[i].state === 'free' && !pinsAllocatedInThisMod.includes(i) && isSafePin(i, modData, req, pinsStateCopy)) { 
                    allocated.push(i); 
                    pinsAllocatedInThisMod.push(i); 
                    pinsToAllocate--; 
                }
            }
        }

        // 结果判定
        if (pinsToAllocate > 0) {
            if (req.optional) missingOptional.push(req.signal); 
            else missingRequired.push(req.signal);
        } else {
            allocations[req.signal] = allocated;
            allocated.forEach(p => { pinsStateCopy[p].state = 'used'; });
        }
    }

    return { allocations, missingRequired, missingOptional };
}

/**
 * 提交分配：将沙盘推演的结果正式写入全局状态
 */
function commitAllocation(modId, allocations) {
    const modData = moduleLibrary[modId];
    const newConnections = {};
    for (const [signal, pins] of Object.entries(allocations)) {
        if (pins === "dropped") { 
            newConnections[signal] = "dropped"; 
        } else {
            newConnections[signal] = pins.length > 1 ? pins.join(',') : pins[0];
            pins.forEach(p => { pinsState[p] = { state: 'used', owner: modId, signal: signal }; });
            if (modData.interface && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK' || signal === 'BCLK' || signal === 'LRC')) {
                if (!activeBuses[modData.interface]) activeBuses[modData.interface] = {};
                activeBuses[modData.interface][signal] = Number(pins[0]);
            }
        }
    }
    activeModules.push({ id: modId, interface: modData.interface, connections: newConnections, overrides: {} });
    
    // 触发 UI 重绘
    if (typeof renderPins === 'function') renderPins();
    if (typeof renderModules === 'function') renderModules();
}

/**
 * 释放引脚：移除模组并归还引脚
 */
function releasePin(pinNum) {
    if (pinsState[pinNum].state !== 'used') return;
    if(confirm(`确定要强制释放 GPIO ${pinNum} 吗？对应的模组将被移除。`)) {
        const ownerId = pinsState[pinNum].owner;
        const modIndex = activeModules.findIndex(m => m.id === ownerId && Object.values(m.connections).some(val => String(val).split(',').includes(String(pinNum))));
        if (modIndex > -1) {
            activeModules.splice(modIndex, 1);
            activeBuses = { I2C: {}, SPI: {}, I2S_IN: {}, I2S_OUT: {}, UART: {} };
            
            // 重新初始化状态
            for (let i = 0; i <= 48; i++) {
                if (boardConfig.fixedPins.includes(i)) pinsState[i] = { state: 'fixed', label: 'Fixed' };
                else if (!boardConfig.availableGpios.includes(i)) pinsState[i] = { state: 'fixed', label: 'N/A' };
                else if (boardConfig.strappingPins[i]) pinsState[i] = { state: 'strapping', label: 'Strap' };
                else pinsState[i] = { state: 'free', label: 'Free' };
            }
            
            // 重建剩余模组的引脚占用状态
            activeModules.forEach(mod => {
                for (const [signal, pinStr] of Object.entries(mod.connections)) {
                    if (pinStr === "dropped") continue;
                    String(pinStr).split(',').forEach(p => {
                        pinsState[p] = { state: 'used', owner: mod.id, signal: signal };
                        if (mod.interface && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK' || signal === 'BCLK' || signal === 'LRC')) { 
                            activeBuses[mod.interface][signal] = Number(p); 
                        }
                    });
                }
            });
            if (typeof renderPins === 'function') renderPins();
            if (typeof renderModules === 'function') renderModules();
        }
    }
}

/**
 * 全局校验：检查 Wi-Fi 与 ADC2 的致命冲突
 */
function checkWifiAdcConflict(modId) {
    const modData = moduleLibrary[modId];
    if (modData.uses_wifi) {
        for (const mod of activeModules) {
            const currentModData = moduleLibrary[mod.id];
            if (currentModData.requires_adc) {
                for (const [signal, pinStr] of Object.entries(mod.connections)) {
                    const pins = String(pinStr).split(',').map(Number);
                    for (const p of pins) {
                        if (boardConfig.adcPins[p] && boardConfig.adcPins[p].startsWith('ADC2')) {
                            alert(`❌ 系统级致命冲突：检测到您使用了 Wi-Fi/4G 模组。但是模拟传感器 ${currentModData.name} 正占用 GPIO ${p} (${boardConfig.adcPins[p]})。一旦开启无线功能，ADC2 将被强制征用，导致模拟读数失效！请立即将传感器更换至 ADC1 引脚 (如 GPIO 1~10)。`);
                        }
                    }
                }
            }
        }
    }
}

/**
 * 痛点3：检查是否存在高速信号，触发物理走线警告
 */
function checkHighSpeedWarning() {
    let hasHighSpeed = false;
    activeModules.forEach(mod => {
        const modData = moduleLibrary[mod.id];
        for (const [signal, pinStr] of Object.entries(mod.connections)) {
            if (pinStr === "dropped") continue;
            const req = modData.requirements.find(r => r.signal === signal);
            if (req && req.high_speed) {
                hasHighSpeed = true;
            }
        }
    });
    return hasHighSpeed;
}

/**
 * 功耗预算计算
 */
function updatePowerBudget() {
    let totalCurrent = 0;
    activeModules.forEach(mod => {
        const modData = moduleLibrary[mod.id];
        const current = mod.overrides?.current !== undefined ? mod.overrides.current : (modData.peak_current_ma || 0);
        totalCurrent += current;
    });
    const maxCurrent = boardConfig.max_current_ma || 500;
    const percentage = Math.min(Math.round((totalCurrent / maxCurrent) * 100), 100);
    const bar = document.getElementById('power-bar');
    const text = document.getElementById('power-text');
    if (bar && text) {
        bar.style.width = `${percentage}%`;
        text.innerText = `${totalCurrent} mA / ${maxCurrent} mA (${percentage}%)`;
        if (percentage < 70) { bar.style.backgroundColor = '#28a745'; text.style.color = '#28a745'; } 
        else if (percentage < 100) { bar.style.backgroundColor = '#fd7e14'; text.style.color = '#fd7e14'; } 
        else { bar.style.backgroundColor = '#dc3545'; text.style.color = '#dc3545'; }
    }
}
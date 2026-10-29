// ==========================================
// 硬件分配引擎 (纯算法层)
// 终极完美版：双侧沙盘预演 + 绝对不跨区 + 完整状态提交
// ==========================================

/* ==========================================
 * 引脚偏好打分：同等条件下优先避开「调试串口 / USB」脚
 * 之前全量搜索是按排针物理顺序取第一个空闲脚，WROOM 右侧头几个正好是
 * TX(43)/RX(44)，于是最简单的 I2C 传感器也会被丢到 UART0 上，
 * 烧录后串口日志全无。这里给这类脚加惩罚分，让它们排到最后再考虑。
 * 知识库与诊断引擎共用一份（resolveBoardSpec），避免两处各写一套。
 * ========================================== */
let _pinPenaltySpec = { board: null, spec: null };

function getPinPenaltySpec() {
    if (typeof boardConfig === 'undefined' || !boardConfig) return null;
    if (typeof resolveBoardSpec !== 'function') return null;
    if (_pinPenaltySpec.board === boardConfig.boardName) return _pinPenaltySpec.spec;
    const spec = resolveBoardSpec(boardConfig.boardName);
    _pinPenaltySpec = { board: boardConfig.boardName, spec: spec };
    return spec;
}

function pinPenalty(pin) {
    const spec = getPinPenaltySpec();
    if (!spec) return 0;
    let score = 0;
    if ((spec.uart_pins || []).includes(pin)) score += 100;
    if ((spec.usb_pins || []).includes(pin)) score += 40;
    // 启动脚（IO0/IO3/IO45/IO46）能用但尽量别用：排在普通空闲脚后面，实在没脚了才落上去
    if (boardConfig && boardConfig.strappingPins && boardConfig.strappingPins[pin]) score += 15;
    return score;
}

function isSafePin(pin, modData, req, pinsStateCopy) {
    if (boardConfig.strappingPins[pin] && boardConfig.strappingPins[pin].reason.includes('仅输入')) {
        if (req.requires_output) return false; 
    }
    if (boardConfig.special_domains && boardConfig.special_domains[pin]) {
        if (boardConfig.special_domains[pin] !== `${modData.signal_voltage}V`) return false;
    }
    if (modData.signal_voltage > boardConfig.safe_voltage) { 
        if (!boardConfig.power_rails["5V"]) return false; 
    }
    if (boardConfig.strappingPins[pin]) {
        const reqLevel = boardConfig.strappingPins[pin].required_level;
        const modDefaultLevel = req.default_state;
        if (modDefaultLevel && reqLevel !== modDefaultLevel) return false; 
        if (req.internal_pull) return false;
    }
    if (modData.requires_adc && !boardConfig.adcPins[pin]) return false;

    if (req.high_speed) {
        const adjacentPins = [pin - 1, pin + 1];
        for (const adj of adjacentPins) {
            if (pinsStateCopy[adj] && pinsStateCopy[adj].state === 'used') {
                const ownerModId = pinsStateCopy[adj].owner;
                const ownerSignal = pinsStateCopy[adj].signal;
                const ownerModData = moduleLibrary[ownerModId];
                if (ownerModData) {
                    // 同一接口（同一组 SPI/I2S 总线）的相邻脚本来就是「一起走线」的，
                    // 时钟与数据必然相邻，不能按串扰拒掉，否则源码指定的 MOSI=20 会被 SCK=19 顶掉
                    if (ownerModData.interface === modData.interface) continue;
                    const ownerReq = ownerModData.requirements.find(r => r.signal === ownerSignal);
                    if (ownerReq && ownerReq.high_speed) { return false; }
                }
            }
        }
    }
    return true;
}

/* ==========================================
 * I2S 总线命名空间
 *   双工(Duplex)：I2S_IN 与 I2S_OUT 默认脚相同，或源码只给了一套共享时钟（activeBuses.I2S）
 *                 → 合并成一条 'I2S'，麦克风与功放共用 BCLK/LRC
 *   单工(Simplex)：默认脚不同且没有共享预设 → 各走 I2S_IN / I2S_OUT，互不干扰
 * 不这么分的话，先分配的麦克风把时钟写进 'I2S'，功放就会顺着复用接到麦克风的脚上，
 * 小智 bread-compact-wifi-s3cam（mic 1/2、spk 40/41）会被画成两对时钟全错。
 * ========================================== */
function resolveBusKey(modData, buses) {
    const key = (modData && modData.interface) ? modData.interface : null;
    if (!key || !key.includes('I2S')) return key;
    const di = (boardConfig.defaultInterfaces || {}).I2S_IN || {};
    const dout = (boardConfig.defaultInterfaces || {}).I2S_OUT || {};
    const sameDefaults = di.BCLK !== undefined && di.BCLK === dout.BCLK && di.LRC === dout.LRC;
    const sharedPreset = !!(buses && buses.I2S && Object.keys(buses.I2S).length);
    return (sameDefaults || sharedPreset) ? 'I2S' : key;
}

/* ==========================================
 * 信号约束解析：字典内信号用其定义；扩展/自定义引线（如 RST、INT、MCLK）
 * 在 requirements 中没有登记，这里返回一份宽松的默认约束，
 * 使它们同样可以在画布上手动拖线接入。
 * ========================================== */
function resolveSignalReq(modData, signal) {
    const defined = ((modData && modData.requirements) || []).find(r => r.signal === signal);
    if (defined) return defined;
    return { signal: signal, count: 1, optional: true, requires_output: true };
}

function simulateAllocateOnSide(modData, pinsStateCopy, busesCopy, forcedSide, leftPinNums, rightPinNums) {
    let allocations = {}; 
    let missingRequired = [];
    let missingOptional = [];
    let pinsAllocatedInThisMod = []; 
    let preferredHits = 0;   // 命中「总线复用 / 主板默认接口」的次数：越高越贴合推荐接法
    let reqs = [...modData.requirements].sort((a, b) => a.optional === b.optional ? 0 : a.optional ? 1 : -1);
    let ifaceKey = resolveBusKey(modData, busesCopy);

    let sidePins = forcedSide === 'left' ? leftPinNums : rightPinNums;

    for (const req of reqs) {
        let pinsToAllocate = req.count;
        let allocated = [];
        
        // 总线复用
        if (ifaceKey && busesCopy[ifaceKey] && busesCopy[ifaceKey][req.signal]) {
            const existingPin = busesCopy[ifaceKey][req.signal];
            // 总线上记着的那根脚必须真的还能用。源码解析会先把代码里的引脚号写进 activeBuses，
            // 若那根脚在本板上已被摄像头/PSRAM/USB 占用（state=onboard/fixed），
            // 直接复用就等于把整条总线拖到不可用的脚上 —— 必须先看状态再决定共享。
            const busSt = pinsStateCopy[existingPin] ? pinsStateCopy[existingPin].state : null;
            if ((busSt === 'free' || busSt === 'used' || busSt === 'strapping') && sidePins.includes(existingPin) && !pinsAllocatedInThisMod.includes(existingPin)) { 
                allocated.push(existingPin); 
                pinsAllocatedInThisMod.push(existingPin); 
                pinsToAllocate--; 
                preferredHits++;
            }
        }

        // 默认接口
        if (pinsToAllocate > 0 && ifaceKey && boardConfig.defaultInterfaces[ifaceKey]) {
            const dp = boardConfig.defaultInterfaces[ifaceKey][req.signal];
            if (dp !== undefined && sidePins.includes(dp) && pinsStateCopy[dp] && pinsStateCopy[dp].state === 'free' && !pinsAllocatedInThisMod.includes(dp) && isSafePin(dp, modData, req, pinsStateCopy)) { 
                allocated.push(dp); 
                pinsAllocatedInThisMod.push(dp); 
                pinsToAllocate--; 
                preferredHits++;
            }
        }

        // 按信号名精确匹配的偏好：源码解析会给出 {SCK:19, MOSI:20, DC:47, RST:21, CS:45, BL:38}
        // 扁平数组只能按顺序抓，会让 SCL 拿到背光脚；有了这个映射，源码写的脚才真的落到对应信号上。
        // 这里额外放行 strapping（BOOT 按键在 GPIO0、屏的片选常在 GPIO45）：
        // 源码点名要用的脚就该接，启动风险交给诊断 W1 提示，而不是悄悄换一根。
        if (pinsToAllocate > 0 && modData.preferredBySignal) {
            const want = modData.preferredBySignal[req.signal];
            if (want !== undefined && want !== null) {
                const wp = Number(want);
                const wst = pinsStateCopy[wp] ? pinsStateCopy[wp].state : null;
                if (sidePins.includes(wp) && (wst === 'free' || wst === 'strapping')
                    && !pinsAllocatedInThisMod.includes(wp) && isSafePin(wp, modData, req, pinsStateCopy)) {
                    allocated.push(wp);
                    pinsAllocatedInThisMod.push(wp);
                    pinsToAllocate--;
                    preferredHits++;
                }
            }
        }

        // 偏好引脚（扁平列表，作为精确映射的兜底；同样放行 strapping）
        if (pinsToAllocate > 0 && modData.preferredPins) {
            for (const p of modData.preferredPins) {
                if (pinsToAllocate <= 0) break;
                if (!sidePins.includes(p)) continue;
                const pst = pinsStateCopy[p] ? pinsStateCopy[p].state : null;
                if ((pst === 'free' || pst === 'strapping') && !pinsAllocatedInThisMod.includes(p) && isSafePin(p, modData, req, pinsStateCopy)) { 
                    allocated.push(p); 
                    pinsAllocatedInThisMod.push(p); 
                    pinsToAllocate--; 
                }
            }
        }

        // 全量搜索该侧：先算候选再排序，把调试串口/USB 脚排到最后
        // （sort 是稳定排序，同分时仍按排针物理顺序，接起来顺手）
        if (pinsToAllocate > 0) {
            const candidates = sidePins.filter(i =>
                pinsStateCopy[i] && pinsStateCopy[i].state === 'free' &&
                !pinsAllocatedInThisMod.includes(i) &&
                isSafePin(i, modData, req, pinsStateCopy)
            );
            candidates.sort((a, b) => pinPenalty(a) - pinPenalty(b));
            for (const i of candidates) {
                if (pinsToAllocate <= 0) break;
                allocated.push(i); 
                pinsAllocatedInThisMod.push(i); 
                pinsToAllocate--; 
            }
        }

        if (pinsToAllocate > 0) {
            if (req.optional) missingOptional.push(req.signal); 
            else missingRequired.push(req.signal);
        } else {
            allocations[req.signal] = allocated;
            allocated.forEach(p => { 
                pinsStateCopy[p].state = 'used'; 
                if (ifaceKey && (req.signal === 'SDA' || req.signal === 'SCL' || req.signal === 'MOSI' || req.signal === 'MISO' || req.signal === 'SCK' || req.signal === 'BCLK' || req.signal === 'LRC')) {
                    if (!busesCopy[ifaceKey]) busesCopy[ifaceKey] = {};
                    busesCopy[ifaceKey][req.signal] = Number(p);
                }
            });
        }
    }
    return { allocations, missingRequired, missingOptional, preferredHits };
}

function tryAllocate(modData, pinsStateCopy, busesCopy) {
    if (!busesCopy) busesCopy = activeBuses; 

    const boardLeftPins = boardConfig.pinLayout?.left || [];
    const boardRightPins = boardConfig.pinLayout?.right || [];
    // 排针上的 "3V3"/"5V"/"GND" 不是 GPIO，不能按数字前缀猜测（否则 5V 会被当成 GPIO5），
    // 统一交给 resolveBoardPinToken 解析；"TX"/"RX" 也会在这里还原成 43/44
    const extractPin = (p) => {
        if (typeof resolveBoardPinToken === 'function') return resolveBoardPinToken(boardConfig, p);
        const s = String(p).trim();
        return /^\d+$/.test(s) ? Number(s) : null;
    };
    let leftPinNums = boardLeftPins.map(extractPin).filter(p => p !== null);
    let rightPinNums = boardRightPins.map(extractPin).filter(p => p !== null);
    // 自定义主板可能没有 pinLayout：退回可用 GPIO 列表并按左右均分，保证分配仍可进行
    if (leftPinNums.length === 0 && rightPinNums.length === 0) {
        const all = (boardConfig.availableGpios || []).slice();
        const mid = Math.ceil(all.length / 2);
        leftPinNums = all.slice(0, mid);
        rightPinNums = all.slice(mid);
    }

    let copyLeft = JSON.parse(JSON.stringify(pinsStateCopy));
    let busesLeft = JSON.parse(JSON.stringify(busesCopy));
    let resLeft = simulateAllocateOnSide(modData, copyLeft, busesLeft, 'left', leftPinNums, rightPinNums);

    let copyRight = JSON.parse(JSON.stringify(pinsStateCopy));
    let busesRight = JSON.parse(JSON.stringify(busesCopy));
    let resRight = simulateAllocateOnSide(modData, copyRight, busesRight, 'right', leftPinNums, rightPinNums);

    if (resLeft.missingRequired.length === 0 && resRight.missingRequired.length > 0) {
        for (let key in copyLeft) pinsStateCopy[key] = copyLeft[key];
        for (let iface in busesLeft) busesCopy[iface] = busesLeft[iface];
        return resLeft;
    } else if (resRight.missingRequired.length === 0 && resLeft.missingRequired.length > 0) {
        for (let key in copyRight) pinsStateCopy[key] = copyRight[key];
        for (let iface in busesRight) busesCopy[iface] = busesRight[iface];
        return resRight;
    } else if (resLeft.missingRequired.length === 0 && resRight.missingRequired.length === 0) {
        // 两侧都能接满时：先看谁用上了主板推荐接法（默认接口/总线复用），
        // 不能因为「右侧更空」就把 I2C 甩到 UART0 上；推荐接法打平再按左右余量均衡
        if (resLeft.preferredHits !== resRight.preferredHits) {
            const useLeft = resLeft.preferredHits > resRight.preferredHits;
            const picked = useLeft ? copyLeft : copyRight;
            const buses = useLeft ? busesLeft : busesRight;
            for (let key in picked) pinsStateCopy[key] = picked[key];
            for (let iface in buses) busesCopy[iface] = buses[iface];
            return useLeft ? resLeft : resRight;
        }
        let leftFree = leftPinNums.filter(p => pinsStateCopy[p] && pinsStateCopy[p].state === 'free').length;
        let rightFree = rightPinNums.filter(p => pinsStateCopy[p] && pinsStateCopy[p].state === 'free').length;
        
        if (leftFree <= rightFree) {
            for (let key in copyLeft) pinsStateCopy[key] = copyLeft[key];
            for (let iface in busesLeft) busesCopy[iface] = busesLeft[iface];
            return resLeft;
        } else {
            for (let key in copyRight) pinsStateCopy[key] = copyRight[key];
            for (let iface in busesRight) busesCopy[iface] = busesRight[iface];
            return resRight;
        }
    } else {
        if (resLeft.missingRequired.length <= resRight.missingRequired.length) {
            for (let key in copyLeft) pinsStateCopy[key] = copyLeft[key];
            for (let iface in busesLeft) busesCopy[iface] = busesLeft[iface];
            return resLeft;
        } else {
            for (let key in copyRight) pinsStateCopy[key] = copyRight[key];
            for (let iface in busesRight) busesCopy[iface] = busesRight[iface];
            return resRight;
        }
    }
}

function commitAllocation(modId, allocations) {
    const modData = moduleLibrary[modId];
    const newConnections = {};
    // 与分配时用同一套命名空间规则，否则单工板写进 I2S_IN、这里却记到 I2S，下一块模组又去复用
    let ifaceKey = resolveBusKey(modData, activeBuses);

    for (const [signal, pins] of Object.entries(allocations)) {
        if (pins === "dropped") { 
            newConnections[signal] = "dropped"; 
        } else {
            newConnections[signal] = pins.length > 1 ? pins.join(',') : pins[0];
            pins.forEach(p => { pinsState[p] = { state: 'used', owner: modId, signal: signal }; });
            if (ifaceKey && (signal === 'SDA' || signal === 'SCL' || signal === 'MOSI' || signal === 'MISO' || signal === 'SCK' || signal === 'BCLK' || signal === 'LRC')) {
                if (!activeBuses[ifaceKey]) activeBuses[ifaceKey] = {};
                activeBuses[ifaceKey][signal] = Number(pins[0]);
            }
        }
    }
    const entry = { id: modId, interface: modData.interface, connections: newConnections, overrides: {} };
    activeModules.push(entry);
    // 应用该型号已保存的默认引脚勾选组合（自定义引线/勾选状态），并补分配扩展/自定义信号
    if (typeof applyPinPresetToMod === 'function') applyPinPresetToMod(entry);
    if (typeof presetExtraAllocate === 'function') presetExtraAllocate(entry, modData);
    if (typeof renderPins === 'function') renderPins();
    if (typeof renderModules === 'function') renderModules();
}

/* Wi-Fi/4G 与 ADC2 的系统级冲突检查：启用无线后 ADC2 被强制征用，模拟读数会失效 */
function checkWifiAdcConflict(modId) {
    const modData = moduleLibrary[modId];
    if (!modData) return;
    if (modData.uses_wifi) {
        for (const mod of activeModules) {
            const currentModData = moduleLibrary[mod.id];
            if (!currentModData) continue;
            if (currentModData.requires_adc) {
                for (const [signal, pinStr] of Object.entries(mod.connections)) {
                    const pins = String(pinStr).split(',').map(Number);
                    for (const p of pins) {
                        if (boardConfig.adcPins[p] && boardConfig.adcPins[p].startsWith('ADC2')) {
                            uiAlert({
                                title: '系统级致命冲突：WiFi 与 ADC2',
                                body: `检测到 Wi-Fi/4G 模组，但模拟传感器【${currentModData.name}】正占用 GPIO ${p}（${boardConfig.adcPins[p]}）。

开启无线后 ADC2 会被强制征用，模拟读数将全部失效。
请把该传感器换到 ADC1 引脚（GPIO 1~10）。`,
                                confirmText: '我知道了',
                                danger: true
                            });
                        }
                    }
                }
            }
        }
    }
}

function checkHighSpeedWarning() {
    let hasHighSpeed = false;
    activeModules.forEach(mod => {
        const modData = moduleLibrary[mod.id];
        for (const [signal, pinStr] of Object.entries(mod.connections)) {
            if (pinStr === "dropped") continue;
            const req = modData.requirements.find(r => r.signal === signal);
            if (req && req.high_speed) { hasHighSpeed = true; }
        }
    });
    return hasHighSpeed;
}
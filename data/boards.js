window.globalBoards = {
    // ==========================================
    // 型号 1: ESP32-S3-WROOM-1 N16R8 (裸板)
    // ==========================================
    "ESP32-S3-WROOM-1 N16R8": {
        "boardName": "ESP32-S3-WROOM-1 N16R8",
        // 本板对应的虾哥官方板型（仓库里的 main/boards/<dir>）。
        // 点「源码解析」时按这个目录精确锁定 config.h，不再靠板名里的 s3/cam/wroom 关键词瞎猜；
        // 接线图也按它的引脚来分配，才能「照图接线 → 直烧官方固件 → 一行源码都不用改」。
        // 换了屏或麦克风型号就该改这里，而不是去改虾哥的源码。
        "xiaozhi": {
            "dir": "main/boards/bread-compact-wifi-lcd",
            "boardId": "bread-compact-wifi-lcd",
            "label": "面包板 WiFi + LCD",
            "hardware": "ST7789 SPI 屏 + INMP441 麦 + MAX98357A 功放",
            "note": "官方这块板没有按键、没有摄像头；屏用 2.0 寸 ST7789 240x320 正对口",
            // 拿这个 id 去小智仓库搜（main/boards/ 下同名目录），排针定义、固件 build 名都对得上
            "search": "https://github.com/78/xiaozhi-esp32/tree/main/main/boards/bread-compact-wifi-lcd"
        },
        "safe_voltage": 3.3,
        "power_rails": { "5V": false, "3.3V": true },
        "max_current_ma": 450,
        "max_pin": 48,
        // 35/36/37：N16R8 的 Octal PSRAM 占用
        // 19/20 **不再硬锁**：它们是原生 USB 的 D-/D+，但芯片层面就是普通 GPIO，
        //   不接 USB 时完全可以拿来接外设（很多人的屏幕就这么接）。
        //   代价是失去这个 USB 口的串口/下载功能 —— 由诊断 W2 给告警，分配引擎用 usb 权重压到末位。
        // 1/2/13/14 在 WROOM 板上是空脚并已引出排针，实拍图可见 IO1/IO2/IO13/IO14，故不锁
        "fixedPins": [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37],
        "strappingPins": {
            "0": { "required_level": "HIGH", "reason": "下载模式选择" },
            "3": { "required_level": "HIGH", "reason": "JTAG 信号源选择" },
            "45": { "required_level": "LOW", "reason": "VDD_SPI 电压选择" },
            "46": { "required_level": "LOW", "reason": "启动模式选择" }
        },
        // N16R8 = ESP32-S3R8（VDD_SPI 3.3V），GPIO47/48 不是 1.8V 域；实拍图 GPIO48 直接驱动板载 WS2812
        "special_domains": {},
        // 实拍图右列第 14 针就是 IO0（旁边是 BOOT 按键），所以 0 可用（按 strapping 脚给启动告警）
        "availableGpios": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
        "adcPins": { "4": "ADC1_CH3", "5": "ADC1_CH4", "6": "ADC1_CH5", "7": "ADC1_CH6", "8": "ADC1_CH7", "9": "ADC1_CH8", "10": "ADC1_CH9", "11": "ADC2_CH0", "12": "ADC2_CH1", "13": "ADC2_CH2", "14": "ADC2_CH3", "15": "ADC2_CH4", "16": "ADC2_CH5", "17": "ADC2_CH6", "18": "ADC2_CH7" },
        "busPins": { "uart0": { "TX": 43, "RX": 44 }, "spi2": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 } },
        // ESP32-S3 IO_MUX 上直连 SPI2(FSPI) 的脚：CS0=10 / MOSI(D)=11 / SCK=12 / MISO(Q)=13 / WP=14 / HD=15
        // 只有落在这组脚上才能跑到 80MHz；经 GPIO 矩阵路由时 SPI 时钟上限约 40MHz（驱动 ST7789 足够）
        "ioMuxSpi": { "CS": 10, "MOSI": 11, "SCK": 12, "MISO": 13, "WP": 14, "HD": 15 },
        "defaultInterfaces": { "I2C": { "SDA": 8, "SCL": 9 }, "SPI": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 }, "I2S_IN": { "BCLK": 15, "LRC": 16, "SD": 17 }, "I2S_OUT": { "BCLK": 15, "LRC": 16, "DIN": 17 }, "UART": { "TX": 43, "RX": 44 } },
        "pinLayout": {
            // 实拍图 22 针/侧：左列 3V3→3V3→RST→IO4…IO14→5Vin→GND
            "left": ["3V3", "3V3", "RST", "4", "5", "6", "7", "15", "16", "17", "18", "8", "3", "46", "9", "10", "11", "12", "13", "14", "5VIN", "GND"],
            // 右列 GND→TX→RX→IO1…IO19→GND→GND（顶部 1 个 GND、底部 2 个 GND）
            "right": ["GND", "TX", "RX", "1", "2", "42", "41", "40", "39", "38", "37", "36", "35", "0", "45", "48", "47", "21", "20", "19", "GND", "GND"]
        },
        // 丝印旁的「说明文字」：实物只印 GPIO 数字，这里补的是芯片级事实（JTAG/PSRAM/USB/UART）
        // 注意极性：ESP32-S3 的 GPIO19 = USB_D-、GPIO20 = USB_D+
        "pinFunctions": {
            "19": "USB_D-", "20": "USB_D+",
            "35": "PSRAM", "36": "PSRAM", "37": "PSRAM",
            "39": "MTCK", "40": "MTDO", "41": "MTDI", "42": "MTMS",
            "43": "U0TXD", "44": "U0RXD"
        },
        "onboard_devices": [],
        "onboard_slots": []
    },

    // ==========================================
    // 型号 2: 果云 GOOUUU ESP32-S3-CAM (带摄像头开发板)
    // ==========================================
    "ESP32-S3 N16R8 CAM": {
        "boardName": "ESP32-S3 N16R8 CAM",
        // 本板对应的虾哥官方板型：带 OV5640 摄像头的那份 config.h
        "xiaozhi": {
            "dir": "main/boards/bread-compact-wifi-s3cam",
            "boardId": "bread-compact-wifi-s3cam",
            "label": "面包板 WiFi + S3 摄像头",
            "hardware": "ST7789 SPI 屏 + OV5640 摄像头 + INMP441 麦 + MAX98357A 功放",
            "note": "摄像头占用 GPIO4~18，屏只能走 GPIO19/20/21/45/47，背光 38",
            "search": "https://github.com/78/xiaozhi-esp32/tree/main/main/boards/bread-compact-wifi-s3cam"
        },
        "safe_voltage": 3.3,
        "power_rails": { "5V": true, "3.3V": true },
        "max_current_ma": 450, 
        "max_pin": 48,
        // 35/36/37：Octal PSRAM，动不得。
        // 19/20 = 原生 USB 的 D-/D+，芯片层面是普通 GPIO，不接 USB 时可以外接（代价见诊断 W2）。
        "fixedPins": [35, 36, 37], 
        "strappingPins": {
            "0": { "required_level": "HIGH", "reason": "下载模式选择" },
            "3": { "required_level": "HIGH", "reason": "JTAG 信号源选择" },
            "45": { "required_level": "LOW", "reason": "VDD_SPI 电压选择" },
            "46": { "required_level": "LOW", "reason": "启动模式选择" }
        },
        // N16R8 = ESP32-S3R8（VDD_SPI 3.3V），GPIO47/48 不是 1.8V 域
        "special_domains": {},
        // 实拍图：摄像头占用的 4~18 仍然引出到排针（和排线并联），但已被板载 OV5640 锁死，不可再分配；
        // GPIO3 在排针上（芯片层面是 ADC1_CH2 / strapping），可用，分配时会给出启动告警；
        // 右列第 8 针是 GPIO39（实拍丝印 36 37 38 39 40 41 连续），可用
        "availableGpios": [0, 1, 2, 3, 14, 19, 20, 21, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
        "adcPins": { "1": "ADC1_CH0", "2": "ADC1_CH1", "4": "ADC1_CH3", "5": "ADC1_CH4", "6": "ADC1_CH5", "7": "ADC1_CH6", "8": "ADC1_CH7", "9": "ADC1_CH8", "10": "ADC1_CH9", "11": "ADC2_CH0", "12": "ADC2_CH1", "13": "ADC2_CH2", "14": "ADC2_CH3", "15": "ADC2_CH4", "16": "ADC2_CH5", "17": "ADC2_CH6", "18": "ADC2_CH7", "19": "ADC2_CH8", "20": "ADC2_CH9" },
        "busPins": { "uart0": { "TX": 43, "RX": 44 }, "spi2": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 } },
        // IO_MUX 的 FSPI 脚（10~15）全部被板载摄像头排线占死，本板外接 SPI 设备只能走 GPIO 矩阵，
        // 实际可用时钟约 40MHz（ST7789 屏够用，跑到 80MHz 会花屏/丢帧）
        "ioMuxSpi": { "CS": 10, "MOSI": 11, "SCK": 12, "MISO": 13, "WP": 14, "HD": 15 },
        "ioMuxSpiBlocked": "本板 FSPI 专用脚（GPIO10~15）已全部被板载摄像头排线占用，无法改回",
        // 音频按官方 bread-compact-wifi-s3cam 的 config.h 对齐（Simplex 单工，双总线）：
        //   MIC WS=IO1 / SCK=IO2 / DIN=IO42      SPK BCLK=IO40 / LRCK=IO41 / DOUT=IO39
        // I2S_IN 与 I2S_OUT 时钟不同 → 分配引擎会把它们当两条独立总线，不会让功放去复用麦克风的时钟
        "defaultInterfaces": { "I2C": { "SDA": 42, "SCL": 41 }, "SPI": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 }, "I2S_IN": { "BCLK": 2, "LRC": 1, "SD": 42 }, "I2S_OUT": { "BCLK": 40, "LRC": 41, "DIN": 39 }, "UART": { "TX": 43, "RX": 44 } },
        "pinLayout": {
            // 实拍图 20 针/侧：左列 3V3→EN→GPIO4…GPIO8→GPIO3→GPIO46→…→GPIO14→5V（到底就是 5V，没有 GND）
            "left": ["3V3", "EN", "4", "5", "6", "7", "15", "16", "17", "18", "8", "3", "46", "9", "10", "11", "12", "13", "14", "5V"],
            // 右列 TX→RX→IO1…→GPIO40→**GPIO39**→GPIO38…→GPIO19→GND
            // CAM 版是 WROOM 的裁剪版：去掉左侧第 2 个 3V3、左侧底部 GND、右侧顶部 GND 和右侧底部重复 GND，
            // 22−2 = 20 针/侧；RST 在 CAM 上丝印为 EN。顶部两个脚印的是 TX/RX（即 UART0 的 43/44），不是数字丝印
            "right": ["TX", "RX", "1", "2", "42", "41", "40", "39", "38", "37", "36", "35", "0", "45", "48", "47", "21", "20", "19", "GND"]
        },
        // 说明文字：摄像头各脚（4~18）直接按 onboard_slots.camera.lockedPins 推导，不另写一份，
        // 免得两处不一致；其余为芯片级事实。
        "pinFunctions": {
            "1": "ADC1_CH0", "2": "ADC1_CH1", "3": "ADC1_CH2",
            "4": "CAM_SIOD", "5": "CAM_SIOC", "6": "CAM_VSYNC", "7": "CAM_HREF",
            "8": "CAM_D2", "9": "CAM_D1", "10": "CAM_D3", "11": "CAM_D0",
            "12": "CAM_D4", "13": "CAM_PCLK", "15": "CAM_XCLK",
            "16": "CAM_D7", "17": "CAM_D6", "18": "CAM_D5",
            "19": "USB_D-", "20": "USB_D+",
            "35": "PSRAM", "36": "PSRAM", "37": "PSRAM",
            "39": "MTCK", "40": "MTDO", "41": "MTDI", "42": "MTMS",
            "43": "U0TXD", "44": "U0RXD"
        },
        "onboard_devices": [
            { "id": "ov5640", "name": "OV5640 摄像头 (板载/已焊接)", "priority": 100, "peak_current_ma": 240 }
        ],
        "onboard_slots": [
            {
                "slotId": "camera", "label": "板载摄像头插槽", "moduleId": "ov5640", "candidates": ["ov5640", "ov2640"], "replaceable": true, "soldered": true,
                "lockedPins": { "SDA": 4, "SCL": 5, "XCLK": 15, "PCLK": 13, "VSYNC": 6, "HREF": 7, "D0-D7": [11, 9, 8, 10, 12, 18, 17, 16] }
            }
        ]
    }
};
window.globalModuleData = {
    // --- 显示类 ---
    "i2c_oled": {
        "name": "0.96寸 OLED (I2C)", "category": "显示类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 20, "priority": 20,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up", "requires_output": true },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up", "requires_output": true }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ],
        // 0.96寸 4pin 排针最常见丝印序：GND → VCC → SCL → SDA（与 2.0寸 TFT 同款布局）
        "pinOrder": ["GND", "VCC", "SCL", "SDA"]
    },
    "spi_tft": {
        "name": "2.0寸 TFT IPS 彩屏 (8PIN)", "category": "显示类", "interface": "SPI", "signal_voltage": 3.3,
        "peak_current_ma": 120, "priority": 90,
        // 画布顺序按「背面丝印读序」排列：这块屏的丝印在背面，插在面包板上时看不见，
        // 拔起来翻面核对时（BL 正读方向）从左到右是 BL→CS→DC→RST→SDA→SCL→VCC→GND，
        // 画布顺序与其一致，翻面对照不用再脑内左右镜像。
        // 丝印对照：SDA = SPI MOSI、SCL = SPI SCK（屏只写不读，没有 MISO/DOUT 脚）
        //   RES = 复位（低有效）/ DC = 数据命令选择 / CS = 片选（低有效）/ BL = 背光使能（高亮，画布名 BLK）
        // 部分 7 针版本省掉 BLK（背光在模组内部直接常亮），此时把 BLK 那一路忽略即可
        "requirements": [
            { "signal": "SCK", "label": "SCL", "aliases": ["SCLK", "CLK"], "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "MOSI", "label": "SDA", "aliases": ["SDIN", "DIN"], "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "RST", "label": "RES", "aliases": ["RESET"], "count": 1, "optional": false, "requires_output": true },
            { "signal": "DC", "label": "DC", "aliases": ["D/C", "RS", "A0"], "count": 1, "optional": false, "requires_output": true },
            { "signal": "CS", "label": "CS", "aliases": ["SS", "CE", "NSS"], "count": 1, "optional": false, "requires_output": true }
        ],
        "power_pins": [
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND，必须与主板共地（SCL/SDA 的参考地）" },
            { "pin": "VCC", "connect_to": "3.3V", "warning": "仕样书标 3.3V，屏上一般不带 LDO，接 5V 会直接烧屏" },
            { "pin": "BLK", "connect_to": "3.3V", "warning": "背光使能，高电平点亮：接 3.3V = 常亮（仕样书写明默认点亮）；需 PWM 调光请改接 GPIO，背光电流超过 20mA 必须经三极管/MOS 驱动，不能直驱" }
        ],
        "pinOrder": ["BLK", "CS", "DC", "RST", "MOSI", "SCK", "VCC", "GND"]
    },

    // --- 传感器类 ---
    "dht11": {
        "name": "DHT11 温湿度传感器", "category": "传感器类", "interface": "GPIO", "signal_voltage": 3.3,
        "peak_current_ma": 5, "priority": 50,
        "requirements": [{ "signal": "DATA", "count": 1, "optional": false }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ],
        // 3针 DHT11 模块排针：VCC → DATA → GND；4针裸件中间是 NC
        "pinOrder": ["VCC", "DATA", "GND"]
    },
    "aht20": {
        "name": "AHT20 温湿度 (I2C)", "category": "传感器类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 1, "priority": 20,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up" },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up" }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ],
        // GY 系列 I2C 小板常见丝印序：VIN → GND → SCL → SDA（AHT20/BMP280 同款）
        "pinOrder": ["VCC", "GND", "SCL", "SDA"]
    },
    "mpu6050": {
        "name": "MPU6050 六轴 (I2C)", "category": "传感器类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 4, "priority": 20,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up" },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up" }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ],
        // GY-521 的 8pin 排针：VCC → GND → SCL → SDA → XDA → XCL → AD0 → INT（后四脚本库未建）
        "pinOrder": ["VCC", "GND", "SCL", "SDA"]
    },
    "ldr_sensor": {
        "name": "光敏电阻传感器 (模拟)", "category": "传感器类", "interface": "ADC", "signal_voltage": 3.3,
        "peak_current_ma": 1, "requires_adc": true, "priority": 50,
        "requirements": [{ "signal": "AOUT", "count": 1, "optional": false }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ],
        // 常见光敏 4pin 板：VCC → GND → DO → AO（本库只建了 AO 一路，实物丝印 AO）
        "pinOrder": ["VCC", "GND", "AOUT"]
    },

    // --- 视觉类 ---
    "ov2640": {
        "name": "OV2640 摄像头 (DVP)", "category": "视觉类", "interface": "DVP", "signal_voltage": 3.3,
        "peak_current_ma": 200, "priority": 100,
        "can_downgrade": true,
        "downgrade_rule": { 
            "signal": "D0-D7", 
            "from_count": 8, 
            "to_count": 4, 
            "warning": "降级为 4 位数据模式将导致摄像头分辨率降低，但能节省 4 个宝贵的 GPIO 引脚。" 
        },
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false }, 
            { "signal": "SCL", "count": 1, "optional": false },
            { "signal": "XCLK", "count": 1, "optional": false, "high_speed": true }, 
            { "signal": "PCLK", "count": 1, "optional": false, "high_speed": true },
            { "signal": "VSYNC", "count": 1, "optional": false }, 
            { "signal": "HREF", "count": 1, "optional": false },
            { "signal": "D0-D7", "count": 8, "optional": false, "high_speed": true }
        ],
        "preferredPins": [4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },
    "ov5640": {
        "name": "OV5640 摄像头 (DVP)", "category": "视觉类", "interface": "DVP", "signal_voltage": 3.3,
        "peak_current_ma": 240, "priority": 100,
        "can_downgrade": true,
        "downgrade_rule": { 
            "signal": "D0-D7", 
            "from_count": 8, 
            "to_count": 4, 
            "warning": "OV5640 降为 4 位数据模式后带宽减半，500 万像素下帧率会明显下降（高分辨率下尤为明显）。" 
        },
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false }, 
            { "signal": "SCL", "count": 1, "optional": false },
            { "signal": "XCLK", "count": 1, "optional": false, "high_speed": true }, 
            { "signal": "PCLK", "count": 1, "optional": false, "high_speed": true },
            { "signal": "VSYNC", "count": 1, "optional": false }, 
            { "signal": "HREF", "count": 1, "optional": false },
            { "signal": "D0-D7", "count": 8, "optional": false, "high_speed": true }
        ],
        "preferredPins": [4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "OV5640 峰值电流更高，CAM 板务必确认 3.3V LDO 余量充足" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },

    // --- 音频类 ---
    "mic_inmp441": {
        "name": "INMP441 麦克风 (I2S)", "category": "音频类", "interface": "I2S_IN", "signal_voltage": 3.3,
        "peak_current_ma": 3, "priority": 80,
        // 模组丝印 SCK/WS 即 ESP32 侧的 I2S BCLK/LRC；SD 是麦克风的数据输出
        "requirements": [
            { "signal": "BCLK", "label": "SCK", "aliases": ["SCLK"], "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "LRC", "label": "WS", "aliases": ["LRCLK"], "count": 1, "optional": false, "requires_output": true },
            { "signal": "SD", "label": "SD", "aliases": ["DOUT", "DIN", "OUT", "IN"], "count": 1, "optional": false, "high_speed": true } 
        ],
        "local_links": [
            { "from": "L/R", "to": "GND", "reason": "L/R 接地 = 左声道输出（接 VCC 则右声道）" }
        ],
        "power_pins": [
            { "pin": "VCC", "label": "VDD", "connect_to": "3.3V", "warning": "输入 1.8~3.3V，接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ],
        // 实物为 14mm 圆形板，6 孔分两排（3+3），丝印在背面。按「SD/VDD/GND 正读」方向核对时：
        //   上排（左→右）：L/R → WS → SCK；下排（左→右）：SD → VDD → GND
        // 画布按两排连读顺序排列，翻面对照时与实物一一对应，不用再脑内镜像。
        // 丝印 VDD 即画布的 VCC；SCK/WS 即 ESP32 侧 I2S 的 BCLK/LRC（画布按 label 显示 SCK/WS）
        "pinOrder": ["L/R", "LRC", "BCLK", "SD", "VCC", "GND"]
    },
    "max98357a": {
        "name": "MAX98357A 功放 (I2S)", "category": "音频类", "interface": "I2S_OUT", "signal_voltage": 3.3,
        "peak_current_ma": 300, "priority": 85,
        // 实物 7 脚：VCC / GND / SD / GAIN / DIN / BCLK / LRC（没有 VIN 脚）
        // 画布顺序按「正面丝印读序」从左到右：LRC → BCLK → DIN → GAIN → SD → GND → VIN
        // （这块板丝印在正面，插在面包板上直接可见，无需翻面；VCC 即实物丝印 VIN。
        //   丝印分两行交错标注：上行 LRC/DIN/SD/VIN 标奇数位 1/3/5/7，下行 BCLK/GAIN/GND 标偶数位 2/4/6）
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false, "high_speed": true, "requires_output": true, "aliases": ["SCK", "SCLK"] },
            { "signal": "LRC", "count": 1, "optional": false, "requires_output": true, "aliases": ["WS", "LRCLK"] },
            { "signal": "DIN", "count": 1, "optional": false, "high_speed": true, "requires_output": true, "aliases": ["DOUT", "SDATA"] }
        ],
        "local_links": [
            { "from": "SD", "to": "VCC", "reason": "SD 拉高 = 常开；拉低则器件进入关断" },
            { "from": "GAIN", "to": "GND", "reason": "GAIN 接地 = 15dB 最大增益（悬空 9dB / 接 VCC 3dB）" }
        ],
        "power_pins": [
            { "pin": "VCC", "label": "VIN", "connect_to": "5V", "warning": "DC 2.5~5.5V，推荐 5V（4Ω 3.2W / 8Ω 1.8W）；超载必须接外部独立 5V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND / 外部供电时须与主控共地" }
        ],
        "pinOrder": ["LRC", "BCLK", "DIN", "GAIN", "SD", "GND", "VCC"]
    },

    // --- 通信类 ---
    "wifi_module": {
        "name": "Wi-Fi 射频模块 (内置)", "category": "通信类", "interface": "INTERNAL", "signal_voltage": 3.3,
        "peak_current_ma": 250, "uses_wifi": true, "priority": 10,
        "requirements": [],
        "power_pins": []
    },
    "4g_module": {
        "name": "4G 通信模组 (Cat.1)", "category": "通信类", "interface": "UART", "signal_voltage": 3.3,
        "peak_current_ma": 500, "uses_wifi": true, "priority": 60,
        "requirements": [
            { "signal": "TX", "count": 1, "optional": false },
            { "signal": "RX", "count": 1, "optional": false },
            { "signal": "PWRKEY", "count": 1, "optional": true }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "5V", "warning": "接主板 5V / 强烈建议外部独立大电流供电" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND / 外部供电时须与主控共地" }
        ]
    },

    // --- 执行器类 ---
    "relay_low_trigger": {
        "name": "低电平触发继电器", "category": "执行器类", "interface": "GPIO", "signal_voltage": 3.3,
        "peak_current_ma": 70, "priority": 40,
        "requirements": [{ "signal": "IN", "count": 1, "optional": false, "default_state": "LOW", "requires_output": true }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "5V", "warning": "接主板 5V / 外部 5V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ],
        // 常见继电器小板 3pin：VCC → GND → IN
        "pinOrder": ["VCC", "GND", "IN"]
    },
    "sg90_servo": {
        "name": "SG90 舵机 (PWM)", "category": "执行器类", "interface": "PWM", "signal_voltage": 3.3,
        "peak_current_ma": 700, "priority": 50,
        "requirements": [{ "signal": "PWM", "count": 1, "optional": false, "requires_output": true }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "5V", "warning": "接主板 5V / 必须外部独立 5V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND / 外部供电时须与主控共地" }
        ],
        // SG90 三根线（棕红橙）：橙=信号 PWM → 红=VCC → 棕=GND
        "pinOrder": ["PWM", "VCC", "GND"]
    }
};
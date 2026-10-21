window.globalModuleData = {
    // --- 显示类 ---
    "i2c_oled": {
        "name": "0.96寸 OLED (I2C)", "category": "显示类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 20,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up", "requires_output": true },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up", "requires_output": true }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },
    "spi_tft": {
        "name": "2.0寸 TFT IPS 彩屏", "category": "显示类", "interface": "SPI", "signal_voltage": 3.3,
        "peak_current_ma": 180,
        "requirements": [
            { "signal": "MOSI", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "SCK", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "CS", "count": 1, "optional": false, "requires_output": true },
            { "signal": "DC", "count": 1, "optional": false, "requires_output": true },
            { "signal": "RST", "count": 1, "optional": true, "requires_output": true },
            { "signal": "BLK", "count": 1, "optional": true, "requires_output": true }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V（耗电较大）/ 建议接外部独立 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },

    // --- 传感器类 ---
    "dht11": {
        "name": "DHT11 温湿度传感器", "category": "传感器类", "interface": "GPIO", "signal_voltage": 3.3,
        "peak_current_ma": 5,
        "requirements": [{ "signal": "DATA", "count": 1, "optional": false }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },
    "aht20": {
        "name": "AHT20 温湿度 (I2C)", "category": "传感器类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 1,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up" },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up" }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },
    "mpu6050": {
        "name": "MPU6050 六轴 (I2C)", "category": "传感器类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 4,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up" },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up" }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },
    "ldr_sensor": {
        "name": "光敏电阻传感器 (模拟)", "category": "传感器类", "interface": "ADC", "signal_voltage": 3.3,
        "peak_current_ma": 1, "requires_adc": true,
        "requirements": [{ "signal": "AOUT", "count": 1, "optional": false }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },

    // --- 视觉类 ---
    "ov2640": {
        "name": "OV2640 摄像头 (DVP)", "category": "视觉类", "interface": "DVP", "signal_voltage": 3.3,
        "peak_current_ma": 200,
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

    // --- 音频类 ---
    "mic_inmp441": {
        "name": "INMP441 麦克风 (I2S)", "category": "音频类", "interface": "I2S_IN", "signal_voltage": 3.3,
        "peak_current_ma": 3,
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "LRC", "count": 1, "optional": false, "requires_output": true },
            { "signal": "SD", "count": 1, "optional": false, "high_speed": true } 
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "3.3V", "warning": "接主板 3.3V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },
    "max98357a": {
        "name": "MAX98357A 功放 (I2S)", "category": "音频类", "interface": "I2S_OUT", "signal_voltage": 3.3,
        "peak_current_ma": 300,
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "LRC", "count": 1, "optional": false, "requires_output": true },
            { "signal": "DIN", "count": 1, "optional": false, "high_speed": true, "requires_output": true }
        ],
        "power_pins": [
            { "pin": "VCC", "connect_to": "5V", "warning": "可接主板 5V / 超载时必须接外部独立 5V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND / 外部供电时须与主控共地" }
        ]
    },

    // --- 通信类 ---
    "wifi_module": {
        "name": "Wi-Fi 射频模块 (内置)", "category": "通信类", "interface": "INTERNAL", "signal_voltage": 3.3,
        "peak_current_ma": 250, "uses_wifi": true,
        "requirements": [],
        "power_pins": []
    },
    "4g_module": {
        "name": "4G 通信模组 (Cat.1)", "category": "通信类", "interface": "UART", "signal_voltage": 3.3,
        "peak_current_ma": 500, "uses_wifi": true,
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
        "peak_current_ma": 70,
        "requirements": [{ "signal": "IN", "count": 1, "optional": false, "default_state": "LOW", "requires_output": true }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "5V", "warning": "接主板 5V / 外部 5V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND" }
        ]
    },
    "sg90_servo": {
        "name": "SG90 舵机 (PWM)", "category": "执行器类", "interface": "PWM", "signal_voltage": 3.3,
        "peak_current_ma": 700,
        "requirements": [{ "signal": "PWM", "count": 1, "optional": false, "requires_output": true }],
        "power_pins": [
            { "pin": "VCC", "connect_to": "5V", "warning": "接主板 5V / 必须外部独立 5V" },
            { "pin": "GND", "connect_to": "GND", "warning": "接主板 GND / 外部供电时须与主控共地" }
        ]
    }
};
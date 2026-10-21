window.globalModuleData = {
    // --- 显示类 (需要输出) ---
    "i2c_oled": {
        "name": "0.96寸 OLED (I2C)", "category": "📺 显示类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 20,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up", "requires_output": true },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up", "requires_output": true }
        ]
    },
    "spi_tft": {
        "name": "2.0寸 TFT IPS 彩屏", "category": "📺 显示类", "interface": "SPI", "signal_voltage": 3.3,
        "peak_current_ma": 180,
        "requirements": [
            { "signal": "MOSI", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "SCK", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "CS", "count": 1, "optional": false, "requires_output": true },
            { "signal": "DC", "count": 1, "optional": false, "requires_output": true },
            { "signal": "RST", "count": 1, "optional": true, "requires_output": true },
            { "signal": "BLK", "count": 1, "optional": true, "requires_output": true }
        ]
    },

    // --- 传感器类 (大多只读) ---
    "dht11": {
        "name": "DHT11 温湿度传感器", "category": "🌡️ 传感器类", "interface": "GPIO", "signal_voltage": 3.3,
        "peak_current_ma": 5,
        "requirements": [{ "signal": "DATA", "count": 1, "optional": false }]
    },
    "ldr_sensor": {
        "name": "光敏电阻传感器 (模拟)", "category": "🌡️ 传感器类", "interface": "ADC", "signal_voltage": 3.3,
        "peak_current_ma": 1, "requires_adc": true,
        "requirements": [{ "signal": "AOUT", "count": 1, "optional": false }]
    },

    // --- 通信类 ---
    "wifi_module": {
        "name": "Wi-Fi 射频模块 (内置)", "category": "📡 通信类", "interface": "INTERNAL", "signal_voltage": 3.3,
        "peak_current_ma": 250, "uses_wifi": true,
        "requirements": []
    },

    // --- 执行器类 (强需求输出) ---
    "relay_low_trigger": {
        "name": "低电平触发继电器", "category": "⚙️ 执行器类", "interface": "GPIO", "signal_voltage": 3.3,
        "peak_current_ma": 70,
        "requirements": [{ "signal": "IN", "count": 1, "optional": false, "default_state": "LOW", "requires_output": true }]
    },

    // --- 音频类 ---
    "mic_inmp441": {
        "name": "INMP441 麦克风 (I2S)", "category": "🎵 音频类", "interface": "I2S_IN", "signal_voltage": 3.3,
        "peak_current_ma": 3,
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "LRC", "count": 1, "optional": false, "requires_output": true },
            { "signal": "SD", "count": 1, "optional": false, "high_speed": true } 
        ]
    },
    "max98357a": {
        "name": "MAX98357A 功放 (I2S)", "category": "🎵 音频类", "interface": "I2S_OUT", "signal_voltage": 3.3,
        "peak_current_ma": 300,
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false, "high_speed": true, "requires_output": true },
            { "signal": "LRC", "count": 1, "optional": false, "requires_output": true },
            { "signal": "DIN", "count": 1, "optional": false, "high_speed": true, "requires_output": true }
        ]
    }
};
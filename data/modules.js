window.globalModuleData = {
    // --- 显示类 ---
    "i2c_oled": {
        "name": "0.96寸 OLED (I2C)", "category": "📺 显示类", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 20,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up" },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up" }
        ]
    },
    "spi_tft": {
        "name": "2.0寸 TFT IPS 彩屏", "category": "📺 显示类", "interface": "SPI", "signal_voltage": 3.3,
        "peak_current_ma": 180,
        "requirements": [
            { "signal": "MOSI", "count": 1, "optional": false, "high_speed": true },
            { "signal": "SCK", "count": 1, "optional": false, "high_speed": true },
            { "signal": "CS", "count": 1, "optional": false },
            { "signal": "DC", "count": 1, "optional": false },
            { "signal": "RST", "count": 1, "optional": true },
            { "signal": "BLK", "count": 1, "optional": true }
        ]
    },

    // --- 传感器类 ---
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

    // --- 执行器类 (测试极性拦截) ---
    "relay_low_trigger": {
        "name": "低电平触发继电器", "category": "⚙️ 执行器类", "interface": "GPIO", "signal_voltage": 3.3,
        "peak_current_ma": 70,
        "requirements": [{ "signal": "IN", "count": 1, "optional": false, "default_state": "LOW" }]
    }
};
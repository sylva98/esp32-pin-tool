window.globalModuleData = {
    // --- 基础与视觉 ---
    "i2c_oled": {
        "name": "0.96寸 OLED (I2C)", "interface": "I2C", "signal_voltage": 3.3,
        "peak_current_ma": 20,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up" },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up" }
        ]
    },
    "lcd_1_5_spi": {
        "name": "1.5寸 LCD 彩屏 (SPI)", "interface": "SPI", "signal_voltage": 3.3,
        "peak_current_ma": 120,
        "requirements": [
            { "signal": "MOSI", "count": 1, "optional": false },
            { "signal": "SCK", "count": 1, "optional": false },
            { "signal": "CS", "count": 1, "optional": false },
            { "signal": "DC", "count": 1, "optional": false },
            { "signal": "RST", "count": 1, "optional": true, "internal_pull": "up" },
            { "signal": "BLK", "count": 1, "optional": true }
        ]
    },
    "dht11": {
        "name": "DHT11 温湿度传感器", "interface": "GPIO", "signal_voltage": 3.3,
        "peak_current_ma": 5,
        "requirements": [{ "signal": "DATA", "count": 1, "optional": false }]
    },
    "ov2640": {
        "name": "OV2640 摄像头 (DVP)", "interface": "DVP", "signal_voltage": 3.3,
        "peak_current_ma": 200,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false }, { "signal": "SCL", "count": 1, "optional": false },
            { "signal": "XCLK", "count": 1, "optional": false }, { "signal": "PCLK", "count": 1, "optional": false },
            { "signal": "VSYNC", "count": 1, "optional": false }, { "signal": "HREF", "count": 1, "optional": false },
            { "signal": "D0-D7", "count": 8, "optional": false }
        ],
        "preferredPins": [4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18]
    },

    // --- 音频模块 ---
    "mic_inmp441": {
        "name": "INMP441 麦克风 (I2S)", "interface": "I2S_IN", "signal_voltage": 3.3,
        "peak_current_ma": 10,
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false },
            { "signal": "LRC", "count": 1, "optional": false },
            { "signal": "SD", "count": 1, "optional": false }
        ]
    },
    "max98357a": {
        "name": "MAX98357A 功放 (I2S)", "interface": "I2S_OUT", "signal_voltage": 3.3,
        "peak_current_ma": 300,
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false },
            { "signal": "LRC", "count": 1, "optional": false },
            { "signal": "DIN", "count": 1, "optional": false }
        ]
    },
    "ht517_amp": {
        "name": "HT517 音频功放 (I2S)", "interface": "I2S_OUT", "signal_voltage": 3.3,
        "peak_current_ma": 150,
        "requirements": [
            { "signal": "BCLK", "count": 1, "optional": false },
            { "signal": "LRC", "count": 1, "optional": false },
            { "signal": "DIN", "count": 1, "optional": false }
        ]
    },

    // --- 通信模块 ---
    "4g_module": {
        "name": "4G 通信模组 (Cat.1)", "interface": "UART", "signal_voltage": 3.3,
        "peak_current_ma": 500,
        "requirements": [
            { "signal": "TX", "count": 1, "optional": false },
            { "signal": "RX", "count": 1, "optional": false },
            { "signal": "PWRKEY", "count": 1, "optional": true }
        ]
    }
};
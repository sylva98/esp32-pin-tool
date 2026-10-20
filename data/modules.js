window.globalModuleData = {
    "i2c_oled": {
        "name": "0.96寸 OLED (I2C)", "interface": "I2C", "signal_voltage": 3.3,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false, "internal_pull": "up" },
            { "signal": "SCL", "count": 1, "optional": false, "internal_pull": "up" }
        ]
    },
    "spi_tft": {
        "name": "SPI TFT 屏幕", "interface": "SPI", "signal_voltage": 3.3,
        "requirements": [
            { "signal": "MOSI", "count": 1, "optional": false }, { "signal": "SCK", "count": 1, "optional": false },
            { "signal": "CS", "count": 1, "optional": false }, { "signal": "DC", "count": 1, "optional": false },
            { "signal": "RST", "count": 1, "optional": true, "internal_pull": "up" }
        ]
    },
    "dht11": {
        "name": "DHT11 温湿度传感器", "interface": "GPIO", "signal_voltage": 3.3,
        "requirements": [{ "signal": "DATA", "count": 1, "optional": false }]
    },
    "ov2640": {
        "name": "OV2640 摄像头 (DVP)", "interface": "DVP", "signal_voltage": 3.3,
        "requirements": [
            { "signal": "SDA", "count": 1, "optional": false }, { "signal": "SCL", "count": 1, "optional": false },
            { "signal": "XCLK", "count": 1, "optional": false }, { "signal": "PCLK", "count": 1, "optional": false },
            { "signal": "VSYNC", "count": 1, "optional": false }, { "signal": "HREF", "count": 1, "optional": false },
            { "signal": "D0-D7", "count": 8, "optional": false }
        ],
        "preferredPins": [4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18]
    },
    "relay_5v": {
        "name": "5V 继电器模块", "interface": "GPIO", "signal_voltage": 5,
        "requirements": [{ "signal": "IN", "count": 1, "optional": false, "internal_pull": "down" }]
    }
};
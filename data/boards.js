window.globalBoards = {
    "ESP32-S3-WROOM-1 N16R8": {
        "boardName": "ESP32-S3-WROOM-1 N16R8",
        "safe_voltage": 3.3,
        "power_rails": { "5V": false, "3.3V": true },
        "max_current_ma": 450,
        "max_pin": 48,
        "fixedPins": [1, 2, 3, 13, 14, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 41],
        "strappingPins": {
            "0": { "required_level": "HIGH", "reason": "下载模式选择" },
            "3": { "required_level": "HIGH", "reason": "JTAG 信号源选择" },
            "45": { "required_level": "LOW", "reason": "VDD_SPI 电压选择" },
            "46": { "required_level": "LOW", "reason": "启动模式选择" }
        },
        "special_domains": { "47": "1.8V", "48": "1.8V" },
        "availableGpios": [4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 21, 38, 39, 40, 42, 43, 44, 45, 46, 47, 48],
        "adcPins": {
            "1": "ADC1_CH0", "2": "ADC1_CH1", "3": "ADC1_CH2", "4": "ADC1_CH3",
            "5": "ADC1_CH4", "6": "ADC1_CH5", "7": "ADC1_CH6", "8": "ADC1_CH7",
            "9": "ADC1_CH8", "10": "ADC1_CH9",
            "11": "ADC2_CH0", "12": "ADC2_CH1", "13": "ADC2_CH2", "14": "ADC2_CH3",
            "15": "ADC2_CH4", "16": "ADC2_CH5", "17": "ADC2_CH6", "18": "ADC2_CH7",
            "19": "ADC2_CH8", "20": "ADC2_CH9"
        },
        "busPins": {
            "uart0": { "TX": 43, "RX": 44 },
            "spi2": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 }
        },
        "defaultInterfaces": { 
            "I2C": { "SDA": 8, "SCL": 9 }, 
            "SPI": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 },
            "I2S_IN": { "BCLK": 15, "LRC": 16, "SD": 17 },
            "I2S_OUT": { "BCLK": 15, "LRC": 16, "DIN": 17 },
            "UART": { "TX": 43, "RX": 44 }
        }
    },
    "ESP32-C3": {
        "boardName": "ESP32-C3 (RISC-V)",
        "safe_voltage": 3.3,
        "power_rails": { "5V": false, "3.3V": true },
        "max_current_ma": 400,
        "max_pin": 21,
        "fixedPins": [11, 12, 13, 14, 15, 16, 17], 
        "strappingPins": {
            "2": { "required_level": "HIGH", "reason": "启动模式选择" },
            "8": { "required_level": "HIGH", "reason": "启动模式选择" },
            "9": { "required_level": "HIGH", "reason": "默认上拉，下载模式" }
        },
        "special_domains": {},
        "availableGpios": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21],
        "adcPins": {
            "0": "ADC1_CH0", "1": "ADC1_CH1", "2": "ADC1_CH2", "3": "ADC1_CH3", "4": "ADC1_CH4"
        },
        "busPins": {
            "uart0": { "TX": 21, "RX": 20 },
            "spi2": { "MOSI": 6, "MISO": 2, "SCK": 4, "CS": 7 }
        },
        "defaultInterfaces": { 
            "I2C": { "SDA": 5, "SCL": 6 }, 
            "SPI": { "MOSI": 6, "MISO": 2, "SCK": 4, "CS": 7 },
            "UART": { "TX": 21, "RX": 20 }
        }
    },
    "ESP32-S2": {
        "boardName": "ESP32-S2 (Xtensa LX7)",
        "safe_voltage": 3.3,
        "power_rails": { "5V": false, "3.3V": true },
        "max_current_ma": 400,
        "max_pin": 46,
        "fixedPins": [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46],
        "strappingPins": {
            "0": { "required_level": "HIGH", "reason": "启动模式选择" },
            "45": { "required_level": "LOW", "reason": "VDD_SPI 电压选择" },
            "46": { "required_level": "LOW", "reason": "仅输入引脚，不可输出" }
        },
        "special_domains": {},
        "availableGpios": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        "adcPins": {
            "1": "ADC1_CH0", "2": "ADC1_CH1", "3": "ADC1_CH2", "4": "ADC1_CH3",
            "5": "ADC1_CH4", "6": "ADC1_CH5", "7": "ADC1_CH6", "8": "ADC1_CH7",
            "9": "ADC1_CH8", "10": "ADC1_CH9",
            "11": "ADC2_CH0", "12": "ADC2_CH1", "13": "ADC2_CH2", "14": "ADC2_CH3",
            "15": "ADC2_CH4", "16": "ADC2_CH5", "17": "ADC2_CH6", "18": "ADC2_CH7",
            "19": "ADC2_CH8", "20": "ADC2_CH9"
        },
        "busPins": {
            "uart0": { "TX": 43, "RX": 44 },
            "spi2": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 }
        },
        "defaultInterfaces": { 
            "I2C": { "SDA": 8, "SCL": 9 }, 
            "SPI": { "MOSI": 11, "MISO": 13, "SCK": 12, "CS": 10 },
            "UART": { "TX": 43, "RX": 44 }
        }
    }
};
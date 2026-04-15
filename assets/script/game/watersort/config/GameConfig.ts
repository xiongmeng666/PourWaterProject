import { Color } from 'cc';

/**
 * 游戏全局配置表
 */
export const GameConfig = {
    // --- 核心规则配置 ---
    
    /** 每个瓶子的最大容量（水层数） */
    MaxLayers: 4,
    
    /** 每次开局默认留给玩家操作的空瓶数量 */
    EmptyBottleCount: 2,
    
    /** 打乱算法的默认逆向推导步数（决定打乱的碎裂程度） */
    ShuffleSteps: 150,

    // --- 美术与视觉配置 ---

    /** 游戏全局颜色库 */
    Colors: [
        new Color().fromHEX('#FFB6C1'), // 0: 粉色 Pink
        new Color().fromHEX('#87CEFA'), // 1: 浅蓝 LightBlue
        new Color().fromHEX('#98FB98'), // 2: 浅绿 LightGreen
        new Color().fromHEX('#FFFACD'), // 3: 鹅黄 LightYellow
        new Color().fromHEX('#E6E6FA'), // 4: 薰衣草紫 Lavender
        new Color().fromHEX('#FFDAB9'), // 5: 蜜桃色 Peach
    ],
};
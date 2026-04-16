import { Color } from 'cc';
import { GameConfig } from '../config/GameConfig';

// 移动历史的数据结构 （用于回撤）
type MoveHistory = {
    /** 倒出水的瓶子索引 (源瓶 A) */
    fromIdx: number,
    /** 接收水的瓶子索引 (目标瓶 B) */
    toIdx: number,
    /** 本次倒出的水的颜色 */
    color: Color,
    /** 本次实际倒过去了几层水块 */
    count: number,
    /** 倒水前，源瓶 (A) 里原本有几层水（用于撤回时精确定位水面初始高度） */
    oldFromCount: number,
    /** 倒水前，目标瓶 (B) 里原本有几层水（用于撤回时精确定位水面初始高度） */
    oldToCount: number
};


/**
 * 游戏核心数据与算法模型
 * * 【核心职责】
 * 1. 纯数据维护：管理游戏中所有瓶子的颜色二维数组结构、维护玩家的操作历史栈（用于完美撤回）。
 * 2. 核心算法库：负责逆向推导生成 100% 有解的随机关卡、执行同色抽水算法、执行道具打乱算法。
 * 3. 规则校验器：提供“是否允许倒水”、“是否已满瓶通关”等业务规则的最终裁定。
 */
export class GameModel {
    /**【核心数据】：二维数组，描述每个瓶子里从底到顶的颜色排布 */ 
    public bottleDatas: Color[][] = [];

    /** 【状态数据】：历史记录栈，用于撤回 (Undo) */ 
    private _history: MoveHistory[] = [];

    // 【用于结算展示】
    /** 本局总步数 */
    public moveCount: number = 0;
    /** 本局撤回次数 */
    public undoCount: number = 0;
    /** 本局开始时间戳 */
    public startTime: number = 0;

    /**
     * [算法] 逆向推导法生成关卡数据
     * 保证生成的关卡 100% 有解，并将最终数据存入 bottleDatas
     */
    public generateRandomLevelData(totalBottles: number) {
        this._history = []; // 新开局清空历史
        this.bottleDatas = [];
        if (totalBottles <= 2) return;

        const fillCount = totalBottles - GameConfig.EmptyBottleCount;
        if (fillCount > GameConfig.Colors.length) {
            console.error(`颜色不够！需要 ${fillCount} 种颜色，请在 GameModel 中添加。`);
            return;
        }

        // 1. 初始化“胜利状态” (几个纯色满瓶 + 几个空瓶)
        const logicState: Color[][] = [];
        for (let i = 0; i < totalBottles; i++) {
            logicState[i] = [];
            if (i < fillCount) {
                for (let j = 0; j < GameConfig.MaxLayers; j++) {
                    logicState[i].push(GameConfig.Colors[i].clone());
                }
            }
        }

        // 2. 模拟逆向抽水（充分打乱）
        this.reverseShuffle(logicState, GameConfig.ShuffleSteps);

        // 3. 将打乱后的虚拟状态，赋给真实的游戏数据
        this.bottleDatas = logicState;
    }

    /** [校验] 检查当前选中状态是否符合倒水规则 */
    public canPour(fromIdx: number, toIdx: number): boolean {
        if (fromIdx === toIdx) return false; // 同一个瓶子不能互倒
        const fromData = this.bottleDatas[fromIdx];
        const toData = this.bottleDatas[toIdx];
        if (!fromData || !toData) return false;
        if (fromData.length === 0) return false; // 源瓶没水
        if (toData.length >= GameConfig.MaxLayers) return false; // 目标瓶已满

        const fromTopColor = fromData[fromData.length - 1];
        const toTopColor = toData.length > 0 ? toData[toData.length - 1] : null;

        // 只要目标瓶没满，且顶层颜色一致（或是空瓶），就允许倒水！
        return toTopColor === null || fromTopColor.equals(toTopColor);
    }

    /** * [写操作] 执行逻辑倒水 
     * 将数据从 A 转移到 B，记录历史，并返回给表现层用于播放动画的数据快照
     */
    public doPour(fromIdx: number, toIdx: number): { color: Color, count: number, oldFromCount: number, oldToCount: number } {
        const fromData = this.bottleDatas[fromIdx];
        const toData = this.bottleDatas[toIdx];
        const oldFromCount = fromData.length;
        const oldToCount = toData.length;

        const fromTopCount = this.getTopColorCount(fromIdx);
        const toSpace = GameConfig.MaxLayers - toData.length;

        // 算实际能倒多少层（取源瓶连续层数与目标瓶剩余空间的最小值）
        // 如果 A 有 2 层黄，B 只能装 1 层，那么 count 就是 1
        const count = Math.min(fromTopCount, toSpace);
        const color = fromData[fromData.length - 1].clone();

        // 压入撤回栈
        this._history.push({ fromIdx, toIdx, color: color.clone(), count, oldFromCount, oldToCount });

        // 核心数据转移
        for (let i = 0; i < count; i++) toData.push(fromData.pop()!);

        return { color, count, oldFromCount, oldToCount };
    }

    /** [写操作] 撤回上一步，恢复数据并弹出历史栈 */
    public undo(): MoveHistory | null {
        if (this._history.length === 0) return null;
        const lastMove = this._history.pop()!;
        const originalFrom = this.bottleDatas[lastMove.fromIdx];
        const originalTo = this.bottleDatas[lastMove.toIdx];

        // 逆向数据转移：把水从目标瓶抽回源瓶
        for (let i = 0; i < lastMove.count; i++) originalTo.pop();
        for (let i = 0; i < lastMove.count; i++) originalFrom.push(lastMove.color.clone());

        return lastMove;
    }

    /** 清空历史记录栈 */
    public clearHistory() {
        this._history = [];
    }

    /**
     * 道具功能：打乱当前存活瓶子里的水（保证 100% 有解）
     * [算法] 使用逆向推导法，将指定的几个存活瓶子重新打乱
     */
    public shuffleActiveWater(activeIndices: number[]) {
        if (activeIndices.length <= 1) return;

        const colorCounts = new Map<string, { color: Color, count: number }>();
        for (const idx of activeIndices) {
            for (const c of this.bottleDatas[idx]) {
                const key = `${c.r},${c.g},${c.b}`;
                if (!colorCounts.has(key)) colorCounts.set(key, { color: c.clone(), count: 0 });
                colorCounts.get(key)!.count++;
            }
        }

        // 核心步骤 1：收集当前颜色并构建“虚拟胜利状态”
        const logicState: Color[][] = Array.from({ length: activeIndices.length }, () => []);
        let fillIdx = 0;
        colorCounts.forEach(info => {
            let remain = info.count;
            while (remain > 0) {
                if (logicState[fillIdx].length >= GameConfig.MaxLayers) fillIdx++;
                logicState[fillIdx].push(info.color.clone());
                remain--;
            }
        });

        // 核心步骤 2：对纯色满瓶执行“逆向推导”打乱
        this.reverseShuffle(logicState, 150);

        // 核心步骤 3：写回活跃瓶的数据
        activeIndices.forEach((idx, i) => {
            this.bottleDatas[idx] = logicState[i];
        });

        this.clearHistory();
    }

    /** [查询] 判断瓶子是否已经完成了纯色收集 */
    public isBottleComplete(idx: number): boolean {
        const data = this.bottleDatas[idx];
        if (!data || data.length !== GameConfig.MaxLayers) return false;
        const first = data[0];
        return data.every(c => c.equals(first));
    }

    /** [查询] 查询指定瓶子是否为空 */
    public isBottleEmpty(idx: number): boolean {
        const data = this.bottleDatas[idx];
        return !data || data.length === 0;
    }

    /** [查询] 查询当前历史记录的步数 */
    public get historyCount() { 
        return this._history.length; 
    }

    /**
     * 逆向打乱核心：从可解终局反推到可玩初局
     */
    private reverseShuffle(logicState: Color[][], shuffleSteps: number) {
        let previousFrom = -1;
        let previousTo = -1;
        const totalBottles = logicState.length;

        for (let step = 0; step < shuffleSteps; step++) {
            const validSources: number[] = [];
            for (let i = 0; i < totalBottles; i++) {
                if (logicState[i].length > 0) validSources.push(i);
            }
            this.shuffleArray(validSources);

            let moved = false;
            for (const srcIdx of validSources) {
                const srcBottle = logicState[srcIdx];
                const topColor = srcBottle[srcBottle.length - 1];

                let topCount = 1;
                for (let i = srcBottle.length - 2; i >= 0; i--) {
                    if (srcBottle[i].equals(topColor)) topCount++;
                    else break;
                }

                // 底色保护机制：如果瓶底不是同色，至少留 1 层不动
                const maxAllowedToTake = topCount === srcBottle.length ? topCount : (topCount - 1);
                if (maxAllowedToTake <= 0) continue;

                const validTargets: number[] = [];
                for (let i = 0; i < totalBottles; i++) {
                    if (i === srcIdx) continue;
                    if (srcIdx === previousTo && i === previousFrom) continue;
                    if (logicState[i].length < GameConfig.MaxLayers) validTargets.push(i);
                }
                if (validTargets.length === 0) continue;
                this.shuffleArray(validTargets);

                for (const dstIdx of validTargets) {
                    const dstBottle = logicState[dstIdx];
                    const space = GameConfig.MaxLayers - dstBottle.length;
                    const maxMove = Math.min(maxAllowedToTake, space);
                    const moveCount = Math.floor(Math.random() * maxMove) + 1;

                    for (let m = 0; m < moveCount; m++) {
                        dstBottle.push(srcBottle.pop()!);
                    }

                    previousFrom = srcIdx;
                    previousTo = dstIdx;
                    moved = true;
                    break;
                }
                if (moved) break;
            }

            if (!moved) break;
        }
    }

    /**
     * [工具算法] Fisher-Yates 洗牌算法
     * 作用：将传入的数组元素顺序进行等概率的随机打乱（原地打乱，不产生新数组）。
     * 在游戏中的应用：在“逆向推导”生成关卡或使用“打乱”道具时，我们需要随机挑瓶子来抽水。
     * 用它打乱有效瓶子的索引数组，可以保证每次生成的关卡千变万化，而不是每次都按固定顺序生成。
     * * @param array 需要打乱的泛型数组
     */
    private shuffleArray<T>(array: T[]) {
        // 从数组最后一个元素开始，自后向前遍历
        for (let i = array.length - 1; i > 0; i--) {
            // 随机生成一个 0 到 i（包含 i）的整数索引 j
            const j = Math.floor(Math.random() * (i + 1));
            // ES6 语法：交换当前元素 i 和随机抽中的元素 j 的位置
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * [核心规则] 获取指定瓶子最顶层【连续且同色】的水层数量
     * 作用：水排序的经典规则是“相同颜色的水连在一起会被当作一个整体”。
     * 这个函数就是用来算命脉的：玩家点击倒水时，到底是一次倒出 1 格、2 格，还是 3 格？
     * * @param idx 瓶子在数据源中的索引
     * @returns 顶层同色水的层数（0 表示空瓶）
     */
    private getTopColorCount(idx: number): number {
        // 拿到这个瓶子当前从底到顶的颜色数组
        const data = this.bottleDatas[idx];
        
        // 防呆保护：如果没数据或者是个空瓶子，直接返回 0 层
        if (!data || data.length === 0) return 0;
        
        // 既然不为空，那最顶上肯定至少有 1 层水，保底为 1
        let count = 1;
        
        // 从最顶层（数组末尾）开始，向下挨个比对颜色
        for (let i = data.length - 1; i > 0; i--) {
            // 如果当前层 (i) 的颜色，和它正下方那层 (i-1) 的颜色一模一样
            if (data[i].equals(data[i - 1])) {
                count++; // 同色水层数量 +1
            } else {
                break; // 只要碰到颜色不一样的，说明同色水块“断层”了，立刻停止计算
            }
        }
        
        // 返回最终算出来的连续同色层数
        return count;
    }

    /** 重置统计数据 */
    public resetStats() {
        this.moveCount = 0;
        this.undoCount = 0;
        this.startTime = 0;
    }
}
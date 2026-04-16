import { IGameView } from '../view/IGameView';
import { GameModel } from '../model/GameModel';

/**
 * 游戏业务逻辑中枢
 * * 【核心职责】
 * 1. 架构桥梁：作为 View(表现) 和 Model(数据) 之间唯一的沟通枢纽，彻底解耦视图与数据。
 * 2. 流程控制：接收 View 层转发的用户交互（如点击瓶子、点击撤回等），根据 Model 的规则进行校验。
 * 3. 状态调度：修改 Model 数据后，指挥 View 层通过 IGameView 接口播放对应的表现动画。
 * 4. 线程安全（防连点）：维护全局动画锁 (_isAnimating)，确保表现层动画与底层数据严格同步。
 */
export class GamePresenter {
    private _view: IGameView;
    private _model: GameModel;

    /** 当前被点击弹起的瓶子索引 */
    private _selectedIdx: number = -1;
    /** 核心锁：防止动画期间的疯狂连点 */
    private _isAnimating: boolean = false;
    /** 记录哪些瓶子还存活（没被消除） */
    private _activeFlags: boolean[] = [];

    constructor(view: IGameView) {
        // 依赖注入：由外部（GameView）将自己当作 IGameView 传入，实现解耦
        this._view = view;
        this._model = new GameModel();
    }

    /** [生命周期] 初始化一局新游戏 */
    public startGame(totalBottles: number) {
        this._isAnimating = false;
        this._selectedIdx = -1;

        // 1. Model 生成底层数据
        this._model.resetStats(); // 开局重置统计信息
        this._model.generateRandomLevelData(totalBottles);
        this._activeFlags = Array.from({ length: totalBottles }, () => true);

        // 2. 指挥 View 根据底层数据绘制首帧画面
        for (let i = 0; i < totalBottles; i++) {
            this._view.refreshBottle(i, this._model.bottleDatas[i]);
        }
        this._view.setUndoButtonInteractable(false);
    }

    /** 
     * [事件响应] 处理来自 View 层的点击汇报
     * 处理 View 传来的点击事件（选中、切换、倒水） 
     * */
    public async onBottleClicked(index: number) {
        if (this._isAnimating) return; // 动画锁

        // 第一步点击时记录开始时间，只存时间戳
        if (this._model.startTime === 0) {
            this._model.startTime = Date.now();
        }

        // 阶段 1：选中瓶子
        if (this._selectedIdx === -1) {
            if (!this._model.isBottleEmpty(index)) { // 从 Model 查是否空瓶
                this._selectedIdx = index;
                this._view.playSelectAnim(index);
            }
            return;
        }

        // 阶段 2：取消选中
        if (this._selectedIdx === index) {
            this._view.playDeselectAnim(index);
            this._selectedIdx = -1;
            return;
        }

        // 阶段 3：尝试倒水或切换选中
        if (this._model.canPour(this._selectedIdx, index)) { // 问 Model 能不能倒
            const fromIdx = this._selectedIdx;
            const toIdx = index;
            // 倒水前，先让当前瓶子回落
            this._view.playDeselectAnim(fromIdx);
            this._selectedIdx = -1;
            
            // 进入正式倒水工作流
            await this.executePour(fromIdx, toIdx);
        } else {
            // 倒不了水？说明是切瓶子
            this._view.playDeselectAnim(this._selectedIdx);
            if (!this._model.isBottleEmpty(index)) {
                this._selectedIdx = index;
                this._view.playSelectAnim(index);
            } else {
                this._selectedIdx = -1;
            }
        }
    }

    /**
     * 核心倒水流程（数据驱动表现）
     * 执行完整倒水流程：
     * 1) Model 先改数据
     * 2) View 播放动画
     * 3) 动画后强制同步 UI
     */
    private async executePour(fromIdx: number, toIdx: number) {
        this._isAnimating = true;

        // 1. [Model] 同步并获取修改结果
        this._model.moveCount++; // 步数+1
        const result = this._model.doPour(fromIdx, toIdx);
        this._view.setUndoButtonInteractable(true);

        // 2. [View] 拿着快照数据，去播放漫长的倒水动画
        await this._view.playPourAnim(fromIdx, toIdx, result.color, result.count, result.oldFromCount, result.oldToCount);

        // 3. [校准] 动画播完后，强制用 Model 里的真实数据刷一遍 View（防呆机制）
        this._view.refreshBottle(fromIdx, this._model.bottleDatas[fromIdx]);
        this._view.refreshBottle(toIdx, this._model.bottleDatas[toIdx]);

        this._isAnimating = false;

        // 4. [规则] 每次倒水后检查是否通关
        this.checkWinCondition();
    }

    /** [工作流] 检查消除与通关状态 */
    private checkWinCondition() {
        let allComplete = true;
        let bottleCleared = false;

        for (let i = 0; i < this._activeFlags.length; i++) {
            if (!this._activeFlags[i]) continue; // 已消失的忽略
            if (this._model.isBottleEmpty(i)) continue; // 空瓶忽略

            if (this._model.isBottleComplete(i)) {
                // 触发单瓶消除
                this._activeFlags[i] = false;
                bottleCleared = true;
                this._view.playDisappearAnim(i);
            } else {
                // 只要还有一个没完，就没通关
                allComplete = false;
            }
        }

        // 如果本次触发消除，旧撤回历史不再安全，必须清空
        if (bottleCleared) {
            this._model.clearHistory();
            this._view.setUndoButtonInteractable(false);
        }

       if (allComplete) {
            // 计算通关用时
            const endTime = Date.now();
            const durationSeconds = Math.floor((endTime - this._model.startTime) / 1000);
            const timeStr = this.formatTime(durationSeconds);

            // 将三个数据打包传给 View
            this._view.showWinPanel({
                moves: this._model.moveCount,
                undos: this._model.undoCount,
                time: timeStr
            });
        }
    }

    /** 
     * UI按钮回调：撤回一步 
     */
    public async onUndoClicked() {
        if (this._isAnimating || this._model.historyCount === 0) return;
        if (this._selectedIdx !== -1) {
            this._view.playDeselectAnim(this._selectedIdx);
            this._selectedIdx = -1;
        }

        this._isAnimating = true;
        const move = this._model.undo();
        if (!move) {
            this._isAnimating = false;
            return;
        }

        // 修改统计数据
        this._model.undoCount++; // 撤回+1

        await this._view.playUndoAnim(
            move.fromIdx,
            move.toIdx,
            move.color,
            move.count,
            move.oldFromCount,
            move.oldToCount
        );

        // 刷新UI
        this._view.refreshBottle(move.fromIdx, this._model.bottleDatas[move.fromIdx]);
        this._view.refreshBottle(move.toIdx, this._model.bottleDatas[move.toIdx]);
        this._view.setUndoButtonInteractable(this._model.historyCount > 0);
        this._isAnimating = false;
    }

    /** 
     * UI按钮回调：打乱当前活跃瓶子（保证可解）
     */
    public onShuffleClicked() {
        if (this._isAnimating) return;
        if (this._selectedIdx !== -1) {
            this._view.playDeselectAnim(this._selectedIdx);
            this._selectedIdx = -1;
        }

        const activeIndices = this._activeFlags
            .map((active, idx) => (active ? idx : -1))
            .filter(idx => idx >= 0);

        this._model.shuffleActiveWater(activeIndices);
        activeIndices.forEach(i => this._view.refreshBottle(i, this._model.bottleDatas[i]));
        this._view.playShuffleAnim(activeIndices);
        this._view.setUndoButtonInteractable(false);
    }

    /** 
     * UI按钮回调：再来一局
     */
    public onNextLevelClicked() {
        this._view.hideWinPanel();
        this._view.resetAllBottles();
        this.startGame(this._view.getBottleCount());
    }

    /** 
     * 辅助函数
     * 格式化秒数为 00:00 格式 
     */
    formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        const mStr = m < 10 ? `0${m}` : `${m}`;
        const sStr = s < 10 ? `0${s}` : `${s}`;
        return `${mStr}:${sStr}`;
    }

    /**
     * 清扫方法
     * 打断引用链，释放内存，注销可能的全局事件监听
     */
    public reset() {
        // 1. 【状态重置】
        this._isAnimating = false;
        this._selectedIdx = -1;

        // 2. 【打断强引用】
        this._view = null!; 
        
        // 3. 【清空大数据量对象】
        if (this._model) {
            this._model.clearHistory(); // 释放历史记录栈里的 Color 对象
            this._model = null!;
        }
    }

}
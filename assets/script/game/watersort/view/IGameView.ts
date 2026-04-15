import { Color } from 'cc';

export interface IGameView {
    /** 刷新指定瓶子的UI表现 */
    refreshBottle(index: number, colors: Color[]): void;
    /** 播放瓶子选中跳起动画 */
    playSelectAnim(index: number): void;
    /** 播放瓶子取消选中回落动画 */
    playDeselectAnim(index: number): void;
    /** 播放倒水完整动画 (异步，等待动画播完再继续) */
    playPourAnim(fromIdx: number, toIdx: number, pourColor: Color, pourCount: number, oldFromCount: number, oldToCount: number): Promise<void>;
    /** 播放撤回动画 (异步，等待动画播完再继续) */
    playUndoAnim(fromIdx: number, toIdx: number, color: Color, count: number, oldFromCount: number, oldToCount: number): Promise<void>;
    /** 播放消除动画 */
    playDisappearAnim(index: number): void;
    /** 设置撤回按钮的置灰状态 */
    setUndoButtonInteractable(interactable: boolean): void;
    /** 弹出胜利界面 */
    showWinPanel(stats: { moves: number, undos: number, time: string }): void;
    /** 隐藏胜利界面 */
    hideWinPanel(): void;
    /** 重置所有瓶子状态（下一关前） */
    resetAllBottles(): void;
    /** 播放打乱时的压扁弹跳动画 */
    playShuffleAnim(indices: number[]): void;
    /** 获取瓶子总数 */
    getBottleCount(): number;
}
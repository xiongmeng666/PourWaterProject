import { _decorator, Component, Node, Button, Color, Vec3, v3, Prefab, instantiate, Sprite, UITransform, tween, Tween } from 'cc';
import { IGameView } from './IGameView';
import { GamePresenter } from '../presenter/GamePresenter';
import { BottleView } from './BottleView';
import { WinPanelView } from './WinPanelView';
import { GameConfig } from '../config/GameConfig';
const { ccclass, property } = _decorator;

@ccclass('GameView')
export class GameView extends Component implements IGameView {
    @property([BottleView])
    bottles: BottleView[] = [];

    @property({ type: Button, tooltip: '撤回按钮' })
    undoButton: Button | null = null;

    @property(Prefab)
    streamPrefab: Prefab = null!; // 倒水时的那条细流预制体

    @property({ tooltip: '是否启用“接收瓶”倒水期间波浪' })
    enablePourWave: boolean = true;

    @property({ tooltip: 'A 瓶口局部偏移（用于对齐倒水出水点）' })
    fromMouthOffset: Vec3 = v3(0, 105, 0);

    @property({ tooltip: 'B 瓶口局部偏移（用于对齐接水点）' })
    toMouthOffset: Vec3 = v3(0, 105, 0);

    @property({ tooltip: 'A 瓶口相对 B 瓶口的垂直偏移（像素）' })
    pourVerticalOffset: number = 50;

    @property({ tooltip: '倒水目标细调偏移（同时支持 X/Y）' })
    pourTargetFineOffset: Vec3 = v3(0, 0, 0);

    @property({ tooltip: '是否把 A 瓶口 X 约束在 A/B 瓶口之间' })
    clampPourXBetweenMouths: boolean = true;

    @property({ tooltip: '细流水柱宽度缩放' })
    streamWidthScale: number = 0.22;

    @property({ tooltip: '细流水柱基准长度（当 scaleY=1 时）' })
    streamBaseLength: number = 220;

    @property({ tooltip: '细流两端收缩，避免穿模到瓶内' })
    streamEndInset: number = 12;

    @property({ tooltip: '细流起点细调偏移（X/Y）' })
    streamFromFineOffset: Vec3 = v3(0, 0, 0);

    @property({ tooltip: '细流终点细调偏移（X/Y）' })
    streamToFineOffset: Vec3 = v3(0, 0, 0);

    // 如果太短的话 就穿帮了
    @property({ tooltip: '细流延伸到接收瓶内部的深度（向下偏移像素）' })
    streamDropDepth: number = 230;

    @property({ type: WinPanelView, tooltip: '胜利弹窗独立组件' })
    winPanel: WinPanelView | null = null;

    // Presenter 引用：View 只负责表现，交互流程由 Presenter 决策
    private _presenter: GamePresenter = null!;

    private _activeStream: Node | null = null;
    private _targetStreamScaleY: number = 1; // 记录水流目标长度

    /** View 主动创建 Presenter，并把自身接口传进去 */
    onLoad() {
        this._presenter = new GamePresenter(this);
    }

    /** 绑定瓶子点击事件并启动游戏 */
    start() {

        // 注册按钮监听
        this.bottles.forEach((bottle, index) => {
            bottle.node.on(Node.EventType.TOUCH_END, () => {
                this._presenter.onBottleClicked(index);
            }, this);
            bottle.setWaveActive(false);
        });

        // GameView 把 WinPanel 的按钮事件，无缝代理给 Presenter
        if (this.winPanel) {
            this.winPanel.onNextLevelCallback = () => {
                this._presenter.onNextLevelClicked();
            };
        }

        // 获取场景上拖进去的瓶子数量，通知大脑开机
        this._presenter.startGame(this.bottles.length);
    }

    // --- 【由框架引擎触发的 UI 事件，全部无脑透传】 ---
    /** UI按钮透传给 Presenter：撤回 */
    public onBtnUndoClick() { void this._presenter.onUndoClicked(); }
    /** UI按钮透传给 Presenter：打乱 */
    public onBtnShuffleClick() { this._presenter.onShuffleClicked(); }
    /** UI按钮透传给 Presenter：下一关 */
    public onBtnNextLevelClick() { this._presenter.onNextLevelClicked(); }


    // ==========================================================
    // --- 【实现 IGameView 契约的方法】 ---
    // ==========================================================

    /** 
     * 被 Presenter 唤起，用绝对正确的数据刷新渲染
     * 根据 Model 数据强制刷新单个瓶子的 UI 
     * */
    public refreshBottle(index: number, colors: Color[]): void {
        // 必须使用 .map(c => c.clone())！
        // 因为这是跨层传递引用，如果不 clone，BottleView 动画中的 popLayers 会直接删掉 Model 里的数据！
        this.bottles[index].init(colors.map(c => c.clone()));
    }

    /** 选中动画：把瓶子提到最上层再跳起 */
    public playSelectAnim(index: number): void {
        const bottle = this.bottles[index];
        if (bottle.node.parent) {
            bottle.node.setSiblingIndex(bottle.node.parent.children.length - 1);
        }
        bottle.select();
    }

    /** 取消选中动画：瓶子回落原位 */
    public playDeselectAnim(index: number): void {
        this.bottles[index].deselect();
    }

    /**
     * 倒水完整表现：
     * 1) 飞向目标并半倾斜
     * 2) 深倾斜 + 水流特效 + 双瓶水位补间
     * 3) 回位复原
     * 注意：在这个过程中，View 层会为了“平滑动画”自己暂时修改内部状态
     */
    public async playPourAnim(fromIdx: number, toIdx: number, pourColor: Color, pourCount: number, oldFromCount: number, oldToCount: number): Promise<void> {
        const fromBottle = this.bottles[fromIdx];
        const toBottle = this.bottles[toIdx];

        // 【View层私有操作】：为了让动画顺滑，必须手动剥离 UI 层的水。
        // 这不是改 Model！这是在骗眼睛。等动画完事，Presenter 会用 refreshBottle 把真实数据盖回来。
        // 必须根据 Presenter 传来的真实数量 (pourCount) 进行精准剥离，否则剩下的水会隐形！
        fromBottle.popLayers(pourCount);
        toBottle.addLayers(pourColor, pourCount);

        const remainingCount = oldFromCount - pourCount;
        const baseAngle = this.calculateDynamicAngle(remainingCount);
        const fromNode = fromBottle.node;
        const startPos = fromBottle.initialPos;
        let isRight = toBottle.node.position.x > fromNode.position.x;
        if (Math.abs(toBottle.node.position.x - fromNode.position.x) < 10) {
            isRight = toBottle.node.position.x >= 0;
        }
        const pourAngle = isRight ? -baseAngle : baseAngle;
        const targetPos = this.getAlignedPourTargetPos(fromBottle, toBottle, pourAngle);

        // --- 阶段 1: 飞向目标瓶口并倾斜 ---
        await new Promise<void>(res => {
            tween(fromNode)
                .to(0.4, { position: targetPos, angle: pourAngle * 0.5 }, { easing: 'sineOut' })
                .call(() => res())
                .start();
        });

        // --- 阶段 2: 深度倾斜 & 表现层水面动画 ---
        await new Promise<void>(res => {
            // A 瓶继续倾斜
            tween(fromNode).to(0.3, { angle: pourAngle }, { easing: 'sineIn' }).start();
            // 倒水时：A 始终不晃，B 只在接水期间晃
            fromBottle.setWaveActive(false);
            toBottle.setWaveActive(this.enablePourWave);
            // 生成细流 (Stream)
            this.showStream(fromBottle, toBottle, pourColor);

            // A 瓶水位平滑下降
            const fromObj = { val: oldFromCount / GameConfig.MaxLayers };
            tween(fromObj)
                .to(0.6, { val: (oldFromCount - pourCount) / GameConfig.MaxLayers }, {
                    onUpdate: (target: { val: number }) => fromBottle.setDisplayFillLevel(target.val),
                })
                .start();

            // B 瓶先刷新颜色，再从旧高度起 tween 到新高度
            toBottle.refreshUI();
            toBottle.setDisplayFillLevel(oldToCount / GameConfig.MaxLayers);

            const toObj = { val: oldToCount / GameConfig.MaxLayers };
            tween(toObj)
                .to(0.6, { val: (oldToCount + pourCount) / GameConfig.MaxLayers }, {
                    onUpdate: (target: { val: number }) => {
                        toBottle.setDisplayFillLevel(target.val);
                        this.updateStreamTransform(fromBottle, toBottle);
                    },
                })
                .delay(0.1) // 稍微延迟，模拟水流过去的时间
                .call(() => {
                    // 倒水结束时再同步 A 瓶真实层数据，避免开倒瞬间“水层立刻消失”
                    fromBottle.refreshUI();
                    toBottle.setWaveActive(false);
                    this.hideStream(toBottle);
                    res();
                })
                .start();
        });

        // --- 阶段 3: 复位 ---
        await new Promise<void>(res => {
            tween(fromNode)
                .to(0.3, { angle: 0 }, { easing: 'sineOut' })
                .to(0.4, { position: startPos }, { easing: 'sineIn' })
                .call(() => {
                    fromBottle.playRecoverNormalAnimation();
                    res();
                })
                .start();
        });
    }

    /** 撤回表现：快速回退双瓶水位，不显示水流连线 */
    public async playUndoAnim(fromIdx: number, toIdx: number, color: Color, count: number, oldFromCount: number, oldToCount: number): Promise<void> {
        const originalFrom = this.bottles[fromIdx];
        const originalTo = this.bottles[toIdx];

        // 先执行 View 侧逻辑回滚，再做水位补间
        originalTo.popLayers(count);
        originalFrom.addLayers(color, count);

        originalTo.refreshUI();
        originalFrom.refreshUI();
        originalTo.setDisplayFillLevel(oldToCount / GameConfig.MaxLayers);
        originalFrom.setDisplayFillLevel(oldFromCount / GameConfig.MaxLayers);

        await new Promise<void>(res => {
            const toObj = { val: oldToCount / GameConfig.MaxLayers };
            tween(toObj)
                .to(0.15, { val: originalTo.currentLayerCount / GameConfig.MaxLayers }, {
                    onUpdate: (target: { val: number }) => originalTo.setDisplayFillLevel(target.val),
                })
                .start();

            const fromObj = { val: oldFromCount / GameConfig.MaxLayers };
            tween(fromObj)
                .to(0.15, { val: originalFrom.currentLayerCount / GameConfig.MaxLayers }, {
                    onUpdate: (target: { val: number }) => originalFrom.setDisplayFillLevel(target.val),
                })
                .call(() => res())
                .start();
        });
    }

    /** 播放单个瓶子的消除动画 */
    public playDisappearAnim(index: number): void {
        this.bottles[index].playDisappearAnimation();
    }

    /** 更新撤回按钮状态（置灰或激活） */
    public setUndoButtonInteractable(interactable: boolean): void {
        if (this.undoButton) this.undoButton.interactable = interactable;
    }

    /** 显示胜利弹窗（延迟少许，给最后一次消除动画留展示时间） */
    public showWinPanel(stats: { moves: number, undos: number, time: string }): void {
        if (!this.winPanel) return;

        this.scheduleOnce(() => {
            this.winPanel!.show(stats);
        }, 0.5);
    }

    /** 隐藏胜利弹窗 */
    public hideWinPanel(): void {
        if (!this.winPanel) return;

        this.winPanel.hide();
    }

    /** 下一关前重置所有瓶子 Transform 与状态 */
    public resetAllBottles(): void {
        this.bottles.forEach(bottle => {
            bottle.node.active = true;
            bottle.node.setScale(1, 1, 1);
            bottle.node.angle = 0;
            bottle.node.setPosition(bottle.initialPos);
            bottle.setWaveActive(false);
        });
    }

    /** 打乱时的压扁弹跳动画 */
    public playShuffleAnim(indices: number[]): void {
        indices.forEach(index => {
            const b = this.bottles[index];
            const originalScale = b.node.scale.clone();
            b.node.setScale(originalScale.x, 0, originalScale.z);
            tween(b.node).to(0.4, { scale: originalScale }, { easing: 'backOut' }).start();
        });
    }

    /** 提供给 Presenter 读取当前瓶子数量 */
    public getBottleCount(): number {
        return this.bottles.length;
    }

    /**
     * 根据倒水后的剩余层数，计算物理合理的倾斜角度
     * 剩3层:70°，剩2层:90°，剩1层:110°，倒空:135°
     */
    private calculateDynamicAngle(remainingLayers: number): number {
        switch (remainingLayers) {
            case 3: return 70;
            case 2: return 90;
            case 1: return 110;
            case 0: return 135;
            default: return 90;
        }
    }

    /** 生成并显示细流水柱特效 */
    private showStream(from: BottleView, to: BottleView, color: Color) {
        if (!this.streamPrefab) return;
        this._activeStream = instantiate(this.streamPrefab);
        this.node.addChild(this._activeStream);
        // 把水流放到最底层，确保被瓶子和水体覆盖，避免穿帮
        this._activeStream.setSiblingIndex(0);

        const streamSprite =
            this._activeStream.getComponent(Sprite) ??
            this._activeStream.getComponentInChildren(Sprite);
        if (streamSprite) streamSprite.color = color;

        const uiTransform = this._activeStream.getComponent(UITransform);
        if (uiTransform) uiTransform.setAnchorPoint(0.5, 1);

        this.updateStreamTransform(from, to);
        this._activeStream.setScale(this.streamWidthScale, 0.01, 1);
        tween(this._activeStream)
            .to(0.15, { scale: v3(this.streamWidthScale, this._targetStreamScaleY, 1) })
            .start();
    }

    /** 收尾动画：切断细流并向目标瓶底部回收 */
    private hideStream(to: BottleView) {
        if (!this._activeStream) return;
        const s = this._activeStream;
        const toMouthWorld = this.getMouthWorldPos(to, this.toMouthOffset).add(this.streamToFineOffset);
        toMouthWorld.y -= this.streamDropDepth;;
        const toMouthLocal = this.worldToLocal(toMouthWorld);

        tween(s)
            .to(0.2, {
                scale: v3(this.streamWidthScale, 0, 1),
                position: toMouthLocal,
            }, { easing: 'sineIn' })
            .call(() => s.destroy())
            .start();

        this._activeStream = null;
    }

    /**
     * 计算对齐坐标：让水流从 A 瓶口到 B 瓶口保持“看起来垂直合理”
     * 核心思路：先算期望瓶口位置，再反推瓶身中心目标位置
     */
    private getAlignedPourTargetPos(from: BottleView, to: BottleView, pourAngle: number): Vec3 {
        const toMouthLocalInGM = this.worldToLocal(this.getMouthWorldPos(to, this.toMouthOffset));
        const desiredMouthPos = v3(
            toMouthLocalInGM.x + this.pourTargetFineOffset.x,
            toMouthLocalInGM.y + this.pourVerticalOffset + this.pourTargetFineOffset.y,
            from.node.position.z
        );
        const rad = pourAngle * Math.PI / 180;
        const rotatedMouthOffset = v3();
        Vec3.rotateZ(rotatedMouthOffset, this.fromMouthOffset, Vec3.ZERO, rad);
        return desiredMouthPos.clone().subtract(rotatedMouthOffset);
    }

    /** 倒水过程中实时更新水流位置、角度、长度，保证与瓶口贴合 */
    private updateStreamTransform(from: BottleView, to: BottleView) {
        if (!this._activeStream) return;
        const fromMouthWorld = this.getMouthWorldPos(from, this.fromMouthOffset).add(this.streamFromFineOffset);
        const toMouthWorld = this.getMouthWorldPos(to, this.toMouthOffset).add(this.streamToFineOffset);
        toMouthWorld.y -= this.streamDropDepth;;

        const dir = toMouthWorld.clone().subtract(fromMouthWorld);
        const distance = dir.length();
        if (distance <= 0.001) return;
        dir.normalize();

        const startWorld = fromMouthWorld.clone().add(dir.clone().multiplyScalar(this.streamFromFineOffset.y === 0 ? this.streamEndInset : 0));
        const endWorld = toMouthWorld.clone().subtract(dir.clone().multiplyScalar(this.streamEndInset));
        const streamVec = endWorld.clone().subtract(startWorld);
        const streamLength = streamVec.length();

        const startLocal = this.worldToLocal(startWorld);
        this._activeStream.setPosition(startLocal);
        const angle = Math.atan2(streamVec.y, streamVec.x) * 180 / Math.PI + 90;
        this._activeStream.angle = angle;
        this._targetStreamScaleY = streamLength / Math.max(this.streamBaseLength, 1);

        if (this._activeStream.scale.y > 0.1) {
            this._activeStream.setScale(this.streamWidthScale, this._targetStreamScaleY, 1);
        }
    }

    /** 获取瓶口在世界坐标系中的位置 */
    private getMouthWorldPos(bottle: BottleView, mouthOffset: Vec3): Vec3 {
        const ui = bottle.node.getComponent(UITransform);
        if (!ui) return bottle.node.worldPosition.clone().add(mouthOffset);
        return ui.convertToWorldSpaceAR(mouthOffset);
    }

    /** 世界坐标转到 GameView 本地坐标 */
    private worldToLocal(worldPos: Vec3): Vec3 {
        const ui = this.node.getComponent(UITransform);
        if (!ui) return worldPos.clone();
        return ui.convertToNodeSpaceAR(worldPos);
    }

    /**
     * 组件销毁前调用
     */
    onDestroy() {
        // 1. 【停止所有 Tween】
        // 必须针对所有可能在播放动画的节点执行停止操作，防止销毁后回调依然触发
        this.bottles.forEach(bottle => {
            if (bottle && bottle.node) {
                Tween.stopAllByTarget(bottle.node); // 停止瓶子自身的跳起、复位、消除动画
            }
        });

        // 如果当前有正在流动的细流，也需要停止并清理
        if (this._activeStream) {
            Tween.stopAllByTarget(this._activeStream);
            this._activeStream.destroy();
            this._activeStream = null;
        }

        // 2. 【清理所有定时器】
        // 清除通过 this.schedule 开启的所有任务，防止延迟逻辑（如 showWinPanel）在销毁后执行
        this.unscheduleAllCallbacks();

        // 3. 【解绑事件与断开闭包】
        this.bottles.forEach(bottle => {
            if (bottle.node && bottle.node.isValid) {
                bottle.node.off(Node.EventType.TOUCH_END);
            }
        });

        // 断开 WinPanel 的闭包回调，这是最容易产生闭包引用导致内存不释放的地方
        if (this.winPanel) {
            this.winPanel.onNextLevelCallback = null; 
            if (this.winPanel.contentNode) {
                Tween.stopAllByTarget(this.winPanel.contentNode);
            }
        }

        // 4. 【通知中枢下线】
        if (this._presenter) {
            this._presenter.reset();
            this._presenter = null!;
        }
    }
}

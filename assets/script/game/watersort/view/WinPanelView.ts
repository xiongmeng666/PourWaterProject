import { _decorator, Component, Label, Node, tween, v3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('WinPanelView')
export class WinPanelView extends Component {
    @property(Node)
    contentNode: Node = null!;
    @property(Label) movesLabel: Label = null!;
    @property(Label) undosLabel: Label = null!;
    @property(Label) timeLabel: Label = null!;

    // 暴露一个回调函数，让外部（GameView）来注册
    public onNextLevelCallback: (() => void) | null = null;

    /** 弹出动画 */
    public show(stats: { moves: number, undos: number, time: string }) {

        this.node.active = true;

        // 填充数据
        this.movesLabel.string = `步数：${stats.moves}`;
        this.undosLabel.string = `撤回次数：${stats.undos}`;
        this.timeLabel.string = `耗时：${stats.time}`;

        if (this.contentNode) {
            this.contentNode.setScale(0, 0, 0);
            tween(this.contentNode).to(0.4, { scale: v3(1, 1, 1) }, { easing: 'backOut' }).start();
        }

    }

    /** 隐藏自身 */
    public hide() {
        this.node.active = false;
    }

    /** 
     * 再来一局按钮回调
     */
    public onBtnNextClick() {
        // 触发回调，通知监听者（GameView）
        if (this.onNextLevelCallback) {
            this.onNextLevelCallback();
        }
    }


}
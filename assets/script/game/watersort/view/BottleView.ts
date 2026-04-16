import { _decorator, Component, Node, Sprite, Color, v3, Vec3, tween, Material, UIOpacity } from 'cc';
import { GameConfig } from '../config/GameConfig';
const { ccclass, property } = _decorator;

/**
 * 瓶子组件：负责管理内部水层数据、控制 Shader 表现及基础动画
 */
@ccclass('BottleView')
export class BottleView extends Component {
    @property(Node)
    waterNode: Node = null!; // 挂载了 4 层水 Shader 的子节点

    @property({ type: Node, tooltip: '选中时的发光底图节点' })
    glowNode: Node | null = null;

    @property({ tooltip: '波浪高度（仅在启用波浪时生效）' })
    waveHeight: number = 0.02;

    @property({ tooltip: '波浪速度' })
    waveSpeed: number = 5;

    /** 存储颜色数组 */
    private _waterColors: Color[] = [];
    /** 记录初始坐标，用于动画回位 */
    private _initialPos: Vec3 = v3();
    /** 材质 */
    private _mat: Material = null!;

    onLoad() {
        // 记录初始位置
        this._initialPos = this.node.position.clone();

        // 获取材质实例以便动态修改 Shader 属性
        const sprite = this.waterNode.getComponent(Sprite);
        if (sprite) {
            this._mat = sprite.getMaterialInstance(0)!;
            this.setWaveActive(false);
        }
    }

    /**
     * 初始化瓶子颜色（由 GameView / Presenter 流程调用）
     */
    public init(colors: Color[]) {
        this._waterColors = colors;
        this.refreshUI();
    }

    // --- 属性获取器 (Getters) ---

    get initialPos() { return this._initialPos; }

    get isFull() { return this._waterColors.length >= GameConfig.MaxLayers; }

    get isEmpty() { return this._waterColors.length === 0; }

    /** 获取当前瓶子里的所有颜色数组的拷贝（用于打乱功能） */
    get colors(): Color[] {
        return [...this._waterColors];
    }

    // --- 核心表现方法 ---

    /** 
     * 刷新 Shader 表现：将逻辑颜色数组映射到 Shader 的 color1~4 属性上
     */
    public refreshUI() {
        if (!this._mat) return;

        const len = this._waterColors.length;

        // 获取 Shader 支持的最大颜色层数
        const shaderMaxSupport = GameConfig.ShaderMaxColors;

        // 1. 设置颜色层
        for (let i = 0; i < shaderMaxSupport; i++) {
            const propName = `color${i + 1}`;
            // 如果超出了当前关卡配置的最大层数，或者超出了当前实际的水层，都填透明
            if (i < GameConfig.MaxLayers && i < len) {
                this._mat.setProperty(propName, this._waterColors[i]);
            } else {
                this._mat.setProperty(propName, new Color(0, 0, 0, 0));
            }
        }

        // 2. 传递关键参数
        const fillRate = len / GameConfig.MaxLayers;
        this._mat.setProperty('totalFillLevel', fillRate);
        // 告诉 Shader 这一瓶现在到底有几层，用于平分高度
        this._mat.setProperty('activeLayers', len);
        // 把配置里的最大容量同步给 Shader
        this._mat.setProperty('maxLayers', GameConfig.MaxLayers);
    }

    /**
     * 每帧同步旋转角度给 Shader，实现液面水平
     */
    update(dt: number) {
        if (!this._mat) return;
        // Shader 需要的是弧度，且要随父节点旋转
        let rad = (this.node.angle * Math.PI) / 180;
        this._mat.setProperty('rotation', rad);
    }

    // --- 逻辑操作方法 (由 GameView 动画流程调用) ---

    /** 逻辑压入：把倒过来的水数据加入 */
    public addLayers(color: Color, count: number) {
        for (let i = 0; i < count; i++) {
            if (!this.isFull) {
                this._waterColors.push(color.clone());
            }
        }
    }

    /** 倒水结束后的形态复原 */
    public playRecoverNormalAnimation() {
        this.refreshUI();
    }

    // --- 基础交互动画 ---

    /** 选中跳起并亮起发光 */
    public select() {
        // 1. 跳起动画
        tween(this.node)
            .to(0.15, { position: v3(this._initialPos.x, this._initialPos.y + 30, 0) }, { easing: 'sineOut' })
            .start();

        // 2. 发光渐显动画
        if (this.glowNode) {
            // 获取透明度组件
            let uiOpacity = this.glowNode.getComponent(UIOpacity);
            if (!uiOpacity) uiOpacity = this.glowNode.addComponent(UIOpacity);
            
            tween(uiOpacity)
                .to(0.15, { opacity: 255 }) // 0.15秒内透明度变成满值
                .start();
        }
    }

    /** 回到原位并熄灭发光 */
    public deselect() {
        // 1. 回落动画
        tween(this.node)
            .to(0.15, { position: this._initialPos }, { easing: 'sineIn' })
            .start();

        // 2. 发光渐隐动画
        if (this.glowNode) {
            const uiOpacity = this.glowNode.getComponent(UIOpacity);
            if (uiOpacity) {
                tween(uiOpacity)
                    .to(0.15, { opacity: 0 }) // 0.15秒内透明度变成0
                    .start();
            }
        }
    }

    /** 消除成功后的消失动画：膨胀跳起 + 爆闪消失 */
    public playDisappearAnimation() {
        // 1. 瓶身表现：先膨胀跳起，再迅速缩成点
        tween(this.node)
            // 阶段 A：放大到 1.1 倍，向上微跳 20 像素
            .to(0.15, { scale: v3(1.1, 1.1, 1), position: v3(this._initialPos.x, this._initialPos.y + 20, 0) }, { easing: 'sineOut' })
            // 阶段 B：猛烈收缩到 0
            .to(0.25, { scale: v3(0, 0, 0) }, { easing: 'backIn' })
            .call(() => {
                this.node.active = false;
            })
            .start();

        // 2. 光效表现：如果有发光底图，配合做一次“爆闪”
        if (this.glowNode) {
            let uiOpacity = this.glowNode.getComponent(UIOpacity);
            if (!uiOpacity) uiOpacity = this.glowNode.addComponent(UIOpacity);
            
            // 强制重置透明度，防止连续操作导致的错乱
            uiOpacity.opacity = 0; 
            
            tween(uiOpacity)
                // 阶段 A：瞬间亮起，达到最亮
                .to(0.15, { opacity: 255 }, { easing: 'sineOut' })
                // 阶段 B：伴随瓶子消失迅速熄灭
                .to(0.25, { opacity: 0 }, { easing: 'sineIn' })
                .start();
        }
    }

    /** 获取当前逻辑上的水层数量 */
    get currentLayerCount() {
        return this._waterColors.length;
    }

    /** 手动设置 Shader 的填充比例（用于倒水动画中的平滑过渡） */
    public setDisplayFillLevel(percent: number) {
        if (this._mat) {
            this._mat.setProperty('totalFillLevel', percent);
        }
    }

    /** 动态开启/关闭波浪晃动 */
    public setWaveActive(active: boolean) {
        if (!this._mat) return;
        this._mat.setProperty('waveHeight', active ? this.waveHeight : 0);
        this._mat.setProperty('waveSpeed', this.waveSpeed);
    }

    /** 
     * 精确移除指定数量的顶层水块
     */
    public popLayers(count: number) {
        for (let i = 0; i < count; i++) {
            this._waterColors.pop();
        }
    }
}
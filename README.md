# 户型装修设计

中文 | [English](README.en.md)

纯前端的户型装修设计工具。在 2D 平面图上绘制/编辑户型、摆放家具、拆改墙体、测量尺寸、标注房间，一键切换到 Three.js 3D 场景。零依赖、零构建，一个静态服务器即可运行。

---

## 目录

- [功能总览](#功能总览)
- [快速开始](#快速开始)
- [工程文件树与职责](#工程文件树与职责)
- [两阶段模型](#两阶段模型)
- [数据模型（概念）](#数据模型概念)
- [快捷键](#快捷键)
- [常见改动指南](#常见改动指南)
- [技术栈](#技术栈)
- [许可协议](#许可协议)

---

## 功能总览

### 阶段 1：户型编辑（edit）

- 画墙（拖动绘制，Shift 锁定正交，斜墙按中心线生成任意角度）
- 画矩形房间 / 智能房间（点击空白处，射线扫描自动沿墙识别多边形）
- 开门 / 开窗（点击墙上任意位置，自动吸附到墙中心线，支持斜墙）
- 房间顶点编辑（选中房间后拖动实心顶点、点边中点插入新顶点、右键删除顶点）
- 墙端点拖动、墙身整体拖动（联动吸附其上的门窗）
- 门 / 窗端点沿宿主墙滑动
- 门属性：门宽、厚度、类型（普通门/入户门）、铰链位置（左/右端）、开启方向（内/外），三者独立可调
- 测量工具（吸附墙面、Shift 锁定正交）
- 拆改非承重墙（承重墙不可拆）
- 自动尺寸链（按房间最长边为主方向，文字角度归一化到头朝上，符合中国建筑制图规范）
- 图层开关：尺寸 / 房间尺寸 / 房间名 / 网格 / 承重墙 / 贴墙吸附
- 自定义原点（把任意点设为坐标系原点）
- 户型文件保存 / 加载（.plan.json）

### 阶段 2：装修布置（layout）

- 从左侧家具库拖入 60 余种家具家电（卧室 / 客厅 / 餐厨 / 卫浴 / 家电 / 书房休闲）
- 拖动移动、旋转（Shift 自由角度）、调整尺寸，贴墙自动吸附
- 硬装锁定：装修阶段不可编辑墙、门、窗，只允许操作家具和房间
- 房间地面材料切换（木地板 / 地砖 / 大理石 / 水磨石 / 地毯等），含 5% 损耗估算造价
- 房间面积 / 套内使用面积自动统计
- 测量、拆改非承重墙、图层开关

### 3D 场景

- 鸟瞰 / 斜视 / 俯视，点击房间列表飞到对应房间
- 点击门开关（动画平滑摆动 90°）
- 全高墙 / 剖切墙切换（剖切高度 1.2m / 2.8m）
- 日照时间滑块、夜景灯光
- 墙体按门窗洞口分段生成，门洞 / 窗洞处不会堵住
- 窗玻璃 + 窗框、门板 + 门把手的实体几何

### 通用功能

- 撤销 / 重做（Ctrl/⌘ + Z、Ctrl/⌘ + Y、Ctrl/⌘ + Shift + Z），2D 和 3D 视图同时刷新
- 方案自动保存在浏览器 localStorage
- 中文 / 繁體中文 / English 三语界面切换
- 导出 PNG（2D 平面 / 3D 截图）、导出 / 导入方案 JSON
- 全屏
- 全触屏支持（iPad / 手机）：单指平移、双指缩放、摇杆漫游

---

## 快速开始

方式一：直接用浏览器打开 index.html。

方式二：起一个本地静态服务器（推荐，避免 ES Module 的跨域限制）：

    python3 -m http.server 8000

浏览器打开 http://localhost:8000/

Three.js 通过 jsDelivr CDN 加载，首次打开 3D 场景需要联网。若需离线运行，参考下方「常见改动指南」中关于 vendor 目录的说明。

---

## 工程文件树与职责

    design-tool/
    ├── index.html                    页面骨架（DOM 结构 + importmap）
    ├── README.md                     本文件
    ├── css/
    │   └── app.css                   全部样式（基础、布局、2D、3D、触屏适配）
    └── js/
        ├── main.js                   入口：创建 App 并启动
        │
        ├── core/                     ★ 核心层（不依赖具体视图）
        │   ├── EventBus.js           事件总线，跨模块通信
        │   ├── I18n.js               多语言（zh / zht / en）、翻译函数
        │   ├── Utils.js              DOM / 几何 / 颜色 / 数值工具
        │   ├── Store.js              应用状态 + 撤销栈 + 持久化
        │   └── App.js                应用主控：boot / 视图切换 / 全局快捷键
        │
        ├── data/                     ★ 数据层（静态数据 + 默认值）
        │   ├── planData.js           默认户型几何 + 线性构件工具函数
        │   ├── furnitureLib.js       家具库条目（分类、默认尺寸、颜色）
        │   └── defaultLayout.js      初始状态装配（完整状态 / 纯户型 / 空户型）
        │
        ├── model/                    ★ 文件模型层
        │   └── PlanFile.js           .plan.json / .design.json 读写与格式规范化
        │
        ├── stage/                    ★ 阶段管理
        │   └── StageManager.js       户型编辑 ↔ 装修布置切换
        │
        ├── view2d/                   ★ 2D 渲染（SVG）
        │   ├── Viewport.js           viewBox 管理（缩放 / 平移 / 坐标换算）
        │   ├── FurnSVG.js            家具 2D 图例（按 type 分支）
        │   └── PlanView.js           2D 主视图（渲染 + 交互 + 智能房间 + 自动尺寸链）
        │
        ├── view3d/                   ★ 3D 渲染（Three.js）
        │   └── Scene3D.js            3D 场景（与 2D 共享 store 状态）
        │
        └── ui/                       ★ UI 组件
            ├── Toolbar.js            顶部工具栏（按阶段重建）
            ├── LibraryPanel.js       左侧面板（家具库 / 户型资源）
            └── PropertyPanel.js      右侧属性面板（按选中对象切换）

### 分层依赖

    Utils / EventBus / I18n
        ↑
    Store  ←──  bus.emit('store:changed')
        ↑
    App  ───  持有 store / stage / view2d / view3d / toolbar / libPanel / propPanel
        ↑
    ├── PlanView    ←─ Viewport + FurnSVG + planData
    ├── Scene3D     ←─ planData（几何工具）
    └── Toolbar / LibraryPanel / PropertyPanel

### 关键约定

- 所有几何数据都在 app.store.state 里（plan + layout），视图只读不缓存
- 修改数据必须通过 store.mutate(label, fn)，这样才会进撤销栈 + 触发全视图刷新
- 数据变化时由事件总线统一广播：App 监听 store:changed → 依次调用 view2d.renderAll() / propPanel.render() / view3d.sync() / toolbar.sync()
- 要往 2D / 3D / UI 增加功能，绝大部分时间只需改一个文件；跨层改动只发生在新增数据类型时

---

## 两阶段模型

document.getElementById('app').dataset.stage 决定当前阶段：

- edit（户型编辑）：工具栏 = Toolbar 的 _editHTML + LibraryPanel 的 _editHTML；负责画墙、画房间、放门窗、编辑顶点
- layout（装修布置）：工具栏 = Toolbar 的 _layoutHTML + LibraryPanel 的 _layoutHTML；负责拖放家具、改地面、3D 预览

阶段切换通过 app.stage.enter('edit') / enter('layout') 完成。StageManager 会依次：

1. 更新 #app 的 data-stage 属性
2. 让 Toolbar / LibraryPanel / PropertyPanel 重建 HTML
3. 若从 3D 切到 edit，自动切回 2D
4. 清空当前选中项

编辑阶段的限制：

- 只能 2D（点 3D 会提示先切回 layout）
- 可用工具：select / draw-wall / draw-room / auto-room / add-door / add-window / measure / demolish

装修阶段的限制：

- 硬装（墙 / 门 / 窗）锁定，点击不会选中或拖动
- 编辑类工具被拒绝，自动切换到 select（由 PlanView.setTool 内拦截）

---

## 数据模型（概念）

### 线性构件（墙 / 门 / 窗）

墙 / 门 / 窗统一使用「中心线 + 厚度」格式：

- x0, y0, x1, y1：中心线的两个端点（单位 mm，任意角度）
- t：厚度
- kind：墙类型 —— n 普通隔墙 / b 承重墙 / e 外墙 / low 矮墙

门在此基础上附加：

- hostWall：宿主墙 id
- hinge：铰点在哪一端 —— left 表示 x0y0 端，right 表示 x1y1 端
- swing：开向哪一侧 —— in 表示墙法线的 +90° 方向，out 表示 -90° 方向
- entry：是否入户门

窗在此基础上附加：

- hostWall：宿主墙 id
- sill：窗台高
- height：窗高

**关键设计**：hinge 与 swing 完全解耦。改铰点只改 hinge，改开向只改 swing，两者互不影响。渲染时根据 hinge 决定用哪一端作铰点，根据 swing 决定门扇朝墙的哪一侧开。

### 房间

- id / name
- poly：任意多边形顶点数组（逆时针）
- mat：地面材料 key（取自 plan.mats）
- at：房间名显示位置
- counted：false 时不计入使用面积（如飘窗）

### Store 状态

- meta：元信息（名称、创建时间、版本号）
- plan：bounds（画布范围）、origin（自定义原点）、walls / windows / doors / slides / rooms / mats
- layout：furniture（家具列表）、demolished（拆改的墙 id）、measures（测量线）

---

## 快捷键

| 按键 | 作用 |
| --- | --- |
| T | 切换 2D / 3D |
| V / M / X | 选择 / 测量 / 拆改墙体 |
| R / Shift+R | 旋转选中家具 90° |
| Delete / Backspace | 删除选中家具 |
| Ctrl/⌘ + D | 复制选中家具 |
| Ctrl/⌘ + Z | 撤销（任何阶段都生效） |
| Ctrl/⌘ + Y 或 Ctrl/⌘ + Shift + Z | 重做 |
| F | 适应窗口 |
| + / - | 放大 / 缩小 |
| [ / ] | 展开 / 收起左侧栏、右侧面板 |
| Shift + F | 全屏 |
| Esc | 取消当前操作 |
| 漫游：WASD / 方向键，Shift，E | 移动、快走、开关门（精简版 3D 暂不支持漫游） |

---

## 常见改动指南

**新增家具类型** —— 需要依次修改：

1. js/data/furnitureLib.js：往条目数组里追加一条（分类、type、名称、宽、深、颜色）
2. js/view2d/FurnSVG.js：在 furnSVG 函数里加一个 type 分支（不写会退化成纯色矩形）
3. js/view3d/Scene3D.js：在 buildFurn 的高度映射里加一行（不写默认高 0.6m）

**修改默认户型** —— js/data/planData.js 里的 DEFAULT_PLAN 常量：墙、窗、门、房间、材料。改完需要清 localStorage（key = huxing-design-v1）才能生效。

**调整界面样式** —— 全部样式集中在 css/app.css：

- 全局变量（颜色 / 字体 / 圆角）在 :root 里
- 工具栏、左侧面板、右侧面板分别用 .grp / .lib / #panel 前缀
- 阶段切换控件单独定义在文件末尾

**扩展 3D 场景** —— 目前 js/view3d/Scene3D.js 是精简版（无漫游 / 无 2D 标签 / 无环境贴图）。如需恢复完整版：参考同文件顶部注释，重新引入 PointerLockControls / RoomEnvironment / CSS2DRenderer 三个 addons 即可。

**离线运行 Three.js** —— 用 npm 安装 three，把 build 和 examples 两个目录拷到项目里的 vendor 目录，然后修改 index.html 里的 importmap 指向本地路径。

**新增房间 / 墙体工具** —— 需要三处联动：

1. UI 层加按钮（Toolbar 或 LibraryPanel）
2. PlanView.setTool 里注册工具名，syncModeHint 里加提示
3. PlanView._pointerDown 里加分支处理，_pointerMove / _endDrag 里加拖拽逻辑


---

## 技术栈

- 原生 HTML / CSS / JavaScript（ES Modules），无框架、无构建
- 2D 平面图：SVG（矢量，无损缩放，物理单位 mm）
- 3D 场景：Three.js r160（OrbitControls）
- 数据持久化：localStorage（key = huxing-design-v1）
- 多语言：内置 I18n 模块，支持简 / 繁 / EN
- 主题色：橙棕 #b5653a（装修阶段主色）、墨绿 #2f5d62（编辑阶段主色）

---

## 许可协议

MIT
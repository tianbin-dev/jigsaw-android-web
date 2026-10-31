# 数字推盘 · NumPush 网页版

`jigsaw-android` 的浏览器复刻版。原 App 的真实玩法并不是「拖拽拼图」，而是 **数字推盘（15-puzzle 类）**：盘面右下角留空，点击与空格相邻的数字让它滑入空格，直到数字按 1 → n²-1 的顺序排好。

网页版保留 3×3 / 4×4 / 5×5 三档难度、计时器、暂停/继续、胜利弹窗与难度选择底部弹层，并额外支持拖动数字、键盘操作。

## 本地运行

无需构建、无依赖，任意静态服务器即可：

```bash
cd <本项目目录>
python3 -m http.server 8000
```

打开 <http://localhost:8000>。直接双击 `index.html` 也能玩。

## 玩法

- **低级** 3×3、**中级** 4×4、**高级** 5×5，可在开始页「修改」中切换。
- 点击空白格上下左右相邻的数字，数字会滑入空白格；也可以把数字拖向空白格。
- 键盘：`Tab` 选中数字后按 `Enter` / `空格`。
- 计时按秒累加；右上角按钮暂停，暂停弹层可继续或退出。
- 排好全部数字后弹出胜利弹窗：「关闭」回到开始页，「再玩一次」以当前难度重新开始。

## 文件结构

```text
index.html                  入口页面（开始页 / 游戏页 / 三个弹层）
css/style.css               布局、棋盘、动效、响应式
js/game.js                  切图、打乱、移动、通关、计时、交互
assets/number_level_3.png   3×3 原始关卡素材（来自 App assets）
assets/number_level_4.png   4×4 原始关卡素材
assets/number_level_5.png   5×5 原始关卡素材
README.md
```

## 部署到静态托管

所有资源路径均为相对路径，可直接部署在根目录或子路径。

**GitHub Pages**

1. 把 `index.html`、`css/`、`js/`、`assets/` 提交到仓库。
2. 仓库 Settings → Pages → Source 选 *Deploy from a branch*，分支 `main`、目录 `/ (root)`。
3. 访问 `https://<用户名>.github.io/<仓库名>/`。

**Vercel**

1. 导入仓库，Framework Preset 选 *Other*。
2. Build Command 留空，Output Directory 填 `.`。
3. 部署完成后使用分配的域名访问。

也可直接用 Vercel CLI：`vercel --prod`（项目根目录执行）。

## 与原 App 的对应关系

| 原 App | 网页版 |
| --- | --- |
| `GameView` 按关卡从图片切块绘制 | 同一张 `number_level_*.png` 通过 CSS 背景切片渲染，格子与数字一一对应 |
| 点击空格相邻数字交换 | 保留点击，并新增拖拽/键盘作为等价输入 |
| `PieceUtil.getRandomValues` 随机排列 | 从完成态随机走合法步打乱，保证可解 |
| 计时器、暂停、胜利弹窗、难度底部弹层 | 全部还原，文案沿用中文资源 |
| AdMob / Firebase Remote Config / Play 服务 | 未包含（网页无需广告与远程开关） |

已知差异：原 App 的随机排列约有一半概率产生无解盘面，网页版改为保证可解；原 App 计时超过 1 小时会显示成 `01:60:00`，网页版使用标准 `HH:MM:SS`；进度不持久化，刷新后回到开始页（与原 App 行为一致）。

## 验证

使用 Playwright 在本地静态服务器上验证通过：三档切图位置、点击/拖拽/触摸/键盘移动、3×3 自动求解通关、胜利弹窗与计时停止、再玩一次、暂停/恢复/退出、刷新重置、320/390/844/1280 宽度无横向溢出，控制台无报错、资源无 4xx。

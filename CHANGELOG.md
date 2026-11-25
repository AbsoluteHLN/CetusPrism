# Changelog

所有显著变更记录于此。格式参考 Keep a Changelog；版本号遵循 SemVer。
本文件自 1.7.3 起建立——此前的版本历史以 git tag 与提交记录为准。

## [2.0.2-prelease-2026-11-22-A] - 2026-11-22

版本线说明：产品版本 `1.8.1` → `2.0.2`；workspace 包版本 `0.2.1-alpha.1` 保持不变
（`docs/UPSTREAM.alignment.json` 的 `productVersion` 同步为 `2.0.2-prelease-2026-11-22-A`）；这是 `v2.0.1` 预留的「含 IDE 模式」大版本线的延续。

### IDE 模式重构为会话级工作台

- **会话级入口**：IDE 不再是侧栏里的全局面板，而是每个会话自己的入口——会话行内按钮与会话「...」菜单中的「在 IDE 中打开」。打开时绑定该会话的工作区与对话。
- **三栏工作台**：左栏是该会话的项目文件树，中栏是正在阅读的文件，右栏是该会话的助手对话（共享对话内容的 `embedded` 变体，显式绑定同一会话），三栏与主对话区彼此独立。
- **IDE 自己的身份**：跨三栏的标题栏点明 IDE、绑定会话与项目路径（面包屑分段），每栏各有栏头（图标、栏名与该栏最清楚的细节），状态栏归入中栏、贴在它描述的代码下方，给出当前文件路径、行列位置、行数与字符数。
- **IDE 的界面与本体对齐**：标题栏改用本体的中央面板几何（20/28px 内边距、0.5px l3 底线、会话名作当前面包屑、项目路径作祖先面包屑并以 `/` 分隔），栏头改为无底色无分割线的分区标签，标签页改用本体的视图标签样式（13px/500、当前项 business-primary 加 2px 下划线），文件树行改用侧栏同款 radius-md + 交互态填充（去掉自造的强调色条），状态栏改为输入框指标行那样的平贴小字。原先「图标方块 + 字标 + 等宽路径胶囊 + 大写字母栏头 + 药丸标签页 + 左侧色条选中态」这套编辑器自造语汇整体移除。
- **可调整的栏宽**：两条分隔条可拖拽调整文件栏与助手栏宽度（也可用方向键微调），文件栏可整体收起为图标条；布局记忆在本地，下次进入沿用。
- **栏宽以编辑器为先**：三栏宽度不再写死——每一侧栏按它在这帧里的比例封顶（文件栏 30%、助手栏 40%），而中栏代码区始终保住 320px 下限；先让位的是文件树，其次是助手栏，代码栏最后。助手栏可一键收成 44px 图标条。布局记忆键升到 `dsh.ide.layout.v3`。
- **进入 IDE 自动收起左侧栏**：IDE 接管整帧时，应用自身的左侧栏自动收起，离开时按原状态还原——新接口 `ctx.layout.setSidebarCollapsed()` 明确说明宿主要的状态，「切换」分不清「进入」与「离开」。
- **IDE 现在可以编辑文件**：中栏不再是只读代码卡片，而是自建的可编辑代码面——文字区叠在高亮层上（插入符、选区、撤销栈仍归浏览器所有），代码填满整栏、文字不换行、行号独占一栏不被裁切；Ctrl+S（Cmd+S）写回磁盘，Tab 插入两个空格，插入符行列报到状态栏。文件改动后标签页带脏点，栏里出现保存按钮。
- **写回磁盘的双重守卫**：宿主新增 `workspaceFiles.write` Remote，写入必须留在会话工作区根内、按该会话自己的沙箱模式执行（只读会话直接拒绝），并以调用方读到的版本号作守卫——被 Agent 在编辑器底下改写过的文件会被拒绝而不是覆盖，改动留在屏幕上、状态栏说明原因。重新读取不会丢掉用户的编辑。
- **助手栏的输入框固定**：右栏改为定高 flex 容器，滚动交给共享对话自己管——消息在输入框下方滚动，输入框始终固定在栏底；此前整栏（消息、输入框、状态条）作为一个块一起滚动，输入框会跟着消息滚走。
- **IDE 模式精简，助手栏不再带 computer use**：IDE 右栏向共享对话索取**精简版**输入框，只留文本区、命令按钮与发送按钮——访问模式、「允许抢前台」（computer use 投递开关）、标准模式与后端、计划模式、模型选择器、活动控件与指标行全部不再出现在右栏，这些座位在精简形态下根本不会被派发，背后不会挂载任何东西。精简是宿主显式要来的：`variant: 'embedded'` 在侧栏 subagent 对话那里含义不变，主面板也从不索取精简版。助手栏默认宽度收窄为 420px（文件树仍为 260px），布局记忆键升到 `dsh.ide.layout.v2`，以便沿用新设计的默认比例。
- **文件树按 IDE 观感呈现**：目录随展开状态切换文件夹图标，文件带各自的类型图标，已打开文件保留标记，当前文件用与侧栏一致的选中态填充标出。
- **文件树实时跟随 Agent 的改动**：IDE 文件树原先只在目录首次展开时列举一次，此后 Agent 在同一工作区里的写入一概看不见，只能靠标题栏的手动刷新。现在每个已列出的层级都会通过宿主 `workspaceFiles.changes` 的受监管流被观察：一次观察重新列举该层级，并重读其下处于干净状态的已打开文件，Agent 的落盘改动无需手动刷新即到达树与编辑器。脏编辑器、写入中的文件与读取失败的文件一律不重读（不丢用户的编辑）；监视失败安静退场，手动刷新照常兜底。
- **IDE 文件实时刷新修复**：上一条的实时跟随在 Windows 上有两处失效，已修复。其一，观察是**一次性**的：宿主流一旦结束（连接抖动、世代重开），该层级的监视便静默死亡且永不重开，此后该层级的文件永远停在旧内容、且没有任何报错——监视结束时释放路径并重新列举该层级，掉线只代价一个轮次而不是整个会话。其二，重读范围靠**原始前缀比较**判定，而树用 `/` 拼接子路径、宿主用自己的分隔符与大小写书写同一目录，两种拼法对不上时已打开文件就被排除在每一次观察之外；现在观察事件携带**宿主书写的目标路径**，比较经归一化键（`/` 分隔 + 大小写折叠）进行，与路径拼法无关。
- **产物链路修复**：前端打包消费的是各包的构建产物而非源码，`build:web` 不会重建依赖包——补跑 `build:lib:client` 之后，新界面才真正进入成品。

### IDE 排版与主题色板修复

- **标题栏的项目路径不再被压成单字母**：路径的每一段面包屑此前各自参与收缩，窄窗口下整条路径被压成 `C / \ / 1 / A. / \ / 1 / dsh-…` 这样的单字符序列，读不出项目名。现在每一段保住自己的宽度；标题栏放不下时，中间的几段折成一枚 `…` 面包屑，项目名（最后一段）始终完整可读。
- **应用根节点补上主题属性**：`#root` 只命中 dist 的 `[data-hln-ui-root]` 默认调色板（浅色），于是合成器上方的淡出带是白条、发送键用的是瓷白主题的靛蓝强调色、细线与背景纹理也一并取错色板。现在 `#root` 与 `<html>` 同带主题属性，v3.5 与 v4 两层的调色板在应用内正确解析，发送键回到石墨主题的琥珀色。
- **合成器淡出带改用应用自己的表面色**：淡出带此前直接读 dist 的 `--hln-ui-bg-0`，现在读 `--dsw-alias-bg-base`——它在 body 上解析，主题当下有效——白带消失，浅色主题下也不会翻白。
- **旧主题真的能切换**：主题目录里 v3.5 的六个平面（veridian-stream、synapse-violet、cobalt-manifold、titanium-oxide、alabaster-studio、bauhaus-compiler）此前点选后只落库不落 DOM（shim 的白名单不含它们，界面毫无变化），现在目录里 16 个主题都会真正写入 `<html>`、`<body>` 与 `#root`。
- **排版落成回归用例**：新增 `apps/web/tests/ide-layout.e2e.ts`，在真实浏览器里量三栏铺排、两条缝隙的位置、行号与代码逐行对齐、状态栏归属，以及面包屑不被压扁、窄窗折叠、合成器淡出带不偏色。

### 账号登录修复

- **平台账号接口的信封读对了**：宿主读账号资料与余额时原先只认 DSH 信封（`{code:0,data:{biz_code,biz_data}}`），而平台账号接口（`/auth-api/v0/users/current`、`/api/v0/users/get_user_summary`）返回的是普通信封 `{code,msg,data}`。信封对不上时被当成普通失败——**既不报错也不退出登录**，于是账号页停在「已登录 DeepSeek / 账号资料暂不可用」、充值与赠金两行空白的半吊子状态。现在两种信封都读：DSH 部署的业务信封照旧解包，平台账号接口直接取 `data`；畸形的业务信封仍然是协议失败，不会被当成普通负载放行。
- **失败不再静默**：账号资料读不出来时，状态行说明「账号资料读取失败」并给出「重新登录」入口，用户不必先退出登录才能重来；余额读失败时两行仍保留去开放平台查看的链接。
- **手机号账号也读得出资料**：账号资料投影不再要求 email 字段，只带手机号的账号照样投影出联系方式。
- **客户端测试基座补齐 `agentPresets/backends`**：上一轮新增的执行后端目录 RPC 没有在共享 remote mock 里注册，导致所有装载完整客户端运行时的测试以「未匹配的请求」失败，本轮一并补上。

### 执行后端链路完善

- **选回 DSH 也通知宿主**：composer 后端 chip 对 DSH 的选择原先不发 `selectBackend` RPC——从外部后端选回 DSH 时，宿主仍绑着刚被放弃的运行时，下一个会话照旧跑在外部运行时上。现在每一个 ready 选择（DSH 在内）都提交到宿主，由绑定会话的一方持有选择。
- **探测与运行同源**：registry 现在保存每个外部运行时被发现时的命令配置，`backendDriver` 构造适配器时用同一可执行文件 spawn——此前探测用配置命令、运行却落回上游默认命令，自定义安装路径的运行时探测得到却跑不起来。同时 `backendDriver` 只对 probe 判定为 `ready` 的后端返回驱动器工厂，不可用后端不再构造注定失败的运行时。
- **resume 对脏记录免疫**：会话日志里记录的后端标识现在过 `parseBuiltinAgentBackend` 白名单校验，未知值回落原生循环，resume 不再因一条坏记录失败。
- **驱动器代码去重**：Pi/ZCode/通用三个外部驱动器逐字重复的回合桥接（约 100 行 × 3）上移到 `BaseExternalAgentDriver` 一份实现，Pi 只保留 live steering 差异；abort 竞态工具（`runtimeAbortError`/`raceAbortSignal`/`awaitRuntimeIdle`）收敛为共享实现；修复 idle 时 steer 也会误发 RPC 的缺陷（`super.steer` 的同步唤醒先于状态采样）；删除 `formatRuntimeRequest` 等生产不可达的死代码。
- **边界补测试**：新增 60+ 用例覆盖取消语义（keepInbox、双重取消、idle 取消）、维护期唤醒闩锁、适配器故障容忍（abortTurn/stop 失败不扩散）、LlmError 结构化失败、降级事件桥接与目录刷新竞态，相关源文件达到每文件 100% 分支覆盖门禁。

### ZCode / Pi 接入打通

- **运行时路径第一次有地方可填**：外部运行时此前只能由部署在配置文件里指名，界面上没有任何入口，用户无从指定自装在 PATH 之外的 Pi/ZCode。现在「设置 → 执行底座」是一页，每个运行时一行——状态、无法启动会话的原因、以及它探测的可执行文件；留空仍用上游自带命令，填入路径即写入部署配置。
- **配置改了即刻生效**：`externalRuntimes` 此前是构造时读一次的普通字段，改配置要重启，探测结果另有 30 秒缓存。现在该字段是 live 的，registry 每次发布目录前重读配置，可执行文件一变就重建 provider 并立即重新探测。
- **目录说清「探的是哪个可执行文件」**：catalog 现在带上被探测的命令，以及部署是否指名了它。「已指名却没装」的运行时不再被当成「未配置」藏起来——composer 底座入口会解释这个缺口。
- **恢复不再换底座**：会话日志没记录底座的会话（原生会话）此前会回落到「宿主当前选中的底座」，恢复旧会话可能换一个驱动器接管历史。现在没有记录即原生循环，与文档和用例名一致。
- **创建不再静默回落 DSH**：选中的外部运行时无法启动会话时，创建会以 `session/backend-unavailable` 明确拒绝，而不是悄悄在原生循环上跑一个不是用户所选的会话。

### Kalcirite UI 能力补齐

- **三个背景预设此前点了没反应**：v4 层的七个静态环境底纹里，页边发丝规线、手迹稿纸横线、犊皮纸纵向纤维这三项不在 shim 的白名单里，`applyBgMotion` 直接拒绝——界面提供却无法应用。现在白名单补齐，十四项背景预设全部可用；新增的 e2e 用例逐一断言「被接受 + 画出内容 + 不播放动画」。
- **拉丁字体档位真正落地**：v4 层把档位重指向 `--hln-ui-font-current`，而应用把界面字面钉死在 `--hln-ui-font-display`（这个变量无人消费）——九张字体卡片此前全是空操作。现在界面字面、标题与控件都读档位引用，浏览器实测选 editorial 后根节点字面变为 Optima/Georgia 栈；三个「宿主兼容」伴随栈（geometric / cyber / berlin）也补上档位映射，每张卡片都生效。
- **入场动效改用 v4 家族**：v3.5 与 v4 两层并存，v3.5 的 preset 规则用 `animation` 简写占住了 `animation-name`，于是应用一直播放 v3.5 级联，v4 的七个变体从未触发。现在设置类界面显式传入 v4 变体（`rise`），变体类型也纳入 v4 的七个 id。

### 设置导航少一行的真因

- **「执行底座」不是没注册，是没进产物**：分区在源码里注册成功（客户端单测能取到 `agent-runtimes` 条目），真实浏览器里却查无此行。根因在构建链路：前端打包消费各包的 `lib/` 产物，而 `build:web` 不重建依赖包——`ui-agent-preset` 的 `lib/client.js` 还停在改动之前的那份 bundle，新分区根本没进成品。补跑 `build:lib:client` 后导航行出现，「执行底座」页可点开，Pi 行的可执行文件输入框可见。
- **回归用例锁住导航清单**：设置导航的 ARIA golden 现在包含「执行底座」这一行，导航少行或改名都会在真实浏览器里失败。
- **设置外壳的分区投影同步**：外壳的分区账本用例此前只列到「Agent 预设」，产品注册了执行底座分区后账本多出一行，用例按产品实际注册清单更新。

### Kalcirite v4 契约落地

- **field 语法接进应用**：v4 层用 `[data-hln-ui-field]` 定义字段（高度、发丝描边、表单字面、聚焦环），而应用此前没有任何元素带这个属性——契约形同虚设。现在共享 `Input` 原语的外框携带该属性，由引擎绘制字段；外框显式声明 border-box，因为设置面板 portal 到 body 后不再落在引擎根节点内，引擎自己的 border-box 规则够不到它。
- **聚焦环仍归应用**：引擎的字段契约给出环的形状（3px 软环）与聚焦边框颜色，环的颜色仍由应用的 `--dsw-focus-ring-color` 决定——焦点环语料门禁只认这一种写法，字段因此没有另立一套环色。
- **滚动条统一到引擎契约**：应用此前自带一条 4px 私有滚动条轨道，与引擎 `[data-hln-ui-scroll]` 的 10px 药丸拇指并存，同一屏里两种滚动条。现在会话正文、设置导航与选项区、菜单、悬停卡片、内联编辑器都挂上契约属性，全局兜底改为与契约同值，整个 shell 只剩一条轨道。
- **选中态交回引擎**：应用原先用一份私有的选中态规则（12% 强调色 + 左侧 3px 内嵌条）压住引擎的 Wash。现在引擎控件由引擎绘制（10% 强调色 + 强调色字），应用只保留引擎够不到的两处（自己的按下按钮、设置导航行）；运行时发布控件词汇表（accent / ghost / quiet / danger 与 wash 状态），界面按名字索取，未知名字与未知主题一样被拒绝。
- **圆角收敛为三轨**：引擎对齐层此前并存三条轨道——引擎的软几何（4/6/8px）、方角覆盖（0）与私有的 2px 字面量。现在只剩三轨：控件与内联框 radius-sm、卡片与面板 radius-md、对话框与大表面 radius-lg；方角只留给 1px 分隔线（否则线头会变成圆角）。
- **运行时皮肤接通**：主题卡片现在通过 dist 自己的 `createHlnSkin` / `applyHlnSkin` 驱动引擎皮肤层，样式表没有对应块的主题（如奇点青、张量琥珀）也会把自身颜料绘制到应用根节点上；引擎校验令牌名与颜色值，被拒绝的皮肤保留样式表主题。
- **新增浏览器用例**：新增 `apps/web/tests/cetus-v4-contract.e2e.ts`，在真实 Chromium 里量控件词汇表、滚动契约、字段高度与圆角、三条圆角轨道、引擎绘制的 Wash，以及运行时皮肤写入根节点内联变量。

### 上游第四轮同步（选择性回移）

- 增量 260 个提交中，仅 3 个在本地前置成立并通过 `git apply --check`：`85c775322f`（goal 状态中文区分）、`e7065bb5ac`（PDF 文本层脱离布局）、`ff42bb3f0d`（多文件 patch 只高亮 hover 项）。
- 上游 subagent 身份模型重构（`agent_id` → `agent`）与 fork 分歧重叠，不回移。

### 额度 persona 保持不变

- 「不用在乎额度」那套预设为 fork 自有资产，上游四个 preset 至今没有任何 token 预算措辞；本轮同步后 10 处出现（preset 5 + golden 5）逐处重新断言，未被上游文本覆盖。

## [1.8.1] - 2026-11-06

版本线说明：产品版本 `1.8.0` → `1.8.1`；workspace 包版本 `0.2.1-alpha.1` 保持不变
（`docs/UPSTREAM.alignment.json` 的 `productVersion` 同步调整为 `1.8.1`；`v2.0.1` 预留给未来的「含 IDE 模式」大版本）。

### 独立 Loop 架构解耦与 Agent 预设修复

- **ZCode 与 Pi 独立 Loop 拆分**：根据规格要求将 ZCode (`zcode-loop-agent.ts`) 与 Pi (`pi-loop-agent.ts`) 拆分为独立的执行 Loop，剥离对单一主 agent-loop 的过度耦合，支持针对外部运行时专属生命周期、帧协议和取消控制，并建立完整的行为单元测试。
- **Agent 预设 API 404 修复**：解决客户端在 Agent 预设界面请求 `/api/agentPresets/list` 报 HTTP 404 的问题，确保预设服务正常注册至 Gateway 路由并注入运行时。
- **上下文压缩 (Compaction) 稳定性增强**：针对 `compaction-basic` 的 summarizer 进行循环收敛修复与单测回归，杜绝长会话压缩死循环风险。
- **工作区双版本线与依赖收敛**：确保全仓 330+ 工作区子包严格维持 `0.2.1-alpha.1`，通过 `check-workspace-constraints.spec.ts` 112 项门禁约束校验。
- **临时环境与验证文件彻底清理**：清除排查过程中产生的 scratch 与验证脚本，保持工作区纯净，完成 v1.8.1 正式发布构建。

## [1.8.0] - 2026-11-04

版本线说明：产品版本 `1.7.5` → `1.8.0`；workspace 包版本 `0.2.1-alpha.1` 保持不变
（`docs/UPSTREAM.alignment.json` 的 `productVersion` 同步调整为 `1.8.0`；`v2.0.1` 预留给未来的「含 IDE 模式」大版本）。

### KalciriteUI v4 全面接入与 UI 软几何美化

- **KalciriteUI v4 资产接入**：正式接入 `apps/web/public/hln-ui-v4/`（包含 tokens、folio、themes、base 及运行时兼容垫片 `hln-v4-fix.js`），支持 8 款全新 Folio 主题。
- **软几何演进**：将全局控件与界面的 0px 直角全面升级为 4px（按钮/输入框）、6px（卡片）、8px（弹窗/主面板）。
- **The Wash 签名选中态**：实现 10% 主色洗色背景 + 3px 前导纵线 + 主色文字的视觉呈现。
- **双颜料高阶调色**：引入主颜料（Primary Pigment）与冷调次颜料（Cool Accent），在界面中呈现细腻色温层次。

### 统一主题系统 (Unified Theme & Typography)

- **收敛离散排列**：将原本 8 主题 × 8 西文字体 × 7 中文字体 × 8 背景动效的 3500+ 离散组合收敛为 8 款开箱即用的预设推荐主题包。
- **一键原子联动**：在外观设置中选择主题卡即刻同步更新主题、西文字体、中文字体与背景动画；卡片内提供三色实心预览色板与深浅色模式指示。
- **平滑降级支持**：依然完整保留底层字体与动效的独立微调选择能力。

### 背景动效真实可见性修复

- **根因修复**：排查并彻底解决 `.frame`、`.centerCol`、`ConversationRoot` 容器多层叠加 55% 底色造成复合不透明度达 91% 遮蔽底层 18% 流光动画的问题。
- **透光重构**：将中间层背景重设为 transparent，统筹顶层单层毛玻璃质感并优化扫描光柱饱和度，使环境动画真实柔和生效。

### 核心特性与架构升级

- **外部智能体驱动器接缝 (External Agent Driver)**：引入统一驱动器架构，完善对 Pi 与 ZCode 外部运行时底座的接入与统一帧通信协议。
- **安全 mTLS 与 Aeroidz 跨网络链路**：新增 mTLS 支持、aeroidz CA 证书工具链与吊销序列，收紧 OID 证书校验。
- **无限 Token 预设指令**：全量预设配置中支持注入无限 Token 预算指令。

## [1.7.5] - 2026-10-26

版本线说明：产品版本 `1.7.4` → `1.7.5`；workspace 包版本 `0.2.1-alpha.1` 不变
（`docs/UPSTREAM.alignment.json` 的 `productVersion` 随产品版本推进）。
本次按既有发布形状手工提升（根 `package.json` + 两个安装器应用 + 对齐记录 + 约束期望值），
**未使用** `pnpm run release:dsh`——该脚本按上游 dsh 的「全族单一版本线」模型工作，
会把约 280 个工作区包一并改写成产品版本，与本仓的双版本线约束闸门冲突。

### 模型目录反复取数与连接卡顿：一个根因族

- **根因（取数风暴）**：`llm/adapters-updated` 是无载荷事件，adapter 每次注册/替换/注销都会发一次；
  客户端有 4 处独立位置各自发 `session/modelCatalog` RPC，而 Host 端既无缓存也无 single-flight，
  每次都全量重算 providers × models。
- **根因（卡顿）**：客户端的 `ModelCatalogDirectory.refresh()` 主动清空在途请求，
  每个事件必开一条新请求；Chromium 同源 HTTP/1.1 只有 6 条并发连接，第 7 条起排队——
  于是「模型反复获取」在用户侧就表现为「后端与软件本体连接卡顿」。
- **放大器**：WS 心跳 2s，连续 2 次丢 pong 即 `terminate()` 重连，事件循环抖动被放大成一次完整重连，
  UI 还会强制显示 800ms「重新连接中」。
- **修复（Host 侧）**：`packages/api/session-controller/src/model-catalog-cache.ts` 新增
  `ModelCatalogCache`——TTL 3s + single-flight + generation 失效。`llm/adapters-updated`
  只作废不再重算；部署默认选择变化时缓存自动重建（默认键比对）。
- **修复（客户端侧）**：`packages/client/ui-model-selection/src/client/catalog.ts` 把同一波事件
  合并成一次读（60ms 窗口）；刷新期间目录立即置 `loading`，旧值不再应答读者；
  已在途的读**不丢弃**——等它结算再读一次，保证合并后仍拿到新鲜目录。
- **修复（面板侧）**：`packages/client/ui-settings-models` 的刷新同样合并，且只在已加载时刷新，
  空闲页面不因 adapter 事件白白取数。
- **回归**：`model-catalog-cache.host.spec.ts`（5 例）、`catalog.client.spec.ts`、
  `store-refresh.client.spec.ts`。三条红线各自被证伪后还原：关掉 Host 缓存复用 → 2 失败；
  客户端改回立即 reload → 2 失败；面板改回立即 load → 1 失败。

### Pi 与 ZCode 收敛为一种「外部运行时底座」

- **一个模式，两个上游**：`packages/preset/agent-preset-registry/src/external-runtime.ts`
  给出统一帧契约（request / notification / response / error）与统一帧解析——
  坏行返回 parse-error 帧，而不是抛出打断流。
- **底座从各自仓库来**：探测器只**查找**不下载。Pi 走 `pi --mode rpc --no-session`（JSONL），
  ZCode 走 `zcode app-server --stdio`（NDJSON）；未安装时报告「去哪个仓库装」，版本低于下限则拒绝。
- **不往产品依赖树加包**：两种底座都不作为 npm 依赖进入 CetusPrism，
  产品侧只提供统一适配器契约（`ExternalRuntimeAdapter`）。
- **去重**：`resolveBuiltinAgent` 的非 native 分支现在识别 pi/zcode，并说明「这是通过外部运行时
  注册表进入的同一种执行模式」，不再为 ZCode 保留一套独立底座逻辑。

### Linux 构建准备

- `apps/electron/scripts/build-deb.mjs` 的 `RUSTFLAGS` 增加
  `--remap-path-prefix=${CETUS_DEPENDENCY_ROOT}=cargo-cache`（含正斜杠形式），
  Linux 产物不再泄露依赖缓存绝对路径；此前只有 Windows 的 `build-shell.mjs` 做了这件事。
  前缀跟随依赖根而非硬编码，因此缓存放在别处的 Linux 主机同样覆盖。

## [1.7.4] - 2026-10-25

版本线说明：产品版本 `1.7.3` → `1.7.4`；workspace 包版本 `0.2.1-alpha.1` 不变
（`docs/UPSTREAM.alignment.json` 的 `productVersion` 随产品版本推进）。

### 思考强度按模型能力裁定（跨模型携带脏 effort 的根治）

- **根因**：思考强度是**每个模型各自的能力**，不是全局概念。实测 `csu` 网关：
  Qwen 只吃 `off/low/medium/xhigh`，给 `high` 直接 400
  （`Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.`）；
  GLM 七档全吃，DeepSeek 五档。父模型（GLM/DeepSeek）给 Qwen 子路由写下
  `high`/`max` 这类脏值时，委派被整体拒绝——**模型本身可用，是能力协商缺失**。
- **协议中立的档位阶梯**（`packages/llm/llm/src/reasoning-effort.ts`）：
  `REASONING_EFFORT_LADDER`（off < minimal < low < medium < high < xhigh < max）
  与 `selectSupportedReasoningEffort`（精确命中 → 不低于请求的最近支持档 →
  否则最高支持档），不认识任何 provider。
- **裁定点落在请求边界**（`packages/core/agent-loop/src/agent.ts`）：在 waterfall 之后、
  `prepareCall` 之前统一裁定，一处覆盖主 Agent / 子智能体 / Agent Team 成员三条路径。
- **降级值不冒充用户选择**：降级时把 `adapterDefaults.reasoningEffort` 置为 `true`，
  沿用 llm 层「adapter 填充的默认值不算用户选择」的既有语义，下次 seed 自动丢弃。
- **委派路径同规则**（`packages/subagent/tool-subagent/src/model-selection.ts`）：
  父模型写的档位属于「模型作者」而非用户选择，故降级而非报错；子模型完全没有档位
  词汇时丢弃该档、用其自身默认。
- **既有契约一行未动**：`packages/llm/llm/src/index.ts` 的 `resolveCallWithInfo` /
  `UNSUPPORTED_REASONING_EFFORT` 严格拒绝语义保持不变——同一模型上用户显式选的非法档仍报错。

### 通用思考强度探针

- **探针实现**（`packages/llm/llm-pi-ai/src/effort-probe.ts`）：本期支持
  `openai-completions`；每档恰好一次请求；`off` 不发请求且声明恒为 `null`；
  2xx 即接受，非 2xx 拒绝并有界读取正文（≤64 KiB）；解析端点自报档位集合；
  apiKey 绝不入消息与日志。错误码 `EFFORT_PROBE_UNSUPPORTED / FAILED / ABORTED /
  INVALID_CREDENTIAL`；`openai-responses` / `anthropic-messages` 明确报不支持。
- **宿主 seam**（`packages/llm/llm-pi-ai/src/effort-probe-host.ts`）：复用 discovery
  同款 `storedDiscoveryProfile` 懒解析，探针复用**宿主持有的凭证与部署头**（含自鉴权
  header 通道），凭据不由请求方传入。
- **宿主 API**：`registerReasoningEffortProbe` / `probeReasoningEfforts` 与
  `@Remote('probeReasoningEfforts')` 远程声明。
- **探测优先、端点自报为辅**：自报集合不能替代逐档实测，冲突以实测为准并在 detail 说明。
- **产出可直接落库**：`declaration` 键=档位名、值=wire 拼写、`off: null`，与
  `llm-pi-ai` 的 `reasoningEfforts` schema 完全兼容，无需改配置 schema。
- **Models 页 UI**（`packages/client/ui-settings-models`）：每个模型行新增「探测推理档位」
  与「写回声明」，写回**只动被探测的那一个模型条目**的 `reasoningEfforts`，不碰同
  provider 的其它模型；中英双语字典齐备。

### 目录与文档

- `scripts/gen-cordis-catalog.ts` 的 `LINK_MAP` 登记两个新 remote 类型，
  重新生成 `packages/extensions/tool-cordis/src/api-catalog.ts` 与
  `docs/subsystems/llm-streaming.md` / `.zh.md`；`gen-cordis-catalog --check` 回到 exit 0
  （121 个产物 up to date）。

### 测试与验证

- 受影响包全绿：agent-loop + tool-subagent 32 文件 / 601 用例；llm-pi-ai 18 / 418；
  llm 14 / 300；ui-settings-models 13 / 331。
- 全量回归（`vitest run --config configs/vitest.config.ts`）：1910 文件 / 38860 用例，
  98 个失败文件**无一落在本轮改动包**；失败签名分布与既有基线吻合（EPERM symlink 60 /
  超时 21 / 缺 pwsh 9）。
- lint（`tsx scripts/run-oxlint.ts .`）exit 0；25 个改动文件全部 LF-only、无 BOM。
- 真机客户端窗体实测：选中 `csu/Qwen3.8-Flash-Next` 发真实消息，2 秒返回且无 4xx/5xx；
  该模型的档位菜单实测为 `Default / Off / Low / Medium / Xhigh`。

### 备注

- 本次版本号变更：4 个版本文件（根、`apps/desktop`、`apps/electron` 的 `package.json`，
  `docs/UPSTREAM.alignment.json` 的 `productVersion`）与本 CHANGELOG；
  **尚未打 tag、尚未发布 GitHub Release**。
- `pnpm-lock.yaml` 实测零 diff（workspace 协议版本不写入 lock）。
- 328 个 workspace 包仍在 `0.2.1-alpha.1`，本轮不动。

## [1.7.3] - 2026-10-21

版本线说明：产品版本从 `1.7.1-beta.1` 直接推进至 `1.7.3`。
`1.7.1-beta.1` 与 `1.7.2` 均无对应 git tag（本地 tag 最高为
`v1.6.2-prelease-2026-10-6-A`；`origin/main` 历史含 `v1.7.0-beta.2`
release 元数据提交，见 `archive/2026-10-13/main-review-origin-main`）。

### OneBot 通道（dsh-bot-companion）

- **直接回复分流**：群聊/私聊消息先过确定性分类器 `classifyQqProcessing`
  （`index.js:1129`），问候语与确认类短句（`QQ_DIRECT_PREFIX` 前缀，
  `index.js:1084`）走 canned 直复路径 `sendDirectReply`（`index.js:2011`），
  真实请求经 `dispatchRoute`（`index.js:2043`）进会话队列；带
  `/dev` 前缀的前缀直复会升级为 agent 请求而非丢失。
- **会话并发模型**：每会话严格 FIFO（`enqueueConversation`，
  `index.js:1408`），跨会话并行受 `maxConcurrentSessions` 闸门约束
  （`acquireDeliverySlot`，`index.js:1436`）；`bot_qq_status` 工具暴露
  `concurrency` 探针（活跃/峰值/排队/丢弃计数，`index.js:1456`）。
- **入站媒体提取**：`extractInboundMedia`（`index.js:1186`）只报类型与
  NapCat 已落盘的本地路径，不透传 QQ CDN 短时效签名链。
- **发送可靠性与节流**：`onFrame` 按 `message_id` 全局去重防重连重放
  （`index.js:2174`），`sendAction` 节流（`index.js:2093`）。

### MCP server（tooLib/QQBot/mcp-server）

- **会话感知保留**：队列超限时优先驱逐「仍持有其他消息的会话」的最旧行，
  繁忙会话不再顶掉其他会话的可回复消息；每次丢弃都计数
  （`server.mjs:131-139`），`droppedMessages` / `oldestCursor` 随收件箱返回
  （`server.mjs:169`）。
- **收件箱游标语义**：`cursor < oldestCursor - 1` 返回 `cursor_expired`
  （`server.mjs:164`），过期游标必须重新全量拉取，绝不静默跳过。

### 测试基建（本轮新增 45 用例，全部离线）

- `dsh-bot-companion/tests/fake-qq-source.mjs`：离线 fake WebSocket 与
  gated prompt 宿主，测试不触网、不连真实 QQ。
- `dsh-bot-companion/tests/direct-reply.test.mjs`：31 用例，覆盖直复
  分类矩阵、直复端到端与错误路径。
- `dsh-bot-companion/tests/concurrency.test.mjs`：8 用例，覆盖会话内
  FIFO、跨会话并行、并发上限、队列满丢弃计数、global 模式与 steer。
- `tooLib/QQBot/mcp-server/tests/retention-observability.test.mjs`：
  6 用例，覆盖会话身份、保留驱逐、busy 恢复、媒体契约与 8000 字上限。
- 离线运行结果（`node --test`，node-runtime 绝对路径）：
  companion 套件 89 tests / 86 pass / 3 fail（3 例均为既有失败：
  `companion.test.mjs` manifest 导出形状 1 例、`connector.test.mjs`
  owner DM 与群成员 /dev 各 1 例，与本轮新增文件分进程隔离）；
  mcp-server 套件 37 tests / 37 pass。

### 备注

- 本次版本号变更随本 PR 提交：6 个版本文件（根与 4 个 app 的
  `package.json`、`docs/UPSTREAM.alignment.json` 的 `productVersion`）
  与本 CHANGELOG 已进入本分支；**尚未打 tag、尚未发布 GitHub Release**。
- `pnpm-lock.yaml` 实测零 diff（workspace 协议版本不写入 lock）。

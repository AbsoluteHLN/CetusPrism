# CetusPrism 多底座重构规格 v2

日期：2026-10-20。状态：待用户确认，尚未授权按本文实施。目标版本暂保持 1.7.1-beta.1；版本升级另由用户决定。本文是本轮开发规格，现行产品规则仍由各包 README 和 docs 拥有。

本文按用户最新指示修正底座划分：DSH（默认）、Pi、ZCode 是三套独立执行底座。本文替代未提交的 v1 草案，不保留重复草案文件。原有 ZCode 原则模式是现存 DSH 策略，不能作为第三套底座的实现或验收证据。

## 目标与范围

先归档失效计划和静态资源，再整理有重复职责的代码，完成官方 dsh 兼容迁移、统一扩展入口、可选择执行底座、KalciriteUI 真实组件接入、Auto review 与原生自动化检查，最后修复模型能力表达、Qwen 请求及默认工具上下文过大问题。所有完成项必须有对应代码、运行入口和验收证据。

本轮方向为 DSH 默认底座、可选 Pi Agent Core 底座及独立 ZCode 底座；composer 分别选择底座、模型和该底座支持的策略。界面使用 KalciriteUI v3 系列的 v3.5 官方组件语法重写。用户已指定 Pi，本轮不引入 OpenCode。CompletionQAMCP 仅用于开发验收，不复制进 CetusPrism，也不作为用户安装包依赖。

## 已核实状态

| 项目 | 2026-10-20 核实结果 | 依据 |
|---|---|---|
| 本地与 GitHub | main 为 “test: pin packaged skills in cross-platform ZCode replay” 批次，与 origin/main 无差异；初始工作区干净，查询无开放 PR | 本轮 Git 与 GitHub 查询 |
| 既有验收 | 10 月 18 日最终 Linux/Windows CI 均成功，各构建并通过 131 项单元、16 项 Web 测试；不是本轮重构后的结果 | [既有 CI](https://github.com/AbsoluteHLN/CetusPrism/actions/runs/39072749368) |
| 官方 DSH | 本轮已抓取 master 到 upstream/master，仍为 rc.2 的 上游 rc.2 合并点（PR #6408）；与上次记录的官方树无差异，本地尚未整体纳入该版本 | [兼容记录](../docs/UPSTREAM.alignment.json)、本轮 fetch 与 tree diff |
| ZCode | 现有 composer 项为 DSH 上的 zcode-inspired persona；原生辅助适配器只支持 native，zcode/antigravity 驱动明确拒绝执行 | [原生适配器](../packages/preset/agent-preset-registry/src/builtin-agent-adapter.ts)、Web preset |
| ZCode 参考版本 | 旧计划参考 3.15.1；官方 README 已更新至 3.16.2，本轮查询的 main 为 3c5b227649371507ddc4eb46ac5133afe6db1cab | [官方源码](https://github.com/zai-org/ZCode)、本轮 GitHub 查询 |
| ZCode 执行接口 | 公开源码有 agent-server/app-server 的 stdio NDJSON 入口；core 导出 AgentRuntime 和模型/工具/存储注入接口，但 @zcode/core 标记 private，尚未在 Cetus 验证协议或运行时兼容 | [协议说明](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/design/v2/zcode-protocol-agent-server.md)、[core 导出](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/core/src/index.ts)、[包声明](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/core/package.json) |
| 两个插件入口 | ui-plugin-manager 管理 profile 包、启停、安装和配置；ui-settings-plugins/ui-settings-plugin-inventory 展示 Host 和 preset 的只读清单，功能不完全重复，但名称与信息分散 | [管理入口](../packages/client/ui-plugin-manager/src/client/index.ts)、[只读清单](../packages/host/plugin-inventory/src/index.ts) |
| 当前 UI | index.html 已加载 v3.5 CSS、Cetus token 映射和 shim；这不能证明所有实际控件遵守 v3 组件语法，亦不能把用户截图的混乱归结为完全没有加载 KalciriteUI | [Web 入口](../apps/web/index.html)、[外观集成](../packages/client/ui-theme/src/client/HlnAppearanceRow.tsx) |
| 静态历史资源 | public/archive 下有 25 个跟踪文件；现有 dist/archive 中仍存在旧 v2/v3.2 资源。当前归档说明关于不随包发布的描述与产物不符 | [旧资源目录](../apps/web/public/archive/README.zh.md)、本地既有构建产物 |
| 双桌面载体 | apps/electron 目录名下实际是 Tauri/WebView2 构建，apps/desktop 是官方 Electron 壳，两者都有现存脚本和消费者，不能直接认作废目录删除 | [Tauri 打包](../apps/electron/scripts/pack-tauri.mjs)、[官方桌面包](../apps/desktop/package.json) |
| 推理强度 | 自定义 endpoint 的模型发现读取 ID、名称、容量，不读取 reasoning 档位；档位由目录或显式配置提供。实时 sweep 曾因付费请求、错误缓存被移除 | [discovery](../packages/llm/llm-pi-ai/src/discovery.ts)、[catalog](../packages/llm/llm-pi-ai/src/catalog.ts) |
| Qwen | 已有 thinkingFormat/chatTemplateKwargs/effort 映射，但目前相关测试停留在配置保留；默认 effort 不被模型声明支持时可能在出站前失败。尚无本轮真实失败请求证据 | [adapter](../packages/llm/llm-pi-ai/src/adapter.ts)、[现有测试](../packages/llm/llm-pi-ai/tests/catalog.spec.ts) |
| 近 60K 上下文 | 尚未测得实际发送量及单位。native 工具 schema、可选 PTC SDK 文本和 workspace instructions 是不同来源；instructions 的 65536 是字节上限，不是已发送的 token 数 | [提示组装](../packages/core/system-prompt/src/index.ts)、[Standard 配置](../packages/bundle/web-app/presets/standard.patch.yml) |
| Auto review | 当前逐调用审查使用现有模型；错误拒绝执行。卸载时会把 Auto 会话设成 danger-full-access，独立审查请求不写入该会话日志，需要审计权限恢复和可重建性 | [实现](../packages/experimental/auto-review/src/index.ts) |
| 浏览器 | 当前展示层 Web 使用 iframe、官方 Electron 使用 webview；Stagehand 自动化是另一 opt-in provider。不能由 Electron 测试推定 Tauri/WebView2 原生浏览器可用 | [展示层](../packages/client/ui-sidebar-browser/README.md)、[自动化](../packages/experimental/browser-use-stagehand-native/README.md) |

## 方案选择与最小接口

### 执行底座与策略分离

底座负责 Agent 生命周期、请求与工具执行调度；策略负责提示、工具组合和运行约束；模型负责 provider/model/effort 路由。三者在 composer 中分组显示。底座列表固定表达 DSH（默认）、Pi、ZCode，分别显示版本、已安装/未配置/不可用状态和能力限制。未配置的底座可见但不能启动。现有 zcode-inspired 策略保留明确名称和旧值读取，不能被映射成 ZCode 底座。

默认组合保持 DSH + 标准策略；Pi 和 ZCode 分别注册 provider，不能互相冒用调度器。策略只在所选底座通过对应能力检查时开放。底座选择在创建会话时固定并持久化。已有会话中切换底座会创建新会话并保留原会话，界面事先说明；不拼接不同运行时的内部状态，也不静默降级到 DSH。策略切换遵守现有 preset 的生效时点；不支持的组合显示原因。

复用 agent-preset-registry 中现有声明、校验及 native 辅助适配器；先定义可扩展的底座 provider 注册接口，避免新增平行配置存储。解析步骤接收底座 ID、策略 ID、显式模型路由和工作区，返回固定版本与能力描述，再创建具有 send/cancel/whenIdle/dispose 的执行句柄。恢复、fork、Team、computer/browser 和 Auto review 能力逐项声明；不支持即在创建前拒绝，所有注册返回 disposer。底座 ID 属于新执行选择，不直接复用 BuiltinAgent 的驱动枚举。现有 BuiltinAgent v1 文件和备份继续可读，未经迁移审查不扩展其接受的驱动枚举。

有效配置记录底座 ID、适配器版本、运行时版本/修订、能力修订及模型路由引用。配置由既有所有者校验、原子保存和备份恢复。智能体声明目录首次可配置，默认与配置文件同级；目录解析不导入外部运行时或账号目录。旧会话缺少新选择时明确按旧 DSH 语义读取；不能承诺旧版本读取新增事件，也不能删除既有持久化代际。

Pi 候选为官方 main 73f8de80bc87021375f8b525292ac07492253002 对应的 @earendil-works/pi-agent-core 1.3.0，使用 Agent 类及其等待式事件和工具预检机制；不引入完整 Pi CLI、TUI、默认工具发现或独立账号存储。通过 streamFn 适配 Cetus 的 ctx.llm，通过工具包装调用现有 ctx.tools 权限与沙箱链，输入输出提交到 Cetus Session。Pi 的私有内存不是第二份会话真相。当前 llm-pi-ai 使用 pi-ai 0.87.1，先隔离版本和显式转换类型，不为引入底座而全局升级它。

### ZCode 独立底座

ZCode 底座必须运行真实 ZCode AgentRuntime，不能只复制提示或把 persona 改名。官方公开的 stdio agent-server 是接入候选；其文档明确由 server 持有会话、模型和运行态。Cetus 不能把该协议连接当作 DSH 内存会话，也不能直接把远端 snapshot 当成本地 Session。

运行时、账号、私有配置和原生存储留在独立外部安装目录，由 ZCode 的所有者管理。Cetus 仅保存显式的外部位置、版本/协议约束及非敏感关联 ID；不扫描、复制或改写已安装 ZCode 的私有配置。主应用和安装包不携带 ZCode 运行时，不自动下载或安装它。Cetus 的模型凭据仍由现有凭据服务持有，不写入 ZCode 配置；ZCode 自有凭据也不导入 Cetus。

先在隔离目录对固定官方修订做接入验证：启动与版本协商、创建、流式发送、停止、恢复、断管、重连及权限拒绝。协议各字段以当前 schema 和源码为准，旧设计文档列举的方法不等于当前兼容承诺。只使用 stdio 不证明模型请求能完整记录，也不证明所有工具都经过 Cetus 授权。

优先使用满足上述要求的公开协议。若原始 agent-server 无法接管模型路由、执行前授权或完整请求记录，则通过外部桥接进程组合公开导出的 AgentRuntime 与注入接口。桥接由 dsh profile 管理连接和生命周期，外部进程及其依赖不进入 Cetus 安装包。AgentRuntimeDeps 已有 modelFactory、toolRegistry/toolExecutor、permissionBroker、eventStore 等注入项；这些是固定源码修订的集成依据，不是稳定发布的 SDK。桥接协议和 Cetus 侧适配属于本轮交付，运行时获取仍由外部安装负责。

桥接的模型调用回到 Cetus 模型路由，工具执行回到现有工具、沙箱和 Auto review 链；未接入的原生工具不得注册。外部状态继续由外部运行时拥有，Cetus 日志保存可重建的模型请求、工具决定/结果与接收事件；映射记录不得成为第二个可独立写入的运行时状态源。任何恢复依赖的外部资源缺失都明确报错，不自动新建替代会话或重复发送上次命令。

协议或注入若无法满足权限和记录要求，该底座保持不可用并列出具体阻塞，不能把占位菜单标成完成。DSH、Pi、ZCode 分别通过请求→工具→后续请求及取消/恢复验收后，才能报告三套底座完成。ZCode 当前许可为 Apache-2.0；采用公开代码或协议资源前逐项保留适用的许可证、NOTICE 和来源记录。

### 单一扩展入口与 UI 方向

左侧只保留一个“扩展”管理入口，在同一管理页内区分“已安装”和“运行能力”视图。只读清单沿用现有 Host inventory；Shell、Agent loop、Web search 配置继续复用 plugins.item，Subagent/Team 保留其 settings.section 所有权。Shell 表单仍按 Host 实际提供的 Bash/PowerShell 配置绑定。设置不再另列一套“内置插件”页面。原导航 ID 和可恢复链接提供明确转向，已有配置和启停状态不重置。移除壳层重复容器前迁完所有 slot 消费者。

建议保留 v3.5 作为 v3 系列的明确基线，使用本机 KalciriteUI 的 v3 契约、v3.5 src/dist 与 node-contract.test.mjs 所定义的目录和组件语法；不自动改为主题体系不同的 v3.8。重写实际 shell、侧栏、会话、composer、模型/策略菜单、设置与扩展页组件，并按已注册路由清单逐页检查自动任务、团队、用量、账户及可选扩展页面。落实 workbench、分组面板、工具栏、状态条、模型能力标签、真实用量展示和空态；显示的数据必须有实际来源，不装饰性编造指标。

共享 primitives 和 ui-theme 拥有外观与行为，业务 CSS 只保留布局和必要 token 传递；现存窗口修正、功能样式和 window.HLN 调用必须先迁移并验收，不能按旧名称直接删除。同步标准资源，不再堆叠新的全局 !important 补丁。背景由唯一画布所有者控制；reduced-motion 静态，后台/不可见时停动，输入/选择文字时不干扰。composer 淡出仅覆盖消息滚动边缘，末条消息、选择文字、弹出菜单、附件和输入区始终可读。界面用词通过现有 locale 字典提供。本文 UI shell 指 Web UI 壳层，不包括 packages/shell 命令执行子系统。

### 模型与上下文原则

“模型列表发现”“目录声明”“端点接受参数”“实际推理行为可观测”分别展示。HTTP 200 只能证明请求被接受，不能证明模型内部执行了某一推理强度；没有公开元数据或可观测证据时显示未声明/未知。实时验证只在用户主动触发时进行，标明调用成本；缓存按端点、provider/model、API 方言、能力修订与凭据修订隔离，不保存密钥。切换路由或凭据修订使旧验证失效，429/超时不永久判定能力不支持。

先复现 Qwen 路由的 effective config，再检查默认 effort、thinkingFormat/chatTemplateKwargs、协议路径和最终请求体。错误保留可诊断的状态/类别及脱敏消息，不把所有失败显示为模型不可用；不把任意模型别名等同于官方 Qwen 端点。不再用“目录声明”冒充探针实测。

工具上下文从实际首次请求分别量化 system、instructions、skills、native schema、PTC SDK、MCP、历史消息，提供字节数及有明确 tokenizer/算法标识的 token 计数或估算。先确认用户看到的近 60K 属于哪项、何种单位。精简重复的说明、默认不需要的扩展能力和重复注册；通过现有 scope、preset 和 deferred discovery 按需开放。变更工具集必须记录在 Session 并保持缓存序列语义；工具不能只从提示隐藏却绕过权限继续调用。完整工具配置仍可显式选择，默认精简不得削弱 dsh 所需核心能力。

## 原子任务、依赖和独占修改范围

以下是待实施任务。每项状态均为 pending；本轮审计不计作代码实现或产品验收。

| ID | 依赖 | 独占修改范围与交付物 | 可观察验收 |
|---|---|---|---|
| A01 | 批准 v2 | dev-docs、public/archive 及引用；建立原路径/日期/原提交/后继索引 | 旧 ZCode 计划与 10-18 规格/报告移入历史索引；TUI 的现行契约先迁到所有者再归档计划；public 不再发货旧 UI，链接和字节来源可追溯 |
| A02 | A01 | apps/electron 路径、相关脚本/清单/配置；重复代码清单 | 将误名的 Tauri 载体归入 apps/desktop-tauri，保留官方 apps/desktop 和 desktop-host；所有引用一次迁移，CLI/安装升级路径不变；只删除已有 Git 备份且零剩余消费者的重复实现 |
| A03 | A02 | 上游兼容记录、官方变更的本地所有者；共享 API 由父任务独占集成 | 对 rc.2 按子系统列 adopted/adapted/deferred 和理由；完成适用 API/权限/profile/构建变更及消费者迁移，不覆盖产品专有功能、凭据和用户数据；不可兼容项明确列为 blocked，不能称全量同步 |
| A04 | A03 | ui-plugin-manager、ui-settings-plugins、ui-settings-plugin-inventory、配置贡献者、Web 组合 | 唯一扩展入口覆盖安装/启停/配置/按预设检查；旧导航可恢复；成功/失败操作反馈正确；不重复注册或丢失配置 slot |
| A05 | A03 | agent-preset-registry 的底座解析与 native 适配器；会话元数据声明、consumer 接口 | DSH 默认不变；三套底座 ID 独立；创建前校验底座/策略/路由；有效选择及可配置声明目录持久化、可校验和回滚；新状态完成持久化 ACK |
| A06 | A05、A08 | 一个实验 Pi provider 包及对应 profile/test/依赖/来源记录 | 真实 Pi Agent 调度完成请求→工具→后续请求、取消、错误、销毁、恢复；每次模型请求及工具结果可从 Cetus 日志重建；无默认 Pi 工具/私有配置扫描，所有工具经过同一权限链 |
| A07 | A05、A08 | 独立 ZCode provider、外部桥接协议/实现、profile、协议 fixture 和来源记录 | 固定官方修订的真实 ZCode runtime 完成模型→受控工具→后续模型、取消和恢复；覆盖断管、重复/迟到帧和版本不兼容；工具不可绕过拒绝，所有模型请求可重建；运行时文件、凭据和私有状态不进入仓库、Cetus 配置或安装包，允许显式外部位置及非敏感版本引用；缺运行时时准确显示未配置 |
| A08 | A03 | experimental/auto-review 及其权限 UI、拥有的会话审查记录 | 覆盖 allow/deny、ask/never、PTC、并发、模型不可用、格式错误、取消、超时、卸载；卸载恢复进入 Auto 前的非 Auto 权限，无法恢复时回到需确认模式，不静默转为 Full access；审查输入/决定/用量可追溯 |
| A09 | A02、A03、A08 | computer-use native provider、browser-use 现有 provider、sidebar browser、桌面 bridge/lease | 独立临时窗口验证真实截图/元素 token/后台输入和 foreground 开关；Tauri 原生浏览载体完成本地页面导航/历史/刷新/弹窗/会话隔离；浏览器自动化经过共享工具与授权链；Web iframe 限制明确展示，不能假报原生可用 |
| A10 | A04、A05；与 A06/A07/A09 通过冻结接口对接 | ui-theme、ui-primitives、shell/会话/composer/设置/扩展组件、Web 当前资源 | 使用 v3.5 原生组件语法；composer 明确显示 DSH（默认）、Pi、ZCode 及真实可用性；覆盖深浅主题、宽/窄窗口、键盘、读屏标签、空态/加载/错误、菜单边缘、reduced-motion 与滚动/末条消息；主流程实机截图由用户产品审阅 |
| A11 | A10 | llm-pi-ai discovery/catalog/adapter/stream、模型设置与选择器 | 区分声明与实测；补 Qwen 最终 HTTP 请求 fixture，覆盖开启/关闭推理、允许档位、默认档位、无效参数和流错误；如可用凭据存在再走最小真实请求，缺凭据明确 blocked，不伪造效果 |
| A12 | A11 | system-prompt/tools 的已有组装点、preset、工具说明所有者和上下文展示 | 给出三底座首次请求各项来源/字节/token 的前后对比；无重复 schema/PTC 双重声明，无未启用扩展说明；核心文件/终端/计划/委派能力按声明可用，发现后调用、恢复和拒绝行为保持可重建 |
| A13 | A01–A12 | 父任务整合、对应 SDK/README/快照/构建检查；最终报告 | 按最终文件范围集中构建与回归，正常 Git hooks、main push 与两端 CI，保存未验证项和回滚说明；任何 required 任务 blocked 时仅交付部分结果，不能标整轮完成 |

共享 API、SessionEventMap、manifest/lock、docs/architecture.md 由父任务修改；子任务在已冻结接口和互斥文件范围内并行。Auto review、Pi/ZCode 工具映射和原生浏览器 bridge 的权限变化由父任务亲自审查。允许的模型路由沿用用户授权；当前宿主没有暴露 GPT-6.1-Sol 子路由，不能声称调用了它。简单取证已使用 GPT-6 Luna xhigh，复杂架构决定由父任务处理；可用 CSU 路由按实际支持选择，不使用 Fast 服务层。

## 归档、删除和兼容性限制

1. 本轮不移动/覆盖/删除已提交 Session fixture 代际、不删除凭据、用户会话、机器本地私有文档、证据或共享依赖缓存。上游 vendor 只按其规定流程更新，不能以去重为由清空。
2. public/archive 的冗余字节由现有 Git 提交保留可恢复来源；主线只保留不随包发货的归档索引和上游版本链接，不再搬出第二份静态资源树。旧 v3.5 若被重写资源替代，依同一规则处理。
3. 只读 inventory 服务与插件安装服务不合并成一个失去职责区分的服务；合并入口与重复 UI 壳层。官方 Electron/Tauri 载体暂保留不同实现，公共策略/路径逻辑按消费者证据提取；删整个载体需要其功能被替代并通过安装/原生浏览器验收。
4. 先核对现有类型与消费者再选择会话元数据或新增事件；每个新增模型可见状态必须入日志。公开字段变化配套类型 ACK、read/write 兼容说明及 TypeScript/Python SDK 期望，不能用旧 reader 支持未认识事件作承诺。
5. Cetus 只可保存外部 ZCode/Antigravity 的显式位置、协议/版本限制及非敏感关联 ID。运行时文件、账号凭据、私有配置及私有存储内容不得导入 Cetus；适配器不得读取、复制或持久化外部凭据和私有配置。Pi 也不扫描外部账号目录；本轮第三方 provider 继续使用现有凭据所有者。必要新依赖先报告精确版本、许可、共享缓存命中与缺失清单，不能隐式重装或改写全仓锁。
6. 遇到同一外部阻塞两次时停止重复尝试，继续独立任务并记录所缺条件；失败项不能通过删测试、宽化规范或隐藏错误解决。无自动 release、上传安装包、发布站点或替换用户当前安装。

## 验证与 QAMCP

CompletionQAMCP 本机 source/Skill 为 0.1.2；已实际调用 CLI help，确认提供 check/text/wizard 等命令。本会话没有已连接的 completionQAHost、可信 Stop 回调或独立模型语义审查回调。text 的 technical_document 检查可用于本文结构；check 的 Python/JSON 语法结果不能证明 TypeScript、浏览器或原生功能正确。不得向 wizard 管道输入批准、由模型填写批准回调，或把配置保存称作宿主可用。

批准后按上述任务追踪 pending/running/pass/fail/blocked/not_run，每项记录输入版本、真实修改、运行检查与消费。模型 token 若宿主未返回则标 unknown，不记为零；本轮旧 goal 仍暂停，不能伪造目标额度。QAMCP 宿主集成未连接不阻碍独立执行代码/实机检查，但最终分别报告该限制，不声称 QAMCP 全自动拦截完成。

代码检查按所有者选择：插件管理导航与设置 Web 回归；DSH、Pi、ZCode 分别验证真实调度、生命周期和恢复，mock 协议只作为补充；Auto review unit + approval/denial Web 场景；computer/native 和浏览器本地站点的实机路径；LLM discovery/catalog/adapter 及真实 HTTP fixture；system-prompt/tools 和请求重建；新增模型可见/用户可见行为的 keyless 快照。三底座均验证模型路由、工具拒绝和调用记录；不支持的 Team/fork/computer/browser 能力在选择时拒绝。Session/loop 改动同步两个 SDK 的期望。最后集中运行必要 build、类型/lint、文档检查、正常 pre-push 和 Linux/Windows CI；macOS 无实机时明确 not_run。通过的检查仅在相关内容再次变化或出现新问题时重跑。

底座实机验收保存可复核的脱敏证据：执行日期和平台、固定源码修订或依赖版本、运行时版本输出及可执行文件摘要、实际启动入口和退出结果、关联 Session ID/事件范围。证据分别标明真实调度器测试与真实模型端点测试；前者可使用确定性模型服务，不能据此宣称 GLM/Qwen 实测通过。工具测试须同时保留允许执行的结果和拒绝后未产生副作用的观察，取消/恢复须对应同一原会话。缺少实际执行记录时只能标为 not_run 或 blocked，不能仅凭 mock、菜单截图或总结文字记 pass。证据不保存密钥、认证头或外部私有配置。

每次实施提交记录来源、上游版本/修订、受影响 API/存储、兼容/迁移和回滚。回滚以撤销相应原子提交为单位；用户配置升级采用同目录原子保存与既有备份，不依赖删除用户数据。最终交付包含修改文件、分支/提交、构建/测试、实机观察、未知项、阻塞与下一步。

## 官方研究来源

- [DSH 官方](https://github.com/deepseek-ai/deepseek-harness)：本轮实际 fetch 的精确版本见状态表；现有布局和应用启动仍通过 dsh profiles。
- [ZCode 官方](https://github.com/zai-org/ZCode)：Apache-2.0，3.16.2；本轮已读取 core 导出、AgentRuntimeDeps、CLI 分发、protocol entrypoint 和 server 设计。公开源码含实际执行接口，不代表稳定第三方 SDK或本仓接入已完成。采用代码必须保留适用许可证与 NOTICE，不采用 installed app 私有配置。
- [Pi Agent Core](https://github.com/earendil-works/pi/blob/73f8de80bc87021375f8b525292ac07492253002/packages/agent/README.md)：MIT；公开 Agent、streamFn、工具预检和等待式事件支持本轮窄适配方向，尚未完成本仓嵌入验证。
- [Pi SDK](https://github.com/earendil-works/pi/blob/73f8de80bc87021375f8b525292ac07492253002/packages/coding-agent/docs/sdk.md)：完整 coding-agent SDK 是另一可选路径，本轮避免附带其完整 CLI/资源发现体系。
- [OpenCode server](https://docs.opencode.ai/docs/server/) 与 [SDK](https://docs.opencode.ai/docs/sdk/)：作为不同进程/server 方案比较，不作为已安装底座。
- KalciriteUI 本机来源：E:/Projects/KalciriteUI/ui-source/v3/README.md、v3/contract.md、v3.5/src、v3.5/dist、v3.5/node-contract.test.mjs；只读研究，不修改该项目工作树。

## 待确认的决定

确认后按本规格执行：先归档/结构整理，再兼容迁移与统一扩展入口；实现 DSH（默认）、Pi、ZCode 三套独立底座，在 composer 切换；保留现有桌面载体的兼容路径，用 KalciriteUI v3.5 官方组件重写界面；最后处理推理能力、Qwen 和工具上下文，完成必要验收后推送 main，不发布 release。底座未通过真实执行验收时报告部分交付和具体阻塞，不以 ZCode 原则策略或菜单占位替代。

## 本轮实施状态（2026-10-20）

用户已批准本文并要求「执行，并编译新安装包」。本轮只交付可验证的最小增量，其余按本文顺序继续。

### 已完成

- 三底座目录协议：`packages/preset/agent-preset-registry/src/backend.ts` 定义 DSH、Pi、ZCode 三个彼此独立的执行底座，含可用状态（ready / unconfigured / incompatible）、能力描述与拒绝原因。底座负责 Agent 生命周期、请求调度与工具执行，与 preset（提示词与工具组合）、模型（provider/model/effort 路由）互不重叠。
- 统一扩展入口：`ctx.agentPresets.registerBackend(provider)` 是外部运行时唯一的接入点。适配器只回答一次探测（版本、来源、协议是否兼容），CetusPrism 不为其保存凭据、私有配置或运行时文件；注册返回 disposer。
- 远程暴露：`agentPresets/backends` 发布目录，DSH 在前。客户端由生成的 Typert 契约消费，无需手写 wire。
- 持久化：`BuiltinAgentConfigStore` 的配置新增可选 `defaultBackend`；旧配置文件缺失该字段时按 DSH 兼容读取。
- Composer 入口：新会话页在预设入口旁显示底座入口，列出三个底座、各自已安装版本与不可用原因。不可用底座保持可见，并以 Host 发布的原因拒绝，不静默回退到 DSH。

### 未完成与具体阻塞

- **Pi 与 ZCode 的真实执行底座尚未实现。** 本仓库没有任何适配器注册，因此两者在界面上恒为「未配置」，也没有真实运行证据。本文规定「底座未通过真实执行验收时报告部分交付和具体阻塞，不以 ZCode 原则策略或菜单占位替代」，本节即为该报告：ZCode 原则模式是 DSH 策略，不能充当第三套底座的验收证据。
- **会话级底座绑定尚未实现。** 会话仍绑定 DSH；选择已注册的外部运行时会被明确拒绝，而不是记录到无人兑现的位置。实现它需要会话头字段与 `agent-backend/selected` 事件投影，以及「切换底座创建新会话并保留原会话」的流程。
- **归档/结构整理、两个插件入口合并、KalciriteUI v3.5 官方组件重写、推理能力目录、Qwen 请求修复、默认工具上下文过大**均未在本轮开始，按本文顺序继续。
- 未验证项：Linux 与 macOS 实机、真实第三方 GLM/Qwen 请求、签名安装包。

### 本轮证据

- `packages/preset/agent-preset-registry/tests/backend.spec.ts`：底座目录与注册表行为（含 disposer 语义、探测失败）。
- `packages/preset/agent-preset-registry/tests/registry.spec.ts`：服务经远程契约暴露目录、注册后与释放后的状态。
- `packages/client/ui-agent-preset/tests/backend-store.client.spec.ts`：目录读取、拒绝原因与可见性。
- `packages/client/ui-agent-preset/tests/apply.client.spec.ts`：底座入口注册、卸载与拒绝路径。
- 定向测试：注册表包 67 项、客户端包 153 项通过；Host 构建与客户端类型检查通过。
# v1.7.0-beta.1 内置智能体接入协议设计与契约

来源：CetusPrism 第三阶段需求；实现版本：v1.7.0-beta.1；兼容性：协议版本 1，未知驱动名称保留以兼容未来 ZCode 与 Antigravity 适配器。

本阶段只定义选择与配置持久化，不启动外部运行时。`agent-preset-registry` 继续拥有 Agent 选择和生命周期；新增协议模块只提供声明、校验、原子保存和回滚，避免改变官方 Agent 与 Session 接口。

## 持久化契约

配置文件是 JSON 文档，包含 `schemaVersion: 1`、`release: "1.7.0-beta.1"`、`installDirectory` 和 `agents`。每个 Agent 记录 `id`、`enabled`、`driver`、`version`、`source` 与 `compatibility.protocolVersion`。首次安装的默认目录是配置文件所在目录，并可由 `installDirectory` 覆盖。

保存过程通过现有 `dsh-atomic-write` 的写锁和原子替换完成；成功保存前一代配置到 `.bak`。回滚交换当前与上一代有效配置。首次安装没有上一代时不生成备份。

校验拒绝空标识、重复标识、非法版本字段、重复协议字段，以及 `credentials`、`runtime`、`privateConfig` 等驱动私有数据。协议不会读取、复制或写入 ZCode/Antigravity 的凭据、运行时路径或私有配置；未来适配器只能通过声明的驱动名和协议版本接入。

## 兼容性边界

v1 保持 `agent-preset-registry` 现有选择入口不变，不修改 Session 格式，不新增模型可见事件，也不将外部驱动状态写入 CetusPrism。驱动适配器、凭据解析、运行时启动和 UI 配置面留给后续阶段。

## 变更来源记录

| 变更 | 来源 | 版本 | 兼容性说明 |
| --- | --- | --- | --- |
| 内置 Agent 声明与启用状态 | 第三阶段需求 | v1.7.0-beta.1 | 新增独立协议类型，不破坏官方 Agent 接口 |
| 原子保存与上一代回滚 | 第三阶段需求；`dsh-atomic-write` | v1.7.0-beta.1 | 使用现有文件替换语义；不承诺崩溃后 fsync 持久性 |
| ZCode/Antigravity 驱动名 | 第三阶段需求 | protocol v1 | 只保留公开元数据；不接管其凭据、运行时或私有配置 |

---
description: "Web 设置中的“关于与鸣谢”分区：发行版自身版本、所内嵌的 harness 内核构建、上游鸣谢与非关联声明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-about

[English](README.md) | 中文

## 概述

设置中的**关于与鸣谢**分区说明本发行版是什么、来自哪里。它渲染发行版自身版本（`DSH_CLIENT_PRODUCT_VERSION`）、所内嵌的 harness 内核构建（`DSH_CLIENT_VERSION` 加提交哈希）、指向 DeepSeek Harness 上游仓库的鸣谢，以及独立发行版所需的非关联声明。该分区不发起任何 Host 调用：所有取值都是客户端构建元数据或静态文案。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用方式

打开设置并选择**关于与鸣谢**。产品卡片展示发行版名称与版本；内核构建卡片展示内嵌的 harness 版本以便诊断；鸣谢与声明卡片承载上游致谢与免责说明。构建元数据缺失时（部分构建）版本行自动隐藏——鸣谢与声明始终显示。

<a id="understand-the-implementation"></a>
## 实现说明

- `AboutSection.tsx` 直接读取 `process.env.DSH_CLIENT_PRODUCT_VERSION` 与 `DSH_CLIENT_*` 构建元数据；没有 inject face，也没有订阅，因为这些值在构建时即已固定。
- 注册是一条 `settings.section` 条目（`id: 'about'`），与其他分区一样共享设置外壳的导航。
- `locales.ts` 以中英两种语言拥有 `settings.about` 命名空间。

<a id="further-exploration"></a>
## 延伸阅读

- [client build environment](../../../scripts/client-build-environment.ts) —— `DSH_CLIENT_PRODUCT_VERSION` 从 shell manifest 解析的位置。
- [ui-settings](../ui-settings/README.zh.md) —— 本分区注册进的 `settings.section` 槽位。

<a id="dev-note"></a>
## 开发备注

该分区是纯展示组件，除构建元数据外无任何输入；测试覆盖版本行的存在与缺失。

<a id="model-experience"></a>
## 模型体验

无，因为本分区只渲染构建元数据与静态文案；不触及任何模型请求或会话记录。

#### KV Cache 影响

无；本分区不组装也不发送任何提供方请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 上游链接是常量；若发行版开始跟踪固定的上游提交，内核构建卡片应同时链接该修订。

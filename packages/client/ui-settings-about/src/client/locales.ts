/** `settings.about` namespace dictionaries (the About & acknowledgements section's copy). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.about'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '关于与鸣谢',
  'product.title': 'CetusPrism',
  'product.version': '版本',
  'product.channel': '独立发行版',
  'core.title': '内核构建',
  'core.version': 'DeepSeek Harness 版本',
  'core.commit': '构建提交',
  'credit.title': '鸣谢',
  'credit.body': '本产品基于开源项目 DeepSeek Harness 构建，其 MIT 许可证允许这样的再分发。感谢 DeepSeek 团队及所有上游贡献者。',
  'credit.license': '上游以 MIT 许可证发布',
  'credit.repo': '上游仓库',
  'legal.title': '声明',
  'legal.disclaimer': 'CetusPrism 是社区独立发行版，由 DeepSeek Harness 源码构建而成。本产品与 DeepSeek（深度求索）官方无隶属、合作或背书关系；DeepSeek 及相关名称、标识归其各自权利人所有。',
  'legal.license': '本产品的修改部分同样以 MIT 许可证发布。',
} satisfies Record<string, string>

/** The settings.about namespace key union. */
export type AboutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav': 'About & credits',
  'product.title': 'CetusPrism',
  'product.version': 'Version',
  'product.channel': 'Independent distribution',
  'core.title': 'Core build',
  'core.version': 'DeepSeek Harness version',
  'core.commit': 'Build commit',
  'credit.title': 'Acknowledgements',
  'credit.body': 'This product is built on the open-source DeepSeek Harness project, whose MIT license permits such redistribution. Thanks to the DeepSeek team and all upstream contributors.',
  'credit.license': 'Upstream is released under the MIT license',
  'credit.repo': 'Upstream repository',
  'legal.title': 'Legal',
  'legal.disclaimer': 'CetusPrism is an independent distribution built from DeepSeek Harness sources. It is not affiliated with, endorsed by, or partnered with DeepSeek; DeepSeek and related names and marks belong to their respective owners.',
  'legal.license': 'The modifications in this distribution are likewise released under the MIT license.',
} satisfies Record<AboutKey, string>


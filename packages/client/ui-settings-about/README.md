---
description: "About & acknowledgements section in Web settings: the distribution's version, the harness core build it embeds, upstream credit, and the non-affiliation statement."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-about

English | [中文](README.zh.md)

## Summary

The **About & credits** section in Settings states what this distribution is and where it comes from. It renders the distribution's own version (`DSH_CLIENT_PRODUCT_VERSION`), the harness core build it embeds (`DSH_CLIENT_VERSION` plus commit), a credit for the upstream DeepSeek Harness project with its repository link, and the non-affiliation statement required of an independent distribution. The section makes no Host calls: every value is client build metadata or static copy.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Open Settings and select **关于与鸣谢 / About & credits**. The product card names the distribution and its version; the core-build card shows the embedded harness version for diagnostics; the acknowledgements and legal cards carry the upstream credit and disclaimer. Version rows disappear when build metadata is absent (partial builds) — the credit and legal statements never do.

<a id="understand-the-implementation"></a>
## Understand the implementation

- `AboutSection.tsx` reads `process.env.DSH_CLIENT_PRODUCT_VERSION` and the `DSH_CLIENT_*` build metadata directly; there is no inject face and no subscription, because the values are frozen at build time.
- Registration is one `settings.section` entry (`id: 'about'`); the section shares the settings shell's navigation like every other section.
- `locales.ts` owns the `settings.about` namespace in zh and en.

<a id="further-exploration"></a>
## Further Exploration

- [client build environment](../../../scripts/client-build-environment.ts) — where `DSH_CLIENT_PRODUCT_VERSION` is resolved from the shell manifest.
- [ui-settings](../ui-settings/README.md) — the `settings.section` slot this section registers into.

<a id="dev-note"></a>
## Dev Note

The section is presentational with zero inputs beyond build metadata; the tests cover the version rows' presence and absence.

<a id="model-experience"></a>
## Model Experience

None, as the section renders build metadata and static copy only; nothing reaches a model request or the transcript.

#### KV Cache effect

None; the section neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The upstream link is a constant; if the distribution ever tracks a pinned upstream commit, the core-build card should also link that revision.

# GLM harness composition

English | [中文](glm-harness.zh.md)

This opt-in headless composition combines an explicitly configured GLM gateway with native tools, task tracking, session persistence, and evidence-based coding guidance. It references ZCode's public model-configuration and prompt principles; it runs inside CetusPrism and does not launch ZCode.

## Configure and run

Use a third-party gateway that accepts OpenAI chat completions, `reasoning_effort` values `low`, `high`, and `max`, and assistant `reasoning_content` in tool history. Replace `baseURL` in the overlay with the gateway's documented endpoint; the shipped `.invalid` address is a placeholder. Set `CETUS_GLM_MODEL`, `CETUS_GLM_CONTEXT_WINDOW`, and `CETUS_GLM_MAX_TOKENS` to the exact model id and documented capacities. The configuration does not infer capabilities from a model name. Adapt its explicit compatibility fields when the gateway implements a different dialect.

Supply `CETUS_GLM_API_KEY` through the existing credential service or the launch environment. The overlay stores the reference name only. It does not read or synchronize ZCode credentials, configuration, accounts, or runtime files.

From this checkout, launch the existing CLI profile:

```sh
pnpm dsh --profile headless --patch apps/cli/config/examples/glm-harness/cordis.yml "Inspect this project and report what you verified."
```

The default reasoning level is `high`. Edit the overlay's provider capability list and default selection together when choosing a different supported level. Existing provider settings remain owned by the Models settings and the normal profile configuration editor; this example's explicit configuration takes precedence while the overlay is active. Agent Team's independent allowed-model list must use the `glm-harness` provider route, never `spawn` or `fork`.

## Compatibility and rollback

The [overlay](../../../apps/cli/config/examples/glm-harness/cordis.yml) uses existing plugins and changes no Agent, Session, or LLM wire interfaces. Stable guidance enters the normal system-message log; tool results and provider replay metadata follow the existing session path. This example is for `headless`: Web presets own their own personas and need a scoped composition before using equivalent guidance.

Omit `--patch` to stop applying this composition to subsequent launches. Existing sessions and the provider credential remain intact. The separate built-in-agent configuration store offers validated saves and one-generation rollback; it does not roll back external provider state.

## Limits and sources

This is a native strategy inspired by ZCode, not the reserved external `zcode` driver. The lifecycle implementation and verification status are tracked in the [integration design](../../../dev-docs/zcode-harness-adapter-plan-v1.7.0-beta.1.zh.md). Local protocol tests cannot establish improved GLM task quality or compatibility with every gateway; those require credentialed evaluation against the selected endpoint.

Reference implementation: [ZCode model configuration](https://github.com/zai-org/ZCode/blob/main/packages/provider/src/config/model-config.ts) and [system prompt contract](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/design/v2/loop/system-prompt-contract.md), inspected at version 3.15.1, provider revision 31. No source text, private configuration, or runtime is vendored by this composition.

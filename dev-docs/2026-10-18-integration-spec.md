# CetusPrism integration and interaction specification

Reference specification, 2026-10-18. Product baseline: 1.7.1-beta.1. Sources: CetusPrism origin/main, official deepseek-ai/deepseek-harness, and the existing KalciriteUI v3.5 integration. Record exact fetched revisions in the verification report; a fetched revision is not an incorporated revision.

## Delivery phases

1. Preserve pending CLI, installer and settings changes; fetch GitHub heads; review open PRs against their live base. Integrate compatible changes without downgrading product versions. Keep superseded PRs unmerged and explain the decision. Fetch official dsh and inspect API, persistence, dependency and profile differences before selecting compatible changes.
2. Preserve native dsh as the default. Reuse the current native GLM harness composition for any optional ZCode-inspired mode. Selection must describe actual behavior, be persisted and validated through existing settings, and apply at an explicitly documented session boundary. Never import ZCode credentials, runtime or private configuration. Model-visible changes must remain reconstructable from session events. Do not advertise the reserved external ZCode driver as implemented.
3. Improve the existing UI using KalciriteUI tokens. Resolve the complete CSS cascade before changing background motion or composer fading. Normal motion must avoid duplicated animations; reduced motion must remain static. Fade only the transcript edge, keep composer controls and final messages readable, and verify scrolling, input growth, light/dark themes and narrow windows through the served application.
4. Trace computer use from the shipped profile to driver registration, native dependency loading, policy and tool availability. Repair the failing layer without bypassing permission or foreground ownership. Verify the installed or built profile with an isolated home; distinguish tool registration from actual screenshot/input operation.
5. An independent supervisor reviews each phase, source/version compatibility and final evidence. Run focused regressions, the necessary build and pre-push gates. Commit and push to main after validation; verify remote SHA and report CI separately. No release publication.

## Compatibility and verification

Keep Agent, Session, LLM and released persistence formats unchanged unless an explicit migration is necessary and acknowledged. Preserve user model authorization, existing sessions, native tools, profile launch and rollback through reverting the isolated integration commits. Configuration errors must fail visibly. Documentation belongs with each owning module; source links and version records must distinguish reference principles from copied code.

Acceptance evidence includes PR decisions and exact heads, upstream comparison, focused behavior tests, served UI screenshots and interaction observations, computer-use profile smoke, build result, and remote commit verification. Credentialed provider quality, unsupported native platforms and unavailable services remain explicitly unverified. Preserve existing evidence and user data. Do not delete dependencies or unrelated project files.

# Persistent TUI integration

Target: CetusPrism v1.7.1-beta.1. Source: the local dsh-headless runner, Node readline, and the existing terminal event projection. No ZCode code, runtime, private configuration or credentials are imported.

The interactive runner owns one Agent handle. Commands act only between turns. A model selection is validated against the mounted provider's advertised catalog before updating that Agent's existing ModelSelectionRef; the existing model-selection plugin logs the next request's route and switch notice. Selection persists through normal request headers after a turn is admitted, without a new Session event or format generation. An idle selection that has not entered a request is process-local.

A real terminal uses an alternate screen with a bounded transcript scroll region and separate status/input rows. Node readline owns line editing and command completion; the terminal workspace owns presentation only. Non-TTY streams retain inline output. Disposal restores screen and scroll margins, unregisters resize listeners, closes readline and disposes the Agent. Terminal layout changes add no model-visible content.

Commands: /help, /sessions, /resume <id>, /new, /models [provider], /model [provider model], /status, /team, /exit. Unknown commands report an error; // escapes an initial slash for a literal prompt. Team information requires the optional terminalTeamStatus presenter, supplied by Agent Teams without a stable-package dependency on experimental types. Ctrl+C cancels an active turn and exits when idle. Commands do not install providers, create credentials or change team routing policy.

Compatibility: headless one-shot, --json and --plain retain their existing output modes. Interactive --json/--plain remain rejected. Application versions advance together; upstream package versions and Session schemas remain unchanged. No merge or release is authorized.

Acceptance: focused parser/screen/runner tests, real dsh-profile CLI smoke with mocked provider, existing keyless Session replay, Host/Client compilation and built CLI smoke. A terminal emulator must verify fixed rows, resize and restoration; authenticated provider quality and platform-specific native visual inspection must be reported separately if unavailable.

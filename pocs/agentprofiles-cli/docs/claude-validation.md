# Claude Config Dir Validation (Draft Protocol)

Goal: verify that `CLAUDE_CONFIG_DIR` provides practical isolation for Claude Code.

## Assumptions

- Claude Code reads and writes its config under `CLAUDE_CONFIG_DIR` when set.
- We can observe a stable file or setting that changes based on the active profile.

## Setup

1. Create two profiles:
   - `agentprofiles add claude work`
   - `agentprofiles add claude personal`
2. Pick a single machine with Claude installed.

## Protocol (fail-fast)

1. In a test repo, run `agentprofiles set claude work` and `direnv allow`.
2. Launch Claude and make a simple, observable change in settings (for example, toggle a UI preference or set a custom instruction).
3. Close Claude.
4. Verify that files were created/updated in:
   - `$HOME/.config/agentprofiles/claude/work`
   - and not in `$HOME/.config/claude` or other defaults.
5. Switch profiles:
   - `agentprofiles set claude personal` and `direnv allow`.
6. Relaunch Claude and check whether the setting is absent (or at its default), then toggle it differently.
7. Verify the change appears only under:
   - `$HOME/.config/agentprofiles/claude/personal`

## Success criteria

- Switching profiles changes observable behavior in Claude.
- Claude reads and writes only within the active profile directory.
- No unintended writes to global default config locations.

## Notes

- If Claude uses multiple config locations, document exactly which files are touched.
- If `CLAUDE_CONFIG_DIR` is ignored, log the behavior and downgrade claims in the README/docs.

# vsix-bridge-cli Future Ideas

## Performance

- [ ] Batch/pool marketplace API calls (multiple extensions per request) — API supports it, could reduce HTTP overhead
- [ ] Retry logic with exponential backoff for transient network failures

## Platform Support

- [ ] Windows paths for app bundles and settings
- [ ] Linux paths (likely `~/.config/Code/` etc.)

## Features

- [ ] `config.json` for user overrides (custom IDE paths, concurrency setting)
- [ ] `state.json` to cache IDE versions and skip re-detection
- [ ] `--concurrency` CLI flag to override default (currently hardcoded to 8)

## Open Questions

- Should VSCodium be added? (uses OpenVSX, not Microsoft Marketplace — different problem)
- Should we support syncing _from_ a fork to VS Code? (reverse direction)

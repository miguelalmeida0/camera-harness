# Gate 1F Save-Path Failure Tests

| Scenario | Expected failure | User-facing fix | Harness failure code |
| --- | --- | --- | --- |
| User downloads file but does not move it | `physical:validate` blocks | Move `live_physical_focus_ritual_001.v0.json` to `fixtures/replay/live/live_physical_focus_ritual_001.v0.json` | `physical_trace_missing` |
| User saves wrong filename | `physical:validate` blocks because required file is absent | Rename file to `live_physical_focus_ritual_001.v0.json` in the required folder | `physical_trace_missing` |
| User saves wrong folder | `physical:validate` blocks because required path is absent | Move file into `fixtures/replay/live/` | `physical_trace_missing` |
| `physical:validate` says `physical_fixture_missing` | Missing physical trace | Use the in-app save-path assistant or macOS copy command | `physical_trace_missing` |
| Gate 1C says `BLOCKED_MISSING_PHYSICAL_TRACE` | Required physical fixture missing or failed physical validation | Run `npm run physical:validate`, fix the saved file, then rerun `npm run gate:1c` | `physical_trace_missing` |
| User used dev dry-run instead of physical export | Physical validator rejects provenance | Redo browser physical export and check physical confirmation | `dev_dry_run_invalid`, `physical_capture_missing`, `operator_confirmation_missing`, `manual_fixture_invalid` |
| User used physical export but did not check operator confirmation | Export should be blocked; if malformed fixture exists, validator rejects it | Repeat export with physical confirmation checked | `operator_confirmation_missing` or `physical_capture_missing` |

## Required Path

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

## Recovery Commands

```sh
mkdir -p fixtures/replay/live
cp ~/Downloads/live_physical_focus_ritual_001.v0.json fixtures/replay/live/live_physical_focus_ritual_001.v0.json
npm run physical:validate
npm run gate:1c
```

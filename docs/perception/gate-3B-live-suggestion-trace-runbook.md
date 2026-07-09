# Gate 3B-Live Suggestion Trace Campaign

Start the app:

```sh
npm run physical:capture
```

Open the local URL printed by the command. Open **Advanced / Developer Tools**, select **Suggestion Trace Campaign**, then work through the 8 traces in order. For each trace: click **Start this trace**, perform the physical action, wait for the expected camera suggestion, Accept or Reject as instructed, complete the ritual if needed, export, save to the exact path under `fixtures/replay/live/suggestions/`, then click **Mark trace exported**.

| # | Trace | Physical action | Expected suggestion | Action | Save path |
| --- | --- | --- | --- | --- | --- |
| 1 | Phone moved | Move phone from `phone_zone` toward `off_desk_zone`. | Possible phone moved - confirm to accept. | Accept | `fixtures/replay/live/suggestions/live_suggestion_phone_moved_001.v0.json` |
| 2 | Notebook opened | Open notebook in `notebook_zone`. | Possible notebook opened - confirm to accept. | Accept | `fixtures/replay/live/suggestions/live_suggestion_notebook_opened_001.v0.json` |
| 3 | Pen picked up | Pick up pen from `pen_zone`. | Possible pen picked up - confirm to accept. | Accept | `fixtures/replay/live/suggestions/live_suggestion_pen_picked_up_001.v0.json` |
| 4 | Writing motion | Make writing-like motion over `notebook_zone`. | Possible writing motion - confirm to accept. | Accept | `fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json` |
| 5 | Typing motion | Make typing-like motion over `keyboard_zone`. | Possible typing motion - confirm to accept. | Accept | `fixtures/replay/live/suggestions/live_suggestion_typing_motion_001.v0.json` |
| 6 | Reject suggestion does not progress | Create a mismatched or low-confidence suggestion. | Any suggestion that should not progress the step. | Reject | `fixtures/replay/live/suggestions/live_suggestion_reject_does_not_progress_001.v0.json` |
| 7 | Uncertain scene | Create noisy motion until uncertainty is suggested. | Possible scene uncertainty - confirm to review. | Reject for exportable trace | `fixtures/replay/live/suggestions/live_suggestion_uncertain_scene_001.v0.json` |
| 8 | Full Focus Ritual | Complete the ritual while accepting matching suggestions. | Matching suggestion at each step. | Accept matching suggestions | `fixtures/replay/live/suggestions/live_suggestion_full_focus_ritual_001.v0.json` |

After exporting all traces, run:

```sh
npm run suggestions:validate
npm run suggestions:report
npm run gate:3b:live
```

If blocked, check all 8 files are under `fixtures/replay/live/suggestions/` with exact filenames. Send back `runs/gate-3b-live-latest.json` and `darkquest_operator_bug_report.json`. Do not send raw webcam media, screenshots, audio, OCR, or notebook text.

# FINAL SUGGESTION TRACE CAPTURE SCRIPT

## 1. Start App

```sh
npm run physical:capture
```

## 2. Open URL

Open the local URL shown by the command. Default:

```text
http://127.0.0.1:4177/packages/perception/browser-local-capture/prototype/index.html
```

## 3. Select Suggestion Trace Campaign

Choose Suggestion Trace Campaign mode. Confirm this is a real physical webcam session.

## 4. Capture Each Trace

Capture all eight traces:

- phone moved
- notebook opened
- pen picked up
- writing motion
- typing motion
- reject does not progress
- uncertain scene
- full Focus Ritual

Accept matching suggestions only. Reject mismatched suggestions. Do not use auto-completion.

## 5. Export Each Trace

Export each trace as symbolic JSON. Do not export raw media.

## 6. Save Each File

Save files to:

```text
fixtures/replay/live/suggestions/
```

Use the exact filenames shown by the app and required by Gate 3B-Live.

## 7. Run Suggestions Validate/Report

```sh
npm run suggestions:validate
npm run suggestions:report
```

## 8. Run Gate 3B-Live

```sh
npm run gate:3b:live
```

## 9. Send Back Results

Send:

- terminal output from `npm run suggestions:validate`
- terminal output from `npm run suggestions:report`
- terminal output from `npm run gate:3b:live`
- any failing trace JSON
- any operator bug report

## Optional Bundle Support

If bundle support exists:

```sh
npm run suggestions:bundle:validate
npm run suggestions:bundle:split
```

Individual trace files remain canonical even when a bundle is used.

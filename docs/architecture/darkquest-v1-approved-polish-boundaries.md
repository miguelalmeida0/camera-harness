# DarkQuest v1 Approved Polish Boundaries

## Decision

This pass may polish reliability, wow, and cost guard behavior inside the frozen product hierarchy. It may not redesign the app.

## Allowed Changes

- mirrored camera preview;
- reliability/error state copy;
- provider busy retry behavior;
- loading/capture/analyzing states;
- result reveal animation;
- voice response polish;
- one-shot cost guard;
- hidden developer diagnostics.

## Forbidden Changes

- layout redesign;
- new dashboard;
- new panels in main UI;
- continuous detection by default;
- auto-calling AI without click;
- raw frame persistence;
- token exposure;
- old ritual UX;
- trace UX;
- changing provider route without proof.

## Reliability Polish Scope

Allowed:

- clearer `HF_TOKEN` missing message;
- clearer provider busy message;
- clearer endpoint unavailable message;
- clearer frame capture failure message;
- capped provider retry/candidate behavior;
- disabled button while capturing/analyzing;
- one-shot duplicate-click guard.

Forbidden:

- loop retrying forever;
- background calls;
- provider calls while tab hidden;
- silent fallback that hides provider failures.

## Wow Polish Scope

Allowed:

- smooth movement result reveal;
- non-jumping hero sentence;
- tasteful motion respecting reduced motion;
- improved browser Web Speech API handling.

Forbidden:

- distracting animation loops;
- new visual hierarchy;
- voice that speaks provider/debug details;
- auto-speaking uncertain results.

## Developer Diagnostics Scope

Allowed only under hidden developer tools:

- provider route;
- failed candidate summary;
- latency;
- safe response parse status;
- token loaded boolean;
- no token value;
- no raw frames.


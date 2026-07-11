# DarkQuest v1.3 Custom Skills Handoff

## Multimodal Handoff

Implement Phase 1 in this order:

1. Add the versioned custom-skill store with generated IDs, transactional writes, migration, clear/delete, and no raw-media fields.
2. Extend local MediaPipe inference to expose validated hand landmarks to worker-local feature extraction without persisting frames or landmark histories.
3. Implement `hand_pose_embedding.v1`, including stable ordering, translation/scale/rotation normalization, mirror handling, and two-hand relation features.
4. Implement example quality checks, five-example collection, optional negative collection, deterministic prototype aggregation, and threshold proposal.
5. Implement the nearest-prototype/kNN classifier, negative separation, second-best margin, ambiguous/no-match behavior, and text-only diagnostics.
6. Reuse the existing stabilizer to emit `stable-custom-skill-event.v1` with no vectors or landmarks.
7. Extend recipe validation/matching by trigger source and custom skill ID; remove hardcoded canned-key assumptions from the custom source path.
8. Add the contained custom gesture wizard without changing the frozen hierarchy or existing visual system.
9. Reuse existing safe local adapters, idempotency, cooldown, receipts, and hidden-tab/camera-stop lifecycle guards.
10. Physically verify the two-hand Heart shape acceptance flow and common negative poses.

Custom hand motion is Phase 2 and must remain inactive until static-pose physical reliability is established.

## Harness Handoff

Add a custom-skill behavior gate that verifies:

- system-generated immutable `skill_id` and non-destructive failed saves;
- no raw image, video, base64, frame, landmark history, token, or cloud-training hook in storage/events/receipts;
- deterministic feature dimensions, stable hand ordering, mirror handling, and two-hand relation preservation;
- five-positive minimum, rejection of poor examples, optional three-negative protocol, and live-test requirement;
- classifier threshold, negative separation, second-best margin, ambiguous/no-match, and never-two-actions conflict behavior;
- trigger-source dispatch without adding custom IDs to the canned gesture list;
- zero LLM/VLM/provider calls during custom matching;
- continued-hold suppression, neutral reset, cooldown, idempotency, and safe action policy;
- lifecycle and deletion semantics, including removal of local templates and disabling references;
- contained wizard behavior at 390, 412, 768, 1024, and 1440px;
- synthetic feature/classifier evidence kept distinct from real physical camera evidence.

## Physical Release Evidence

The release cannot pass from synthetic vectors alone. Capture a physical session proving five valid two-hand Heart shape examples, local-only template persistence, successful live test, one `Heart detected` speech action, no repeat during hold, a later post-reset execution, and no trigger from open-palm or prayer-hand negatives.

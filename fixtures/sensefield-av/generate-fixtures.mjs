#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const videoDir = resolve(root, "video");
const audioDir = resolve(root, "audio");

const videos = {
  static_empty_scene: ["empty"],
  static_person: ["person"],
  thumbs_up: ["thumbs_up"],
  neutral_then_thumbs_up: ["neutral", "thumbs_up"],
  neutral_peace_neutral_thumbs: ["neutral", "peace_sign", "neutral", "thumbs_up"],
  thumbs_up_then_neutral_then_heart: ["thumbs_up", "neutral", "heart"],
  heart_shape: ["heart"],
  raise_cup: ["neutral", "cup_high"],
  lower_cup: ["cup_high", "cup_low"],
  pick_up_mug: ["neutral", "mug_held"],
  put_down_mug: ["mug_held", "neutral"],
  enter_frame: ["empty", "person"],
  leave_frame: ["person", "empty"],
  no_meaningful_change: ["neutral", "neutral_noise"],
  low_light_movement: ["low_light", "low_light_move"],
  partial_object: ["partial_object"],
  camera_bump: ["neutral", "camera_bump", "neutral"],
  repeated_unchanged_pose: ["thumbs_up", "thumbs_up", "thumbs_up"],
  three_distinct_movements: ["neutral", "thumbs_up", "neutral", "heart", "neutral", "mug_held"]
};

const transcripts = {
  what_am_i_holding: "What am I holding?",
  what_color_is_it: "What color is it?",
  what_changed: "What changed?",
  did_i_make_a_heart: "Did I make a heart?",
  follow_up_that_one: "That one.",
  interruption_stop: "Stop, what is on the desk?",
  silence: "",
  background_noise: "",
  two_questions: "What am I holding? What color is it?",
  speech_while_assistant_speaks: "Stop, what is on the desk?"
};

await mkdir(videoDir, { recursive: true });
await mkdir(audioDir, { recursive: true });
for (const [name, stages] of Object.entries(videos)) {
  await writeFile(resolve(videoDir, `${name}.y4m`), createY4m(stages));
}
for (const [name, transcript] of Object.entries(transcripts)) {
  await writeFile(resolve(audioDir, `${name}.wav`), createWav(name, transcript));
}
console.log(`generated ${Object.keys(videos).length} camera fixtures and ${Object.keys(transcripts).length} microphone fixtures`);

function createY4m(stages) {
  const width = 160;
  const height = 120;
  const fps = 5;
  const framesPerStage = 5;
  const chunks = [Buffer.from(`YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`)];
  for (const stage of stages) {
    for (let frame = 0; frame < framesPerStage; frame += 1) {
      const y = Buffer.alloc(width * height, stage.startsWith("low_light") ? 28 : 54);
      drawStage(y, width, height, stage, frame);
      const chromaSize = (width * height) / 4;
      chunks.push(Buffer.from("FRAME\n"), y, Buffer.alloc(chromaSize, 128), Buffer.alloc(chromaSize, 128));
    }
  }
  return Buffer.concat(chunks);
}

function drawStage(y, width, height, stage, frame) {
  const paint = (x, top, w, h, value) => {
    for (let row = Math.max(0, top); row < Math.min(height, top + h); row += 1) {
      y.fill(value, (row * width) + Math.max(0, x), (row * width) + Math.min(width, x + w));
    }
  };
  if (stage === "empty") return;
  if (stage === "neutral_noise") return paint(78 + (frame % 2), 58, 3, 3, 60);
  if (stage === "camera_bump") return paint(4 + (frame * 8), 4, 145, 108, 170);
  if (stage === "partial_object") return paint(138, 42, 22, 54, 185);
  if (stage === "low_light") return paint(62, 28, 34, 76, 38);
  if (stage === "low_light_move") return paint(92, 28, 34, 76, 64);
  paint(58, 22, 44, 78, stage === "person" ? 142 : 116);
  if (stage === "thumbs_up") {
    paint(105, 38, 18, 45, 214);
    paint(111, 22, 8, 20, 232);
  } else if (stage === "peace_sign") {
    paint(105, 42, 20, 42, 214);
    paint(108, 17, 7, 31, 232);
    paint(119, 13, 7, 35, 232);
  } else if (stage === "heart") {
    paint(34, 42, 38, 12, 220);
    paint(88, 42, 38, 12, 220);
    paint(62, 52, 36, 30, 200);
  } else if (stage === "cup_high") {
    paint(106, 28, 28, 32, 32);
    paint(132, 36, 8, 16, 34);
  } else if (stage === "cup_low" || stage === "mug_held") {
    paint(104, 72, 28, 30, 32);
    paint(130, 78, 8, 16, 34);
  }
}

function createWav(name, transcript) {
  const sampleRate = 16000;
  const seconds = name === "silence" ? 1 : Math.max(1, Math.min(4, 0.45 + (transcript.split(/\s+/).filter(Boolean).length * 0.28)));
  const sampleCount = Math.round(sampleRate * seconds);
  const pcm = Buffer.alloc(sampleCount * 2);
  const seed = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleRate;
    const wordBand = Math.floor(t / 0.24);
    const frequency = name === "background_noise" ? 97 : 150 + ((seed + (wordBand * 47)) % 190);
    const envelope = transcript ? Math.sin(Math.min(1, (t % 0.24) / 0.03) * Math.PI / 2) * Math.min(1, (0.24 - (t % 0.24)) / 0.04) : 0;
    const noise = name === "background_noise" ? Math.sin(2 * Math.PI * 31 * t) * 0.04 : 0;
    const sample = Math.max(-1, Math.min(1, (Math.sin(2 * Math.PI * frequency * t) * envelope * 0.24) + noise));
    pcm.writeInt16LE(Math.round(sample * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

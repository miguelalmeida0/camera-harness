export function createPerceptionImageRuntime(options = {}) {
  const doc = options.document || globalThis.document;
  const maximumFramesPerTrack = boundedInteger(options.maximumFramesPerTrack, 1, 8, 4);
  const maximumTotalFrames = boundedInteger(options.maximumTotalFrames, 2, 24, 10);
  const embeddingCanvas = doc.createElement("canvas");
  const contourCanvas = doc.createElement("canvas");
  const cropCanvas = doc.createElement("canvas");
  embeddingCanvas.width = 16;
  embeddingCanvas.height = 16;
  contourCanvas.width = 64;
  contourCanvas.height = 64;
  const embeddingContext = embeddingCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const contourContext = contourCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const cropContext = cropCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const frameMemory = new Map();

  function appearanceEmbedding(video, box) {
    const rect = sourceRect(video, box);
    if (!rect) return null;
    embeddingContext.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, 16, 16);
    const pixels = embeddingContext.getImageData(0, 0, 16, 16).data;
    const histogram = new Array(64).fill(0);
    for (let index = 0; index < pixels.length; index += 4) {
      const bucket = (pixels[index] >> 6) * 16 + (pixels[index + 1] >> 6) * 4 + (pixels[index + 2] >> 6);
      histogram[bucket] += 1;
    }
    const norm = Math.sqrt(histogram.reduce((sum, value) => sum + value * value, 0)) || 1;
    return histogram.map((value) => value / norm);
  }

  function objectContour(video, track, timestamp = Date.now()) {
    const rect = sourceRect(video, track?.geometry?.box || track?.box);
    if (!rect || !track?.id) return null;
    contourContext.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, 64, 64);
    const image = contourContext.getImageData(0, 0, 64, 64);
    const pixels = image.data;
    const background = borderMean(pixels, 64, 64);
    const distances = new Float32Array(64 * 64);
    let distanceSum = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const index = (y * 64 + x) * 4;
        const distance = Math.hypot(
          pixels[index] - background.r,
          pixels[index + 1] - background.g,
          pixels[index + 2] - background.b
        );
        distances[y * 64 + x] = distance;
        distanceSum += distance;
      }
    }
    const meanDistance = distanceSum / distances.length;
    const threshold = Math.max(24, meanDistance * 1.08);
    const binary = new Uint8Array(64 * 64);
    for (let index = 0; index < distances.length; index += 1) binary[index] = distances[index] >= threshold ? 1 : 0;
    const seed = centralForegroundSeed(distances, binary, 64, 64);
    const component = seed == null ? [] : connectedComponent(binary, seed, 64, 64);
    const componentRatio = component.length / (64 * 64);
    let polygon;
    let confidence;
    if (componentRatio >= 0.035 && componentRatio <= 0.92) {
      const boundary = componentBoundary(component, binary, 64, 64);
      polygon = simplifyPolygon(convexHull(boundary), 24).map((point) => ({
        x: clamp((rect.x + point.x / 63 * rect.width) / video.videoWidth, 0, 1),
        y: clamp((rect.y + point.y / 63 * rect.height) / video.videoHeight, 0, 1)
      }));
      confidence = clamp(0.38 + Math.min(0.38, meanDistance / 170) + Math.min(0.18, componentRatio), 0, 0.92);
    } else {
      const box = track?.geometry?.smoothedBox || track?.box;
      polygon = insetOctagon(box);
      confidence = 0.3;
    }
    return Object.freeze({
      trackId: track.id,
      polygon: Object.freeze(polygon.map((point) => Object.freeze(point))),
      confidence,
      timestamp
    });
  }

  function considerBestFrame(video, track, mask, timestamp = Date.now()) {
    if (!track?.id) return null;
    const captured = capture(video, track.geometry?.box || track.box, 384, 0.82, 0.08);
    if (!captured) return null;
    const sharpness = laplacianSharpness(captured.imageData);
    const lighting = lightingScore(captured.imageData);
    const size = Math.min(1, area(track.box) / 0.22);
    const centrality = centralityScore(track.box);
    const completeness = mask?.confidence || 0.45;
    const motion = Math.max(0, 1 - Math.min(1, (track.motion?.velocity || 0) / 0.3));
    const quality = clamp(sharpness * 0.3 + lighting * 0.16 + size * 0.18 + centrality * 0.12 + completeness * 0.12 + motion * 0.12, 0, 1);
    const frame = Object.freeze({
      trackId: track.id,
      capturedAt: timestamp,
      width: captured.width,
      height: captured.height,
      mimeType: "image/jpeg",
      encodedFrame: captured.encodedFrame,
      quality,
      sharpness,
      lighting,
      fingerprint: visualFingerprint(captured.imageData)
    });
    const frames = frameMemory.get(track.id) || [];
    frames.push(frame);
    frames.sort((left, right) => right.quality - left.quality || right.capturedAt - left.capturedAt);
    frames.splice(maximumFramesPerTrack);
    frameMemory.set(track.id, frames);
    trimTotalFrames();
    return frame;
  }

  function bestFrame(trackId) {
    return frameMemory.get(String(trackId))?.[0] || null;
  }

  function bestDifferentFrame(trackId, fingerprint, minimumDistance = 8) {
    return frameMemory.get(String(trackId))?.find((frame) => (
      !fingerprint || fingerprintDistance(frame.fingerprint, fingerprint) >= minimumDistance
    )) || null;
  }

  function captureDiscoveryFrame(video, timestamp = Date.now()) {
    const captured = capture(video, { x: 0, y: 0, width: 1, height: 1 }, 512, 0.76, 0);
    if (!captured) return null;
    return {
      encoded_frame: captured.encodedFrame,
      mime_type: "image/jpeg",
      captured_at_ms: timestamp,
      width: captured.width,
      height: captured.height
    };
  }

  function verificationFrame(trackId) {
    const frame = bestFrame(trackId);
    return frame ? {
      encoded_frame: frame.encodedFrame,
      mime_type: frame.mimeType,
      captured_at_ms: frame.capturedAt,
      width: frame.width,
      height: frame.height
    } : null;
  }

  function stats() {
    return Object.freeze({
      tracks: frameMemory.size,
      frames: [...frameMemory.values()].reduce((sum, frames) => sum + frames.length, 0),
      maximumFramesPerTrack,
      maximumTotalFrames
    });
  }

  function clear() {
    frameMemory.clear();
    for (const canvas of [embeddingCanvas, contourCanvas, cropCanvas]) {
      const context = canvas.getContext("2d");
      context?.clearRect?.(0, 0, canvas.width, canvas.height);
    }
  }

  function trimTotalFrames() {
    while ([...frameMemory.values()].reduce((sum, frames) => sum + frames.length, 0) > maximumTotalFrames) {
      let worstTrackId = null;
      let worstIndex = -1;
      let worstQuality = Infinity;
      for (const [trackId, frames] of frameMemory) {
        const index = frames.length - 1;
        if (index >= 0 && frames[index].quality < worstQuality) {
          worstQuality = frames[index].quality;
          worstTrackId = trackId;
          worstIndex = index;
        }
      }
      if (!worstTrackId) break;
      const frames = frameMemory.get(worstTrackId);
      frames.splice(worstIndex, 1);
      if (!frames.length) frameMemory.delete(worstTrackId);
    }
  }

  return Object.freeze({
    appearanceEmbedding,
    bestFrame,
    bestDifferentFrame,
    captureDiscoveryFrame,
    clear,
    considerBestFrame,
    objectContour,
    stats,
    verificationFrame
  });

  function capture(video, box, maximumDimension, quality, paddingRatio) {
    const padded = padBox(box, paddingRatio);
    const rect = sourceRect(video, padded);
    if (!rect) return null;
    const scale = Math.min(1, maximumDimension / Math.max(rect.width, rect.height));
    cropCanvas.width = Math.max(1, Math.round(rect.width * scale));
    cropCanvas.height = Math.max(1, Math.round(rect.height * scale));
    cropContext.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, cropCanvas.width, cropCanvas.height);
    const imageData = cropContext.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    return {
      width: cropCanvas.width,
      height: cropCanvas.height,
      encodedFrame: cropCanvas.toDataURL("image/jpeg", quality).split(",")[1],
      imageData
    };
  }
}

function sourceRect(video, box) {
  const width = Number(video?.videoWidth) || 0;
  const height = Number(video?.videoHeight) || 0;
  if (!width || !height || !box) return null;
  return {
    x: Math.floor(clamp(box.x, 0, 1) * width),
    y: Math.floor(clamp(box.y, 0, 1) * height),
    width: Math.max(1, Math.ceil(clamp(box.width, 0, 1) * width)),
    height: Math.max(1, Math.ceil(clamp(box.height, 0, 1) * height))
  };
}

function padBox(box, ratio) {
  const xPadding = box.width * ratio;
  const yPadding = box.height * ratio;
  const x = clamp(box.x - xPadding, 0, 1);
  const y = clamp(box.y - yPadding, 0, 1);
  return {
    x,
    y,
    width: Math.min(1 - x, box.width + xPadding * 2),
    height: Math.min(1 - y, box.height + yPadding * 2)
  };
}

function borderMean(pixels, width, height) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > 2 && x < width - 3 && y > 2 && y < height - 3) continue;
      const index = (y * width + x) * 4;
      r += pixels[index];
      g += pixels[index + 1];
      b += pixels[index + 2];
      count += 1;
    }
  }
  return { r: r / count, g: g / count, b: b / count };
}

function centralForegroundSeed(distances, binary, width, height) {
  let bestIndex = null;
  let bestDistance = -1;
  for (let y = Math.floor(height * 0.22); y < Math.ceil(height * 0.78); y += 1) {
    for (let x = Math.floor(width * 0.22); x < Math.ceil(width * 0.78); x += 1) {
      const index = y * width + x;
      if (binary[index] && distances[index] > bestDistance) {
        bestIndex = index;
        bestDistance = distances[index];
      }
    }
  }
  return bestIndex;
}

function connectedComponent(binary, seed, width, height) {
  const queue = [seed];
  const seen = new Uint8Array(binary.length);
  seen[seed] = 1;
  const output = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    output.push(index);
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (binary[neighbor] && !seen[neighbor]) {
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
  }
  return output;
}

function componentBoundary(component, binary, width, height) {
  const output = [];
  for (const index of component) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1
      || !binary[index - 1] || !binary[index + 1] || !binary[index - width] || !binary[index + width]) {
      output.push({ x, y });
    }
  }
  return output;
}

function convexHull(points) {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (origin, left, right) => (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function simplifyPolygon(points, maximum) {
  if (points.length <= maximum) return points;
  const step = points.length / maximum;
  return Array.from({ length: maximum }, (_, index) => points[Math.floor(index * step)]);
}

function insetOctagon(box) {
  const insetX = box.width * 0.035;
  const insetY = box.height * 0.035;
  const cornerX = box.width * 0.12;
  const cornerY = box.height * 0.12;
  return [
    { x: box.x + cornerX, y: box.y + insetY },
    { x: box.x + box.width - cornerX, y: box.y + insetY },
    { x: box.x + box.width - insetX, y: box.y + cornerY },
    { x: box.x + box.width - insetX, y: box.y + box.height - cornerY },
    { x: box.x + box.width - cornerX, y: box.y + box.height - insetY },
    { x: box.x + cornerX, y: box.y + box.height - insetY },
    { x: box.x + insetX, y: box.y + box.height - cornerY },
    { x: box.x + insetX, y: box.y + cornerY }
  ];
}

function laplacianSharpness(imageData) {
  const { data, width, height } = imageData;
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  const luminance = (index) => data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = (y * width + x) * 4;
      const value = luminance(index) * 4
        - luminance(index - 4)
        - luminance(index + 4)
        - luminance(index - width * 4)
        - luminance(index + width * 4);
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  const variance = count ? sumSquares / count - (sum / count) ** 2 : 0;
  return clamp(Math.sqrt(Math.max(0, variance)) / 90, 0, 1);
}

function lightingScore(imageData) {
  const { data } = imageData;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 16) {
    sum += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    count += 1;
  }
  const mean = count ? sum / count : 0;
  return clamp(1 - Math.abs(mean - 142) / 142, 0, 1);
}

function centralityScore(box) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return 1 - Math.min(1, Math.hypot(x - 0.5, y - 0.5) / 0.71);
}

function visualFingerprint(imageData) {
  const { data, width, height } = imageData;
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = sampledLuminance(data, width, height, x, y);
      const right = sampledLuminance(data, width, height, x + 1, y);
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

function sampledLuminance(data, width, height, gridX, gridY) {
  const x = Math.min(width - 1, Math.max(0, Math.round(gridX / 8 * (width - 1))));
  const y = Math.min(height - 1, Math.max(0, Math.round(gridY / 7 * (height - 1))));
  const index = (y * width + x) * 4;
  return (data[index] || 0) * 0.2126 + (data[index + 1] || 0) * 0.7152 + (data[index + 2] || 0) * 0.0722;
}

function fingerprintDistance(left, right) {
  try {
    let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
    let count = 0;
    while (difference) {
      count += Number(difference & 1n);
      difference >>= 1n;
    }
    return count;
  } catch {
    return left === right ? 0 : 64;
  }
}

function area(box) {
  return Math.max(0, box.width * box.height);
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

const sceneConfig = {
  spin: 0.82,
  inclinationDeg: 67,
  cameraDistance: 12,
  raySteps: 128,
  geodesicRays: 112,
  diskSamples: 168,
  frameCount: 72,
  taaEnabled: true,
  resolutionScale: 0.74
};

const requestedMode = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("mode")
  : null;
const isRealRendererMode = typeof requestedMode === "string" && requestedMode.startsWith("real-");
const REAL_ADAPTER_WAIT_MS = 5000;
const REAL_ADAPTER_LOAD_MS = 20000;

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function findRegisteredRealRenderer() {
  const registry = typeof window !== "undefined" ? window.__aiWebGpuLabRendererRegistry : null;
  if (!registry || typeof registry.list !== "function") return null;
  return registry.list().find((adapter) => adapter && adapter.isReal === true) || null;
}

async function awaitRealRenderer(timeoutMs = REAL_ADAPTER_WAIT_MS) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const adapter = findRegisteredRealRenderer();
    if (adapter) return adapter;
    if (typeof window !== "undefined" && window.__aiWebGpuLabRealKerrBootstrapError) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const state = {
  startedAt: performance.now(),
  environment: buildEnvironment(),
  capability: null,
  run: null,
  active: false,
  realAdapterError: null,
  logs: []
};

const elements = {
  statusRow: document.getElementById("status-row"),
  summary: document.getElementById("summary"),
  probeCapability: document.getElementById("probe-capability"),
  runScene: document.getElementById("run-scene"),
  downloadJson: document.getElementById("download-json"),
  canvas: document.getElementById("scene-canvas"),
  metricGrid: document.getElementById("metric-grid"),
  metaGrid: document.getElementById("meta-grid"),
  logList: document.getElementById("log-list"),
  resultJson: document.getElementById("result-json")
};

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function parseBrowser() {
  const ua = navigator.userAgent;
  for (const [needle, name] of [["Edg/", "Edge"], ["Chrome/", "Chrome"], ["Firefox/", "Firefox"], ["Version/", "Safari"]]) {
    const marker = ua.indexOf(needle);
    if (marker >= 0) return { name, version: ua.slice(marker + needle.length).split(/[\s)/;]/)[0] || "unknown" };
  }
  return { name: "Unknown", version: "unknown" };
}

function parseOs() {
  const ua = navigator.userAgent;
  if (/Windows NT/i.test(ua)) return { name: "Windows", version: (ua.match(/Windows NT ([0-9.]+)/i) || [])[1] || "unknown" };
  if (/Mac OS X/i.test(ua)) return { name: "macOS", version: ((ua.match(/Mac OS X ([0-9_]+)/i) || [])[1] || "unknown").replace(/_/g, ".") };
  if (/Linux/i.test(ua)) return { name: "Linux", version: "unknown" };
  return { name: "Unknown", version: "unknown" };
}

function inferDeviceClass() {
  const threads = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  if (memory >= 16 && threads >= 12) return "desktop-high";
  if (memory >= 8 && threads >= 8) return "desktop-mid";
  if (threads >= 4) return "laptop";
  return "unknown";
}

function buildEnvironment() {
  return {
    browser: parseBrowser(),
    os: parseOs(),
    device: {
      name: navigator.platform || "unknown",
      class: inferDeviceClass(),
      cpu: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} threads` : "unknown",
      memory_gb: navigator.deviceMemory || undefined,
      power_mode: "unknown"
    },
    gpu: { adapter: "pending", required_features: [], limits: {} },
    backend: "pending",
    fallback_triggered: false,
    worker_mode: "main",
    cache_state: "warm"
  };
}

function log(message) {
  state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
  state.logs = state.logs.slice(0, 12);
  renderLogs();
}

async function probeCapability() {
  if (state.active) return;
  state.active = true;
  render();

  const hasWebGpu = typeof navigator !== "undefined" && Boolean(navigator.gpu);
  const fallbackForced = new URLSearchParams(window.location.search).get("mode") === "fallback";
  const webgpuPath = hasWebGpu && !fallbackForced;
  const adapter = webgpuPath ? "navigator.gpu available" : "wasm-webgl-fallback";

  state.capability = {
    hasWebGpu,
    adapter,
    requiredFeatures: webgpuPath ? ["shader-f16", "timestamp-query"] : []
  };
  state.environment.gpu = {
    adapter,
    required_features: state.capability.requiredFeatures,
    limits: webgpuPath ? { maxStorageBufferBindingSize: 134217728, maxBindGroups: 4 } : {}
  };
  state.environment.backend = webgpuPath ? "webgpu" : "wasm-webgl";
  state.environment.fallback_triggered = !webgpuPath;
  state.active = false;

  log(webgpuPath ? "WebGPU path selected for Kerr engine readiness." : "Fallback path selected for Kerr engine readiness.");
  render();
}

function simulateGeodesicIntegration(frame) {
  const startedAt = performance.now();
  const spin = sceneConfig.spin;
  const inclination = sceneConfig.inclinationDeg * Math.PI / 180;
  let checksum = 0;
  let captured = 0;
  let escaped = 0;

  for (let ray = 0; ray < sceneConfig.geodesicRays; ray += 1) {
    let radius = 2.2 + (ray % 28) * 0.17;
    let theta = (ray / sceneConfig.geodesicRays) * Math.PI * 2 + frame * 0.006;
    let radialVelocity = 0.004 + (ray % 5) * 0.0015;
    let angularMomentum = 0.5 + Math.sin(ray * 0.37) * 0.22;

    for (let step = 0; step < sceneConfig.raySteps; step += 1) {
      const frameDragging = spin / Math.max(radius * radius, 0.5);
      const polarTerm = Math.sin(inclination) * Math.cos(theta + step * 0.013);
      theta += 0.012 * angularMomentum + frameDragging * 0.018 + polarTerm * 0.0007;
      radius += radialVelocity - 0.00011 * step + Math.sin(theta * 1.7) * 0.0008;
      angularMomentum *= 0.9996;
      checksum += Math.sin(theta) * 0.0009 + radius * 0.00003;
      if (radius < 1.18) {
        captured += 1;
        break;
      }
      if (radius > 8.4) {
        escaped += 1;
        break;
      }
    }
  }

  return {
    durationMs: performance.now() - startedAt,
    checksum: round(checksum, 5),
    captured,
    escaped
  };
}

function drawBackground(ctx, width, height, frame) {
  ctx.fillStyle = "#010102";
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 170; index += 1) {
    const x = (index * 83 % width) + Math.sin(index * 0.91 + frame * 0.01) * 3;
    const y = (index * 47 % height) + Math.cos(index * 1.27) * 3;
    const alpha = 0.25 + (index % 9) * 0.055;
    ctx.fillStyle = `rgba(247, 240, 228, ${round(alpha, 3)})`;
    ctx.fillRect(x, y, index % 13 === 0 ? 2 : 1, index % 17 === 0 ? 2 : 1);
  }
}

function drawFrameDraggingField(ctx, cx, cy, radius, frame) {
  ctx.strokeStyle = "rgba(103, 232, 249, 0.24)";
  ctx.lineWidth = 1;
  for (let ring = 0; ring < 7; ring += 1) {
    const ringRadius = radius * (1.25 + ring * 0.48);
    const twist = sceneConfig.spin * (0.3 + ring * 0.08) + frame * 0.006;
    ctx.beginPath();
    for (let step = 0; step <= 96; step += 1) {
      const phase = (step / 96) * Math.PI * 2;
      const x = cx + Math.cos(phase + Math.sin(phase + twist) * 0.12) * ringRadius;
      const y = cy + Math.sin(phase + twist) * ringRadius * 0.42;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawErgosphere(ctx, cx, cy, radius, frame) {
  const horizonRadius = radius * (1 + Math.sqrt(1 - sceneConfig.spin * sceneConfig.spin) * 0.24);
  const ergoRadius = radius * (1.45 + sceneConfig.spin * 0.28);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(frame * 0.008) * 0.05);
  ctx.scale(1, 0.62);
  ctx.strokeStyle = "rgba(103, 232, 249, 0.62)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, ergoRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(245, 188, 91, 0.78)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, horizonRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#010101";
  ctx.beginPath();
  ctx.arc(cx, cy, horizonRadius * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawDisk(ctx, cx, cy, frame) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(frame * 0.01) * 0.03);
  ctx.scale(1, Math.cos(sceneConfig.inclinationDeg * Math.PI / 180) * 0.9);

  for (let index = 0; index < sceneConfig.diskSamples; index += 1) {
    const phase = (index / sceneConfig.diskSamples) * Math.PI * 2 + frame * 0.023;
    const band = index % 5;
    const radius = 128 + band * 15 + Math.sin(phase * 3.1 + sceneConfig.spin) * 6;
    const doppler = Math.cos(phase) > 0 ? 1.18 : 0.58;
    const alpha = 0.22 + doppler * 0.34;
    const x = Math.cos(phase + sceneConfig.spin * 0.08) * radius;
    const y = Math.sin(phase) * radius;
    ctx.fillStyle = band < 2 ? `rgba(245, 188, 91, ${round(alpha, 3)})` : `rgba(248, 113, 113, ${round(alpha * 0.78, 3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.9 + band * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineWidth = 2;
  for (const radius of [126, 154, 184]) {
    ctx.strokeStyle = "rgba(245, 188, 91, 0.2)";
    ctx.beginPath();
    ctx.ellipse(0, 0, radius, radius * 0.78, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGeodesicBundle(ctx, cx, cy, radius, frame, checksum) {
  ctx.lineWidth = 1;
  for (let index = 0; index < 36; index += 1) {
    const phase = (index / 36) * Math.PI * 2 + frame * 0.013;
    const startRadius = radius * (2.1 + (index % 4) * 0.22);
    const endRadius = radius * (0.92 + (index % 3) * 0.06);
    ctx.beginPath();
    for (let step = 0; step <= 34; step += 1) {
      const t = step / 34;
      const bend = sceneConfig.spin * t * t * 1.2;
      const localRadius = startRadius * (1 - t) + endRadius * t;
      const theta = phase + bend + Math.sin(t * Math.PI + checksum) * 0.08;
      const x = cx + Math.cos(theta) * localRadius;
      const y = cy + Math.sin(theta) * localRadius * (0.36 + 0.2 * t);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = index % 2 === 0 ? "rgba(103, 232, 249, 0.28)" : "rgba(247, 240, 228, 0.18)";
    ctx.stroke();
  }
}

function drawFrame(ctx, frame, integration) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const cx = width / 2;
  const cy = height / 2 + 4;
  const radius = Math.min(width, height) * 0.13;

  drawBackground(ctx, width, height, frame);
  drawFrameDraggingField(ctx, cx, cy, radius, frame);
  drawDisk(ctx, cx, cy, frame);
  drawGeodesicBundle(ctx, cx, cy, radius, frame, integration.checksum);
  drawErgosphere(ctx, cx, cy, radius, frame);

  ctx.fillStyle = "rgba(247, 240, 228, 0.9)";
  ctx.font = "14px Segoe UI";
  ctx.fillText(`frame ${frame + 1}/${sceneConfig.frameCount}`, 18, 28);
  ctx.fillText(`spin ${sceneConfig.spin}, inclination ${sceneConfig.inclinationDeg} deg, ${sceneConfig.raySteps} ray steps`, 18, 50);
  ctx.fillText(`integration ${round(integration.durationMs, 3)} ms, checksum ${integration.checksum}`, 18, 72);
}

async function runRealRendererKerr(adapter) {
  log(`Connecting real renderer adapter '${adapter.id}'.`);
  const startedAt = performance.now();
  const sceneLoadStartedAt = performance.now();
  const realCanvas = document.createElement("canvas");
  realCanvas.width = elements.canvas.width;
  realCanvas.height = elements.canvas.height;
  realCanvas.style.display = "none";
  document.body.appendChild(realCanvas);
  try {
    await withTimeout(
      Promise.resolve(adapter.createRenderer({ canvas: realCanvas })),
      REAL_ADAPTER_LOAD_MS,
      `createRenderer(${adapter.id})`
    );
    await withTimeout(
      Promise.resolve(adapter.loadScene({ nodeCount: 24 })),
      REAL_ADAPTER_LOAD_MS,
      `loadScene(${adapter.id})`
    );
    const sceneLoadMs = performance.now() - sceneLoadStartedAt;

    const frameTimes = [];
    for (let index = 0; index < 32; index += 1) {
      const frameInfo = await withTimeout(
        Promise.resolve(adapter.renderFrame({ frameIndex: index })),
        REAL_ADAPTER_LOAD_MS,
        `renderFrame(${adapter.id})`
      );
      frameTimes.push(typeof frameInfo?.frameMs === "number" ? frameInfo.frameMs : 0);
    }

    const totalMs = performance.now() - startedAt;
    const avgFrame = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(frameTimes.length, 1);
    return {
      totalMs,
      sceneLoadMs,
      avgFps: 1000 / Math.max(avgFrame, 0.001),
      p95FrameMs: percentile(frameTimes, 0.95) || 0,
      frameTimes,
      sampleCount: frameTimes.length,
      realAdapter: adapter
    };
  } finally {
    realCanvas.remove();
  }
}

async function runSceneBaseline() {
  if (state.active) return;
  if (!state.capability) {
    await probeCapability();
  }

  state.active = true;
  render();

  if (isRealRendererMode) {
    log(`Mode=${requestedMode} requested; awaiting real renderer adapter registration.`);
    const adapter = await awaitRealRenderer();
    if (adapter) {
      try {
        state.run = await runRealRendererKerr(adapter);
        state.active = false;
        log(`Real renderer '${adapter.id}' complete: avg fps ${round(state.run.avgFps, 2)}, p95 frame ${round(state.run.p95FrameMs, 2)} ms.`);
        render();
        return;
      } catch (error) {
        state.realAdapterError = error?.message || String(error);
        log(`Real renderer '${adapter.id}' failed: ${state.realAdapterError}; falling back to deterministic.`);
      }
    } else {
      const reason = (typeof window !== "undefined" && window.__aiWebGpuLabRealKerrBootstrapError) || "timed out waiting for adapter registration";
      state.realAdapterError = reason;
      log(`No real renderer adapter registered (${reason}); falling back to deterministic Kerr engine baseline.`);
    }
  }
  const ctx = elements.canvas.getContext("2d");
  const frameTimes = [];
  const integrationTimes = [];
  const startedAt = performance.now();
  const sceneLoadStartedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, state.environment.fallback_triggered ? 78 : 44));
  const sceneLoadMs = performance.now() - sceneLoadStartedAt;

  let previous = performance.now();
  let checksum = 0;
  let captured = 0;
  let escaped = 0;
  for (let frame = 0; frame < sceneConfig.frameCount; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const integration = simulateGeodesicIntegration(frame);
    integrationTimes.push(integration.durationMs);
    checksum = integration.checksum;
    captured += integration.captured;
    escaped += integration.escaped;
    const now = performance.now();
    frameTimes.push(now - previous);
    previous = now;
    drawFrame(ctx, frame, integration);
  }

  const totalMs = performance.now() - startedAt;
  const avgFrame = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(frameTimes.length, 1);
  const avgIntegration = integrationTimes.reduce((sum, value) => sum + value, 0) / Math.max(integrationTimes.length, 1);
  state.run = {
    totalMs,
    sceneLoadMs,
    avgFps: 1000 / Math.max(avgFrame, 0.001),
    p95FrameMs: percentile(frameTimes, 0.95) || 0,
    avgIntegrationMs: avgIntegration,
    p95IntegrationMs: percentile(integrationTimes, 0.95) || 0,
    checksum,
    captured,
    escaped,
    sampleCount: frameTimes.length,
    artifactNote: state.environment.fallback_triggered
      ? "fallback Kerr path; deterministic geodesic integration fixture only"
      : "synthetic Kerr geodesic WebGPU path; no Rust/WASM or shader integration yet",
    realAdapter: null
  };
  state.active = false;

  log(`Kerr engine baseline complete: avg fps ${round(state.run.avgFps, 2)}, p95 frame ${round(state.run.p95FrameMs, 2)} ms.`);
  render();
}

function describeRendererAdapter() {
  const registry = typeof window !== "undefined" ? window.__aiWebGpuLabRendererRegistry : null;
  const requested = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("mode")
    : null;
  if (registry) {
    return registry.describe(requested);
  }
  return {
    id: "deterministic-kerr",
    label: "Deterministic Kerr engine",
    status: "deterministic",
    isReal: false,
    version: "1.0.0",
    capabilities: ["scene-load", "frame-pace", "fallback-record"],
    backendHint: "synthetic",
    message: "Renderer adapter registry unavailable; using inline deterministic mock."
  };
}

function buildResult() {
  const run = state.run;
  return {
    meta: {
      repo: "exp-blackhole-kerr-engine",
      commit: "bootstrap-generated",
      timestamp: new Date().toISOString(),
      owner: "ai-webgpu-lab",
      track: "blackhole",
      scenario: run
        ? (run.realAdapter ? `blackhole-kerr-engine-real-${run.realAdapter.id}` : "blackhole-kerr-engine-readiness")
        : "blackhole-kerr-engine-pending",
      notes: run
        ? `spin=${sceneConfig.spin}; inclinationDeg=${sceneConfig.inclinationDeg}; cameraDistance=${sceneConfig.cameraDistance}; raySteps=${sceneConfig.raySteps}; geodesicRays=${sceneConfig.geodesicRays}; avgIntegrationMs=${round(run.avgIntegrationMs, 4)}; p95IntegrationMs=${round(run.p95IntegrationMs, 4)}; captured=${run.captured}; escaped=${run.escaped}; backend=${state.environment.backend}; fallback=${state.environment.fallback_triggered}${run.realAdapter ? `; realAdapter=${run.realAdapter.id}` : (isRealRendererMode && state.realAdapterError ? `; realAdapter=fallback(${state.realAdapterError})` : "")}`
        : "Probe capability and run the deterministic Kerr geodesic scene."
    },
    environment: state.environment,
    workload: {
      kind: "blackhole",
      name: "blackhole-kerr-engine-readiness",
      input_profile: "spin-0.82-inclination-67-geodesic-fixture",
      renderer: "kerr-geodesic-readiness",
      model_id: "kerr-geodesic-readiness",
      resolution: `${elements.canvas.width}x${elements.canvas.height}`
    },
    metrics: {
      common: {
        time_to_interactive_ms: round(performance.now() - state.startedAt, 2) || 0,
        init_ms: run ? round(run.sceneLoadMs, 2) || 0 : 0,
        success_rate: run ? 1 : state.capability ? 0.5 : 0,
        peak_memory_note: navigator.deviceMemory ? `${navigator.deviceMemory} GB reported by browser` : "deviceMemory unavailable",
        error_type: ""
      },
      graphics: {
        avg_fps: run ? round(run.avgFps, 2) || 0 : 0,
        p95_frametime_ms: run ? round(run.p95FrameMs, 2) || 0 : 0,
        scene_load_ms: run ? round(run.sceneLoadMs, 2) || 0 : 0,
        resolution_scale: sceneConfig.resolutionScale,
        ray_steps: sceneConfig.raySteps,
        taa_enabled: sceneConfig.taaEnabled,
        visual_artifact_note: run ? run.artifactNote : "pending Kerr geodesic scene run"
      }
    },
    status: run ? "success" : state.capability ? "partial" : "pending",
    artifacts: {
      raw_logs: state.logs.slice(0, 5),
      deploy_url: "https://ai-webgpu-lab.github.io/exp-blackhole-kerr-engine/",
      renderer_adapter: describeRendererAdapter()
    }
  };
}

function renderStatus() {
  const badges = state.active
    ? ["Kerr baseline running", state.environment.backend === "pending" ? "Capability pending" : state.environment.backend]
    : state.run
      ? ["Kerr baseline complete", `${round(state.run.avgFps, 2)} fps`]
      : state.capability
        ? ["Capability captured", state.environment.backend]
        : ["Awaiting probe", "No baseline run"];
  elements.statusRow.innerHTML = "";
  for (const text of badges) {
    const node = document.createElement("span");
    node.className = "badge";
    node.textContent = text;
    elements.statusRow.appendChild(node);
  }
  elements.summary.textContent = state.run
    ? `Last run: ${round(state.run.avgFps, 2)} fps average, p95 frame ${round(state.run.p95FrameMs, 2)} ms, scene load ${round(state.run.sceneLoadMs, 2)} ms.`
    : "Probe capability first, then run the deterministic Kerr geodesic scene to export schema-aligned blackhole metrics.";
}

function renderMetrics() {
  const run = state.run;
  const cards = [
    ["Backend", state.environment.backend],
    ["Fallback", String(state.environment.fallback_triggered)],
    ["Avg FPS", run ? `${round(run.avgFps, 2)}` : "pending"],
    ["P95 Frame", run ? `${round(run.p95FrameMs, 2)} ms` : "pending"],
    ["Scene Load", run ? `${round(run.sceneLoadMs, 2)} ms` : "pending"],
    ["Ray Steps", String(sceneConfig.raySteps)],
    ["Spin", String(sceneConfig.spin)],
    ["Integration", run ? `${round(run.avgIntegrationMs, 3)} ms` : "pending"]
  ];
  elements.metricGrid.innerHTML = "";
  for (const [label, value] of cards) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<span class="label">${label}</span><div class="value">${value}</div>`;
    elements.metricGrid.appendChild(card);
  }
}

function renderEnvironment() {
  const info = [
    ["Browser", `${state.environment.browser.name} ${state.environment.browser.version}`],
    ["OS", `${state.environment.os.name} ${state.environment.os.version}`],
    ["Device", state.environment.device.class],
    ["CPU", state.environment.device.cpu],
    ["Memory", state.environment.device.memory_gb ? `${state.environment.device.memory_gb} GB` : "unknown"],
    ["Adapter", state.environment.gpu.adapter],
    ["Backend", state.environment.backend]
  ];
  elements.metaGrid.innerHTML = "";
  for (const [label, value] of info) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<span class="label">${label}</span><div class="value">${value}</div>`;
    elements.metaGrid.appendChild(card);
  }
}

function renderLogs() {
  elements.logList.innerHTML = "";
  const entries = state.logs.length ? state.logs : ["No Kerr engine activity yet."];
  for (const entry of entries) {
    const li = document.createElement("li");
    li.textContent = entry;
    elements.logList.appendChild(li);
  }
}

function render() {
  renderStatus();
  renderMetrics();
  renderEnvironment();
  renderLogs();
  elements.resultJson.textContent = JSON.stringify(buildResult(), null, 2);
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(buildResult(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `exp-blackhole-kerr-engine-${state.run ? "scene-ready" : "pending"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  log("Downloaded Kerr engine readiness JSON draft.");
}

elements.probeCapability.addEventListener("click", probeCapability);
elements.runScene.addEventListener("click", runSceneBaseline);
elements.downloadJson.addEventListener("click", downloadJson);

log("Kerr engine readiness harness ready.");
render();

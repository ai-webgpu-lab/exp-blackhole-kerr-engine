// Real raw-WebGPU Kerr blackhole geodesic compute sketch for exp-blackhole-kerr-engine.
//
// Gated by ?mode=real-kerr. Default deterministic harness path is untouched.
// `loadWebGpuFromBrowser` is parameterized so tests can inject a stub.

const KERR_COMPUTE_SHADER = /* wgsl */ `
struct Geodesic {
  position : vec3<f32>,
  direction : vec3<f32>,
  affine    : f32,
};

struct KerrParams {
  spin        : f32,
  inclination : f32,
  step_size   : f32,
  step_count  : u32,
};

@group(0) @binding(0) var<storage, read_write> geodesics : array<Geodesic>;
@group(0) @binding(1) var<uniform> params : KerrParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&geodesics)) { return; }
  var g = geodesics[index];
  let r = max(length(g.position), 0.05);
  let pull = -g.position / (r * r * r);
  let frame = vec3<f32>(0.0, params.spin * 0.0008, 0.0);
  for (var step : u32 = 0u; step < params.step_count; step = step + 1u) {
    g.direction = g.direction + pull * params.step_size + frame * params.step_size;
    g.position = g.position + g.direction * params.step_size;
    g.affine = g.affine + params.step_size;
  }
  geodesics[index] = g;
}
`;

export async function loadWebGpuFromBrowser({ navigatorGpu = (typeof navigator !== "undefined" ? navigator.gpu : null) } = {}) {
  if (!navigatorGpu) {
    throw new Error("navigator.gpu unavailable");
  }
  const adapter = await navigatorGpu.requestAdapter();
  if (!adapter) {
    throw new Error("no GPU adapter available");
  }
  const device = await adapter.requestDevice();
  return { adapter, device };
}

export function buildRealKerrAdapter({ device, version = "raw-webgpu-1" }) {
  if (!device || typeof device.createShaderModule !== "function") {
    throw new Error("buildRealKerrAdapter requires a GPUDevice");
  }
  const id = `kerr-rawgpu-${version.replace(/[^0-9]/g, "") || "1"}`;
  let pipeline = null;
  let geodesicBuffer = null;
  let paramsBuffer = null;
  let bindGroup = null;
  let geodesicCount = 0;

  return {
    id,
    label: `Raw WebGPU Kerr geodesic compute (${version})`,
    version,
    capabilities: ["scene-load", "frame-pace", "real-render", "compute-dispatch", "geodesic-integration"],
    backendHint: "webgpu",
    isReal: true,
    async createRenderer() {
      const module = device.createShaderModule({ code: KERR_COMPUTE_SHADER });
      pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" }
      });
      return pipeline;
    },
    async loadScene({ count = 4096, spin = 0.7, inclination = 0.18, stepSize = 0.05, stepCount = 24 } = {}) {
      if (!pipeline) {
        throw new Error("createRenderer() must run before loadScene()");
      }
      geodesicCount = count;
      const geodesicSize = 32; // vec3 + vec3 + float, padded to 32B for storage alignment
      geodesicBuffer = device.createBuffer({
        size: geodesicSize * count,
        usage: 0x80 | 0x40 | 0x08
      });
      paramsBuffer = device.createBuffer({
        size: 16,
        usage: 0x40 | 0x08 // UNIFORM | COPY_DST
      });
      const paramsArray = new ArrayBuffer(16);
      const paramsView = new DataView(paramsArray);
      paramsView.setFloat32(0, spin, true);
      paramsView.setFloat32(4, inclination, true);
      paramsView.setFloat32(8, stepSize, true);
      paramsView.setUint32(12, stepCount, true);
      device.queue.writeBuffer(paramsBuffer, 0, paramsArray);
      const layout = pipeline.getBindGroupLayout(0);
      bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: geodesicBuffer } },
          { binding: 1, resource: { buffer: paramsBuffer } }
        ]
      });
      return { count, spin, inclination, stepSize, stepCount };
    },
    async renderFrame({ frameIndex = 0 } = {}) {
      if (!pipeline || !geodesicBuffer || !bindGroup) {
        throw new Error("loadScene() must run before renderFrame()");
      }
      const startedAt = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      const workgroups = Math.ceil(geodesicCount / 64);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      device.queue.submit([encoder.finish()]);
      return { frameMs: performance.now() - startedAt, frameIndex, geodesicCount, workgroups };
    }
  };
}

export async function connectRealKerr({
  registry = typeof window !== "undefined" ? window.__aiWebGpuLabRendererRegistry : null,
  loader = loadWebGpuFromBrowser,
  version = "raw-webgpu-1"
} = {}) {
  if (!registry) {
    throw new Error("renderer registry not available");
  }
  const { device } = await loader({});
  const adapter = buildRealKerrAdapter({ device, version });
  registry.register(adapter);
  return { adapter, device };
}

if (typeof window !== "undefined" && window.location && typeof window.location.search === "string") {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "real-kerr" && !window.__aiWebGpuLabRealKerrBootstrapping) {
    window.__aiWebGpuLabRealKerrBootstrapping = true;
    connectRealKerr().catch((error) => {
      console.warn(`[real-kerr] bootstrap failed: ${error.message}`);
      window.__aiWebGpuLabRealKerrBootstrapError = error.message;
    });
  }
}

# Results

## 1. 실험 요약
- 저장소: exp-blackhole-kerr-engine
- 커밋 해시: fa93fa8
- 실험 일시: 2026-05-20T15:40:32.948Z -> 2026-05-20T15:40:36.525Z
- 담당자: ai-webgpu-lab
- 실험 유형: `blackhole`
- 상태: `success`

## 2. 질문
- 과학형 Kerr 블랙홀 엔진으로 넘기기 전에 geodesic integration cost와 frame pacing 보고 경로를 먼저 고정할 수 있는가
- spin, inclination, ray step budget, integration timing metadata가 graphics 결과 문서에 같이 남는가
- 실제 Rust/WASM 및 WebGPU geodesic engine 교체 전 deterministic Kerr harness로 반복 검증이 가능한가

## 3. 실행 환경
### 브라우저
- 이름: Chrome
- 버전: 147.0.7727.15

### 운영체제
- OS: Linux
- 버전: unknown

### 디바이스
- 장치명: Linux x86_64
- device class: `desktop-high`
- CPU: 16 threads
- 메모리: 32 GB
- 전원 상태: `unknown`

### GPU / 실행 모드
- adapter: navigator.gpu available
- backend: `webgpu`
- fallback triggered: `false`
- worker mode: `main`
- cache state: `warm`
- required features: ["shader-f16","timestamp-query"]
- limits snapshot: {"maxStorageBufferBindingSize":134217728,"maxBindGroups":4}

## 4. 워크로드 정의
- 시나리오 이름: Kerr Engine Readiness, blackhole-kerr-engine-real-kerr-rawgpu-1
- 입력 프로필: spin-0.82-inclination-67-geodesic-fixture
- 데이터 크기: spin=0.82; inclinationDeg=67; cameraDistance=12; raySteps=128; geodesicRays=112; avgIntegrationMs=0.7028; p95IntegrationMs=1.1; captured=0; escaped=0; backend=webgpu; fallback=false; automation=playwright-chromium, spin=0.82; inclinationDeg=67; cameraDistance=12; raySteps=128; geodesicRays=112; avgIntegrationMs=null; p95IntegrationMs=null; captured=undefined; escaped=undefined; backend=webgpu; fallback=false; realAdapter=kerr-rawgpu-1; automation=playwright-chromium
- dataset: -
- model_id 또는 renderer: kerr-geodesic-readiness
- 양자화/정밀도: -
- resolution: 960x540
- context_tokens: -
- output_tokens: -

## 5. 측정 지표
### 공통
- time_to_interactive_ms: 116.9 ~ 1400.9 ms
- init_ms: 0.4 ~ 44.1 ms
- success_rate: 1
- peak_memory_note: 32 GB reported by browser
- error_type: -

### Graphics / Blackhole
- avg_fps: 60.79 ~ 53333.33
- p95_frametime_ms: 0.1 ~ 18.5 ms
- scene_load_ms: 0.4 ~ 44.1 ms
- ray_steps: 128
- taa states: true
- fallback states: false
- backends: webgpu

## 6. 결과 표
| Run | Scenario | Backend | Cache | Mean | P95 | Notes |
|---|---|---:|---:|---:|---:|---|
| 1 | Kerr Engine Readiness | webgpu | warm | 60.79 | 18.5 | scene_load=44.1 ms, fallback=false |
| 2 | blackhole-kerr-engine-real-kerr-rawgpu-1 | webgpu | warm | 53333.33 | 0.1 | scene_load=0.4 ms, fallback=false |

## 7. 관찰
- Kerr engine readiness baseline은 backend=webgpu, fallback_triggered=false로 기록됐다.
- graphics summary는 avg_fps=60.79, p95_frametime_ms=18.5, scene_load_ms=44.1였다.
- Kerr metadata는 spin=0.82; inclinationDeg=67; cameraDistance=12; raySteps=128; geodesicRays=112; avgIntegrationMs=0.7028; p95IntegrationMs=1.1; captured=0; escaped=0; backend=webgpu; fallback=false; automation=playwright-chromium로 남았다.
- playwright-chromium로 수집된 automation baseline이며 headless=true, browser=Chromium 147.0.7727.15.
- 실제 runtime/model/renderer 교체 전 deterministic harness 결과이므로, 절대 성능보다 보고 경로와 재현성 확인에 우선 의미가 있다.

## 8. Real Adapter vs Deterministic
- adapter: real=kerr-rawgpu-1, deterministic=deterministic-three-style
- avg_fps: real=53333.33, deterministic=60.79, delta=+53272.54
- p95_frametime: real=0.1 ms, deterministic=18.5 ms, delta=-18.4 ms
- scene_load_ms: real=0.4 ms, deterministic=44.1 ms, delta=-43.7 ms

## 9. 결론
- 과학형 Kerr 블랙홀 엔진 실험으로 넘어가기 전 geodesic readiness baseline과 결과 문서가 연결됐다.
- 다음 단계는 deterministic canvas surface를 실제 Rust/WASM geodesic kernel 및 WebGPU renderer로 교체하되 spin/inclination/ray_steps/integration metric 구조를 유지하는 것이다.
- 이후 raw WebGPU blackhole engine과 blackhole renderer shootout의 과학형 기준 입력으로 재사용할 수 있다.

## 10. 첨부
- 스크린샷: ./reports/screenshots/01-kerr-engine-readiness.png, ./reports/screenshots/02-blackhole-kerr-engine-real-kerr.png
- 로그 파일: ./reports/logs/01-kerr-engine-readiness.log, ./reports/logs/02-blackhole-kerr-engine-real-kerr.log
- raw json: ./reports/raw/01-kerr-engine-readiness.json, ./reports/raw/02-blackhole-kerr-engine-real-kerr.json
- 배포 URL: https://ai-webgpu-lab.github.io/exp-blackhole-kerr-engine/
- 관련 이슈/PR: -

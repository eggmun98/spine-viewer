const RUNTIME_URL = window.__SPINE_RUNTIME_URL__;
const LOAD_TIMEOUT_MS = 15000;
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;
const MIN_SPEED = 0.1;
const MAX_SPEED = 3;

const vscode = acquireVsCodeApi();

// Held so the event-timeline lookup can do an instanceof against EventTimeline.
let runtimeRef = null;

const state = {
  loadedUrl: null,
  animation: null,
  loop: true,
  scale: 1,
  speed: 1,
  timeline: null,
  playheadFrame: null,
  app: null,
  viewport: null,
  spine: null,
  pan: { x: 0, y: 0 },
  dragging: null,
  loadToken: 0,
};

document.getElementById('app').innerHTML = `
  <div class="shell">
    <div class="toolbar">
      <div class="file">
        <div class="file-name"></div>
        <div class="file-meta"></div>
      </div>
      <select class="select" title="Animation"></select>
      <label class="field" title="Zoom"><span>zoom</span>
        <input class="number scale" type="number" step="0.05" min="${MIN_SCALE}" max="${MAX_SCALE}" value="1">
      </label>
      <label class="field" title="Playback speed"><span>speed</span>
        <input class="number speed" type="number" step="0.1" min="${MIN_SPEED}" max="${MAX_SPEED}" value="1">
      </label>
      <button class="toggle active" type="button" title="Toggle looping">Loop</button>
      <button class="reset" type="button" title="Reset zoom and pan">Reset</button>
    </div>
    <div class="stage-wrap">
      <div id="stage"></div>
      <div class="message"></div>
      <div class="status"></div>
    </div>
    <div class="events hidden">
      <div class="events-head">
        <span class="events-title">Events</span>
        <span class="events-last"></span>
      </div>
      <div class="track">
        <div class="track-line"></div>
        <div class="playhead"></div>
        <div class="tip hidden"></div>
      </div>
      <div class="track-scale"><span>0.00s</span><span class="track-end"></span></div>
    </div>
  </div>
`;

const els = {
  fileName: document.querySelector('.file-name'),
  fileMeta: document.querySelector('.file-meta'),
  animationSelect: document.querySelector('.select'),
  scaleInput: document.querySelector('.number.scale'),
  speedInput: document.querySelector('.number.speed'),
  events: document.querySelector('.events'),
  eventsLast: document.querySelector('.events-last'),
  track: document.querySelector('.track'),
  trackLine: document.querySelector('.track-line'),
  playhead: document.querySelector('.playhead'),
  trackEnd: document.querySelector('.track-end'),
  tip: document.querySelector('.tip'),
  loopButton: document.querySelector('.toggle'),
  resetButton: document.querySelector('.reset'),
  stage: document.getElementById('stage'),
  message: document.querySelector('.message'),
  status: document.querySelector('.status'),
};

window.addEventListener('error', (event) => {
  log(`window error: ${event.message}`);
  setMessage(event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.message ?? String(event.reason);
  log(`unhandled rejection: ${reason}`);
  setMessage(reason);
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'load') loadSpine(event.data.payload);
});

els.animationSelect.addEventListener('change', () => {
  state.animation = els.animationSelect.value;
  playSelectedAnimation();
});

els.scaleInput.addEventListener('input', () => {
  state.scale = clamp(Number(els.scaleInput.value) || 1, MIN_SCALE, MAX_SCALE);
  fitSpine();
});

els.speedInput.addEventListener('input', () => {
  state.speed = clamp(Number(els.speedInput.value) || 1, MIN_SPEED, MAX_SPEED);
  if (state.spine) state.spine.state.timeScale = state.speed;
});

els.loopButton.addEventListener('click', () => {
  state.loop = !state.loop;
  els.loopButton.classList.toggle('active', state.loop);
  playSelectedAnimation();
});

els.resetButton.addEventListener('click', resetView);

els.stage.addEventListener('pointerdown', (event) => {
  if (!state.viewport) return;
  els.stage.setPointerCapture(event.pointerId);
  state.dragging = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: state.pan.x,
    panY: state.pan.y,
  };
  els.stage.classList.add('dragging');
});

els.stage.addEventListener('pointermove', (event) => {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId) return;
  state.pan.x = state.dragging.panX + event.clientX - state.dragging.startX;
  state.pan.y = state.dragging.panY + event.clientY - state.dragging.startY;
  applyPan();
});

els.stage.addEventListener('pointerup', endDrag);
els.stage.addEventListener('pointercancel', endDrag);
els.stage.addEventListener('dblclick', resetView);

els.stage.addEventListener(
  'wheel',
  (event) => {
    if (!state.spine) return;
    event.preventDefault();
    const next = clamp(state.scale * (event.deltaY > 0 ? 0.92 : 1.08), MIN_SCALE, MAX_SCALE);
    state.scale = next;
    els.scaleInput.value = String(Number(next.toFixed(2)));
    fitSpine();
  },
  { passive: false },
);

setMessage('Select a skeleton from the Spine Viewer sidebar.');
const runtimeReady = loadRuntime();
vscode.postMessage({ type: 'ready' });

async function loadRuntime() {
  log('importing bundled pixi/spine runtime');
  const runtime = await import(RUNTIME_URL);
  runtimeRef = runtime;
  log(`runtime imported: pixi keys=${Object.keys(runtime.pixi).length}`);
  return runtime;
}

// Concurrent loads must share one canvas, so hand every caller the same promise.
let stagePromise = null;

function initStage(runtime) {
  stagePromise ??= createStage(runtime);
  return stagePromise;
}

async function createStage(runtime) {
  state.app = new runtime.pixi.Application();
  await state.app.init({
    width: Math.max(els.stage.clientWidth, 1),
    height: Math.max(els.stage.clientHeight, 1),
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: 'webgl',
  });

  state.app.canvas.className = 'pixi-canvas';
  els.stage.appendChild(state.app.canvas);
  state.viewport = new runtime.pixi.Container();
  state.app.stage.addChild(state.viewport);

  new ResizeObserver(() => {
    resizeStage();
    fitSpine();
  }).observe(els.stage);

  resizeStage();
  log(`canvas ready: ${state.app.renderer.width} x ${state.app.renderer.height}`);
  return state.app;
}

async function loadSpine(payload) {
  const token = (state.loadToken += 1);
  const isReload = state.loadedUrl === baseUrl(payload.skeletonUrl);
  const keptAnimation = isReload ? state.animation : null;

  els.fileName.textContent = payload.name;
  els.fileMeta.textContent = payload.atlasName ?? payload.relativePath ?? '';

  if (payload.error) {
    clearSpine();
    renderAnimations([]);
    setMessage(payload.error);
    setStatus('');
    return;
  }

  try {
    setMessage('Loading...');
    log(`load start: ${payload.name}`);
    const runtime = await runtimeReady;
    await initStage(runtime);
    if (token !== state.loadToken) return;

    const [skeletonJson, atlas] = await withTimeout(
      Promise.all([fetchJson(payload.skeletonUrl), buildAtlas(runtime, payload)]),
      LOAD_TIMEOUT_MS,
      `Timed out loading ${payload.name}`,
    );
    if (token !== state.loadToken) return;

    const parser = new runtime.SkeletonJson(new runtime.AtlasAttachmentLoader(atlas));
    const skeletonData = parser.readSkeletonData(skeletonJson);

    clearSpine();
    state.spine = new runtime.Spine(skeletonData);
    state.spine.state.timeScale = state.speed;
    state.spine.state.addListener({
      event: (entry, event) => showFiredEvent(entry, event),
    });
    state.spine.skeleton.setToSetupPose();
    state.spine.update(0);
    state.viewport.removeChildren();
    state.viewport.addChild(state.spine);

    renderAnimations(
      skeletonData.animations.map((animation) => animation.name),
      keptAnimation,
    );
    if (!isReload) {
      state.scale = 1;
      els.scaleInput.value = '1';
      resetPan();
    }
    state.loadedUrl = baseUrl(payload.skeletonUrl);
    playSelectedAnimation();
    fitSpine();
    setMessage('');
    log(`load done: ${payload.name}, animations=${skeletonData.animations.length}`);
  } catch (error) {
    if (token !== state.loadToken) return;
    console.error(error);
    const reason = describeError(error, payload);
    log(`load failed: ${error?.stack ?? reason}`);
    clearSpine();
    renderAnimations([]);
    setMessage(reason);
    setStatus('');
  }
}

// Discovery keys off the atlas, so a stray non-skeleton JSON in a spine folder
// reaches this point. Say so instead of leaking a parser stack trace.
function describeError(error, payload) {
  const reason = error?.message ?? String(error);
  if (/spine|skeleton|version/i.test(reason)) {
    return `${payload.name}.json is not a Spine skeleton, or was exported by an incompatible Spine version.\n\n${reason}`;
  }
  return reason;
}

function renderAnimations(animations, preferred = null) {
  state.animation = animations.includes(preferred) ? preferred : pickDefault(animations);
  els.animationSelect.innerHTML = '';

  for (const animation of animations) {
    const option = document.createElement('option');
    option.value = animation;
    option.textContent = animation;
    option.selected = animation === state.animation;
    els.animationSelect.appendChild(option);
  }

  els.animationSelect.disabled = animations.length === 0;
}

function pickDefault(animations) {
  return (
    animations.find((name) => name === 'default') ??
    animations.find((name) => name.toLowerCase() === 'idle') ??
    animations[0] ??
    null
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to read skeleton file: ${response.status}`);
  return response.json();
}

async function buildAtlas(runtime, payload) {
  const atlas = new runtime.TextureAtlas(payload.atlasText);
  log(`atlas parsed: pages=${atlas.pages.length}, regions=${atlas.regions.length}`);

  await Promise.all(
    atlas.pages.map(async (page) => {
      const imageUrl = payload.atlasImages[page.name];
      if (!imageUrl) {
        throw new Error(`Atlas page image is missing from the folder: ${page.name}`);
      }
      const texture = await loadTexture(runtime, imageUrl);
      page.setTexture(runtime.SpineTexture.from(texture.source));
    }),
  );

  return atlas;
}

async function loadTexture(runtime, url) {
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a 2D canvas context for the atlas image.');
  context.drawImage(image, 0, 0);

  const source = new runtime.pixi.CanvasSource({
    resource: canvas,
    width: canvas.width,
    height: canvas.height,
  });
  return new runtime.pixi.Texture({ source });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load atlas page image: ${url}`));
    image.src = url;
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function clearSpine() {
  stopPlayhead();
  state.timeline = null;
  els.events.classList.add('hidden');
  if (!state.spine) return;
  state.spine.destroy({ children: true });
  state.spine = null;
}

function playSelectedAnimation() {
  if (!state.spine || !state.animation) return;
  state.spine.state.setAnimation(0, state.animation, state.loop);
  renderTimeline();
}

// Spine stores an animation's events in an EventTimeline rather than on the
// animation itself, so read them out to place the markers.
function readEvents(animationName) {
  const data = state.spine?.skeleton.data;
  const animation = data?.animations.find((item) => item.name === animationName);
  if (!animation) return null;

  const timeline = animation.timelines.find((item) => item instanceof runtimeRef.EventTimeline);
  const events = (timeline?.events ?? [])
    .filter(Boolean)
    .map((event) => ({
      time: event.time,
      name: event.data.name,
      int: event.intValue,
      float: event.floatValue,
      string: event.stringValue,
    }))
    .sort((a, b) => a.time - b.time);

  return { duration: animation.duration, events };
}

function renderTimeline() {
  stopPlayhead();
  hideTip();
  state.timeline = readEvents(state.animation);
  const hasEvents = (state.timeline?.events.length ?? 0) > 0;
  els.events.classList.toggle('hidden', !hasEvents);
  els.eventsLast.textContent = '';

  for (const marker of els.track.querySelectorAll('.marker')) marker.remove();
  if (!hasEvents) return;

  const { duration, events } = state.timeline;
  els.trackEnd.textContent = `${duration.toFixed(2)}s`;

  events.forEach((event, index) => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'marker';
    marker.dataset.index = String(index);
    marker.style.left = `${duration > 0 ? (event.time / duration) * 100 : 0}%`;
    marker.setAttribute('aria-label', summarise(event));
    marker.addEventListener('click', () => describeEvent(event));
    marker.addEventListener('pointerenter', () => showTip(marker, event));
    marker.addEventListener('pointerleave', hideTip);
    marker.addEventListener('focus', () => showTip(marker, event));
    marker.addEventListener('blur', hideTip);
    els.track.appendChild(marker);
  });

  startPlayhead();
}

function summarise(event) {
  const extras = [
    event.int ? `int ${event.int}` : null,
    event.float ? `float ${event.float}` : null,
    event.string ? `"${event.string}"` : null,
  ].filter(Boolean);
  return `${event.name} · ${event.time.toFixed(3)}s` + (extras.length ? ` · ${extras.join(', ')}` : '');
}

function describeEvent(event) {
  els.eventsLast.textContent = summarise(event);
}

// Anchored to the marker rather than the cursor so it stays put, and clamped to
// the track so markers at either end are not cut off.
function showTip(marker, event) {
  els.tip.textContent = summarise(event);
  els.tip.classList.remove('hidden');

  const trackWidth = els.track.clientWidth;
  const tipWidth = els.tip.offsetWidth;
  const centre = marker.offsetLeft;
  const half = tipWidth / 2;
  els.tip.style.left = `${clamp(centre, half, Math.max(half, trackWidth - half))}px`;
}

function hideTip() {
  els.tip.classList.add('hidden');
}

function showFiredEvent(entry, event) {
  if (entry.trackIndex !== 0) return;
  const index = state.timeline?.events.findIndex(
    (item) => item.name === event.data.name && Math.abs(item.time - event.time) < 0.001,
  );
  describeEvent({
    time: event.time,
    name: event.data.name,
    int: event.intValue,
    float: event.floatValue,
    string: event.stringValue,
  });

  const marker = index >= 0 ? els.track.querySelector(`.marker[data-index="${index}"]`) : null;
  if (!marker) return;
  marker.classList.remove('fired');
  void marker.offsetWidth; // restart the flash even on back-to-back fires
  marker.classList.add('fired');
}

function startPlayhead() {
  const step = () => {
    const track = state.spine?.state.tracks[0];
    const duration = state.timeline?.duration ?? 0;
    if (track && duration > 0) {
      const position = state.loop ? track.trackTime % duration : Math.min(track.trackTime, duration);
      els.playhead.style.left = `${(position / duration) * 100}%`;
    }
    state.playheadFrame = requestAnimationFrame(step);
  };
  state.playheadFrame = requestAnimationFrame(step);
}

function stopPlayhead() {
  if (state.playheadFrame) cancelAnimationFrame(state.playheadFrame);
  state.playheadFrame = null;
}

function fitSpine() {
  if (!state.app || !state.spine) return;

  state.spine.scale.set(1);
  state.spine.position.set(0, 0);

  const bounds = state.spine.getLocalBounds();
  const data = state.spine.skeleton.data;
  const width = bounds.width > 1 ? bounds.width : data.width || 300;
  const height = bounds.height > 1 ? bounds.height : data.height || 300;
  const centerX = bounds.width > 1 ? bounds.x + bounds.width / 2 : 0;
  const centerY = bounds.height > 1 ? bounds.y + bounds.height / 2 : 0;

  const stageWidth = state.app.renderer.width;
  const stageHeight = state.app.renderer.height;
  if (stageWidth <= 0 || stageHeight <= 0) return;

  const scale = Math.min(stageWidth / width, stageHeight / height) * 0.8 * state.scale;
  state.spine.scale.set(scale);
  state.spine.position.set(-centerX * scale, -centerY * scale);
  applyPan();

  setStatus(`${Math.round(width)} x ${Math.round(height)} · zoom ${(state.scale * 100).toFixed(0)}%`);
}

function resizeStage() {
  if (!state.app) return;
  const width = Math.max(Math.round(els.stage.clientWidth), 1);
  const height = Math.max(Math.round(els.stage.clientHeight), 1);
  state.app.renderer.resize(width, height);
  applyPan();
}

function resetView() {
  state.scale = 1;
  els.scaleInput.value = '1';
  resetPan();
  fitSpine();
}

function resetPan() {
  state.pan.x = 0;
  state.pan.y = 0;
}

function applyPan() {
  if (!state.app || !state.viewport) return;
  state.viewport.position.set(
    state.app.renderer.width / 2 + state.pan.x,
    state.app.renderer.height / 2 + state.pan.y,
  );
}

function endDrag(event) {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId) return;
  state.dragging = null;
  els.stage.classList.remove('dragging');
}

function baseUrl(url) {
  return String(url ?? '').split('?')[0];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setMessage(message) {
  els.message.textContent = message;
  els.message.classList.toggle('hidden', !message);
}

function setStatus(message) {
  els.status.textContent = message;
  els.status.classList.toggle('hidden', !message);
}

function log(message) {
  vscode.postMessage({ type: 'log', message: String(message) });
}

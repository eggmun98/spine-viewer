const data = window.__SPINE_VIEWER_DATA__;
const vscode = acquireVsCodeApi();

const state = {
  items: data.spines,
  filteredItems: data.spines,
  selectedId: data.spines[0]?.id ?? null,
  animation: data.spines[0]?.defaultAnimation ?? null,
  loop: true,
  scale: 1,
  app: null,
  viewport: null,
  spine: null,
  resizeObserver: null,
  pan: { x: 0, y: 0 },
  dragging: null,
};

const appRoot = document.getElementById('app');

appRoot.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="header">
        <h1 class="title">Spine Viewer</h1>
        <div class="count"></div>
      </div>
      <input class="search" type="search" placeholder="Filter spines">
      <div class="list"></div>
    </aside>
    <main class="main">
      <div class="toolbar">
        <div class="selected-title">
          <div class="selected-name"></div>
          <div class="selected-path"></div>
        </div>
        <select class="select"></select>
        <input class="number" type="number" step="0.05" min="0.05" max="10" value="1" title="Scale">
        <button class="toggle active" type="button">Loop</button>
        <button class="reset" type="button">Reset</button>
      </div>
      <div class="stage-wrap">
        <div id="stage"></div>
        <div class="message"></div>
        <div class="status"></div>
      </div>
    </main>
  </div>
`;

const els = {
  count: document.querySelector('.count'),
  search: document.querySelector('.search'),
  list: document.querySelector('.list'),
  selectedName: document.querySelector('.selected-name'),
  selectedPath: document.querySelector('.selected-path'),
  animationSelect: document.querySelector('.select'),
  scaleInput: document.querySelector('.number'),
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

const modulesReady = loadRuntime().catch((error) => {
  console.error(error);
  log(`runtime import failed: ${error?.message ?? String(error)}`);
  setStatus(`Runtime error: ${error?.message ?? String(error)}`);
  return null;
});

els.search.addEventListener('input', () => {
  const query = els.search.value.trim().toLowerCase();
  state.filteredItems = query
    ? state.items.filter((item) =>
        `${item.name} ${item.folder} ${item.relativePath} ${item.animations.join(' ')}`
          .toLowerCase()
          .includes(query),
      )
    : state.items;
  renderList();
});

els.animationSelect.addEventListener('change', () => {
  state.animation = els.animationSelect.value;
  playSelectedAnimation();
});

els.scaleInput.addEventListener('input', () => {
  state.scale = Number(els.scaleInput.value) || 1;
  fitSpine();
});

els.loopButton.addEventListener('click', () => {
  state.loop = !state.loop;
  els.loopButton.classList.toggle('active', state.loop);
  playSelectedAnimation();
});

els.resetButton.addEventListener('click', () => {
  resetView();
});

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
els.stage.addEventListener('dblclick', () => resetView());

els.stage.addEventListener('wheel', (event) => {
  if (!state.viewport || !state.spine) return;
  event.preventDefault();
  const nextScale = clamp(
    Number(els.scaleInput.value || 1) * (event.deltaY > 0 ? 0.92 : 1.08),
    0.05,
    10,
  );
  state.scale = nextScale;
  els.scaleInput.value = String(Number(nextScale.toFixed(2)));
  fitSpine();
}, { passive: false });

render();
setMessage(data.initialMessage ?? '');
log(`viewer booted: ${state.items.length} spines, selected=${state.selectedId ?? 'none'}`);
initStage();

async function loadRuntime() {
  log('importing bundled pixi/spine runtime');
  const runtime = await import(data.runtimeUrl);
  log(`runtime imported: pixi keys=${Object.keys(runtime.pixi).length}`);
  return runtime;
}

async function initStage() {
  setStatus('Loading Pixi/Spine runtime...');
  const runtime = await modulesReady;
  if (!runtime) return;
  setStatus('Runtime loaded. Initializing canvas...');
  log(`stage size before init: ${els.stage.clientWidth} x ${els.stage.clientHeight}`);

  const { Application } = runtime.pixi;
  state.app = new Application();
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
  state.resizeObserver = new ResizeObserver(() => {
    resizeStage();
    fitSpine();
  });
  state.resizeObserver.observe(els.stage);
  resizeStage();

  setStatus(`Canvas ready: ${state.app.renderer.width} x ${state.app.renderer.height}`);
  log(`canvas ready: ${state.app.renderer.width} x ${state.app.renderer.height}`);
  await loadSelectedSpine();
}

function render() {
  renderList();
  renderDetails();
}

function renderList() {
  els.count.textContent = `${state.filteredItems.length} / ${state.items.length} spines`;
  els.list.innerHTML = '';

  for (const item of state.filteredItems) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `item${item.id === state.selectedId ? ' active' : ''}`;
    button.innerHTML = `
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="item-path">${escapeHtml(item.relativePath)}</div>
    `;
    button.addEventListener('click', async () => {
      state.selectedId = item.id;
      state.animation = item.defaultAnimation;
      log(`selected: ${item.name}, animation=${state.animation ?? 'none'}`);
      render();
      await loadSelectedSpine();
    });
    els.list.appendChild(button);
  }
}

function renderDetails() {
  const item = selectedItem();
  els.selectedName.textContent = item?.name ?? 'No Spine skeleton found';
  els.selectedPath.textContent = item?.relativePath ?? '';
  els.animationSelect.innerHTML = '';

  for (const animation of item?.animations ?? []) {
    const option = document.createElement('option');
    option.value = animation;
    option.textContent = animation;
    option.selected = animation === state.animation;
    els.animationSelect.appendChild(option);
  }

  els.animationSelect.disabled = !item?.animations.length;
}

async function loadSelectedSpine() {
  const runtime = await modulesReady;
  const item = selectedItem();

  if (!runtime || !state.app || !item) return;
  if (!item.atlasUrl) {
    log(`missing atlas: ${item.name}`);
    setMessage('No matching .atlas file found for this skeleton.');
    clearSpine();
    return;
  }

  try {
    setMessage('Loading...');
    setStatus(`Loading ${item.name} / ${state.animation ?? 'no animation'}`);
    log(`load start: ${item.name}`);
    log(`skeleton=${item.relativePath}, atlas=${item.atlasUrl ? 'yes' : 'no'}, pages=${Object.keys(item.atlasImages).join(', ') || 'none'}`);
    clearSpine();

    const [skeletonAsset, atlasAsset] = await withTimeout(
      Promise.all([fetchJson(item.skeletonUrl), makeTextureAtlas(runtime, item)]),
      12000,
      `Timed out loading ${item.name}`,
    );
    const attachmentLoader = new runtime.AtlasAttachmentLoader(atlasAsset);
    const parser = new runtime.SkeletonJson(attachmentLoader);
    log(`skeleton fetched: bones=${skeletonAsset.bones?.length ?? 0}, slots=${skeletonAsset.slots?.length ?? 0}`);
    const skeletonData = parser.readSkeletonData(
      typeof skeletonAsset === 'string' ? JSON.parse(skeletonAsset) : skeletonAsset,
    );
    log(`skeleton parsed: width=${skeletonData.width ?? 0}, height=${skeletonData.height ?? 0}, animations=${skeletonData.animations?.length ?? 0}`);

    state.spine = new runtime.Spine(skeletonData);
    state.spine.skeleton.setToSetupPose();
    state.spine.update(0.016);
    state.viewport.removeChildren();
    state.viewport.addChild(state.spine);
    resetPan();
    playSelectedAnimation();
    fitSpine();
    setMessage('');
    log(`load done: ${item.name}`);
    setStatus(
      `Showing ${item.name} / ${state.animation ?? 'no animation'} / ${Math.round(state.app.renderer.width)} x ${Math.round(state.app.renderer.height)}`,
    );
  } catch (error) {
    console.error(error);
    log(`load failed: ${error?.stack ?? error?.message ?? String(error)}`);
    clearSpine();
    setMessage(error?.message ?? String(error));
    setStatus(`Load failed: ${error?.message ?? String(error)}`);
  }
}

async function fetchJson(url) {
  log('fetch skeleton json');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load skeleton JSON: ${response.status}`);
  }
  return response.json();
}

async function makeTextureAtlas(runtime, item) {
  if (!item.atlasText) {
    throw new Error('Atlas text was not embedded in the viewer payload.');
  }

  const atlas = new runtime.TextureAtlas(item.atlasText);
  log(`atlas parsed: pages=${atlas.pages.map((page) => page.name).join(', ') || 'none'}, regions=${atlas.regions.length}`);
  await Promise.all(atlas.pages.map(async (page) => {
    const pageName = page.name;
    const imageUrl = item.atlasImages[pageName];
    if (!imageUrl) {
      throw new Error(`Atlas page image not found: ${pageName}`);
    }

    log(`load atlas page image: ${pageName}`);
    const texture = await loadPixiTextureFromImage(runtime, imageUrl);
    page.setTexture(runtime.SpineTexture.from(texture.source));
    log(`atlas page ready: ${pageName}, texture=${texture.width ?? texture.source?.width ?? 0} x ${texture.height ?? texture.source?.height ?? 0}`);
  }));

  return atlas;
}

async function loadPixiTextureFromImage(runtime, url) {
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create 2D canvas context for atlas image.');
  }
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
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(`Timed out loading image: ${url}`));
    }, 12000);

    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Failed to load image: ${url}`));
    };
    image.src = url;
  });
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function clearSpine() {
  if (!state.spine) return;
  state.spine.destroy({ children: true });
  state.spine = null;
}

function playSelectedAnimation() {
  if (!state.spine || !state.animation) return;
  state.spine.state.setAnimation(0, state.animation, state.loop);
}

function fitSpine() {
  if (!state.app || !state.viewport || !state.spine) return;

  const bounds = state.spine.getLocalBounds();
  const fallbackWidth = state.spine.skeleton.data.width || 300;
  const fallbackHeight = state.spine.skeleton.data.height || 300;
  const width = bounds.width > 1 ? bounds.width : fallbackWidth;
  const height = bounds.height > 1 ? bounds.height : fallbackHeight;
  const offsetX = bounds.width > 1 ? bounds.x + bounds.width / 2 : fallbackWidth / 2;
  const offsetY = bounds.height > 1 ? bounds.y + bounds.height / 2 : fallbackHeight / 2;
  const stageWidth = state.app.renderer.width;
  const stageHeight = state.app.renderer.height;
  if (stageWidth <= 0 || stageHeight <= 0) {
    setStatus('Canvas size is 0. Resize the panel or reopen the viewer.');
    return;
  }
  const fittedScale = Math.min(stageWidth / width, stageHeight / height) * 0.72 * state.scale;

  state.spine.scale.set(fittedScale);
  state.spine.position.set(-offsetX * fittedScale, -offsetY * fittedScale);
  applyPan();
  log(
    `fit: bounds=${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)}x${Math.round(bounds.height)} fallback=${Math.round(fallbackWidth)}x${Math.round(fallbackHeight)} scale=${fittedScale.toFixed(3)} pan=${Math.round(state.pan.x)},${Math.round(state.pan.y)}`,
  );
  setStatus(
    `Showing ${selectedItem()?.name ?? ''} / bounds ${Math.round(bounds.width)} x ${Math.round(bounds.height)} / scale ${fittedScale.toFixed(3)}`,
  );
}

function resizeStage() {
  if (!state.app) return;
  const width = Math.max(Math.round(els.stage.clientWidth), 1);
  const height = Math.max(Math.round(els.stage.clientHeight), 1);
  state.app.renderer.resize(width, height);
  state.app.canvas.style.width = `${width}px`;
  state.app.canvas.style.height = `${height}px`;
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedId) ?? null;
}

function setMessage(message) {
  els.message.textContent = message;
  els.message.classList.toggle('hidden', !message);
}

function setStatus(message) {
  els.status.textContent = message;
}

function log(message) {
  vscode.postMessage({ type: 'log', message: String(message) });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

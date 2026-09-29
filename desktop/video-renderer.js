import { WebCodecsVideoDecoder, WebGLVideoFrameRenderer } from '@yume-chan/scrcpy-decoder-webcodecs';

const sessions = new Map();
const panel = document.querySelector('#viewerPanel');
const grid = document.querySelector('#viewerGrid');

function label(mode) {
  return mode === 'chrome' ? 'Chrome' : 'Phone';
}

function createTile(event) {
  let tile = document.querySelector(`[data-viewer-id="${CSS.escape(event.deviceId)}"]`);
  if (tile) return tile;

  tile = document.createElement('article');
  tile.className = 'viewer-tile';
  tile.dataset.viewerId = event.deviceId;

  const header = document.createElement('header');
  const heading = document.createElement('div');
  const name = document.createElement('strong');
  const mode = document.createElement('span');
  const close = document.createElement('button');
  const stage = document.createElement('div');
  const canvas = document.createElement('canvas');
  const message = document.createElement('p');

  name.className = 'viewer-name';
  mode.className = 'viewer-mode';
  close.className = 'viewer-close';
  close.type = 'button';
  close.title = 'Stop view';
  close.setAttribute('aria-label', 'Stop view');
  close.textContent = '\u00d7';
  stage.className = 'viewer-stage';
  canvas.className = 'device-canvas';
  canvas.tabIndex = 0;
  message.className = 'viewer-message';
  message.textContent = 'Starting stream...';
  heading.append(name, mode);
  header.append(heading, close);
  stage.append(canvas, message);
  tile.append(header, stage);
  grid.append(tile);

  close.onclick = () => window.phoneRelay.runAction('fleetAction', {
    deviceId: event.deviceId,
    command: 'stopView'
  }).catch(showError);
  bindPointerInput(canvas, event.deviceId);
  panel.hidden = false;
  return tile;
}

function updateTile(event) {
  const tile = createTile(event);
  tile.querySelector('.viewer-name').textContent = event.name || event.deviceId;
  tile.querySelector('.viewer-mode').textContent = label(event.mode);
  return tile;
}

async function start(event) {
  stopDecoder(event.deviceId);
  const tile = updateTile(event);
  const canvas = tile.querySelector('canvas');
  const message = tile.querySelector('.viewer-message');
  if (!WebCodecsVideoDecoder.isSupported || !WebGLVideoFrameRenderer.isSupported) {
    message.textContent = 'Hardware video decoding is unavailable on this computer.';
    return;
  }

  const renderer = new WebGLVideoFrameRenderer(canvas);
  const decoder = new WebCodecsVideoDecoder({ codec: event.codec, renderer });
  const writer = decoder.writable.getWriter();
  const session = { decoder, writer, queue: Promise.resolve(), canvas, packets: 0 };
  session.metricsTimer = setInterval(() => {
    canvas.dataset.framesRendered = String(decoder.framesRendered);
    canvas.dataset.framesSkipped = String(decoder.framesSkipped);
  }, 500);
  sessions.set(event.deviceId, session);
  decoder.sizeChanged(({ width, height }) => setCanvasSize(event.deviceId, width, height));
  setCanvasSize(event.deviceId, event.width, event.height);
  message.hidden = true;
}

function writePacket(event) {
  const session = sessions.get(event.deviceId);
  if (!session) return;
  const packet = {
    type: event.packet.type,
    data: new Uint8Array(event.packet.data)
  };
  if (packet.type === 'data') {
    packet.keyframe = event.packet.keyframe;
    if (event.packet.pts !== null) packet.pts = BigInt(event.packet.pts);
  }
  session.packets += 1;
  session.canvas.dataset.packetCount = String(session.packets);
  session.canvas.dataset.packetBytes = String(packet.data.byteLength);
  session.queue = session.queue
    .then(() => session.writer.write(packet))
    .then(() => { session.canvas.dataset.framesRendered = String(session.decoder.framesRendered); })
    .catch(error => showTileError(event.deviceId, error));
}

function setCanvasSize(deviceId, width, height) {
  if (!width || !height) return;
  const session = sessions.get(deviceId);
  const tile = document.querySelector(`[data-viewer-id="${CSS.escape(deviceId)}"]`);
  if (session) {
    session.canvas.dataset.videoWidth = String(width);
    session.canvas.dataset.videoHeight = String(height);
  }
  if (tile) tile.querySelector('.viewer-stage').style.aspectRatio = `${width} / ${height}`;
}

function stopDecoder(deviceId) {
  const session = sessions.get(deviceId);
  if (!session) return;
  sessions.delete(deviceId);
  clearInterval(session.metricsTimer);
  session.writer.close().catch(() => {});
  session.decoder.dispose();
}

function remove(event) {
  stopDecoder(event.deviceId);
  document.querySelector(`[data-viewer-id="${CSS.escape(event.deviceId)}"]`)?.remove();
  panel.hidden = grid.children.length === 0;
}

function showTileError(deviceId, error) {
  stopDecoder(deviceId);
  const tile = document.querySelector(`[data-viewer-id="${CSS.escape(deviceId)}"]`);
  if (!tile) return;
  const message = tile.querySelector('.viewer-message');
  message.hidden = false;
  message.textContent = String(error?.message || error || 'Video stream failed.');
}

function showError(error) {
  window.dispatchEvent(new CustomEvent('all-in-viewer-state', {
    detail: { type: 'error', message: String(error?.message || error) }
  }));
}

function bindPointerInput(canvas, deviceId) {
  let pointerDown = false;
  let pendingMove = null;
  let frame = 0;

  const send = (action, event) => {
    const rect = canvas.getBoundingClientRect();
    const width = Number(canvas.dataset.videoWidth || canvas.width);
    const height = Number(canvas.dataset.videoHeight || canvas.height);
    if (!rect.width || !rect.height || !width || !height) return;
    window.phoneRelay.viewerInput({
      deviceId,
      action,
      x: (event.clientX - rect.left) * width / rect.width,
      y: (event.clientY - rect.top) * height / rect.height
    });
  };

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointerDown = true;
    canvas.setPointerCapture(event.pointerId);
    send('down', event);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointerDown) return;
    pendingMove = event;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (pendingMove) send('move', pendingMove);
      pendingMove = null;
    });
  });
  const release = event => {
    if (!pointerDown) return;
    pointerDown = false;
    send(event.type === 'pointercancel' ? 'cancel' : 'up', event);
    pendingMove = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
}

window.phoneRelay.onViewerEvent(event => {
  if (event.type === 'loading') {
    const tile = updateTile(event);
    tile.querySelector('.viewer-message').hidden = false;
    tile.querySelector('.viewer-message').textContent = `Starting ${label(event.mode).toLowerCase()} stream...`;
  } else if (event.type === 'started') {
    start(event).catch(error => showTileError(event.deviceId, error));
  } else if (event.type === 'packet') {
    writePacket(event);
  } else if (event.type === 'size') {
    setCanvasSize(event.deviceId, event.width, event.height);
  } else if (event.type === 'stopped') {
    remove(event);
  } else if (event.type === 'error') {
    const tile = updateTile(event);
    showTileError(event.deviceId, event.message);
  }
  if (event.type !== 'packet' && event.type !== 'size') {
    window.dispatchEvent(new CustomEvent('all-in-viewer-state', { detail: event }));
  }
});

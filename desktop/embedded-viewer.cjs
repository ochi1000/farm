const fs = require('node:fs');
const path = require('node:path');

const SERVER_VERSION = '3.3.3';

module.exports = function createEmbeddedViewer({ root, emit }) {
  const sessions = new Map();
  let modulesPromise;

  function loadModules() {
    modulesPromise ||= Promise.all([
      import('@yume-chan/adb'),
      import('@yume-chan/adb-server-node-tcp'),
      import('@yume-chan/adb-scrcpy'),
      import('@yume-chan/scrcpy'),
      import('@yume-chan/stream-extra')
    ]).then(([adb, adbServer, adbScrcpy, scrcpy, streams]) => ({
      AdbServerClient: adb.AdbServerClient,
      AdbServerNodeTcpConnector: adbServer.AdbServerNodeTcpConnector,
      AdbScrcpyClient: adbScrcpy.AdbScrcpyClient,
      AdbScrcpyOptionsLatest: adbScrcpy.AdbScrcpyOptionsLatest,
      DefaultServerPath: scrcpy.DefaultServerPath,
      ScrcpyNewDisplay: scrcpy.ScrcpyNewDisplay,
      ScrcpyPointerId: scrcpy.ScrcpyPointerId,
      AndroidMotionEventAction: scrcpy.AndroidMotionEventAction,
      AndroidMotionEventButton: scrcpy.AndroidMotionEventButton,
      ReadableStream: streams.ReadableStream
    }));
    return modulesPromise;
  }

  function notify(message) {
    emit({ channel: 'viewer', ...message });
  }

  async function start(record, serial, mode = 'phone') {
    mode = mode === 'chrome' ? 'chrome' : 'phone';
    const existing = sessions.get(record.deviceId);
    if (existing?.mode === mode && !existing.stopping) return { mode };
    if (existing) await stop(record.deviceId);

    notify({ type: 'loading', deviceId: record.deviceId, name: record.name, mode });
    const session = {
      deviceId: record.deviceId,
      name: record.name || record.deviceId,
      mode,
      serial,
      adb: null,
      client: null,
      video: null,
      width: 0,
      height: 0,
      stopping: false,
      removeSizeListener: null
    };
    sessions.set(record.deviceId, session);

    try {
      const modules = await loadModules();
      const serverPath = path.join(root, 'desktop', 'assets', `scrcpy-server-v${SERVER_VERSION}`);
      if (!fs.existsSync(serverPath)) throw new Error(`Embedded viewer server is missing: ${serverPath}`);

      const connector = new modules.AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 });
      const adbServer = new modules.AdbServerClient(connector);
      session.adb = await adbServer.createAdb({ serial });

      const binary = new Uint8Array(fs.readFileSync(serverPath));
      await modules.AdbScrcpyClient.pushServer(
        session.adb,
        modules.ReadableStream.from([binary]),
        modules.DefaultServerPath
      );

      const options = new modules.AdbScrcpyOptionsLatest({
        video: true,
        audio: false,
        control: true,
        maxSize: 1280,
        maxFps: 20,
        bitRate: 4_000_000,
        stayAwake: true,
        powerOn: mode === 'phone',
        logLevel: 'warn',
        ...(mode === 'chrome' ? {
          newDisplay: new modules.ScrcpyNewDisplay(720, 1600, 320),
          vdSystemDecorations: true
        } : {})
      });

      session.client = await modules.AdbScrcpyClient.start(session.adb, modules.DefaultServerPath, options);
      drainOutput(session);
      session.video = await session.client.videoStream;
      if (!session.video) throw new Error('The phone did not provide a video stream.');
      session.width = session.video.width || session.video.metadata.width || 0;
      session.height = session.video.height || session.video.metadata.height || 0;
      session.removeSizeListener = session.video.sizeChanged(({ width, height }) => {
        if (sessions.get(session.deviceId) !== session) return;
        session.width = width;
        session.height = height;
        notify({ type: 'size', deviceId: session.deviceId, width, height });
      });

      notify({
        type: 'started',
        deviceId: session.deviceId,
        name: session.name,
        mode,
        codec: session.video.metadata.codec,
        width: session.width,
        height: session.height
      });

      consumeVideo(session);
      watchExit(session);
      if (mode === 'chrome') {
        if (!session.client.controller) throw new Error('Chrome display control is unavailable.');
        await session.client.controller.startApp('com.android.chrome', { forceStop: false });
      }
      return { mode };
    } catch (error) {
      if (sessions.get(session.deviceId) === session) sessions.delete(session.deviceId);
      await closeSession(session);
      const message = readableError(error);
      notify({ type: 'error', deviceId: session.deviceId, name: session.name, mode, message });
      throw new Error(message);
    }
  }

  async function consumeVideo(session) {
    try {
      for await (const packet of session.video.stream) {
        if (sessions.get(session.deviceId) !== session || session.stopping) break;
        const bytes = Uint8Array.from(packet.data).buffer;
        notify({
          type: 'packet',
          deviceId: session.deviceId,
          packet: {
            type: packet.type,
            data: bytes,
            ...(packet.type === 'data' ? {
              keyframe: Boolean(packet.keyframe),
              pts: packet.pts === undefined ? null : packet.pts.toString()
            } : {})
          }
        });
      }
    } catch (error) {
      if (!session.stopping) failSession(session, error);
    }
  }

  async function drainOutput(session) {
    try {
      for await (const line of session.client.output) {
        if (/\b(error|exception|fatal)\b/i.test(line)) session.lastOutput = line;
      }
    } catch (error) {
      if (!session.stopping) session.lastOutput = readableError(error);
    }
  }

  function watchExit(session) {
    session.client.exited.then(
      () => { if (!session.stopping) failSession(session, new Error(session.lastOutput || 'Viewer process ended.')); },
      error => { if (!session.stopping) failSession(session, error); }
    );
  }

  function failSession(session, error) {
    if (sessions.get(session.deviceId) !== session) return;
    sessions.delete(session.deviceId);
    session.stopping = true;
    closeSession(session);
    notify({
      type: 'error',
      deviceId: session.deviceId,
      name: session.name,
      mode: session.mode,
      message: readableError(error)
    });
  }

  async function input(deviceId, inputEvent) {
    const session = sessions.get(deviceId);
    const controller = session?.client?.controller;
    if (!session || !controller || session.stopping) return;
    const x = Math.max(0, Math.min(session.width - 1, Math.round(Number(inputEvent.x))));
    const y = Math.max(0, Math.min(session.height - 1, Math.round(Number(inputEvent.y))));
    if (!Number.isFinite(x) || !Number.isFinite(y) || session.width < 1 || session.height < 1) return;

    const modules = await loadModules();
    const actions = {
      down: modules.AndroidMotionEventAction.Down,
      move: modules.AndroidMotionEventAction.Move,
      up: modules.AndroidMotionEventAction.Up,
      cancel: modules.AndroidMotionEventAction.Cancel
    };
    const action = actions[inputEvent.action];
    if (action === undefined) return;
    const pressed = inputEvent.action === 'down' || inputEvent.action === 'move';
    await controller.injectTouch({
      action,
      pointerId: modules.ScrcpyPointerId.Finger,
      pointerX: x,
      pointerY: y,
      videoWidth: session.width,
      videoHeight: session.height,
      pressure: pressed ? 1 : 0,
      buttons: pressed ? modules.AndroidMotionEventButton.Primary : modules.AndroidMotionEventButton.None
    });
  }

  async function stop(deviceId) {
    const session = sessions.get(deviceId);
    if (!session) return;
    sessions.delete(deviceId);
    session.stopping = true;
    await closeSession(session);
    notify({ type: 'stopped', deviceId, name: session.name, mode: session.mode });
  }

  async function closeSession(session) {
    try { session.removeSizeListener?.(); } catch {}
    try { await session.client?.close(); } catch {}
    try { await session.adb?.close(); } catch {}
  }

  async function shutdown() {
    await Promise.all([...sessions.keys()].map(stop));
  }

  return {
    start,
    stop,
    input,
    shutdown,
    isViewing: deviceId => sessions.has(deviceId),
    mode: deviceId => sessions.get(deviceId)?.mode || null
  };
};

function readableError(error) {
  if (Array.isArray(error?.output) && error.output.length) return error.output.slice(-4).join(' ');
  return String(error?.message || error || 'Viewer failed.');
}

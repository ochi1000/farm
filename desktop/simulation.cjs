const fs = require('node:fs');
module.exports = function simulationController(emit, defaults = {}) {
  let watched, cursor = 0, current, lastSnapshot = '';
  const api = import('../scripts/simulation.mjs');
  async function publish() {
    if (!current) return;
    try {
      const runs = await api;
      const state = runs.status(current);
      const events = runs.events(current, cursor);
      cursor = events.at(-1)?.sequence ?? cursor;
      const snapshot = JSON.stringify(state);
      if (events.length || snapshot !== lastSnapshot) { lastSnapshot = snapshot; emit({ state, events: events.slice(-200) }); }
    } catch { emit({ error: 'Simulation status could not be read.' }); }
  }
  async function attach(state) {
    const runs = await api;
    if (current !== state?.id) {
      if (watched) fs.unwatchFile(watched);
      current = state?.id; cursor = 0; lastSnapshot = '';
      if (current) { watched = runs.runFile(current, 'status.json'); fs.watchFile(watched, { interval: 250, persistent: false }, publish); }
    }
    return state ? { state, events: runs.events(state.id).slice(-200) } : { state: null, events: [] };
  }
  return async (action, options = {}) => {
    if (action === 'dispose') { if (watched) fs.unwatchFile(watched); current = null; return; }
    const runs = await api;
    if (action === 'simulationStart') return attach(runs.start({ ...defaults, commandId: options.commandId, fault: options.fault === 'error' ? 'error' : 'none' }));
    if (action === 'simulationStop') return { state: runs.stop(String(options.id)), events: [] };
    if (action === 'simulationHistory') return runs.history();
    if (action === 'simulationReport') {
      const id = String(options.id); const state = runs.status(id);
      const file = runs.runFile(id, 'report.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ...state, trace: runs.events(id) };
    }
    return attach(runs.latest());
  };
};

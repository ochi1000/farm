(() => {
  const $ = id => document.getElementById(id);
  let state, cursor = 0, runId, pending = false;
  function show(message) {
    if (message.error) { $('simulationError').textContent = message.error; return; }
    if (!message.state) return;
    state = message.state;
    if (runId !== state.id) { cursor = 0; $('simulationEvents').replaceChildren(); runId = state.id; }
    const active = !['completed', 'failed', 'stopped', 'interrupted'].includes(state.state);
    $('simulationStart').disabled = pending || active;
    $('simulationStop').disabled = !active;
    $('simulationReport').disabled = active;
    $('simulationState').textContent = `${state.state}${state.stopRequested ? ' — stop requested' : ''} · ${state.completed}/${state.total} steps processed · ${state.phase}`;
    $('simulationError').textContent = state.error || (state.unresponsive ? 'Supervisor is unresponsive.' : '');
    $('simulationRun').textContent = `Run ${state.id}${state.persona ? ' | Persona: ' + state.persona.name : ''} | Brain: ${state.brain?.model || state.brain?.mode || 'legacy'} | Skipped: ${state.skipped || 0}`;
    for (const event of message.events || []) {
      if (event.sequence <= cursor) continue;
      cursor = event.sequence;
      const item = document.createElement('li');
      item.textContent = `${new Date(event.timestamp).toLocaleTimeString()} · ${event.type}${event.action ? ' · ' + event.action : ''}${event.message ? ' · ' + event.message : ''}`;
      $('simulationEvents').append(item);
    }
    while ($('simulationEvents').children.length > 200) $('simulationEvents').firstChild.remove();
  }
  $('simulationStart').onclick = async () => {
    if (pending) return;
    pending = true; $('simulationStart').disabled = true;
    try { show(await window.phoneRelay.runAction('simulationStart', { commandId: crypto.randomUUID(), fault: $('simulationFault').checked ? 'error' : 'none' })); }
    catch (error) { $('simulationError').textContent = String(error.message); }
    finally { pending = false; $('simulationStart').disabled = Boolean(state && !['completed', 'failed', 'stopped', 'interrupted'].includes(state.state)); }
  };
  $('simulationStop').onclick = async () => {
    if (!state) return;
    try { show(await window.phoneRelay.runAction('simulationStop', { id: state.id })); }
    catch (error) { $('simulationError').textContent = String(error.message); }
  };
  $('simulationReport').onclick = async () => {
    try { const report = await window.phoneRelay.runAction('simulationReport', { id: state.id }); $('simulationReportText').textContent = JSON.stringify(report, null, 2); }
    catch (error) { $('simulationError').textContent = String(error.message); }
  };
  $('simulationRefreshHistory').onclick = async () => {
    try {
      const sessions = await window.phoneRelay.runAction('simulationHistory');
      $('simulationHistory').replaceChildren(...sessions.map(session => {
        const option = document.createElement('option'); option.value = session.id;
        option.textContent = `${session.startedAt} | ${session.state} | ${session.id}`; return option;
      }));
    } catch (error) { $('simulationError').textContent = String(error.message); }
  };
  $('simulationLoadHistory').onclick = async () => {
    if (!$('simulationHistory').value) return;
    try { $('simulationReportText').textContent = JSON.stringify(await window.phoneRelay.runAction('simulationReport', { id: $('simulationHistory').value }), null, 2); }
    catch (error) { $('simulationError').textContent = String(error.message); }
  };
  window.phoneRelay.onSimulationEvent?.(show);
  window.phoneRelay.runAction('simulationStatus').then(show).catch(error => { $('simulationError').textContent = String(error.message); });
  setInterval(() => {
    if (!state) return;
    const end = state.finishedAt ? Date.parse(state.finishedAt) : Date.now();
    $('simulationTiming').textContent = `Elapsed ${Math.floor((end - Date.parse(state.startedAt)) / 1000)}s · heartbeat ${Math.max(0, Math.floor((Date.now() - Date.parse(state.heartbeatAt)) / 1000))}s ago`;
  }, 1000);
})();

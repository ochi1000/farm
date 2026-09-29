const $ = selector => document.querySelector(selector);
let devices = [];
let selectedId = '';
let refreshing = false;
let busy = false;
let setupMode = 'add';
let editingId = '';
let discovering = false;
let setupScanTimer = null;
let brainPostUrl = '';

const form = $('#deviceForm');
const xForm = $('#xForm');
const xMutationActions = new Set(['follow_user', 'like_post', 'comment_post', 'create_post']);
const selected = () => devices.find(device => device.deviceId === selectedId);
const status = message => { $('#status').textContent = message; };
const errorMessage = error => String(error?.message || error).replace(/^Error invoking remote method 'run-action': Error:\s*/, '');

async function refresh() {
  if (refreshing || busy) return;
  refreshing = true;
  try {
    devices = (await window.phoneRelay.runAction('fleetList')).devices;
    render();
  } catch (error) {
    status(errorMessage(error));
  } finally {
    refreshing = false;
  }
}

function render() {
  $('#counts').textContent = `${devices.length} devices / ${devices.filter(device => device.relayOnline).length} relay online / ${devices.filter(device => device.adbReady).length} ready`;
  const query = $('#search').value.toLowerCase();
  const visible = devices.filter(device => `${device.name} ${device.model} ${device.deviceId}`.toLowerCase().includes(query));
  $('#devices').replaceChildren();

  for (const device of visible) {
    const row = document.createElement('tr');
    row.classList.toggle('selected', device.deviceId === selectedId);
    const name = document.createElement('td');
    const state = document.createElement('td');
    const target = document.createElement('td');
    const button = document.createElement('button');
    const model = document.createElement('small');
    button.textContent = device.name;
    button.disabled = busy;
    button.onclick = () => { selectedId = device.deviceId; render(); };
    model.textContent = device.model || 'Android device';
    name.append(button, model);
    state.textContent = device.state;
    state.className = device.state.toLowerCase();
    target.textContent = device.viewMode === 'chrome' ? 'Chrome' : (device.viewing ? 'Phone' : 'Off');
    row.append(name, state, target);
    $('#devices').append(row);
  }

  $('#empty').hidden = visible.length > 0;
  const device = selected();
  $('#selectedName').textContent = device?.name || 'Select a device';
  $('#identity').textContent = device?.model || '';
  $('#detail').textContent = device?.message || '';
  document.querySelectorAll('[data-command],#edit,#remove').forEach(button => { button.disabled = !device || busy; });
  document.querySelectorAll('[data-command="deviceView"],[data-command="backgroundChromeView"],[data-command="remoteAdbConnect"],[data-command="openRelayApp"]').forEach(button => {
    button.disabled = !device?.adbReady || busy;
  });
  $('#xTask').disabled = !device || !device.adbReady || busy;
  document.querySelectorAll('.view-actions [data-command]').forEach(button => {
    const mode = button.dataset.command === 'deviceView' ? 'phone' : (button.dataset.command === 'backgroundChromeView' ? 'chrome' : null);
    button.classList.toggle('active', Boolean(device && ((mode && device.viewMode === mode) || (!mode && !device.viewing))));
  });
}

function setSetupBusy(value) {
  busy = value;
  $('#close').disabled = value;
  $('#cancel').disabled = value;
  $('#rescan').disabled = value;
  $('#setupSubmit').disabled = value || (setupMode === 'add' && !$('#serial').value);
  render();
}

async function discoverPhones() {
  if (discovering || busy || setupMode !== 'add' || !$('#setup').open) return;
  discovering = true;
  const previousSerial = $('#serial').value;
  if (!previousSerial) {
    $('#discoveryStatus').textContent = 'Scanning...';
    $('#serial').replaceChildren(new Option('Scanning connected phones...', ''));
    $('#serial').disabled = true;
    $('#setupSubmit').disabled = true;
  }
  try {
    const result = await window.phoneRelay.runAction('discoverUsbDevices');
    $('#serial').replaceChildren();
    for (const phone of result.phones || []) $('#serial').add(new Option(phone.label, phone.serial));
    if (!result.phones?.length) $('#serial').add(new Option('No authorized phone detected', ''));
    if ([...$('#serial').options].some(option => option.value === previousSerial)) $('#serial').value = previousSerial;
    $('#serial').disabled = !result.phones?.length;
    $('#discoveryStatus').textContent = result.message;
    if (!form.elements.name.value && result.phones?.length === 1) form.elements.name.value = result.phones[0].suggestedName;
  } catch (error) {
    $('#serial').replaceChildren(new Option('Phone scan failed', ''));
    $('#discoveryStatus').textContent = errorMessage(error);
  } finally {
    discovering = false;
    $('#setupSubmit').disabled = busy || !$('#serial').value;
  }
}

function closeSetup() {
  clearInterval(setupScanTimer);
  setupScanTimer = null;
  $('#setup').close();
}

async function openSetup(device) {
  form.reset();
  $('#setupStatus').textContent = '';
  setupMode = device ? 'edit' : 'add';
  editingId = device?.deviceId || '';
  $('#setupTitle').textContent = device ? 'Rename device' : 'Add device';
  $('#connectedGroup').hidden = Boolean(device);
  $('#setupSubmit').textContent = device ? 'Save name' : 'Set up device';
  form.elements.name.value = device?.name || '';
  $('#serial').required = !device;
  $('#setup').showModal();
  if (device) {
    $('#setupSubmit').disabled = false;
    form.elements.name.focus();
  } else {
    await discoverPhones();
    setupScanTimer = setInterval(discoverPhones, 3000);
  }
}

$('#refresh').onclick = refresh;
$('#search').oninput = render;
$('#add').onclick = () => openSetup(null).catch(error => status(errorMessage(error)));
$('#edit').onclick = () => openSetup(selected()).catch(error => status(errorMessage(error)));
$('#remove').onclick = () => {
  const device = selected();
  if (!device) return;
  $('#removeName').textContent = device.name;
  $('#removeStatus').textContent = '';
  $('#removeDialog').showModal();
};
$('#close').onclick = closeSetup;
$('#cancel').onclick = closeSetup;
$('#setup').addEventListener('close', () => {
  clearInterval(setupScanTimer);
  setupScanTimer = null;
});
$('#rescan').onclick = () => discoverPhones();
$('#serial').onchange = () => { $('#setupSubmit').disabled = busy || !$('#serial').value; };
$('#removeClose').onclick = () => $('#removeDialog').close();
$('#removeCancel').onclick = () => $('#removeDialog').close();

$('#xTask').onclick = () => {
  const device = selected();
  if (!device) return;
  xForm.reset();
  brainPostUrl = '';
  $('#xAccount').value = 'x-lab-account';
  $('#xLimit').value = '5';
  $('#xScrolls').value = '1';
  $('#xPostIndex').value = '1';
  $('#xDeviceName').textContent = device.name;
  $('#xResult').textContent = '';
  updateXFields();
  $('#xDialog').showModal();
};
$('#xClose').onclick = () => $('#xDialog').close();
$('#xCancel').onclick = () => $('#xDialog').close();
$('#xAction').onchange = () => { brainPostUrl = ''; updateXFields(); };
$('#xCommit').onchange = updateXFields;

function updateXFields() {
  const action = $('#xAction').value;
  const mutation = xMutationActions.has(action);
  const commit = mutation && $('#xCommit').checked;
  $('#xPinnedTarget').textContent = brainPostUrl ? `Pinned post: ${brainPostUrl}` : '';
  $('#xPinnedTarget').hidden = !brainPostUrl;
  $('#xUsernameGroup').hidden = action !== 'follow_user';
  $('#xPostGroup').hidden = action !== 'like_post' && action !== 'comment_post';
  $('#xTextGroup').hidden = action !== 'comment_post' && action !== 'create_post';
  $('#xLimitGroup').hidden = action !== 'read_feed' && action !== 'scroll_feed';
  $('#xScrollsGroup').hidden = action !== 'scroll_feed';
  $('#xCommitGroup').hidden = !mutation;
  $('#xApprovalGroup').hidden = !commit;
  $('#xIdempotencyGroup').hidden = !commit || (action !== 'comment_post' && action !== 'create_post');
  $('#xUsername').required = action === 'follow_user';
  $('#xText').required = action === 'comment_post' || action === 'create_post';
  $('#xApproval').required = commit;
  $('#xIdempotency').required = commit && (action === 'comment_post' || action === 'create_post');
  $('#xSubmit').textContent = commit ? 'Run approved action' : 'Run preview';
}

xForm.onsubmit = async event => {
  event.preventDefault();
  const device = selected();
  if (!device || busy) return;
  busy = true;
  render();
  $('#xResult').textContent = 'Running...';
  document.querySelectorAll('#xDialog button,#xDialog input,#xDialog select,#xDialog textarea').forEach(control => { control.disabled = true; });
  try {
    const action = $('#xAction').value;
    const result = await window.phoneRelay.runAction('xInstruction', {
      deviceId: device.deviceId,
      xAction: action,
      accountId: $('#xAccount').value.trim(),
      username: $('#xUsername').value.trim(),
      text: $('#xText').value.trim(),
      postIndex: Number($('#xPostIndex').value) - 1,
      postUrl: brainPostUrl,
      scrolls: Number($('#xScrolls').value),
      limit: Number($('#xLimit').value),
      commit: xMutationActions.has(action) && $('#xCommit').checked,
      approvalToken: $('#xApproval').value,
      idempotencyKey: $('#xIdempotency').value.trim(),
      closeTab: $('#xCloseTab').checked
    });
    const summary = result.output?.posts?.map(post => `${post.handle || post.author || 'Post'}: ${post.text || post.url || ''}`).join('\n')
      || result.output?.actionResult?.state
      || result.message;
    $('#xResult').textContent = summary;
    status(`${result.title}: ${result.message}`);
  } catch (error) {
    $('#xResult').textContent = errorMessage(error);
  } finally {
    busy = false;
    document.querySelectorAll('#xDialog button,#xDialog input,#xDialog select,#xDialog textarea').forEach(control => { control.disabled = false; });
    updateXFields();
    await refresh();
  }
};

$('#xBrainDraft').onclick = async () => {
  const device = selected();
  if (!device || busy) return;
  busy = true;
  render();
  $('#xResult').textContent = 'Reading the feed and preparing a local draft...';
  document.querySelectorAll('#xDialog button,#xDialog input,#xDialog select,#xDialog textarea').forEach(control => { control.disabled = true; });
  try {
    const result = await window.phoneRelay.runAction('xBrainPlan', { deviceId: device.deviceId, accountId: $('#xAccount').value.trim(), instruction: $('#xBrainInstruction').value.trim() });
    const plan = result.plan;
    if (!plan || plan.action === 'clarify') { $('#xResult').textContent = plan?.explanation || 'Please clarify the instruction.'; return; }
    $('#xAction').value = plan.action;
    $('#xText').value = plan.text;
    $('#xUsername').value = plan.username;
    $('#xCommit').checked = false;
    $('#xApproval').value = '';
    $('#xIdempotency').value = crypto.randomUUID();
    brainPostUrl = plan.postUrl;
    $('#xResult').textContent = `${plan.explanation}${brainPostUrl ? '\nTarget: ' + brainPostUrl : ''}\nDraft ready for review.`;
  } catch (error) { $('#xResult').textContent = errorMessage(error); }
  finally {
    busy = false;
    document.querySelectorAll('#xDialog button,#xDialog input,#xDialog select,#xDialog textarea').forEach(control => { control.disabled = false; });
    updateXFields();
    await refresh();
  }
};

$('#removeForm').onsubmit = async event => {
  event.preventDefault();
  const device = selected();
  if (!device || busy) return;
  busy = true;
  render();
  $('#removeStatus').textContent = 'Removing device...';
  document.querySelectorAll('#removeDialog button').forEach(button => { button.disabled = true; });
  try {
    const result = await window.phoneRelay.runAction('fleetRemove', { deviceId: device.deviceId });
    selectedId = '';
    $('#removeDialog').close();
    status(`${result.title}: ${result.message}`);
  } catch (error) {
    $('#removeStatus').textContent = errorMessage(error);
  } finally {
    busy = false;
    document.querySelectorAll('#removeDialog button').forEach(button => { button.disabled = false; });
    await refresh();
  }
};

form.onsubmit = async event => {
  event.preventDefault();
  setSetupBusy(true);
  $('#setupStatus').textContent = setupMode === 'add' ? 'Preparing and connecting phone...' : 'Saving...';
  try {
    const name = form.elements.name.value.trim();
    const result = setupMode === 'add'
      ? await window.phoneRelay.runAction('fleetEnroll', { name, serial: $('#serial').value })
      : await window.phoneRelay.runAction('fleetRename', { deviceId: editingId, name });
    selectedId = result.deviceId || editingId;
    closeSetup();
    status(`${result.title}: ${result.message}`);
  } catch (error) {
    $('#setupStatus').textContent = errorMessage(error);
  } finally {
    setSetupBusy(false);
    await refresh();
  }
};

document.querySelectorAll('[data-command]').forEach(button => {
  button.onclick = async () => {
    busy = true;
    render();
    status('Working...');
    try {
      const result = await window.phoneRelay.runAction('fleetAction', { deviceId: selectedId, command: button.dataset.command });
      status(`${result.title}: ${result.message}`);
    } catch (error) {
      status(errorMessage(error));
    } finally {
      busy = false;
      await refresh();
    }
  };
});

for (const [id, action] of [['viewAll', 'fleetViewAll'], ['stopAll', 'fleetStopAll']]) {
  $(`#${id}`).onclick = async () => {
    if (busy) return;
    busy = true;
    render();
    status('Working...');
    try {
      const result = await window.phoneRelay.runAction(action);
      status(result.message);
    } catch (error) {
      status(errorMessage(error));
    } finally {
      busy = false;
      await refresh();
    }
  };
}

window.addEventListener('all-in-viewer-state', event => {
  const count = document.querySelectorAll('.viewer-tile').length;
  $('#viewerCount').textContent = `${count} active ${count === 1 ? 'view' : 'views'}`;
  if (event.detail?.type === 'error') status(event.detail.message || 'Viewer failed.');
  void refresh();
});

refresh();
setInterval(refresh, 15000);

for (const [id, action] of [['longSmoke', 'longRunStart'], ['longStart', 'longRunStart'], ['longStatus', 'longRunStatus'], ['longStop', 'longRunStop']]) {
  $('#' + id).onclick = async () => {
    const device = selected();
    if (!device) return status('Select a device.');
    const key = 'long-run:' + device.deviceId;
    try {
      const result = await window.phoneRelay.runAction(action, { deviceId: device.deviceId, runId: localStorage.getItem(key), smoke: id === 'longSmoke' });
      if (result.id) localStorage.setItem(key, result.id);
      status(`Test ${result.state}; ${result.completedCycles || 0} cycles. ${result.stopRequested ? 'Stop requested; current cycle will finish first.' : ''} Report: ${result.reportPath}`);
    } catch (error) { status(errorMessage(error)); }
  };
}

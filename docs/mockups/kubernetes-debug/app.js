const $ = id => document.getElementById(id);
const templates = [
  { id: 'shell', name: 'Shell', image: 'busybox:1.37.0', command: ['sh'], profile: 'restricted', description: 'Small shell toolbox', builtin: true },
  { id: 'network', name: 'Network toolbox', image: 'nicolaka/netshoot:v0.14', command: ['sh'], profile: 'restricted', description: 'DNS, HTTP and TLS tools', builtin: true }
];
const defaults = { plugin: 'shell', cluster: null };
let session = null;
const sessions = [];
let podReplaced = false;
const pendingSession = () => sessions.find(s => ['Starting', 'Checking creation'].includes(s.state));
let serial = 0;
let templateSerial = 0;
let draftTemplateID = null;
let execTarget = null;
let terminalMode = 'debug';
let pickerTrigger = null;
const templateByID = id => templates.find(t => t.id === id);
const defaultTemplate = () => templateByID(defaults.cluster ?? defaults.plugin);
function runningContainers() {
  return $('container-count').value === 'none' ? [] : $('container-count').value === 'one' ? ['checkout'] : ['checkout', 'istio-proxy'];
}
function pickTarget(continueWithTarget, trigger = $('debug')) {
  const containers = runningContainers();
  if (!containers.length) { $('action-error').textContent = 'No running container to inspect. Check logs and events instead.'; return; }
  if (containers.length === 1) { continueWithTarget(containers[0]); return; }
  const menu = $('container-menu');
  pickerTrigger = trigger;
  const choices = $('container-choices'); choices.replaceChildren();
  containers.forEach(target => {
    const button = document.createElement('button'); button.className = 'menu-item'; button.textContent = target; button.dataset.target = target;
    button.onclick = () => { menu.hidePopover(); continueWithTarget(target); };
    choices.append(button);
  });
  menu.showPopover();
  const rect = trigger.getBoundingClientRect();
  menu.style.left = Math.max(8, rect.right - menu.offsetWidth) + 'px';
  menu.style.top = rect.bottom + 5 + 'px';
  choices.querySelector('button').focus();
}
function targetMenuKeydown(event) {
  const buttons = [...$('container-choices').querySelectorAll('button')];
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
  }
  if (event.key === 'Escape') { $('container-menu').hidePopover(); pickerTrigger?.focus(); }
}
$('container-menu').onkeydown = targetMenuKeydown;
$('debug').setAttribute('aria-controls', 'container-menu');
$('debug').setAttribute('aria-expanded', 'false');
$('container-menu').addEventListener('toggle', () => {
  $('debug').setAttribute('aria-expanded', String(pickerTrigger === $('debug') && $('container-menu').matches(':popover-open')));
  $('exec').setAttribute('aria-expanded', String(pickerTrigger === $('exec') && $('container-menu').matches(':popover-open')));
});
$('container-count').onchange = () => {
  if (pendingSession() || podReplaced) return;
  $('container-menu').hidePopover();
  $('container-debug').disabled = runningContainers().length === 0;
  document.querySelectorAll('.container')[1].hidden = $('container-count').value !== 'two';
  $('action-error').textContent = '';
};
function options(select, selected, inherit = false) {
  select.replaceChildren();
  if (inherit) select.add(new Option('Use all-cluster default', 'inherit'));
  templates.forEach(t => select.add(new Option(t.name, t.id)));
  select.value = selected;
}
function hideMenu() { $('debug-menu').hidePopover(); }
function refreshMenu() {
  const box = $('template-menu'); box.replaceChildren();
  templates.forEach(t => {
    const button = document.createElement('button'); button.className = 'menu-item'; button.dataset.template = t.id;
    const text = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = t.name;
    const image = document.createElement('small'); image.textContent = t.image;
    text.append(name, image); button.append(text);
    if (t.id === defaultTemplate().id) { const badge = document.createElement('span'); badge.textContent = 'Default'; button.append(badge); }
    button.onclick = () => { hideMenu(); quickLaunch(t); };
    box.append(button);
  });
  $('debug').title = `Debug container — open a toolbox alongside your app · ${defaultTemplate().name} · Ctrl+Alt+D (proposed)`;
}
$('choose').onclick = () => {
  const menu = $('debug-menu');
  if (menu.matches(':popover-open')) { hideMenu(); return; }
  refreshMenu(); menu.showPopover();
  const rect = $('choose').getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.min(rect.bottom + 5, innerHeight - menu.offsetHeight - 8) + 'px';
  menu.querySelector('button')?.focus();
};
$('debug-menu').addEventListener('toggle', () => $('choose').setAttribute('aria-expanded', String($('debug-menu').matches(':popover-open'))));
$('debug-menu').onkeydown = event => {
  const buttons = [...$('debug-menu').querySelectorAll('button')];
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault(); const index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
  }
  if (event.key === 'Escape') { hideMenu(); $('choose').focus(); }
};
function fillLaunch(t, target) {
  options($('template'), t.id);
  $('template-description').textContent = t.description || 'Custom toolbox';
  $('image').value = t.image; $('image-source').textContent = 'Template';
  $('target').replaceChildren(...runningContainers().map(name => new Option(name, name)));
  $('target').value = target; $('command').value = JSON.stringify(t.command);
  document.querySelector('#launch .context').textContent = `Inspect ${target} · storefront`;
  $('profile').value = t.profile; $('pull').value = t.pull ?? 'IfNotPresent'; $('mount').value = 'none'; $('env').value = JSON.stringify(t.env ?? {});
  $('ack').checked = false; $('error').textContent = '';
  updatePreview();
}
function openLaunch(t = defaultTemplate(), target) {
  hideMenu();
  if (!target) { pickTarget(selected => openLaunch(t, selected)); return; }
  fillLaunch(t, target); $('customize').open = false;
  document.querySelector('.request-details').open = false;
  $('launch').showModal();
}
function requestFrom(t, target) {
  return { templateID: t.id, template: t.name, image: t.image, command: [...t.command], profile: t.profile, target, targetContainerName: target, pull: t.pull ?? 'IfNotPresent', mount: 'none', env: { ...t.env } };
}
function quickLaunch(t = defaultTemplate(), target) {
  if ($('launch').open || $('settings').open || $('template-editor').open || $('session-details').open) return;
  if (podReplaced) { $('action-error').textContent = 'Original Pod was replaced. Select the current Pod before debugging.'; return; }
  if (pendingSession()) { showTerminalState(pendingSession()); return; }
  if (!target) { pickTarget(selected => quickLaunch(t, selected)); return; }
  if (t.profile !== 'restricted') { openLaunch(t, target); return; }
  launch(requestFrom(t, target), false);
}
$('debug').onclick = () => {
  if ($('container-menu').matches(':popover-open')) { $('container-menu').hidePopover(); return; }
  quickLaunch();
};
$('container-debug').onclick = () => quickLaunch(defaultTemplate(), 'checkout');
$('exec').onclick = () => pickTarget(target => {
  execTarget = target; terminalMode = 'exec';
  if (session) session.connected = false;
  renderSession();
  $('terminal').hidden = false; $('exec-recovery').hidden = false; $('inspector-context').hidden = true;
  $('terminal-status').hidden = true; $('terminal-reconnect').hidden = true; $('exit').hidden = false; $('detach').textContent = 'Detach';
  $('terminal-title').textContent = `checkout-7c9d8b-x2m4k / ${target} · Exec`;
  $('exec-target').textContent = target;
  $('output').textContent = 'exec: "sh": executable file not found in $PATH\n';
}, $('exec'));
$('recover-debug').onclick = () => quickLaunch(defaultTemplate(), execTarget);
$('configure').onclick = () => openLaunch();
$('cancel').onclick = () => $('launch').close();
$('template').onchange = () => fillLaunch(templateByID($('template').value), $('target').value);
$('image').oninput = () => { $('image-source').textContent = 'This session'; updatePreview(); };
['target', 'command', 'pull', 'mount', 'env'].forEach(id => $(id).addEventListener('input', updatePreview));
$('profile').onchange = () => { $('ack').checked = false; updatePreview(); };
function updatePreview() {
  document.querySelector('#launch .context').textContent = `Inspect ${$('target').value} · storefront`;
  $('elevated').hidden = $('profile').value === 'restricted';
  $('preview').textContent = JSON.stringify({ targetContainerName: $('target').value, image: $('image').value, command: $('command').value, profile: $('profile').value, pull: $('pull').value, mount: $('mount').value, env: $('env').value }, null, 2);
}
function validCommand(value) { return Array.isArray(value) && value.length > 0 && value.every(x => typeof x === 'string'); }
$('start').onclick = () => {
  let command, env;
  try {
    command = JSON.parse($('command').value); env = JSON.parse($('env').value);
    if (!validCommand(command) || !env || Array.isArray(env) || typeof env !== 'object' || !Object.values(env).every(x => typeof x === 'string')) throw Error();
  } catch { $('customize').open = true; $('error').textContent = 'Use a JSON string array for command and a string-valued JSON object for environment.'; return; }
  if (!$('image').value.trim()) { $('error').textContent = 'Choose a tool image.'; return; }
  if ($('profile').value !== 'restricted' && !$('ack').checked) { $('error').textContent = 'Confirm elevated access before starting.'; return; }
  launch({ templateID: $('template').value, template: templateByID($('template').value).name, image: $('image').value.trim(), command, profile: $('profile').value, target: $('target').value, targetContainerName: $('target').value, pull: $('pull').value, mount: $('mount').value, env }, true);
};
function attach(selected = session) {
  if (!selected || !['Running', 'Disconnected'].includes(selected.state)) return;
  sessions.forEach(s => { if (s !== selected) s.connected = false; });
  session = selected;
  if (session.state === 'Disconnected') session.events.push('Client: rechecked this named container and reattached. No new container created.');
  session.state = 'Running'; session.connected = true; session.note = '';
  terminalMode = 'debug';
  $('terminal').hidden = false; $('exec-recovery').hidden = true; $('inspector-context').hidden = false;
  $('terminal-status').hidden = true; $('terminal-reconnect').hidden = true; $('exit').hidden = false; $('detach').textContent = 'Detach';
  $('terminal-title').textContent = `checkout-7c9d8b-x2m4k / ${session.request.target} / ${session.name}`;
  $('inspector-summary').textContent = `Debug → ${session.request.target} · ${session.request.image}`;
  $('inspector-details').open = false; $('copy-status').textContent = '';
  const access = session.processAccess;
  $('process-status').textContent = access === 'unknown' ? 'Target namespace requested · not verified' : access === 'unavailable' ? 'Target namespace unavailable · simulated runtime limit' : 'Target process visible · simulated';
  $('files-status').textContent = access === 'visible' ? `/proc/${session.request.target === 'checkout' ? 42 : 84}/root` : access === 'denied' ? 'Permission denied · no privilege changes made' : 'Unavailable until a live target process is visible and readable';
  $('copy-root').hidden = access !== 'visible';
  $('process-limited').hidden = access !== 'unavailable';
  $('output').textContent = '/ $ ';
  renderSession();
}
$('copy-root').onclick = async () => {
  if (!session || session.processAccess !== 'visible') return;
  try { await navigator.clipboard.writeText($('files-status').textContent); $('copy-status').textContent = 'Path copied. No command executed.'; }
  catch { $('copy-status').textContent = 'Clipboard unavailable. Select and copy the path above.'; }
};
function setLaunchAvailability() {
  const blocked = Boolean(pendingSession()) || podReplaced;
  ['debug', 'start', 'recover-debug', 'configure'].forEach(id => $(id).disabled = blocked);
  $('container-debug').disabled = blocked || runningContainers().length === 0;
  $('exec').disabled = podReplaced;
}
function showTerminalState(selected) {
  sessions.forEach(s => { s.connected = false; });
  session = selected; terminalMode = 'debug';
  $('terminal').hidden = false; $('exec-recovery').hidden = true; $('inspector-context').hidden = true;
  $('terminal-title').textContent = `checkout-7c9d8b-x2m4k / ${selected.request.target} / ${selected.name}`;
  $('terminal-status').hidden = false;
  $('terminal-status').textContent = `${selected.state}: ${selected.note || 'Container running. Reconnect to resume.'}`;
  $('terminal-reconnect').hidden = !['Running', 'Disconnected'].includes(selected.state);
  $('exit').hidden = true; $('detach').textContent = 'Hide';
  $('output').textContent = '';
}
function showSessionDetails(selected) {
  $('session-details-title').textContent = selected.confirmed ? selected.name : `Request ${selected.name}`;
  $('session-identity').textContent = `kind-kind / storefront / checkout-7c9d8b-x2m4k`;
  const facts = $('session-facts'); facts.replaceChildren();
  [['Target', selected.request.target], ['State', selected.state], ['Image', selected.request.image], ['Pod UID', selected.podUID], ['Creation', selected.confirmed ? 'Confirmed' : selected.state === 'Not created' ? 'Reconciled: not added' : 'Unconfirmed']].forEach(([label, value]) => {
    const row = document.createElement('div'); const key = document.createElement('span'); key.textContent = label;
    const text = document.createElement('b'); text.textContent = value; row.append(key, text); facts.append(row);
  });
  $('session-events').textContent = selected.events.join('\n');
  $('session-lifecycle-note').textContent = selected.confirmed ? 'Ephemeral container cannot be edited, restarted or removed. Its record stays with the original Pod. Do not delete the application Pod to clean it up.' : selected.state === 'Not created' ? 'Original operation was definitively rejected; no ephemeral container was added. This is a local attempt record.' : 'No confirmed container record. Reconcile this request against the original Pod UID before submitting another.';
  $('session-details').showModal();
}
$('session-details-close').onclick = () => $('session-details').close();
function createAnother(selected) {
  if (podReplaced || pendingSession()) return;
  const t = templateByID(selected.request.templateID) ?? defaultTemplate();
  openLaunch({ ...t, image: selected.request.image, command: selected.request.command, profile: selected.request.profile, pull: selected.request.pull, env: selected.request.env }, selected.request.target);
}
function renderSession() {
  $('session-section').hidden = sessions.length === 0;
  const box = $('sessions'); box.replaceChildren();
  [...sessions].reverse().forEach(s => {
    const card = document.createElement('div'); card.className = 'debug-record'; card.dataset.session = s.name;
    const head = document.createElement('div'); head.className = 'session-head';
    const name = document.createElement('span'); name.textContent = s.confirmed ? s.name : `Request ${s.name}`;
    const state = document.createElement('span'); state.className = 'badge ' + (s.state === 'Running' ? 'success' : 'warning'); state.textContent = s.state;
    head.append(name, state);
    const actions = document.createElement('div'); actions.className = 'session-actions';
    const button = (label, action) => { const b = document.createElement('button'); b.className = 'btn quiet'; b.textContent = label; b.onclick = action; actions.append(b); };
    if (['Running', 'Disconnected'].includes(s.state) && !podReplaced) button(s.connected ? 'Open terminal' : 'Reconnect', () => attach(s));
    if (['ImagePullBackOff', 'Terminated', 'Not created'].includes(s.state) && !podReplaced && !pendingSession()) button('New session…', () => createAnother(s));
    button('Details', () => showSessionDetails(s));
    const context = document.createElement('p'); context.className = 'session-target'; context.textContent = `→ ${s.request.target}` + (s.state === 'Running' && !s.connected ? ' · detached' : '');
    card.append(head, context);
    if (s.note) { const note = document.createElement('p'); note.textContent = s.note; card.append(note); }
    card.append(actions); box.append(card);
  });
  const selection = $('event-session').value;
  $('event-session').replaceChildren(...sessions.map(s => new Option(s.name, s.name)));
  $('event-session').value = sessions.some(s => s.name === selection) ? selection : session?.name ?? '';
  setLaunchAvailability();
}
function launch(request, fromDialog) {
  if (pendingSession() || podReplaced) return;
  const result = $('failure').value;
  $('action-error').replaceChildren(); $('error').textContent = '';
  if (result === 'rbac' || result === 'admission') {
    const text = result === 'rbac' ? 'Forbidden: cannot patch pods/ephemeralcontainers. Nothing created. Request scoped access from an administrator.' : 'Admission denied: image or security context violates cluster policy. Nothing created. Choose an approved configuration.';
    $(fromDialog ? 'error' : 'action-error').textContent = text;
    if (!fromDialog && result === 'admission') {
      const action = document.createElement('button'); action.className = 'btn quiet'; action.textContent = 'Customize…';
      action.onclick = () => createAnother({ request }); $('action-error').append(action);
    }
    return;
  }
  const state = result === 'unknown' ? 'Checking creation' : result === 'starting' ? 'Starting' : result === 'pull' ? 'ImagePullBackOff' : 'Running';
  const note = result === 'unknown' ? 'Response lost. Checking whether this request was accepted. Do not submit another.' : result === 'starting' ? 'Container added. Pulling the toolbox image…' : result === 'pull' ? 'Image pull failed. Inspect events or create a new container with a corrected image. This entry cannot be edited.' : result === 'attach' ? 'Container created; attachment lost. Reconnect to this container, not another.' : '';
  sessions.forEach(s => { s.connected = false; });
  session = { name: 'debugger-' + (++serial), state, note, request, processAccess: $('process-access').value, confirmed: result !== 'unknown', connected: false, podUID: 'pod-uid-original', events: [] };
  session.events.push(result === 'unknown' ? 'Client: response lost after submission; creation is unconfirmed.' : 'API: ephemeral container addition accepted by the original Pod.');
  if (result === 'starting') session.events.push(`Normal Pulling: Pulling image "${request.image}".`);
  if (result === 'pull') session.events.push(`Warning Failed: Failed to pull image "${request.image}": registry access denied.\nWarning BackOff: Back-off pulling image.`);
  sessions.push(session);
  $('terminal').hidden = true; renderSession();
  $('event-session').value = session.name;
  if (fromDialog) $('launch').close();
  if (result === 'success') attach(session);
  else if (['starting', 'unknown'].includes(result)) showTerminalState(session);
}
$('detach').onclick = () => {
  if (terminalMode === 'debug' && session) session.connected = false;
  $('terminal').hidden = true; renderSession();
};
$('terminal-reconnect').onclick = () => attach(session);
$('exit').onclick = () => {
  if (terminalMode === 'debug' && session && session.connected) {
    session.state = 'Terminated'; session.connected = false; session.note = 'Exited (0). Record remains until the original Pod is deleted.';
    session.events.push('Terminated: shell exited with code 0. Ephemeral record retained.'); renderSession();
  }
  $('terminal').hidden = true;
};
$('apply-event').onclick = () => {
  const selected = sessions.find(s => s.name === $('event-session').value);
  if (!selected) return;
  const event = $('session-event').value;
  const previousState = selected.state;
  const wasConnected = selected.connected;
  if (event !== 'target-gone' && ['Terminated', 'Target gone', 'Not created'].includes(selected.state)) return;
  if (event === 'absent' && selected.state !== 'Checking creation') return;
  if (event === 'running') {
    selected.confirmed = true; selected.state = 'Running'; selected.note = ''; selected.events.push('Normal Started: the same named debug container is running.');
  } else if (event === 'pull') {
    if (!['Starting', 'Checking creation', 'ImagePullBackOff'].includes(selected.state)) return;
    selected.confirmed = true; selected.state = 'ImagePullBackOff'; selected.note = 'Image pull failed. Correct image access, or explicitly create a new debug container.'; selected.events.push('Warning BackOff: failed to pull toolbox image; retrying pull, not creating another container.');
  } else if (event === 'disconnect') {
    if (selected.state !== 'Running') return;
    selected.state = 'Disconnected'; selected.connected = false; selected.note = 'Connection lost. Last seen running; current process state is unknown.'; selected.events.push('Client: terminal stream disconnected. Container exit is not confirmed.');
  } else if (event === 'terminated') {
    if (!['Running', 'Disconnected'].includes(selected.state)) return;
    selected.state = 'Terminated'; selected.connected = false; selected.note = 'Exited (0). Ephemeral record remains with the original Pod.'; selected.events.push('Terminated: exit code 0 observed.');
  } else if (event === 'absent') {
    selected.state = 'Not created'; selected.note = 'Original operation definitively rejected. No container was added. A new attempt is safe.'; selected.events.push('Reconciled original Pod UID and original operation: server definitively rejected the addition.');
  } else if (event === 'target-gone') {
    podReplaced = true;
    sessions.forEach(s => { s.state = 'Target gone'; s.connected = false; s.note = 'Original Pod was replaced. Select the current Pod; do not attach by reused name.'; s.events.push('Pod UID changed: original target no longer exists.'); });
  }
  if (podReplaced && session && terminalMode === 'debug' && !$('terminal').hidden) showTerminalState(session);
  else if (session === selected && !$('terminal').hidden) {
    if (selected.state === 'Running' && (wasConnected || ['Starting', 'Checking creation'].includes(previousState))) attach(selected);
    else showTerminalState(selected);
  }
  renderSession();
};
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.repeat || !event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey || event.code !== 'KeyD') return;
  if ($('launch').open || $('settings').open || $('template-editor').open || $('session-details').open || !document.hasFocus()) return;
  if (event.target.closest('input,textarea,select,[contenteditable="true"],#terminal')) return;
  event.preventDefault(); hideMenu(); quickLaunch();
});
function loadDefault(selected = defaults[$('scope').value] ?? 'inherit') {
  options($('default-template'), selected, $('scope').value === 'cluster');
  showEffectiveDefault();
}
function showEffectiveDefault() {
  const inherited = $('scope').value === 'cluster' && $('default-template').value === 'inherit';
  const t = templateByID(inherited ? defaults.plugin : $('default-template').value);
  $('default-origin').textContent = inherited ? 'Inherited from Kubernetes defaults' : $('scope').value === 'cluster' ? 'Cluster override' : 'Kubernetes default';
  $('effective-template').textContent = t.name;
  $('effective-image').textContent = t.image;
  $('default-warning').hidden = t.profile === 'restricted';
}
function renderSettingsTemplates() {
  const list = $('settings-templates'); list.replaceChildren();
  templates.forEach(t => {
    const row = document.createElement('div'); row.className = 'template-row';
    const text = document.createElement('div'); text.className = 'template-row-text';
    const name = document.createElement('b'); name.textContent = t.name;
    const image = document.createElement('code'); image.textContent = t.image;
    text.append(name, image);
    if (t.profile !== 'restricted') { const elevated = document.createElement('span'); elevated.className = 'badge warning'; elevated.textContent = 'Elevated'; text.append(elevated); }
    const source = document.createElement('span'); source.className = 'template-source'; source.textContent = t.builtin ? 'Built-in' : 'Custom';
    const edit = document.createElement('button'); edit.className = 'btn quiet'; edit.textContent = t.builtin ? 'Duplicate' : 'Edit'; edit.dataset.editTemplate = t.id;
    edit.onclick = () => openTemplateEditor(t, Boolean(t.builtin));
    row.append(text, source, edit); list.append(row);
  });
}
function openTemplateEditor(t = null, duplicate = false) {
  draftTemplateID = t && !duplicate ? t.id : null;
  $('template-editor-title').textContent = duplicate ? 'Duplicate template' : t ? 'Edit template' : 'New template';
  $('template-name').value = t ? t.name + (duplicate ? ' copy' : '') : '';
  $('template-image').value = t?.image ?? '';
  $('template-command').value = JSON.stringify(t?.command ?? ['sh']);
  $('template-profile').value = t?.profile ?? 'restricted';
  $('template-pull').value = t?.pull ?? 'IfNotPresent';
  $('template-env').value = JSON.stringify(t?.env ?? {});
  $('template-error').textContent = '';
  $('template-customize').open = false;
  $('template-save-warning').hidden = $('template-profile').value === 'restricted';
  $('settings').close();
  $('template-editor').showModal();
}
function openSettings() {
  hideMenu(); $('saved').textContent = ''; loadDefault(); renderSettingsTemplates(); $('settings').showModal();
}
$('preferences').onclick = openSettings;
$('scope').onchange = () => { $('saved').textContent = ''; loadDefault(); };
$('default-template').onchange = () => { $('saved').textContent = ''; showEffectiveDefault(); };
$('new-template').onclick = () => openTemplateEditor();
$('cancel-template').onclick = () => $('template-editor').close();
$('template-editor').addEventListener('close', () => $('settings').showModal());
$('template-profile').onchange = () => { $('template-save-warning').hidden = $('template-profile').value === 'restricted'; };
$('save-template').onclick = () => {
  let command, env;
  try {
    command = JSON.parse($('template-command').value); env = JSON.parse($('template-env').value);
    if (!validCommand(command) || !env || Array.isArray(env) || typeof env !== 'object' || !Object.values(env).every(x => typeof x === 'string')) throw Error();
  } catch { $('template-customize').open = true; $('template-error').textContent = 'Use a nonempty JSON string array for command and a string-valued JSON object for environment.'; return; }
  const name = $('template-name').value.trim(), image = $('template-image').value.trim();
  if (!name || !image) { $('template-error').textContent = 'Enter a template name and image.'; return; }
  if (templates.some(t => t.id !== draftTemplateID && t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { $('template-error').textContent = 'Choose a unique template name.'; return; }
  const existing = templateByID(draftTemplateID);
  const t = { id: existing?.id ?? 'custom-' + (++templateSerial), name, image, command, profile: $('template-profile').value, pull: $('template-pull').value, env, description: 'Custom toolbox', builtin: false };
  if (existing) templates[templates.indexOf(existing)] = t; else templates.push(t);
  const pendingDefault = $('default-template').value;
  loadDefault(pendingDefault); renderSettingsTemplates(); refreshMenu(); $('template-editor').close();
  $('saved').textContent = 'Template saved. Choose it as the default, or use it from the toolbar menu.';
};
$('save-default').onclick = () => {
  defaults[$('scope').value] = $('default-template').value === 'inherit' ? null : $('default-template').value;
  refreshMenu(); showEffectiveDefault(); $('saved').textContent = 'Default saved for future launches. Existing containers are unchanged.';
};
refreshMenu();

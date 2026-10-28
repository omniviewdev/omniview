'use strict';
const $ = id => document.getElementById(id);
const state = { older:false, revealed:false, pending:false, paused:false, selected:null, applied:{namespace:'payments',kinds:['Deployment','Pod'],sources:['Observed state','Events','Audit metadata'],backfill:'6',follow:true,background:true} };
// Fixture timestamps use Oct 28, 2026, 12:00 UTC as a fixed query clock.
const records = [
['11:59:42','payments-api','Deployment','Rollout complete','3 of 3 replicas available','observed','green','payments'],
['11:59:18','payments-api-7f8b6c9d4-x2mqp','Pod','Running','All containers ready (2/2)','observed','green','payments'],
['11:58:53','payments-api-7f8b6c9d4-x2mqp','Pod','ContainerCreating','Pulling image payments:v2.18.4','events','','payments'],
['11:58:41','payments-api','Deployment','Patch accepted','Actor: system:serviceaccount:ci:deployer · payload not retained','audit','','payments'],
['11:57:12','ingress-controller','Deployment','Available','2 of 2 replicas available','observed','green','platform'],
['11:56:22','payment-worker-6c9fb4d8-j7k2s','Pod','BackOff','Restarting failed container worker','events','amber','payments'],
['11:54:08','payment-worker','Deployment','Scaled up','2 → 3 replicas · horizontal-pod-autoscaler','observed','','payments'],
['11:51:30','checkout-config','ConfigMap','Updated','Actor: system:serviceaccount:ci:deployer','audit','','payments'],
['11:49:37','cert-manager-5cc8b9c7-r2d6k','Pod','Running','All containers ready (1/1)','observed','green','platform'],
['11:48:12','payments-api-68d9b7cc5-m4l8r','Pod','Deleted','Previous revision · graceful termination','observed','red','payments'],
['11:43:56','payment-worker-6c9fb4d8-j7k2s','Pod','Unhealthy','Readiness probe failed: HTTP 503','events','amber','payments'],
['11:40:21','payments-api','Deployment','Rollout started','Revision 42 · deployment-controller','events','','payments'],
['11:32:09','ledger-api','Deployment','Available','Minimum availability reached','observed','green','payments'],
['11:28:41','cluster-dns','ConfigMap','Updated','Actor: platform-admin','audit','','platform'],
['11:25:33','ledger-api-799fb5c68-z9t4n','Pod','Scheduled','Assigned to ip-10-0-24-87.eu-west-1.compute.internal','events','','payments'],
['11:12:06','payment-worker','Deployment','Updated','Actor: j.chen@example.com','audit','','payments'],
['10:58:47','payments-api-68d9b7cc5-k8q2v','Pod','Running','All containers ready (2/2)','observed','green','payments'],
['10:46:19','ledger-config','ConfigMap','Updated','Metadata only · payload unavailable','audit','','payments'],
['10:32:04','ledger-api','Deployment','Scaled down','4 → 3 replicas','observed','','payments'],
['10:24:52','ingress-controller','Deployment','Scaled up','1 → 2 replicas','observed','','platform'],
['10:18:39','payment-worker-6c9fb4d8-p3h7k','Pod','Evicted','Node had memory pressure','events','amber','payments'],
['10:02:51','payments-api','Deployment','Updated','Actor: system:serviceaccount:ci:deployer','audit','','payments'],
['09:56:20','payment-worker','Deployment','Available','All replicas healthy','observed','green','payments'],
['09:40:00','ledger-api-799fb5c68-z9t4n','Pod','Created','First locally cached observation','observed','','payments']
];
const olderRecords = [['09:12:21','payments-api','Deployment','Available','Retained API event · remote fixture','events','green','payments'],['08:42:06','payment-worker','Deployment','Updated','Actor: deploy-bot · metadata only','audit','','payments'],['07:20:18','ledger-api','Deployment','Scaled up','2 → 3 replicas · retained event','events','','payments']];
const incoming = [['12:00:06','payments-api','Deployment','Observed revision 43','New observation · simulated follow event','observed','','payments'],['12:00:02','payments-api-7f8b6c9d4-x2mqp','Pod','Ready','Readiness condition changed','observed','green','payments']];
const sourceNames = {observed:'Observed state',events:'Events',audit:'Audit metadata',denied:'EKS Authenticator'};
const escapeText = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const minute = time => +time.slice(0,2)*60 + +time.slice(3,5);
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').hidden=true,4500); }
function resourceURL(r) { return `resource.html?resource=${encodeURIComponent(r[1])}&namespace=${encodeURIComponent(r[7])}&kind=${encodeURIComponent(r[2])}&time=${encodeURIComponent(r[0])}&from=connection`; }
function render() {
 const search=$('search').value.trim().toLowerCase(), namespace=$('namespace').value, kind=$('kind').value, source=$('source').value, hours=+$('time').value;
 let rows=[...(state.revealed?incoming:[]),...records,...(state.older?olderRecords:[])];
 rows=rows.filter(r => minute(r[0])>=720-hours*60 && (namespace==='all'||r[7]===namespace) && (kind==='all'||r[2]===kind) && (source==='all'||r[5]===source) && (!search||r.join(' ').toLowerCase().includes(search)) && ($('scope').value!=='resource'||r[1]==='payments-api'&&r[2]==='Deployment'));
 $('result-count').textContent=`${rows.length} changes`;
 $('result-description').textContent=state.older?'Newest first · cache + fetched fixtures':'Newest first · local cache';
 const chips=[];
 if(namespace!=='all') chips.push(['namespace',`namespace: ${namespace}`]);
 if(kind!=='all') chips.push(['kind',`kind: ${kind}`]);
 if(source!=='all') chips.push(['source',`source: ${sourceNames[source]}`]);
 if(search) chips.push(['search',`search: ${$('search').value}`]);
 $('chips').hidden=!chips.length;
 $('chips').innerHTML=chips.map(([id,text])=>`<span class="chip">${escapeText(text)}<button data-remove="${id}" aria-label="Remove ${escapeText(text)} filter">×</button></span>`).join('');
 $('filters-toggle').textContent=`Filters${chips.filter(c=>c[0]!=='search').length?` (${chips.filter(c=>c[0]!=='search').length})`:''}`;
 $('results').innerHTML=`<table class="event-table"><thead><tr><th>Time UTC</th><th>Resource / namespace</th><th>Change / context</th><th>Source</th></tr></thead><tbody>${rows.map(r=>{const id=[...records,...olderRecords,...incoming].indexOf(r);return `<tr tabindex="0" data-row="${id}" class="${state.selected===id?'selected':''}" aria-label="Inspect ${escapeText(r[1])} ${escapeText(r[3])}"><td><time>${r[0]}</time></td><td>${r[1]==='payments-api'&&r[2]==='Deployment'?`<a class="resource-name" href="${resourceURL(r)}">${escapeText(r[1])} ↗</a>`:`<span class="resource-name">${escapeText(r[1])}</span>`}<div class="resource-meta">${r[2]} · ${r[7]}</div></td><td><div class="event-reason ${r[6]}">${escapeText(r[3])}</div><div class="context" title="${escapeText(r[4])}">${escapeText(r[4])}</div></td><td class="source-label">${sourceNames[r[5]]}<small>${r[5]==='audit'?'Metadata only':r[5]==='events'?'Retained event':'Observed snapshot'}</small></td></tr>`;}).join('')}</tbody></table>${rows.length?'':`<div class="empty-state">${source==='denied'?'Permission denied · EKS Authenticator was not read. Coverage unknown.':'No matching prepared records. Missing coverage does not mean no changes.'}</div>`}`;
 const start=hours===1?'11:00':hours===24?'Oct 27, 12:00':'06:00';
 $('coverage-text').textContent=`Cached ${hours===1?'11:00':'09:40'}–12:00 UTC`;
 $('gap').textContent=hours===1?'Partial source fidelity':state.older?'Older fixtures fetched · retention gaps remain':`Partial · ${start}–09:40 not fetched`;
 $('older').disabled=state.older||hours===1||source==='denied';
 $('older').textContent=state.older?'Available older fixtures fetched':hours===1?'Selected hour cached':`Fetch older · ${start}–09:40`;
 $('new-events').hidden=!state.pending;
}
function inspect(id) {
 state.selected=id; const r=[...records,...olderRecords,...incoming][id];
 $('detail').hidden=false;
 const fidelity=r[5]==='audit'?'Audit metadata retains actor, timestamp and resource reference. Object payload and field diff are unavailable.':r[5]==='events'?'Retained Kubernetes event. Provider retention may omit earlier events; this is not a full state diff.':'Observed Kubernetes object state. Intermediate changes between observations may be missing.';
 $('detail-content').innerHTML=`<h3>${escapeText(r[3])}</h3><dl><dt>Resource</dt><dd>${escapeText(r[2])} / ${escapeText(r[1])}</dd><dt>Recorded time</dt><dd>Oct 28, 2026 · ${r[0]} UTC</dd><dt>Namespace</dt><dd>${r[7]}</dd><dt>Context</dt><dd>${escapeText(r[4])}</dd><dt>Source fidelity</dt><dd>${fidelity}</dd></dl>${r[1]==='payments-api'&&r[2]==='Deployment'?`<a class="btn" href="${resourceURL(r)}">Open resource history ↗</a>`:'<p class="muted">Resource page not included in this prototype. Recorded context remains available if resource no longer exists.</p>'}`;
 const scroll=$('results').scrollTop;render();$('results').scrollTop=scroll;
}
$('results').addEventListener('click',e=>{if(e.target.closest('a'))return;const row=e.target.closest('[data-row]');if(row)inspect(+row.dataset.row);});
$('results').addEventListener('keydown',e=>{if(e.target.closest('a'))return;if(e.key==='Enter'||e.key===' '){const row=e.target.closest('[data-row]');if(row){e.preventDefault();inspect(+row.dataset.row);}}});
function closeDetail(){state.selected=null;$('detail').hidden=true;const scroll=$('results').scrollTop;render();$('results').scrollTop=scroll;}
$('close-detail').addEventListener('click',closeDetail);
['namespace','kind','source','time','scope'].forEach(id=>$(id).addEventListener('change',()=>{closeDetail();render();}));
$('search').addEventListener('input',render);
$('chips').addEventListener('click',e=>{const id=e.target.dataset.remove;if(id){$(id).value=id==='search'?'':'all';render();}});
$('reset').addEventListener('click',()=>{['namespace','kind','source'].forEach(id=>$(id).value='all');$('search').value='';render();});
[['filters-toggle','filters'],['activity-toggle','activity']].forEach(([button,panel])=>$(button).addEventListener('click',()=>{const open=$(panel).hidden;$(panel).hidden=!open;$(button).setAttribute('aria-expanded',String(open));}));
$('history-nav').addEventListener('click',()=>{$('scope').value='plugin';render();});
$('older').addEventListener('click',()=>{state.older=true;render();histogram();$('fetch-note').textContent='3 retained fixture records appended. Other intervals remain unknown; no sync scope change.';toast('Scoped older retrieval simulated. No network requests.');});
$('simulate').addEventListener('click',()=>{if(state.paused||!state.applied.follow){toast('Follow paused or disabled. Resume and enable follow to receive changes.');return;}if(state.revealed){toast('Prepared incoming fixture already shown.');return;}state.pending=true;render();});
$('new-events').addEventListener('click',()=>{const scroll=$('results').scrollTop;state.pending=false;state.revealed=true;render();$('results').scrollTop=scroll;toast('2 prepared changes added. Scroll position preserved. Active query filters still apply.');});
function histogram(){const values=[8,16,10,22,15,34,19,13,27,18,31,46,26,35,17,30,45,25,38,51,36,54,33,49,63,45,31,56,39,48,62,53,42,60,44,35];$('histogram').innerHTML=values.map((height,index)=>`<button class="${index<22?'uncached':''}" style="height:${height}px" title="${index<22?'Missing continuous coverage; older retrieval adds retained fixtures only':'Prepared activity bucket'}" aria-label="${6+Math.floor(index/6)}:${String(index%6*10).padStart(2,'0')} UTC · ${index<22?'missing continuous coverage':'prepared activity'}"></button>`).join('');}
$('histogram').addEventListener('click',()=>toast('Prepared activity summary only. Hatched intervals have missing continuous coverage, not zero activity.'));
function draft(){return{namespace:$('draft-namespace').value,kinds:[...document.querySelectorAll('[name=draft-kind]:checked')].map(el=>el.value),sources:[...document.querySelectorAll('[name=draft-source]:checked')].map(el=>el.value),backfill:$('backfill').value,follow:$('follow').checked,background:$('background').checked};}
function draftChanged(){const d=draft(),dirty=JSON.stringify(d)!==JSON.stringify(state.applied),valid=d.kinds.length&&d.sources.length; $('draft-state').textContent=dirty?'Unapplied draft':'No unapplied changes';$('apply').disabled=!dirty||!valid;$('discard').disabled=!dirty;const factor=d.kinds.length*d.sources.length*d.namespace.split(',').length*(+d.backfill/6);$('estimate').textContent=`~${Math.round(factor*20)}–${Math.round(factor*60)} requests · ~${Math.round(factor*2/3)}–${Math.round(factor*2)} MB`;$('apply-message').textContent=valid?'Draft edits never start reads until applied.':'Select at least one kind and one source family.';}
function discard(){const d=state.applied;$('draft-namespace').value=d.namespace;$('backfill').value=d.backfill;$('follow').checked=d.follow;$('background').checked=d.background;document.querySelectorAll('[name=draft-kind]').forEach(el=>el.checked=d.kinds.includes(el.value));document.querySelectorAll('[name=draft-source]').forEach(el=>el.checked=d.sources.includes(el.value));draftChanged();}
document.querySelectorAll('#sync-dialog input:not(:disabled),#sync-dialog select').forEach(el=>el.addEventListener('change',draftChanged));
$('discard').addEventListener('click',discard);
$('manage-sync').addEventListener('click',()=>$('sync-dialog').showModal());
$('close-sync').addEventListener('click',()=>{$('sync-dialog').close();if(JSON.stringify(draft())!==JSON.stringify(state.applied))toast('Draft retained, not applied. Reopen Manage sync to apply or discard.');});
$('sync-dialog').addEventListener('cancel',()=>{if(JSON.stringify(draft())!==JSON.stringify(state.applied))toast('Draft retained, not applied.');});
function syncStatus(){const label=state.paused?'Paused':state.applied.follow?'Following':'Backfill only';$('sync-state').textContent=label;$('sync-state').className=`badge ${state.paused?'warning':'success'}`;$('follow-state').innerHTML=state.paused?'Paused · checkpoint retained':state.applied.follow?'<i class="dot live"></i> Following · 18s behind':'Follow disabled';$('pause').textContent=state.paused?'Resume':'Pause';}
$('apply').addEventListener('click',()=>{state.applied=draft();$('applied-scope').textContent=`${state.applied.namespace} · ${state.applied.kinds.join(', ')}`;$('applied-sources').textContent=state.applied.sources.join(' · ');$('backfill-state').textContent=`Finite ${state.applied.backfill}h backfill queued${state.paused?' · paused':''} · no whole-cluster indexing`;draftChanged();syncStatus();$('apply-message').textContent='Applied locally. Prepared backfill queued; no network requests.';toast('Selective sync scope applied. Query scope unchanged.');});
$('pause').addEventListener('click',()=>{state.paused=!state.paused;syncStatus();toast(state.paused?'Sync paused. Cached records and checkpoint retained.':'Sync resumed within applied scope.');});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!$('sync-dialog').open){e.preventDefault();$('search').focus();}if(e.key==='Escape'&&!$('sync-dialog').open&&!$('detail').hidden)closeDetail();});
histogram();render();draftChanged();

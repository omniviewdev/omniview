'use strict';
const $ = id => document.getElementById(id);
const icon = (kind='success') => `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7"/>${kind==='warning'?'<path d="M10 5v6m0 2v1"/>':kind==='audit'?'<path d="m6 10 3 3 5-6"/>':'<path d="M6 10h8m-4-4v8"/>'}</svg>`;
const records = [
 {id:'h19',time:'10:19:12',title:'Deployment available',desc:'All 3 replicas ready on payments-api:2.8.3.',source:'state',actor:'unknown',family:'health',outcome:'success',version:'982174',note:'Observed readyReplicas changing from 1 to 3. No actor attribution is present in a watch observation.',diff:'health'},
 {id:'h17',time:'10:17:43',title:'Rollback to image 2.8.3',desc:'maya.chen patched the container image after a failed rollout.',source:'audit',actor:'maya',family:'image',outcome:'success',version:'982101',note:'Successful patch request recorded by the Kubernetes audit backend. The request body contains the image field; snapshots show the observed effect.',diff:'image'},
 {id:'h16',time:'10:16:58',title:'Rollout exceeded progress deadline',desc:'Deployment did not make progress within 600 seconds.',source:'event',actor:'unknown',family:'image',outcome:'warning',version:'982074',note:'Kubernetes Event: ProgressDeadlineExceeded. The reporting controller is not the actor who initiated the deployment.',reason:'ProgressDeadlineExceeded'},
 {id:'h13',time:'10:13:21',title:'Only 1 of 3 replicas available',desc:'Observed unavailableReplicas: 2 after image update.',source:'state',actor:'unknown',family:'health',outcome:'warning',version:'981982',note:'Local watch observation. This shows resource state, not an API request or a causal link.',diff:'health'},
 {id:'h08',time:'10:06:04',title:'Image updated to 2.9.0',desc:'argocd controller applied the desired image from Git.',source:'audit',actor:'argocd',family:'image',outcome:'success',version:'981801',note:'Audit patch succeeded. Adjacent local snapshots show the image change; they are not atomic before/after request bodies.',diff:'forward'},
 {id:'h06',time:'10:06:11',title:'New ReplicaSet scaled up',desc:'Scaled payments-api-7b6f9c8d4 to 3 replicas.',source:'event',actor:'unknown',family:'image',outcome:'success',version:'981752',note:'Kubernetes Event reported by deployment-controller. Actor unknown; the reporter is a system component.',reason:'ScalingReplicaSet'},
 {id:'h01',time:'10:01:36',title:'Patch request denied',desc:'maya.chen could not patch deployments in payments.',source:'audit',actor:'maya',family:'access',outcome:'denied',version:'—',note:'Metadata-only audit record, response code 403. Request and response objects were not retained. No resource change can be inferred.',late:true,received:'10:12:09',reason:'Forbidden'},
 {id:'h55',time:'09:55:08',title:'Baseline image observed: 2.8.3',desc:'3 ready replicas; deployment revision 41.',source:'state',actor:'unknown',family:'health',outcome:'success',version:'981403',note:'First retained healthy snapshot for this view. Earlier changes may not be available.'}
];
const olderRecords=[{id:'h48',time:'09:48:20',title:'Deployment became available',desc:'3 of 3 replicas available on image 2.8.3.',source:'event',actor:'unknown',family:'health',outcome:'success',version:'981104',reason:'Available',note:'Retained Kubernetes Event. Audit collection had not started; no actor information is available.'},{id:'h42',time:'09:42:03',title:'Local collection started',desc:'Initial state observed; earlier resource history is unknown.',source:'state',actor:'unknown',family:'health',outcome:'success',version:'980991',note:'Initial list snapshot, not a creation event. This resource existed before local collection began.'}];
const sources={audit:'Audit',event:'Kubernetes Event',state:'State observation'};
const actors={maya:'maya.chen',argocd:'system:serviceaccount:argocd:argocd-application-controller',unknown:'Unknown actor'};
let loaded=false, selected=null, mode='summary', bin=null, following=true, streamAdded=false;
const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
const all=()=>[...records,...(loaded?olderRecords:[])].sort((a,b)=>b.time.localeCompare(a.time));
function matches(r,ignoreBin=false){const q=$('history-search').value.toLowerCase();return (!q||[r.title,r.desc,actors[r.actor],sources[r.source],r.note].join(' ').toLowerCase().includes(q))&&['actor','outcome','family','source'].every(k=>$(k).value==='all'||r[k]===$(k).value)&&($('range').value!=='15'||minutes(r.time)>=605)&&($('range').value!=='hour'||minutes(r.time)>=560)&&(ignoreBin||bin===null||Math.floor((minutes(r.time)-560)/5)===bin);}
function renderInventory(){const names=['billing-worker','checkout-api','fraud-detector','invoice-scheduler','payments-api','payments-webhook','payout-worker','reconciliation','refund-worker','risk-engine','settlement-api','transaction-router'];const q=$('resource-search').value.toLowerCase();const shown=names.filter(n=>n.includes(q));$('inventory-list').innerHTML=shown.length?shown.map(n=>`<div class="inventory-row ${n==='payments-api'?'selected':''}" ${n==='payments-api'?'aria-current="true"':''}><span>${n}</span><span class="ready">${n==='invoice-scheduler'?'1/1':'3/3'}</span></div>`).join(''):'<p class="muted small">No deployments match.</p>';}
function renderHistogram(){const eligible=all().filter(r=>matches(r,true));$('bins').innerHTML=Array.from({length:12},(_,i)=>{const counts=['audit','event','state'].map(s=>eligible.filter(r=>r.source===s&&Math.floor((minutes(r.time)-560)/5)===i).length);const start=560+i*5;const t=`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`;return `<button class="bin ${i<4?'uncovered':''} ${bin===i?'selected':''}" data-bin="${i}" aria-label="${t} UTC, ${counts.reduce((a,b)=>a+b,0)} loaded records${i<4?', no local coverage':''}" aria-pressed="${bin===i}" title="${t}–${String(Math.floor((start+5)/60)).padStart(2,'0')}:${String((start+5)%60).padStart(2,'0')} UTC"><span style="height:${counts[0]*12}px"></span><span class="event" style="height:${counts[1]*12}px"></span><span class="state" style="height:${counts[2]*12}px"></span></button>`;}).join('');$('clear-bin').hidden=bin===null;}
function render(){
 const visible=all().filter(r=>matches(r));
 if(selected&&!visible.some(r=>r.id===selected))selected=null;
 $('record-inspector').hidden=!selected;
 $('result-count').textContent=`${visible.length} records · ${all().length} loaded${bin!==null?' · 5-minute selection':''}`;
 $('timeline').innerHTML=visible.length?visible.map(r=>`<button class="timeline-record ${r.id===selected?'selected':''}" data-record="${r.id}" aria-pressed="${r.id===selected}"><span class="timestamp">${r.time.slice(0,5)}<small>:${r.time.slice(-2)} UTC</small></span><span class="indicator ${r.outcome==='warning'||r.outcome==='denied'?'warning':r.source==='audit'?'':'success'}">${icon(r.outcome==='warning'||r.outcome==='denied'?'warning':r.source)}</span><span class="record-content"><span class="record-title">${r.title}</span><span class="record-desc">${r.desc}</span><span class="record-meta"><span class="source-tag">${sources[r.source]}</span><span>${r.actor==='unknown'?'Actor unknown':r.actor==='maya'?'maya.chen':'argocd controller'}</span>${r.late?'<span class="late">Late arrival +10m</span>':''}</span></span></button>`).join(''):'<div class="empty-state"><strong>No matching records</strong>Try a wider time range or clear filters.<br><button class="btn" id="empty-reset">Clear filters</button></div>';
 $('older').disabled=loaded;
 $('older').textContent=loaded?'All retained records loaded':'↓ Fetch older local records';
 const active=['actor','outcome','family','source'].filter(k=>$(k).value!=='all');
 $('filters-toggle').textContent=`Filters${active.length?' ('+active.length+')':''}`;
 $('active-filters').innerHTML=active.map(k=>`<button class="filter-chip" data-clear="${k}" aria-label="Remove ${k} filter">${$(k).selectedOptions[0].textContent} ×</button>`).join('')+(bin!==null?'<button class="filter-chip" data-clear="time">5-minute window ×</button>':'');
 renderHistogram();renderInspector();
}
function esc(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
function renderInspector(){const r=all().find(r=>r.id===selected);document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-selected',b.dataset.mode===mode);});if(!r){$('record-source').textContent='No selection';$('inspector-content').innerHTML='<div class="empty-state">Select a record to inspect its evidence.</div>';return;}$('record-source').textContent=sources[r.source];const head=`<div class="detail-kicker">28 OCT 2026 · ${r.time} UTC</div><h3 class="detail-title">${r.title}</h3>`;let content='';if(mode==='summary'){content=`<p class="detail-description">${r.note}</p><dl class="detail-grid"><dt>Resource</dt><dd>Deployment / payments-api</dd><dt>Namespace</dt><dd>payments</dd><dt>Actor</dt><dd>${actors[r.actor]}</dd><dt>Source</dt><dd>${sources[r.source]}</dd><dt>Outcome</dt><dd>${r.outcome==='denied'?'Denied · HTTP 403':r.outcome==='warning'?'Warning':r.source==='audit'?'Success · HTTP 200':'Observed'}</dd><dt>Observed at</dt><dd>${r.time} UTC</dd><dt>Received at</dt><dd>${r.received||r.time} UTC${r.late?' · late arrival':''}</dd><dt>Resource ver.</dt><dd class="mono">${r.version}</dd></dl>`;if(r.diff==='image'||r.diff==='forward'){const rollback=r.diff==='image';content+=`<h4 class="detail-section">Observed image change</h4><div class="change-line"><code>payments-api:${rollback?'2.9.0':'2.8.3'}</code><span class="muted">→</span><code>payments-api:${rollback?'2.8.3':'2.9.0'}</code></div><div class="fidelity"><strong>Adjacent observed snapshots</strong>Compared resource versions ${rollback?'982074 → 982101':'981752 → 981801'}. Other writes may exist between snapshots. This is not an exact audit-request diff.</div>`;}else content+=`<div class="fidelity"><strong>${r.source==='audit'?'Metadata-only evidence':r.source==='event'?'Event evidence, not a state diff':'Observed state, not actor evidence'}</strong>${r.source==='audit'?'No request or response body was retained. This record cannot reconstruct a change.':r.source==='event'?'An Event reports controller activity. It does not prove who changed the resource.':'A local observation records what was seen. It does not identify who made the change.'}</div>`;content+='<a class="detail-link" href="connection.html">Inspect source coverage on this connection ↗</a>';}else if(mode==='diff'){if(r.diff){const health=r.diff==='health';const before=r.diff==='forward'?'2.8.3':'2.9.0',after=r.diff==='forward'?'2.9.0':'2.8.3';content=`<div class="fidelity"><strong>Observed snapshot comparison · partial fidelity</strong>${health?'Only the observed readiness field is shown.':'Focused on the container image field.'} Not an exact request diff. Unobserved intermediate writes are possible.</div><div class="code-label"><span>apps/v1 · Deployment</span><span>Focused YAML</span></div><pre><span class="diff-context"> ${health?'status:':'spec:\n   template:\n     spec:\n       containers:\n         - name: payments-api'}</span><span class="diff-remove">- ${health?`readyReplicas: ${r.id==='h13'?3:1}`:`          image: registry.acme.io/payments-api:${before}`}</span><span class="diff-add">+ ${health?`readyReplicas: ${r.id==='h13'?1:3}`:`          image: registry.acme.io/payments-api:${after}`}</span></pre><p class="detail-description" style="margin-top:12px">${health?'Readiness values are local observations, not a patch request.':'Comparison excludes unchanged fields. Managed fields and secret values are not shown.'}</p>`;}else content=`<div class="no-diff">${icon('warning')}<h3>Comparison unavailable</h3><p>${r.source==='audit'?'This audit record contains metadata only. Neither a request body nor a paired state snapshot is available.':r.source==='event'?'Kubernetes Events contain messages, not before-and-after resource manifests.':'No earlier retained snapshot is available for this observation.'}</p><p>No change has been inferred or reconstructed.</p><button class="btn" data-switch-summary>Back to summary</button></div>`;}else{const raw={kind:r.source==='audit'?'AuditEvent':r.source==='event'?'Event':'LocalStateObservation',apiVersion:r.source==='audit'?'audit.k8s.io/v1':r.source==='event'?'v1':'local.omniview.dev/v1',timestamp:`2026-10-28T${r.time}Z`,receivedAt:`2026-10-28T${r.received||r.time}Z`,objectRef:{resource:'deployments',namespace:'payments',name:'payments-api',uid:'d4bc6f09-31a2-4b8f-9ea2-3a01c9b27e11'},...(r.source==='audit'?{verb:'patch',user:{username:actors[r.actor]},responseStatus:{code:r.outcome==='denied'?403:200},level:r.diff?'Request':'Metadata',...(r.diff?{requestObject:{spec:{template:{spec:{containers:[{name:'payments-api',image:`registry.acme.io/payments-api:${r.diff==='image'?'2.8.3':'2.9.0'}`}]}}}}}:{})}:r.source==='event'?{reason:r.reason,type:r.outcome==='warning'?'Warning':'Normal',reportingController:'deployment-controller',message:r.desc}:{resourceVersion:r.version,observation:r.desc,actor:null})};content=`<p class="detail-description">Retained ${sources[r.source].toLowerCase()} payload · simulated data. Missing fields were not retained.</p><pre>${esc(JSON.stringify(raw,null,2))}</pre>`;}$('inspector-content').innerHTML=head+content;}
function reset(){['actor','outcome','family','source'].forEach(k=>$(k).value='all');$('history-search').value='';$('range').value='hour';bin=null;render();}
['actor','outcome','family','source','range'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='range')bin=null;render();}));
$('history-search').addEventListener('input',render);
$('resource-search').addEventListener('input',renderInventory);
$('reset').addEventListener('click',reset);
$('clear-bin').addEventListener('click',()=>{bin=null;render();});
$('bins').addEventListener('click',e=>{const b=e.target.closest('[data-bin]');if(b){const n=Number(b.dataset.bin);bin=bin===n?null:n;render();}});
$('timeline').addEventListener('click',e=>{const b=e.target.closest('[data-record]');if(b){selected=b.dataset.record;mode='summary';render();}if(e.target.closest('#empty-reset'))reset();});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;renderInspector();}));
$('inspector-content').addEventListener('click',e=>{if(e.target.closest('[data-switch-summary]')){mode='summary';renderInspector();}});
$('older').addEventListener('click',()=>{loaded=true;render();});
$('follow').addEventListener('click',()=>{
 following=!following;
 $('follow').setAttribute('aria-pressed',following);
 $('follow').classList.toggle('primary',following);
 $('follow').innerHTML=following?'<span class="dot live"></span> Following':'▶ Resume follow';
 $('follow-note').textContent=following?'Following · mock stream':'Paused · no new records';
 if(following&&!streamAdded){
  streamAdded=true;
  records.unshift({id:'h20',time:'10:20:00',title:'Healthy state confirmed',desc:'3 ready replicas remain on image 2.8.3.',source:'state',actor:'unknown',family:'health',outcome:'success',version:'982220',note:'Deterministic simulated observation received when following resumes. No new API write or actor is implied.'});
  render();
 }
});
const requestedTime = new URLSearchParams(location.search).get('time');
if (requestedTime && /^\d{2}:\d{2}:\d{2}$/.test(requestedTime)) {
  selected = records.reduce((best, record) => Math.abs(minutes(record.time) - minutes(requestedTime)) < Math.abs(minutes(best.time) - minutes(requestedTime)) ? record : best).id;
}
renderInventory();render();
function setExpanded(expanded){
 document.body.classList.toggle('expanded',expanded);
 $('expand-history').setAttribute('aria-pressed',expanded);
 $('expand-history').textContent=expanded?'↙ Restore drawer':'Expand history ↗';
 const url=new URL(location.href);
 if(expanded)url.searchParams.set('expanded','1');else url.searchParams.delete('expanded');
 history.replaceState(null,'',url);
}
$('expand-history').addEventListener('click',()=>setExpanded(!document.body.classList.contains('expanded')));
$('close-inspector').addEventListener('click',()=>{selected=null;render();});
$('filters-toggle').addEventListener('click',()=>{
 const open=$('advanced-filters').hidden;
 $('advanced-filters').hidden=!open;
 $('filters-toggle').setAttribute('aria-expanded',open);
});
$('activity-toggle').addEventListener('click',()=>{
 const open=$('activity-chart').hidden;
 $('activity-chart').hidden=!open;
 $('activity-toggle').setAttribute('aria-expanded',open);
 $('activity-toggle').textContent=open?'Activity ▴':'Activity ▾';
});
$('active-filters').addEventListener('click',e=>{
 const target=e.target.closest('[data-clear]');if(!target)return;
 if(target.dataset.clear==='time')bin=null;else $(target.dataset.clear).value='all';
 render();
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){
  selected=null;$('advanced-filters').hidden=true;$('filters-toggle').setAttribute('aria-expanded','false');render();
 }
});
setExpanded(new URLSearchParams(location.search).get('expanded')==='1');

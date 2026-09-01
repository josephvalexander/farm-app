// V-Plantations · drive.js — Google Drive API, OAuth, sync, merge, backups

// ── GOOGLE DRIVE ──────────────────────────────────────────────────────────────
function getClientId(){return cfg.clientId||CID_PH;}

// ── OAUTH TOKEN — persisted in sessionStorage for up to 30 mins ──────────────
// sessionStorage survives page refreshes within the same tab session.
// Token is valid for 1hr; we cache for 30min to be conservative.
const TOKEN_SS_KEY='vp_oauth_token';
const TOKEN_TTL=30*60*1000; // 30 minutes

function loadCachedToken(){
  try{
    const raw=sessionStorage.getItem(TOKEN_SS_KEY);
    if(!raw)return null;
    const {token,expiry}=JSON.parse(raw);
    if(Date.now()<expiry)return token;
    sessionStorage.removeItem(TOKEN_SS_KEY); // expired — clear it
    return null;
  }catch(e){return null;}
}
function saveTokenToSession(token){
  try{
    sessionStorage.setItem(TOKEN_SS_KEY,JSON.stringify({token,expiry:Date.now()+TOKEN_TTL}));
  }catch(e){}
}
function clearCachedToken(){
  try{sessionStorage.removeItem(TOKEN_SS_KEY);}catch(e){}
  S.oauthToken=null;
}

// Wait for the Google GSI script to finish loading (up to 8s)
function waitForGoogle(){
  return new Promise((res,rej)=>{
    if(typeof google!=='undefined'&&google.accounts){res();return;}
    let attempts=0;
    const t=setInterval(()=>{
      attempts++;
      if(typeof google!=='undefined'&&google.accounts){clearInterval(t);res();}
      else if(attempts>60){clearInterval(t);rej(new Error('Google API unavailable'));} // 60×200ms=12s
    },200);
  });
}

async function getOAuthToken(){
  // 1. In-memory (fastest — same JS session)
  if(S.oauthToken)return S.oauthToken;
  // 2. sessionStorage (survives refresh, same tab, up to 55 min)
  const cached=loadCachedToken();
  if(cached){S.oauthToken=cached;return cached;}
  // 3. Wait for Google API to load (handles slow iOS load), then request token
  await waitForGoogle();
  return new Promise((res,rej)=>{
    const hint=cfg.googleAccountHint||'';
    const client=google.accounts.oauth2.initTokenClient({
      client_id:getClientId(),
      scope:SCOPES,
      login_hint:hint||undefined,
      callback:(r)=>{
        if(r.error){rej(new Error(r.error));return;}
        S.oauthToken=r.access_token;
        saveTokenToSession(r.access_token); // persist across refreshes
        // Store account hint on first auth
        if(!cfg.googleAccountHint){
          fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${r.access_token}`)
            .then(x=>x.json()).then(d=>{if(d.email){cfg.googleAccountHint=d.email;saveCfg();}})
            .catch(()=>{});
        }
        res(r.access_token);
      }
    });
    client.requestAccessToken(hint?{}:{prompt:'select_account'});
  });
}

// Call this to force sign-out and re-pick account
function disconnectGoogle(){
  clearCachedToken();
  cfg.googleAccountHint=null;
  saveCfg();
  if(typeof google!=='undefined'&&google.accounts?.oauth2)
    google.accounts.oauth2.revoke(cfg.googleAccountHint||'',()=>{});
  showToast('Disconnected — next sync will ask for account');
}
async function driveFetch(path,opts={}){
  const tok=await getOAuthToken();
  return fetch('https://www.googleapis.com/'+path,{...opts,headers:{Authorization:'Bearer '+tok,...(opts.headers||{})}});
}
async function findFile(){
  const folder=cfg.sharedFolderId;
  const q=folder
    ?`name='${DRIVE_FILE}' and '${folder}' in parents and trashed=false`
    :`name='${DRIVE_FILE}' and trashed=false`;
  const spaces=folder?'drive':'appDataFolder';
  const r=await driveFetch(`drive/v3/files?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id)`);
  const d=await r.json();return d.files?.[0]||null;
}
async function readFile(id){return(await driveFetch(`drive/v3/files/${id}?alt=media`)).text();}
async function writeFile(id,content){
  const parents=id?undefined:(cfg.sharedFolderId?[cfg.sharedFolderId]:['appDataFolder']);
  const meta={name:DRIVE_FILE,parents};
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
  form.append('file',new Blob([content],{type:'text/plain'}));
  return(await driveFetch(id?`upload/drive/v3/files/${id}?uploadType=multipart`:`upload/drive/v3/files?uploadType=multipart`,{method:id?'PATCH':'POST',body:form})).json();
}

// ── SYNC ──────────────────────────────────────────────────────────────────────
async function findNamedFile(name){
  const folder=cfg.sharedFolderId;
  const q=folder
    ?`name='${name}' and '${folder}' in parents and trashed=false`
    :`name='${name}' and trashed=false`;
  const spaces=folder?'drive':'appDataFolder';
  const r=await driveFetch(`drive/v3/files?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`);
  const d=await r.json();
  const files=d.files||[];
  // Auto-delete duplicates — keep most recent, delete the rest silently
  if(files.length>1){
    const toDelete=files.slice(1);
    toDelete.forEach(f=>driveFetch(`drive/v3/files/${f.id}`,{method:'DELETE'}).catch(()=>{}));
    console.log(`[Drive] Cleaned up ${toDelete.length} duplicate(s) of "${name}"`);
  }
  return files[0]||null;
}

// Delete ALL files with a given name (for thorough cleanup)
async function deleteAllNamed(name){
  const folder=cfg.sharedFolderId;
  const q=folder
    ?`name='${name}' and '${folder}' in parents and trashed=false`
    :`name='${name}' and trashed=false`;
  const spaces=folder?'drive':'appDataFolder';
  const r=await driveFetch(`drive/v3/files?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id,name)`);
  const d=await r.json();
  const files=d.files||[];
  await Promise.all(files.map(f=>driveFetch(`drive/v3/files/${f.id}`,{method:'DELETE'}).catch(()=>{})));
  return files.length;
}

// Full Drive cleanup — remove all duplicates of known files
async function cleanupDrive(){
  const allFiles=[...BACKUP_FILES, DRIVE_FILE, KEYS_DRIVE_FILE, INSIGHTS_DRIVE_FILE];
  let totalCleaned=0;
  for(const name of allFiles){
    const folder=cfg.sharedFolderId;
    const q=folder
      ?`name='${name}' and '${folder}' in parents and trashed=false`
      :`name='${name}' and trashed=false`;
    const spaces=folder?'drive':'appDataFolder';
    const r=await driveFetch(`drive/v3/files?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`);
    const d=await r.json();
    const files=d.files||[];
    if(files.length>1){
      const toDelete=files.slice(1);
      await Promise.all(toDelete.map(f=>driveFetch(`drive/v3/files/${f.id}`,{method:'DELETE'}).catch(()=>{})));
      totalCleaned+=toDelete.length;
    }
  }
  return totalCleaned;
}

async function rotateBackups(currentRaw){
  // Rotate: bak2→bak3, bak1→bak2, current→bak1
  try{
    const [f1,f2,f3]=await Promise.all(BACKUP_FILES.map(n=>findNamedFile(n)));
    // bak2 → bak3
    if(f2){const c=await readFile(f2.id);if(f3)await writeFile(f3.id,c);else await writeNamedFile(null,BACKUP_FILES[2],c);}
    // bak1 → bak2
    if(f1){const c=await readFile(f1.id);if(f2)await writeFile(f2.id,c);else await writeNamedFile(null,BACKUP_FILES[1],c);}
    // current → bak1
    if(f1)await writeFile(f1.id,currentRaw);
    else await writeNamedFile(null,BACKUP_FILES[0],currentRaw);
  }catch(e){console.warn('Backup rotation failed (non-fatal):',e);}
}

async function writeNamedFile(id,name,content){
  const parents=id?undefined:(cfg.sharedFolderId?[cfg.sharedFolderId]:['appDataFolder']);
  const meta={name,parents};
  const form=new FormData();
  form.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
  form.append('file',new Blob([content],{type:'text/plain'}));
  return(await driveFetch(id?`upload/drive/v3/files/${id}?uploadType=multipart`:`upload/drive/v3/files?uploadType=multipart`,{method:id?'PATCH':'POST',body:form})).json();
}

// In-memory sync lock — prevents any concurrent syncs within the same session
let _syncInFlight=false;
let _lastSyncAttempt=0;

async function triggerSync(manual=false){
  // Hard lock — only one sync at a time, ever
  if(_syncInFlight){console.log('[Sync] Blocked — sync already in flight');return;}
  // Rate limit — no auto-sync within 60s of last attempt
  if(!manual&&Date.now()-_lastSyncAttempt<60000){console.log('[Sync] Blocked — too soon');return;}
  if(!navigator.onLine){if(manual){setSyncUI('err','Offline');setTimeout(()=>setSyncUI('idle','Sync'),2000);}S.pendingSync=true;return;}
  if(!cfg.passphrase){if(manual)showPassphraseSetup();return;}
  if(!getClientId()||getClientId()===CID_PH){if(manual)showClientIdSetup();return;}
  if(!manual&&!S.oauthToken&&!loadCachedToken()){return;}
  _syncInFlight=true;
  _lastSyncAttempt=Date.now();
  S.syncing=true;S.pendingSync=false;setSyncUI('syncing','Syncing…');
  const syncTimeout=setTimeout(()=>{
    if(S.syncing){_syncInFlight=false;S.syncing=false;setSyncUI('err','Timed out — tap Sync to retry');setTimeout(()=>setSyncUI('idle','Sync'),4000);}
  },35000);
  try{
    await getOAuthToken();

    // ── FIND FILE ─────────────────────────────────────────────────────────────
    // Key insight: Drive search has eventual consistency — newly created files
    // may not appear in search results for several seconds, causing duplicate creation.
    // Fix: use a localStorage creation mutex + verify by ID before searching.
    const CREATION_LOCK_KEY='vp_creating_file';
    let file=null;

    // 1. Verify cached file ID directly (O(1), no search, no consistency issues)
    if(cfg.driveFileId){
      try{
        const chk=await driveFetch(`drive/v3/files/${cfg.driveFileId}?fields=id,trashed`);
        if(chk.ok){
          const j=await chk.json().catch(()=>null);
          if(j?.id&&!j.trashed){file={id:cfg.driveFileId};}
          else{cfg.driveFileId=null;saveCfg();}
        }else{cfg.driveFileId=null;saveCfg();}
      }catch(e){cfg.driveFileId=null;saveCfg();}
    }

    // 2. Search only if no valid cached ID
    if(!file){
      // Wait for any in-progress creation on this device to finish
      const creationStart=parseInt(localStorage.getItem(CREATION_LOCK_KEY)||'0');
      if(creationStart&&Date.now()-creationStart<15000){
        // Another invocation on this device is currently creating — wait and retry
        console.log('[Sync] Creation in progress — waiting 5s');
        await new Promise(r=>setTimeout(r,5000));
      }
      file=await findFile();
      if(file){cfg.driveFileId=file.id;saveCfg();}
    }

    // 3. Create — only if still not found and no creation lock active
    if(!file){
      const lockTs=parseInt(localStorage.getItem(CREATION_LOCK_KEY)||'0');
      if(lockTs&&Date.now()-lockTs<15000){
        // Lock is fresh — another sync on this device just started creating
        // Wait for it and retry finding
        console.log('[Sync] Creation lock active — waiting');
        await new Promise(r=>setTimeout(r,6000));
        file=await findFile();
        if(file){cfg.driveFileId=file.id;saveCfg();}
      }

      if(!file){
        // Set creation lock before any async work
        localStorage.setItem(CREATION_LOCK_KEY,Date.now().toString());
        try{
          console.log('[Sync] Creating new file');
          const pp=normPP(cfg.passphrase);
          const enc=await encrypt(db,pp);
          const res=await writeFile(null,enc);
          if(!res?.id)throw new Error('File creation returned no ID');
          cfg.driveFileId=res.id;cfg.lastSyncTs=Date.now();saveCfg();saveLocal();
          setSyncUI('ok','Synced ✓');
          clearTimeout(syncTimeout);
          _syncInFlight=false;
          S.syncing=false;
          setTimeout(()=>setSyncUI('idle','Sync'),2000);
          syncGeminiKey();
          syncInsights();
          setTimeout(()=>{
            localStorage.removeItem(CREATION_LOCK_KEY);
            cleanupDrive().catch(()=>{});
          },8000);
          return;
        }catch(e){
          localStorage.removeItem(CREATION_LOCK_KEY);
          throw e;
        }
      }
    }
    if(file){
      const raw=await readFile(file.id);
      let cloud;
      try{
        // Diagnostic: log file stats to help debug decrypt failures
        console.log('[Sync] Drive file length:',raw.length,'chars, first 20:',raw.slice(0,20));
        const isValidB64=/^[A-Za-z0-9+/=\s]+$/.test(raw.trim());
        console.log('[Sync] Looks like valid base64:',isValidB64);
        console.log('[Sync] Passphrase length:',cfg.passphrase?.length,'repr:',JSON.stringify(cfg.passphrase));
        cloud=await decryptWithVariants(raw,normPP(cfg.passphrase));
      }catch(e){
        console.error('[Sync] Decrypt failed:',e.message);
        // Check if the file content looks like JSON (not encrypted) — old unencrypted data
        const trimmed=raw.trim();
        if(trimmed.startsWith('{')||trimmed.startsWith('[')){
          console.log('[Sync] File appears to be unencrypted JSON — loading directly');
          try{
            cloud=JSON.parse(trimmed);
            showToast('Migrated unencrypted data — re-encrypting now');
          }catch(e2){
            setSyncUI('err','Corrupt file — use Reset Drive in Settings');
            clearTimeout(syncTimeout);S.syncing=false;setTimeout(()=>setSyncUI('idle','Sync'),5000);return;
          }
        } else {
          setSyncUI('err','Wrong passphrase — check Settings');
          clearTimeout(syncTimeout);S.syncing=false;setTimeout(()=>setSyncUI('idle','Sync'),5000);return;
        }
      }
      // Rotate backups before overwriting (fire and forget)
      rotateBackups(raw);
      db=mergeDb(db,cloud);saveLocal();
      const enc=await encrypt(db,normPP(cfg.passphrase));
      await writeFile(file.id,enc);
      cfg.lastSyncTs=Date.now();saveCfg();
      setSyncUI('ok','Synced ✓');
      render();
    }
    // Load Gemini key and shared insights in background after sync
    syncGeminiKey();
    syncInsights();
    // Always clean up duplicates after every sync — keeps Drive tidy
    setTimeout(()=>{
      cleanupDrive().then(n=>{
        if(n>0){console.log(`[Drive] Cleaned ${n} duplicates`);localStorage.setItem('vp_last_clean',Date.now().toString());}
      }).catch(()=>{});
    },3000);
  }catch(e){
    console.error('Sync error:',e);
    const msg=e.message||'';
    if(msg.toLowerCase().includes('passphrase')||msg.toLowerCase().includes('decrypt')){
      setSyncUI('err','Wrong passphrase');
    } else if(msg.toLowerCase().includes('network')||msg.toLowerCase().includes('fetch')){
      setSyncUI('err','Network error — retry');
    } else {
      setSyncUI('err','Sync failed — retry');
    }
  } finally {
    clearTimeout(syncTimeout);
    _syncInFlight=false;
    S.syncing=false;
    setTimeout(()=>setSyncUI('idle','Sync'),3000);
  }
}

function mergeDb(local,cloud){
  // Use deletedIds to properly sync deletions
  const delIds=new Set([...(local.deletedIds||[]),...(cloud.deletedIds||[])]);
  function ml(a,b){
    const m={};
    for(const x of [...(a||[]),...(b||[])])
      if(!m[x.id]||(x.updatedAt||x.createdAt||0)>(m[x.id].updatedAt||m[x.id].createdAt||0))m[x.id]=x;
    // remove deleted items
    for(const id of delIds)delete m[id];
    return Object.values(m).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  }
  const newer=cloud.updatedAt>local.updatedAt;
  return{
    sections:ml(local.sections,cloud.sections),
    seasons:ml(local.seasons||[],cloud.seasons||[]),
    yields:ml(local.yields,cloud.yields),
    expenses:ml(local.expenses,cloud.expenses),
    incomes:ml(local.incomes,cloud.incomes),
    dryings:ml(local.dryings||[],cloud.dryings||[]),
    buyers:[...new Set([...(local.buyers||[]),...(cloud.buyers||[])])],
    priceHistory:(()=>{
      // Merge by date, keep most recent entry per date
      const all=[...(local.priceHistory||[]),...(cloud.priceHistory||[])];
      const byDate={};all.forEach(p=>{if(!byDate[p.date]||p.fetchedAt>byDate[p.date].fetchedAt)byDate[p.date]=p;});
      return Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date)).slice(-60); // keep last 60 days
    })(),
    priceRaw:newer?cloud.priceRaw:local.priceRaw,
    priceDried:newer?cloud.priceDried:local.priceDried,
    priceDate:newer?cloud.priceDate:local.priceDate,
    priceSource:newer?cloud.priceSource:local.priceSource,
    deletedIds:[...delIds],
    updatedAt:Math.max(local.updatedAt||0,cloud.updatedAt||0)
  };
}

function setSyncUI(state,label){
  const btn=document.getElementById('sync-btn'),lbl=document.getElementById('sync-label');
  if(!btn)return;
  btn.className='sync-btn'+(state==='syncing'?' syncing':state==='err'?' err':state==='ok'?' ok':'');
  lbl.textContent=label;
}

// ── AUTO-SYNC & NETWORK ───────────────────────────────────────────────────────
function updateOnlineDot(){
  const dot=document.getElementById('online-dot');
  if(dot)dot.className='online-dot'+(navigator.onLine?' on':'');
}
window.addEventListener('online',()=>{
  updateOnlineDot();
  if(S.pendingSync)triggerSync(false);
});
window.addEventListener('offline',updateOnlineDot);

// Auto-sync on open — only attempt if we already have a cached token.
// On iOS PWA, requesting a new token without user gesture causes a silent hang.
// If no token cached, just show idle state — user taps Sync when ready.
window.addEventListener('load',()=>{
  updateOnlineDot();
  const hasToken=!!loadCachedToken();
  if(hasToken){
    // Token in hand — wait for Google API then sync silently
    waitForGoogle()
      .then(()=>triggerSync(false))
      .catch(()=>{}); // Google API unavailable — skip, don't show error
  }
  // No else — if no token, stay idle. User taps Sync to authenticate.
});

// Auto-sync every 5 mins
setInterval(()=>{if(!document.hidden)triggerSync(false);},AUTO_SYNC_INTERVAL);

// Foreground return — show updated online status but don't auto-sync
// (auto-sync interval handles periodic sync; user can tap Sync manually)
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)updateOnlineDot();
});


function showToast(msg){
  let t=document.getElementById('toast');
  if(!t){t=document.createElement('div');t.id='toast';t.style.cssText='position:fixed;bottom:96px;left:50%;transform:translateX(-50%);background:var(--sur);border:1px solid var(--bor2);color:var(--tx);padding:10px 18px;border-radius:20px;font-size:13px;font-weight:500;z-index:200;box-shadow:var(--shadow2);max-width:300px;text-align:center;';document.body.appendChild(t);}
  t.textContent=msg;t.style.opacity='1';
  clearTimeout(t._to);t._to=setTimeout(()=>t.style.opacity='0',3000);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const uid=()=>'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const fc=n=>'₹'+Math.round(n).toLocaleString('en-IN');
const fd=s=>{if(!s)return'';const d=new Date(s+'T00:00:00');return isNaN(d)?s:d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'});};
const totalPlants=()=>db.sections.reduce((s,x)=>s+(x.plants||0),0);
const totalYield=()=>db.yields.reduce((s,x)=>s+(x.qty||0),0);
const totalExp=()=>db.expenses.reduce((s,x)=>s+(x.amount||0),0);
const totalInc=()=>db.incomes.reduce((s,x)=>s+((x.qty||0)*(x.pricePerKg||0)),0);
const yieldForSec=id=>db.yields.filter(y=>y.sectionId===id).reduce((s,y)=>s+(y.qty||0),0);
const CL={labor:'Labor',pesticide:'Pesticide',rawmat:'Raw material',crop:'Crop',other:'Other'};
const BC={labor:'bl',pesticide:'bp',rawmat:'br2',crop:'bc2',other:'bo'};
const secName=id=>{const s=db.sections.find(x=>x.id===id);return s?s.name:'All sections';};
const seaName=id=>{if(!id)return'';const s=(db.seasons||[]).find(x=>x.id===id);return s?s.name:'';};
const secOpts=(blank='All sections')=>`<option value="">${blank}</option>`+db.sections.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
const seaOpts=(blank='No season')=>`<option value="">${blank}</option>`+(db.seasons||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');

// Buyers list helpers
const buyerOpts=(selected='')=>{
  const def=`<option value="">Select buyer…</option>`;
  return def+(db.buyers||[]).map(b=>`<option value="${esc(b)}" ${b===selected?'selected':''}>${esc(b)}</option>`).join('')+`<option value="__new__">+ Add new buyer…</option>`;
};
const esc=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/'/g,"&#39;").replace(/"/g,'&quot;');

// ── DELETE WITH TRACKING ──────────────────────────────────────────────────────
function deleteItem(type,id){
  const map={section:'sections',season:'seasons',yield:'yields',expense:'expenses',income:'incomes',drying:'dryings'};
  const key=map[type];if(!key)return;
  db[key]=db[key].filter(x=>x.id!==id);
  if(!db.deletedIds)db.deletedIds=[];
  if(!db.deletedIds.includes(id))db.deletedIds.push(id);
  saveLocal();
  // Auto-sync after delete
  setTimeout(()=>triggerSync(false),2000);
}
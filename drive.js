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

// ── SYNC DIAGNOSTICS (mobile-friendly popup) ─────────────────────────────────
async function showSyncDiagnostics(){
  const lines=[];
  lines.push('=== SYNC DIAGNOSTICS ===');lines.push('');
  lines.push('Passphrase: '+(cfg.passphrase?'SET ('+cfg.passphrase.length+' chars)':'NOT SET'));
  lines.push('Shared folder: '+(cfg.sharedFolderId||'NOT SET'));
  lines.push('Client ID: '+(cfg.clientId?cfg.clientId.slice(0,20)+'…':'NOT SET'));
  lines.push('Cached file ID: '+(cfg.driveFileId||'none'));
  lines.push('OAuth token: '+(S.oauthToken?'in memory':loadCachedToken()?'in session':'NONE'));
  lines.push('Last sync: '+(cfg.lastSyncTs?new Date(cfg.lastSyncTs).toLocaleString('en-IN'):'never'));
  lines.push('Local records: '+db.yields.length+' yield, '+db.expenses.length+' exp, '+db.sections.length+' sections');
  lines.push('Online: '+navigator.onLine);
  lines.push('');

  // Try Drive API
  try{
    const tok=S.oauthToken||loadCachedToken();
    if(!tok){lines.push('TOKEN: none — tap Sync to authenticate first');}
    else{
      lines.push('TOKEN: present');
      const folder=cfg.sharedFolderId;
      const q=folder
        ?`name='vplantations_data.enc' and '${folder}' in parents and trashed=false`
        :`name='vplantations_data.enc' and trashed=false`;
      lines.push('Search query: '+q.slice(0,80));
      const r=await fetch(
        `https://www.googleapis.com/drive/v3/files?spaces=drive&q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime)`,
        {headers:{Authorization:'Bearer '+tok}}
      );
      const d=await r.json();
      if(d.error){
        lines.push('DRIVE ERROR: '+d.error.message+' ('+d.error.code+')');
      } else {
        lines.push('Files found: '+(d.files?.length||0));
        (d.files||[]).forEach((f,i)=>{
          lines.push('  ['+i+'] '+f.id+' ('+Math.round((f.size||0)/1024)+'KB, '+new Date(f.modifiedTime).toLocaleDateString('en-IN')+')');
        });
        if((d.files||[]).length===0){
          lines.push('');
          lines.push('WHY NO FILE?');
          if(!folder)lines.push('• No shared folder ID set');
          else lines.push('• File not in folder '+folder.slice(0,20)+'… or not shared with this account');
        }
      }
    }
  }catch(e){lines.push('API call failed: '+e.message);}

  // Show in modal
  const txt=lines.join('\n');
  modal('<div style="font-family:monospace;font-size:11px;background:var(--sur2);border-radius:var(--rs);padding:12px;white-space:pre-wrap;word-break:break-all;max-height:60vh;overflow-y:auto;line-height:1.7">'+esc(txt)+'</div><div class=\"btn-row\" style=\"margin-top:12px\"><button class=\"btnc\" onclick=\"closeModal()\">Close</button><button class=\"btnp\" onclick=\"navigator.clipboard&&navigator.clipboard.writeText(this.getAttribute(\'data-txt\')).then(()=>showToast(\'Copied ✓\'))\" data-txt=\"'+esc(txt)+'\">Copy</button></div>','Sync diagnostics');
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
  const r=await driveFetch(`drive/v3/files?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id,size,modifiedTime)&orderBy=modifiedTime desc`);
  if(!r.ok)return null;
  const d=await r.json();
  const files=(d.files||[]).filter(f=>parseInt(f.size||0)>10); // skip empty/0KB
  if(!files.length)return null;
  files.sort((a,b)=>parseInt(b.size||0)-parseInt(a.size||0)); // largest first
  if(files.length>1)setTimeout(()=>cleanupDrive().catch(()=>{}),2000);
  return files[0];
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
    const r=await driveFetch(`drive/v3/files?spaces=${spaces}&q=${encodeURIComponent(q)}&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime desc`);
    const d=await r.json();
    const files=d.files||[];
    // Delete 0KB/empty files first (corrupted placeholders)
    const emptyFiles=files.filter(f=>parseInt(f.size||0)<=10);
    await Promise.all(emptyFiles.map(f=>driveFetch(`drive/v3/files/${f.id}`,{method:'DELETE'}).catch(()=>{})));
    totalCleaned+=emptyFiles.length;
    const realFiles=files.filter(f=>parseInt(f.size||0)>10);
    if(realFiles.length>1){
      const toDelete=realFiles.slice(1);
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

// In-memory sync lock
let _syncInFlight=false;
let _lastSyncAttempt=0;
let _pendingAutoSync=false;

// autoSync — called after every CRUD operation. No rate limit for manual saves.
function autoSync(){
  if(_syncInFlight){_pendingAutoSync=true;return;}
  if(!navigator.onLine){S.pendingSync=true;return;}
  triggerSync(true); // treat as manual so no rate-limit
}

async function triggerSync(manual=false){
  if(_syncInFlight){if(manual)_pendingAutoSync=true;return;}
  if(!manual&&Date.now()-_lastSyncAttempt<60000){return;}
  if(!navigator.onLine){setSyncUI('offline');S.pendingSync=true;return;}
  if(!cfg.passphrase){if(manual)showPassphraseSetup();return;}
  if(!getClientId()||getClientId()===CID_PH){if(manual)showClientIdSetup();return;}
  if(!manual&&!S.oauthToken&&!loadCachedToken()){return;}
  _syncInFlight=true;
  _pendingAutoSync=false;
  _lastSyncAttempt=Date.now();
  S.syncing=true;S.pendingSync=false;setSyncUI('syncing');
  const syncTimeout=setTimeout(()=>{
    if(S.syncing){_syncInFlight=false;S.syncing=false;setSyncUI('err');setTimeout(()=>setSyncUI('idle'),4000);}
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
        const chk=await driveFetch(`drive/v3/files/${cfg.driveFileId}?fields=id,trashed,size`);
        if(chk.ok){
          const j=await chk.json().catch(()=>null);
          // Reject if trashed OR empty (0KB = corrupt/placeholder)
          if(j?.id&&!j.trashed&&parseInt(j.size||0)>10)file={id:cfg.driveFileId};
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
        await new Promise(r=>setTimeout(r,6000));
        file=await findFile();
        if(file){cfg.driveFileId=file.id;saveCfg();}
      }

      if(!file){
        // Set creation lock before any async work
        localStorage.setItem(CREATION_LOCK_KEY,Date.now().toString());
        try{
          const pp=normPP(cfg.passphrase);
          const enc=await encrypt(db,pp);
          const res=await writeFile(null,enc);
          if(!res?.id)throw new Error('File creation returned no ID');
          cfg.driveFileId=res.id;cfg.lastSyncTs=Date.now();saveCfg();saveLocal();
          setSyncUI('ok');
          clearTimeout(syncTimeout);
          _syncInFlight=false;
          S.syncing=false;
          setTimeout(()=>setSyncUI('idle'),2000);
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
        cloud=await decryptWithVariants(raw,normPP(cfg.passphrase));
      }catch(e){
        console.error('[Sync] Decrypt failed:',e.message);
        const trimmed=raw.trim();
        if(trimmed.startsWith('{')||trimmed.startsWith('[')){
          try{cloud=JSON.parse(trimmed);showToast('Migrated unencrypted data');}
          catch(e2){setSyncUI('err');clearTimeout(syncTimeout);S.syncing=false;setTimeout(()=>setSyncUI('idle'),5000);return;}
        } else {
          // Wrong passphrase — show a clear message, don't just show error icon
          setSyncUI('err');
          clearTimeout(syncTimeout);S.syncing=false;
          setTimeout(()=>setSyncUI('idle'),5000);
          showToast('Wrong passphrase — check Settings → Sync & account');
          return;
        }
      }
      rotateBackups(raw);

      // ── FIRST-TIME SYNC FOR THIS DEVICE ──────────────────────────────────────
      // If local db has no records (fresh device / new user), Drive is full SOR —
      // replace local completely. Don't merge empty local onto Drive.
      const localIsEmpty=!db.yields.length&&!db.expenses.length&&!db.incomes.length&&!db.sections.length&&!(db.workers||[]).length;
      if(localIsEmpty){
        db={...cloud,
          // Preserve device-local config
          priceRaw:cloud.priceRaw,priceDried:cloud.priceDried,
          priceDate:cloud.priceDate,priceSource:cloud.priceSource,
          priceUpdatedAt:cloud.priceUpdatedAt
        };
      } else {
        db=mergeDb(db,cloud);
      }
      saveLocal();
      const enc=await encrypt(db,normPP(cfg.passphrase));
      await writeFile(file.id,enc);
      cfg.lastSyncTs=Date.now();saveCfg();
      setSyncUI('ok');
      render();
    }
    // Load Gemini key and shared insights in background after sync
    syncGeminiKey();
    syncInsights();
    // Always clean up duplicates after every sync — keeps Drive tidy
    setTimeout(()=>{
      cleanupDrive().then(n=>{
        if(n>0){localStorage.setItem('vp_last_clean',Date.now().toString());}
      }).catch(()=>{});
    },3000);
  }catch(e){
    console.error('Sync error:',e);
    const msg=e.message||'';
    if(msg.toLowerCase().includes('passphrase')||msg.toLowerCase().includes('decrypt')){
      setSyncUI('err');
    } else if(msg.toLowerCase().includes('network')||msg.toLowerCase().includes('fetch')){
      setSyncUI('err');
    } else {
      setSyncUI('err');
    }
  } finally {
    clearTimeout(syncTimeout);
    _syncInFlight=false;
    S.syncing=false;
    if(!S.syncing)setTimeout(()=>setSyncUI('idle'),2000);
    // If a CRUD save was queued while we were syncing, fire it now
    if(_pendingAutoSync){_pendingAutoSync=false;setTimeout(()=>autoSync(),1000);}
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
  // Compare prices by their own updatedAt, not db.updatedAt
  const localPriceTs=local.priceUpdatedAt||0;
  const cloudPriceTs=cloud.priceUpdatedAt||0;
  const cloudPriceNewer=cloudPriceTs>localPriceTs;
  // Use non-null values when one side has no price
  const pickPrice=(lv,cv)=>{
    if(cloudPriceNewer)return cv!==null&&cv!==undefined?cv:lv;
    return lv!==null&&lv!==undefined?lv:cv;
  };
  return{
    sections:ml(local.sections,cloud.sections),
    seasons:ml(local.seasons||[],cloud.seasons||[]),
    yields:ml(local.yields,cloud.yields),
    expenses:ml(local.expenses,cloud.expenses),
    incomes:ml(local.incomes,cloud.incomes),
    dryings:ml(local.dryings||[],cloud.dryings||[]),
    buyers:[...new Set([...(local.buyers||[]),...(cloud.buyers||[])])],
    workers:ml(local.workers||[],cloud.workers||[]),
    // workerRates: merge by id (last-write-wins), then deduplicate same effectiveFrom — keep most recently updated
    workerRates:(()=>{
      const merged=ml(local.workerRates||[],cloud.workerRates||[]);
      const byDate={};
      merged.forEach(r=>{
        if(!byDate[r.effectiveFrom]||(r.updatedAt||r.createdAt||0)>(byDate[r.effectiveFrom].updatedAt||byDate[r.effectiveFrom].createdAt||0))
          byDate[r.effectiveFrom]=r;
      });
      return Object.values(byDate).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
    })(),
    priceHistory:(()=>{
      const all=[...(local.priceHistory||[]),...(cloud.priceHistory||[])];
      const byDate={};all.forEach(p=>{if(!byDate[p.date]||p.fetchedAt>byDate[p.date].fetchedAt)byDate[p.date]=p;});
      return Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date)).slice(-60);
    })(),
    priceRaw:pickPrice(local.priceRaw,cloud.priceRaw),
    priceDried:pickPrice(local.priceDried,cloud.priceDried),
    priceDate:pickPrice(local.priceDate,cloud.priceDate),
    priceSource:pickPrice(local.priceSource,cloud.priceSource),
    priceUpdatedAt:Math.max(localPriceTs,cloudPriceTs)||undefined,
    deletedIds:[...delIds],
    updatedAt:Math.max(local.updatedAt||0,cloud.updatedAt||0)
  };
}

function setSyncUI(state){
  const btn=document.getElementById('sync-btn');
  if(!btn)return;
  btn.className='sync-btn'+(state==='syncing'?' syncing':state==='err'?' err':state==='ok'?' ok':state==='offline'?' offline':'');
  btn.title={syncing:'Syncing…',err:'Sync failed — tap to retry',ok:'Saved to Drive ✓',offline:'Offline — tap to retry',idle:'Sync'}[state]||'Sync';
  if(state==='ok')setTimeout(()=>setSyncUI('idle'),2000);
}

// ── AUTO-SYNC & NETWORK ───────────────────────────────────────────────────────
function updateOnlineDot(){
  const dot=document.getElementById('online-dot');
  if(dot)dot.className='online-dot'+(navigator.onLine?' on':'');
}
window.addEventListener('online',()=>{
  updateOnlineDot();
  updateOfflineBanner();
  if(S.pendingSync)triggerSync(false);
});
window.addEventListener('offline',()=>{updateOnlineDot();updateOfflineBanner();});

// ── STARTUP AUTH FLOW ────────────────────────────────────────────────────────
// On load: if valid token cached → pull Drive silently → show app
//          if no token → show auth screen → user signs in or skips
window.addEventListener('load',()=>{
  updateOnlineDot();
  updateOfflineBanner();
  const hasToken=!!loadCachedToken();
  if(hasToken&&navigator.onLine){
    // Token cached → silent startup sync then show app
    showAuthScreen('loading');
    waitForGoogle()
      .then(()=>startupSync())
      .catch(()=>{hideAuthScreen();});
  } else if(!hasToken&&navigator.onLine){
    // No token → show auth screen
    showAuthScreen('signin');
  } else {
    // Offline — go straight to local data
    hideAuthScreen();
    showOfflineBanner();
  }
});

// ── STARTUP SYNC (Drive as SOR) ──────────────────────────────────────────────
async function startupSync(){
  try{
    await getOAuthToken();
    let file=null;
    if(cfg.driveFileId){
      try{
        const chk=await driveFetch(`drive/v3/files/${cfg.driveFileId}?fields=id,trashed`);
        if(chk.ok){const j=await chk.json().catch(()=>null);if(j?.id&&!j.trashed)file={id:cfg.driveFileId};}
        else cfg.driveFileId=null;
      }catch(e){cfg.driveFileId=null;}
    }
    if(!file)file=await findFile();

    if(file){
      const raw=await readFile(file.id);
      let cloud;
      try{cloud=await decryptWithVariants(raw,normPP(cfg.passphrase));}
      catch(e){
        // Wrong passphrase or no passphrase set — go to app, user can set in settings
        hideAuthScreen();
        return;
      }
      // Drive-as-SOR: find conflicts between local changes since last sync and cloud
      const lastSync=cfg.lastSyncTs||0;
      // If this device has never synced or has no records — Drive wins completely
      const localIsEmpty=!db.yields.length&&!db.expenses.length&&!db.incomes.length&&!db.sections.length&&!(db.workers||[]).length;
      if(localIsEmpty||!lastSync){
        db={...cloud};
        saveLocal();
        cfg.driveFileId=file.id;
        cfg.lastSyncTs=Date.now();saveCfg();
        syncGeminiKey();syncInsights();
        hideAuthScreen();
        return;
      }
      const conflicts=findConflicts(db,cloud,lastSync);
      if(conflicts.length>0){
        hideAuthScreen();
        resolveConflicts(conflicts,cloud);
      } else {
        // No conflicts — merge with Drive as base (option C: local-only changes win)
        const localOnly={
          yields:db.yields.filter(y=>(y.updatedAt||0)>lastSync),
          expenses:db.expenses.filter(e=>(e.updatedAt||0)>lastSync),
          incomes:db.incomes.filter(i=>(i.updatedAt||0)>lastSync),
          workers:(db.workers||[]).filter(w=>(w.updatedAt||0)>lastSync),
          sections:db.sections.filter(s=>(s.updatedAt||0)>lastSync),
        };
        db=mergeDb(cloud,db); // cloud as base, local on top
        // Re-apply truly local-only records
        ['yields','expenses','incomes','workers','sections'].forEach(k=>{
          if(localOnly[k]?.length){
            const ids=new Set(localOnly[k].map(r=>r.id));
            const base=db[k].filter(r=>!ids.has(r.id));
            db[k]=[...base,...localOnly[k]].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
          }
        });
        saveLocal();
        cfg.driveFileId=file.id;
        // Write merged result back
        const enc=await encrypt(db,normPP(cfg.passphrase));
        await writeFile(file.id,enc);
        cfg.lastSyncTs=Date.now();saveCfg();
        syncGeminiKey();syncInsights();
        setTimeout(()=>cleanupDrive().catch(()=>{}),3000);
        hideAuthScreen();
      }
    } else {
      // No Drive file — create fresh from local
      hideAuthScreen();
      setTimeout(()=>triggerSync(true),500);
    }
  }catch(e){
    hideAuthScreen(); // fail open
  }
}

// Find conflicts: same record modified in both local and cloud since lastSync
function findConflicts(local,cloud,lastSync){
  const conflicts=[];
  const arrays=['yields','expenses','incomes','workers','sections'];
  arrays.forEach(k=>{
    const cloudMap={};
    (cloud[k]||[]).forEach(r=>cloudMap[r.id]=r);
    (local[k]||[]).forEach(localRec=>{
      const cloudRec=cloudMap[localRec.id];
      if(!cloudRec)return; // local-only, no conflict
      const localNewer=(localRec.updatedAt||0)>lastSync;
      const cloudNewer=(cloudRec.updatedAt||0)>lastSync;
      if(localNewer&&cloudNewer&&localRec.updatedAt!==cloudRec.updatedAt){
        conflicts.push({type:k,localRec,cloudRec,
          localDate:new Date(localRec.updatedAt).toLocaleString('en-IN'),
          cloudDate:new Date(cloudRec.updatedAt).toLocaleString('en-IN')});
      }
    });
  });
  return conflicts;
}

// Show conflicts one at a time
let _pendingConflicts=[];
let _conflictCloud=null;
function resolveConflicts(conflicts,cloud){
  _pendingConflicts=[...conflicts];
  _conflictCloud=cloud;
  showNextConflict();
}
function showNextConflict(){
  if(_pendingConflicts.length===0){
    // All resolved — save and write back
    saveLocal();
    if(_conflictCloud){
      encrypt(db,normPP(cfg.passphrase)).then(enc=>{
        if(cfg.driveFileId)writeFile(cfg.driveFileId,enc);
        cfg.lastSyncTs=Date.now();saveCfg();
      });
    }
    _conflictCloud=null;
    render();
    return;
  }
  const c=_pendingConflicts[0];
  const typeLabel={yields:'Harvest',expenses:'Expense',incomes:'Income',workers:'Workers',sections:'Section'}[c.type]||c.type;
  const desc=c.localRec.date?'on '+c.localRec.date:'';
  modal(`
<div style="background:var(--a-bg);border:1px solid var(--a-bor);border-radius:var(--rs);padding:12px;margin-bottom:14px">
  <div style="font-size:12px;font-weight:700;color:var(--a-tx);margin-bottom:4px">⚠️ Conflict detected</div>
  <div style="font-size:12px;color:var(--a-mid)">${typeLabel} record ${desc} was edited on two devices since last sync.</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
  <div style="background:var(--b-bg);border:1px solid var(--b-bor);border-radius:var(--rs);padding:10px">
    <div style="font-size:11px;font-weight:700;color:var(--b-tx);margin-bottom:6px">Drive version</div>
    <div style="font-size:11px;color:var(--tx2)">${formatRecordSummary(c.cloudRec,c.type)}</div>
    <div style="font-size:10px;color:var(--tx3);margin-top:4px">${c.cloudDate}</div>
  </div>
  <div style="background:var(--g-bg);border:1px solid var(--g-bor);border-radius:var(--rs);padding:10px">
    <div style="font-size:11px;font-weight:700;color:var(--g-tx);margin-bottom:6px">This device</div>
    <div style="font-size:11px;color:var(--tx2)">${formatRecordSummary(c.localRec,c.type)}</div>
    <div style="font-size:10px;color:var(--tx3);margin-top:4px">${c.localDate}</div>
  </div>
</div>
<div style="font-size:11px;color:var(--tx3);margin-bottom:12px">${_pendingConflicts.length} conflict${_pendingConflicts.length>1?'s':''} remaining</div>
<div class="btn-row">
  <button class="btnc" onclick="applyConflictChoice('cloud')">Keep Drive</button>
  <button class="btnp" onclick="applyConflictChoice('local')">Keep this device</button>
</div>`,'Sync conflict');
}
function applyConflictChoice(choice){
  const c=_pendingConflicts.shift();
  if(c){
    const winner=choice==='local'?c.localRec:c.cloudRec;
    const arr=db[c.type];
    const idx=arr.findIndex(r=>r.id===winner.id);
    if(idx>=0)arr[idx]=winner;else arr.push(winner);
  }
  closeModal();
  showNextConflict();
}
function formatRecordSummary(rec,type){
  if(type==='yields')return`${rec.qty||0} kg · ${rec.date||''}`;
  if(type==='expenses')return`${fc(rec.amount||0)} · ${rec.category||''} · ${rec.date||''}`;
  if(type==='incomes')return`${rec.qty||0}kg @ ₹${rec.pricePerKg||0} · ${rec.date||''}`;
  if(type==='workers')return`M:${rec.male||0} F:${rec.female||0} B:${rec.bengali||0} · ${rec.date||''}`;
  if(type==='sections')return`${rec.name||''} · ${rec.plants||0} plants`;
  return JSON.stringify(rec).slice(0,60);
}

// ── OFFLINE BANNER ────────────────────────────────────────────────────────────
function updateOfflineBanner(){
  const existing=document.getElementById('offline-banner');
  if(!navigator.onLine){
    if(!existing){
      const b=document.createElement('div');
      b.id='offline-banner';
      b.style.cssText='background:var(--a-bg);border-bottom:1px solid var(--a-bor);padding:8px 16px;font-size:12px;color:var(--a-tx);display:flex;align-items:center;gap:6px;font-family:-apple-system,sans-serif';
      b.innerHTML='<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l16 16M8.5 4.5A9 9 0 0118 14M1.5 6A9 9 0 004 9M12 12a4 4 0 00-5.5-5.5"/></svg> Offline — changes saved locally, will sync when connected';
      const content=document.getElementById('main-content');
      if(content)content.before(b);
    }
  } else {
    if(existing)existing.remove();
  }
}
function showOfflineBanner(){updateOfflineBanner();}

// ── AUTH SCREEN ────────────────────────────────────────────────────────────────
function showAuthScreen(mode){
  let el=document.getElementById('auth-screen');
  if(!el){
    el=document.createElement('div');
    el.id='auth-screen';
    el.style.cssText='position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;background:var(--page)';
    document.body.appendChild(el);
  }
  if(mode==='loading'){
    el.innerHTML=`
    <div style="text-align:center;padding:40px 24px">
      <div style="width:72px;height:72px;background:#14532d;border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
        <svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M50 78 Q32 52 28 22 Q46 34 48 58 Q50 34 72 22 Q68 52 50 78Z" fill="#4ade80"/>
          <line x1="50" y1="78" x2="30" y2="24" stroke="#c89a30" stroke-width="5" stroke-linecap="round"/>
          <line x1="50" y1="78" x2="70" y2="24" stroke="#c89a30" stroke-width="5" stroke-linecap="round"/>
        </svg>
      </div>
      <div style="font-size:22px;font-weight:700;color:var(--tx);margin-bottom:4px">V-Plantations</div>
      <div style="font-size:14px;color:var(--tx3);margin-bottom:32px">Cardamom Estate · Idukki</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;color:var(--tx3);font-size:13px">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="animation:spin 1s linear infinite"><path d="M4 10a6 6 0 0110.5-4M16 10a6 6 0 01-10.5 4"/></svg>
        Loading your data…
      </div>
    </div>`;
  } else {
    el.innerHTML=`
    <div style="text-align:center;padding:40px 24px;max-width:360px;width:100%">
      <div style="width:72px;height:72px;background:#14532d;border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
        <svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M50 78 Q32 52 28 22 Q46 34 48 58 Q50 34 72 22 Q68 52 50 78Z" fill="#4ade80"/>
          <line x1="50" y1="78" x2="30" y2="24" stroke="#c89a30" stroke-width="5" stroke-linecap="round"/>
          <line x1="50" y1="78" x2="70" y2="24" stroke="#c89a30" stroke-width="5" stroke-linecap="round"/>
        </svg>
      </div>
      <div style="font-size:26px;font-weight:700;color:var(--tx);margin-bottom:4px">V-Plantations</div>
      <div style="font-size:14px;color:var(--tx3);margin-bottom:8px">Cardamom Estate · Idukki</div>
      <div style="font-size:12px;color:var(--tx3);margin-bottom:40px">Sign in to sync your farm data across all devices</div>
      <button onclick="doGoogleSignIn()" style="width:100%;padding:14px;background:#14532d;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:12px">
        <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#fff"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#d4e8d0"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#c8e6c9"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#e8f5e9"/></svg>
        Sign in with Google
      </button>
      ${!cfg.passphrase||!cfg.sharedFolderId?`
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;margin-bottom:12px;text-align:left">
        <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:6px">⚠ First-time setup needed</div>
        ${!cfg.sharedFolderId?'<div style="font-size:11px;color:#92400e;margin-bottom:3px">• Shared folder ID not set (Settings → Sync)</div>':''}
        ${!cfg.passphrase?'<div style="font-size:11px;color:#92400e">• Passphrase not set (Settings → Sync) — must match the other devices</div>':''}
      </div>`:''}
      <button onclick="skipAuth()" style="width:100%;padding:12px;background:none;color:var(--tx3);border:1px solid var(--bor2);border-radius:12px;font-size:14px;cursor:pointer;font-family:inherit">
        Work offline
      </button>
      <div style="font-size:11px;color:var(--tx3);margin-top:16px;line-height:1.5">Your data is encrypted and only accessible with your passphrase</div>
    </div>`;
  }
}
function hideAuthScreen(){
  const el=document.getElementById('auth-screen');
  if(el){el.style.opacity='0';el.style.transition='opacity 0.3s';setTimeout(()=>el.remove(),300);}
  render();
}

async function doGoogleSignIn(){
  const btn=document.querySelector('#auth-screen button');
  if(btn){btn.disabled=true;btn.textContent='Signing in…';}
  try{
    await waitForGoogle();
    await getOAuthToken();
    showAuthScreen('loading');
    await startupSync();
  }catch(e){
    showAuthScreen('signin');
    showToast('Sign in failed — try again');
  }
}
function skipAuth(){
  hideAuthScreen();
  showOfflineBanner();
}

// ── AUTO-SYNC ─────────────────────────────────────────────────────────────────
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
  const map={section:'sections',season:'seasons',yield:'yields',expense:'expenses',income:'incomes',drying:'dryings',worker:'workers'};
  const key=map[type];if(!key)return;
  db[key]=db[key].filter(x=>x.id!==id);
  if(!db.deletedIds)db.deletedIds=[];
  if(!db.deletedIds.includes(id))db.deletedIds.push(id);
  saveLocal();
  // Auto-sync after delete
  setTimeout(()=>triggerSync(false),2000);
}

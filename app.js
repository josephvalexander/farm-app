// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const APP_VERSION='__VERSION__'; // replaced at deploy time — or just increment manually
const DB_KEY='vp_data_v1', CFG_KEY='vp_config_v1';
const DRIVE_FILE='vplantations_data.enc', SCOPES='https://www.googleapis.com/auth/drive.file';
const BACKUP_FILES=['vplantations_bak1.enc','vplantations_bak2.enc','vplantations_bak3.enc'];
const CID_PH='YOUR_GOOGLE_CLIENT_ID_HERE';
const AUTO_SYNC_INTERVAL=5*60*1000;
const NEWS_KEY='vp_news_v1';
const NEWS_TTL=24*60*60*1000; // 24 hours

// ── STATE ─────────────────────────────────────────────────────────────────────
let cfg={driveFileId:null,sharedFolderId:null,passphrase:null,lastSyncTs:null,clientId:null,googleAccountHint:null,deviceId:'dev_'+Math.random().toString(36).slice(2,8)};
let db={sections:[],seasons:[],yields:[],expenses:[],incomes:[],dryings:[],
  priceRaw:null,priceDried:null,priceDate:null,priceSource:null,updatedAt:Date.now()};
let S={tab:'dashboard',recTab:'yield',expTab:'all',yieldPeriod:'month',expPeriod:'month',incPeriod:'month',dryPeriod:'month',insightsOpen:true,showAllYield:false,showAllExp:false,showAllInc:false,showAllDry:false,syncing:false,fetchingInsights:false,lastInsightsTrigger:0,oauthToken:null,geminiKey:null,_insightsError:null,pendingSync:false};

// ── PERSIST ───────────────────────────────────────────────────────────────────
function saveLocal(){
  db.updatedAt=Date.now();
  try{localStorage.setItem(DB_KEY,JSON.stringify(db));}catch(e){}
}
function loadLocal(){
  try{
    const d=localStorage.getItem(DB_KEY);
    if(d){const p=JSON.parse(d);
      // migrate old schema: marketPrice → priceDried
      if(p.marketPrice&&!p.priceDried){p.priceDried=p.marketPrice;p.priceDate=p.marketPriceDate||null;delete p.marketPrice;delete p.marketPriceDate;}
      db={...db,...p};
      if(!db.dryings)db.dryings=[];
    }
    const c=localStorage.getItem(CFG_KEY);
    if(c)cfg={...cfg,...JSON.parse(c)};
    // migrate old config key
    const oldCfg=localStorage.getItem('cf_config_v2');
    if(oldCfg&&!cfg.passphrase){const o=JSON.parse(oldCfg);cfg={...cfg,...o};if(cfg.passphrase)cfg.passphrase=normPP(cfg.passphrase);saveCfg();}
    // migrate old db key
    const oldDb=localStorage.getItem('cf_data_v3');
    if(oldDb&&!db.sections.length){
      const o=JSON.parse(oldDb);
      db={...db,sections:o.sections||[],seasons:o.seasons||[],yields:o.yields||[],expenses:o.expenses||[],incomes:o.incomes||[],priceDried:o.marketPrice||null,priceDate:o.marketPriceDate||null};
      saveLocal();
    }
  }catch(e){}
}
function saveCfg(){try{localStorage.setItem(CFG_KEY,JSON.stringify(cfg));}catch(e){}}
loadLocal();

// ── THEME ─────────────────────────────────────────────────────────────────────
function getSystemTheme(){return window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}
function resolveTheme(){return cfg.theme||'system';}
function applyTheme(){
  const pref=resolveTheme();
  const actual=pref==='system'?getSystemTheme():pref;
  document.documentElement.setAttribute('data-theme',actual);
  const btn=document.getElementById('theme-btn');
  if(btn){
    if(pref==='system') btn.textContent=actual==='dark'?'🌙':'☀️';
    else if(pref==='dark') btn.textContent='🌙';
    else btn.textContent='☀️';
    btn.title=pref==='system'?'Following system (tap to override)':pref==='dark'?'Dark mode (tap for light)':'Light mode (tap for dark)';
  }
}
function toggleTheme(){
  const pref=resolveTheme();
  // Cycle: system → dark → light → system
  if(pref==='system'){cfg.theme=getSystemTheme()==='dark'?'light':'dark';}
  else if(pref==='dark'){cfg.theme='light';}
  else{cfg.theme='system';}
  saveCfg();applyTheme();
}
// Listen for system theme changes (affects 'system' mode only)
window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(resolveTheme()==='system')applyTheme();});
applyTheme();

// ── CRYPTO ────────────────────────────────────────────────────────────────────
// Normalise passphrase — strips invisible chars, smart quotes, leading/trailing space
// Must be applied consistently everywhere passphrase is saved or used
function normPP(pp){
  if(!pp)return pp;
  return pp
    .replace(/[‘’]/g,"'")   // smart single quotes → straight
    .replace(/[“”]/g,'"')   // smart double quotes → straight
    .replace(/[ ​‌‍﻿]/g,'') // non-breaking & zero-width spaces
    .trim();
}

// Generate all plausible variants of a passphrase to handle iOS autocorrect
function ppVariants(pp){
  if(!pp)return[];
  const n=normPP(pp);
  const variants=new Set([
    pp,
    n,
    pp.trim(),
    n.charAt(0).toUpperCase()+n.slice(1),
    n.charAt(0).toLowerCase()+n.slice(1),
    pp.charAt(0).toUpperCase()+pp.trim().slice(1),
    pp.charAt(0).toLowerCase()+pp.trim().slice(1),
  ]);
  return [...variants].filter(Boolean);
}

// Try to decrypt with multiple passphrase variants — handles autocorrect mismatches
// IMPORTANT: never mutates cfg.passphrase — that caused cascading encryption drift
async function decryptWithVariants(b64,pp){
  const variants=ppVariants(pp);
  for(const v of variants){
    try{
      const result=await decrypt(b64,v);
      // Log which variant worked so user can correct their stored passphrase manually
      if(v!==pp)console.log('[Auth] Variant matched:',JSON.stringify(v),'stored:',JSON.stringify(pp));
      return result;
    }catch(e){continue;}
  }
  throw new Error('Wrong passphrase');
}


async function getKey(pp,salt){
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pp),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encrypt(data,pp){
  pp=normPP(pp);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await getKey(pp,salt);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(data)));
  const buf=new Uint8Array(28+ct.byteLength);
  buf.set(salt);buf.set(iv,16);buf.set(new Uint8Array(ct),28);
  // Use chunked approach — btoa(String.fromCharCode(...buf)) stack-overflows on iOS for large arrays
  let bin='';
  const chunk=8192;
  for(let i=0;i<buf.length;i+=chunk){
    bin+=String.fromCharCode(...buf.subarray(i,i+chunk));
  }
  return btoa(bin);
}
async function decrypt(b64,pp){
  pp=normPP(pp);
  // Robust base64 decode — handles whitespace/newlines Drive may add
  const clean=b64.replace(/\s/g,'');
  const raw=Uint8Array.from(atob(clean),c=>c.charCodeAt(0));
  const key=await getKey(pp,raw.slice(0,16));
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(16,28)},key,raw.slice(28));
  return JSON.parse(new TextDecoder().decode(pt));
}

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

async function triggerSync(manual=false){
  if(S.syncing)return;
  if(!navigator.onLine){if(manual){setSyncUI('err','Offline');setTimeout(()=>setSyncUI('idle','Sync'),2000);}S.pendingSync=true;return;}
  if(!cfg.passphrase){if(manual)showPassphraseSetup();return;}
  if(!getClientId()||getClientId()===CID_PH){if(manual)showClientIdSetup();return;}
  // On auto-sync with no cached token: skip silently — avoid iOS PWA auth popup hang
  if(!manual&&!S.oauthToken&&!loadCachedToken()){return;}
  S.syncing=true;S.pendingSync=false;setSyncUI('syncing','Syncing…');
  // Safety net: if sync never resolves, reset after 20s to prevent permanent stuck state
  const syncTimeout=setTimeout(()=>{
    if(S.syncing){S.syncing=false;setSyncUI('err','Timed out — tap Sync to retry');setTimeout(()=>setSyncUI('idle','Sync'),4000);}
  },35000);
  try{
    await getOAuthToken();
    const file=await findFile();
    if(!file){
      const pp=normPP(cfg.passphrase);
      const enc=await encrypt(db,pp);
      const res=await writeFile(null,enc);
      cfg.driveFileId=res.id;cfg.lastSyncTs=Date.now();saveCfg();saveLocal();
      setSyncUI('ok','Synced ✓');
      syncGeminiKey();
      syncInsights();
    } else {
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
    // Periodically auto-clean Drive duplicates — run roughly once per day
    const lastClean=parseInt(localStorage.getItem('vp_last_clean')||'0');
    if(Date.now()-lastClean>24*60*60*1000){
      cleanupDrive().then(n=>{
        if(n>0)console.log(`[Drive] Auto-cleaned ${n} duplicates`);
        localStorage.setItem('vp_last_clean',Date.now().toString());
      }).catch(()=>{});
    }
  }catch(e){
    console.error('Sync error:',e);
    const msg=e.message||'';
    if(msg.toLowerCase().includes('passphrase')||msg.toLowerCase().includes('decrypt')){
      setSyncUI('err','Wrong passphrase');
    } else if(msg.toLowerCase().includes('network')||msg.toLowerCase().includes('fetch')){
      setSyncUI('err','Network error — retry');
    } else {
      setSyncUI('err','Failed — retry');
    }
  }
  clearTimeout(syncTimeout);
  S.syncing=false;
  setTimeout(()=>setSyncUI('idle','Sync'),4000);
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
  } else {
    // No token — schedule a gentle delayed attempt after user may have interacted
    // This handles the case where the app was freshly installed / token expired
    setTimeout(()=>{
      if(loadCachedToken())triggerSync(false); // token appeared (e.g. via another tab)
      // else: stay idle, user will tap Sync button which triggers auth properly
    },3000);
  }
});

// Auto-sync every 5 mins
setInterval(()=>{if(!document.hidden)triggerSync(false);},AUTO_SYNC_INTERVAL);

// Auto-sync when app comes back to foreground — only if token cached
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&loadCachedToken()){
    waitForGoogle()
      .then(()=>triggerSync(false))
      .catch(()=>{});
  }
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
  setTimeout(()=>triggerSync(false),500);
}

// ── AI INSIGHTS ENGINE (Gemini + Google Search Grounding) ────────────────────
const INSIGHTS_KEY='vp_insights_v1';
const INSIGHTS_TTL=24*60*60*1000;
const KEYS_DRIVE_FILE='vplantations_keys.enc';
const INSIGHTS_DRIVE_FILE='vplantations_insights.json';

function loadInsightsCache(){try{const d=localStorage.getItem(INSIGHTS_KEY);return d?JSON.parse(d):null;}catch(e){return null;}}
function saveInsightsCache(data){try{localStorage.setItem(INSIGHTS_KEY,JSON.stringify({ts:Date.now(),...data}));}catch(e){}}
function insightsCacheValid(){
  const d=loadInsightsCache();
  if(!d||(Date.now()-d.ts)>=INSIGHTS_TTL)return null;
  // Check same calendar day (IST = UTC+5:30)
  const tz=5.5*3600000;
  const cacheDay=new Date(d.ts+tz).toISOString().slice(0,10);
  const todayDay=new Date(Date.now()+tz).toISOString().slice(0,10);
  return cacheDay===todayDay?d:null;
}

// ── GEMINI KEY — stored encrypted in Drive, never in plain localStorage ─────
async function loadGeminiKey(){
  if(S.geminiKey)return S.geminiKey;
  if(!cfg.passphrase||!navigator.onLine)return null;
  try{
    const f=await findNamedFile(KEYS_DRIVE_FILE);
    if(!f)return null;
    const raw=await readFile(f.id);
    const data=await decryptWithVariants(raw,cfg.passphrase);
    S.geminiKey=data.geminiKey||null;
    return S.geminiKey;
  }catch(e){return null;}
}

async function saveGeminiKeyToDrive(key){
  if(!cfg.passphrase)throw new Error('Set up sync passphrase first');
  await getOAuthToken();
  const data={geminiKey:key,savedAt:Date.now()};
  const enc=await encrypt(data,cfg.passphrase);
  const existing=await findNamedFile(KEYS_DRIVE_FILE);
  if(existing)await writeFile(existing.id,enc);
  else await writeNamedFile(null,KEYS_DRIVE_FILE,enc);
  S.geminiKey=key;
}

// Silently load Gemini key from Drive after sync — fires & forgets, never blocks
async function syncGeminiKey(){
  if(S.geminiKey)return; // already in memory
  try{
    const hadKey=!!S.geminiKey;
    await loadGeminiKey();
    // If we just got the key for the first time, trigger insights
    if(!hadKey&&S.geminiKey&&S.tab==='dashboard'){
      S.lastInsightsTrigger=0; // reset debounce so it fires
      initInsights();
    }
  }catch(e){} // silent — key sync is non-critical
}

// ── SHARED INSIGHTS CACHE (Drive) ────────────────────────────────────────────
// Reads insights from Drive so all devices share one fetch per day.
// Writes to Drive after a fresh fetch so others pick it up on next sync.
async function readInsightsFromDrive(){
  try{
    const f=await findNamedFile(INSIGHTS_DRIVE_FILE);
    if(!f)return null;
    const text=await readFile(f.id);
    const data=JSON.parse(text);
    return data;
  }catch(e){return null;}
}

async function writeInsightsToDrive(data){
  try{
    const text=JSON.stringify(data);
    const existing=await findNamedFile(INSIGHTS_DRIVE_FILE);
    if(existing)await writeFile(existing.id,text);
    else await writeNamedFile(null,INSIGHTS_DRIVE_FILE,text);
  }catch(e){} // non-critical, fire and forget
}

async function syncInsights(){
  // Skip if local cache is already valid for today
  if(insightsCacheValid())return;
  try{
    const driveData=await readInsightsFromDrive();
    if(!driveData)return;
    // Check if Drive insights are valid for today (same IST calendar day)
    const tz=5.5*3600000;
    const driveDay=new Date((driveData.ts||0)+tz).toISOString().slice(0,10);
    const todayDay=new Date(Date.now()+tz).toISOString().slice(0,10);
    if(driveDay===todayDay){
      // Fresh from Drive — save to local cache and render
      saveInsightsCache(driveData);
      if(S.tab==='dashboard')render();
    }
  }catch(e){}
}

// ── GEMINI FETCH (with Google Search grounding) ─────────────────────────────
async function fetchAIInsights(force=false){
  // Safety: if stuck fetching for >45s (e.g. previous call crashed), reset and allow retry
  if(S.fetchingInsights){
    if(!S._insightsFetchStart||Date.now()-S._insightsFetchStart>45000){
      S.fetchingInsights=false;S._insightsFetchStart=null;
    } else {
      return;
    }
  }
  // Hard rate limit: never fire more than once per 60 seconds regardless of other guards
  const now=Date.now();
  if(!force&&now-S.lastInsightsTrigger<60000)return;
  S.lastInsightsTrigger=now;
  S._insightsError=null;
  const cached=insightsCacheValid();
  if(cached&&!force){if(S.tab==='dashboard')render();return;}
  const key=await loadGeminiKey();
  if(!key){renderInsightsSetup();return;}
  S.fetchingInsights=true;S._insightsFetchStart=Date.now();
  renderInsightsLoading();
  try{
    const today=new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
    const cutoff=new Date(Date.now()-30*24*3600000).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
    const prompt=`Today is ${today}. You are a commodity news analyst. Your task is to search the web and compile a market intelligence briefing for a cardamom farmer in Thopramkudy, Idukki, Kerala, India.

LOOKBACK WINDOW: Search for news and data from the last 30 days (since ${cutoff}). Do not limit yourself to only today — recent weeks are equally valuable for understanding market trends.

CRITICAL RULES — strictly enforced:
- Every single fact, price, statistic, or claim MUST come from a web search result dated within the last 30 days.
- Do NOT use training data or memory for any factual claim. Only use what you find via web search.
- If no web search result is found for a topic within the last 30 days, write "No data found in last 30 days" — do not substitute with guesses or general knowledge.
- Do NOT invent auction prices, weather conditions, export volumes, or policy details.
- Do NOT use phrases like "typically", "historically", "generally", "tends to" — these signal memory-based hallucination.
- Always include the date of each source you cite. If you cannot find a date, say so.
- Only include a keyFactor if you found a real, datable news source from the last 30 days.

Search for ALL of the following — look back up to 30 days:
1. Cardamom auction prices at Vandanmedu, Bodinayakanur, or Kumily — last 30 days (include specific price figures and dates found)
2. Cardamom crop and harvest news in Kerala — Idukki, Wayanad, Munnar — last 30 days
3. Rainfall and weather conditions in Kerala Cardamom Hills — last 30 days
4. Guatemala cardamom production and export news — last 30 days
5. India cardamom export data — Spices Board of India, APEDA — last 30 days
6. Global cardamom demand — Middle East (Saudi Arabia, UAE), Europe — last 30 days
7. INR/USD exchange rate trend — last 30 days (affects export competitiveness)
8. Indian government policy for spice farmers — MSP, subsidies, export incentives — last 30 days
9. Any pest, disease, or supply disruption news for cardamom — last 30 days

Respond ONLY with a valid JSON object — no markdown, no text before or after the JSON:
{
  "headline": "One sentence summarising the most important market development from the last 30 days",
  "outlook": "bullish" | "bearish" | "neutral" | "volatile",
  "outlookReason": "One sentence based only on search results found — cite source and date e.g. (Spices Board, 15 Mar 2026)",
  "keyFactors": [
    {
      "icon": "relevant emoji",
      "title": "Short factor title",
      "detail": "2-3 sentences from actual search results only. Include source name and date. Write 'No data found in last 30 days' if nothing found.",
      "impact": "positive" | "negative" | "neutral",
      "source": "Source name and date e.g. 'The Hindu, 10 Mar 2026' — or 'Not found' if unavailable"
    }
  ],
  "keralaUpdate": "2-3 sentences on Kerala-specific cardamom news from the last 30 days — auction prices, rainfall, harvest, Idukki/Wayanad conditions. Cite dates. Write 'No Kerala news found in last 30 days' if nothing found.",
  "globalUpdate": "2-3 sentences on global market news from the last 30 days — Guatemala supply, Middle East demand, export trends. Cite dates. Write 'No global news found in last 30 days' if nothing found.",
  "priceOutlook": "Based on price data and news found in the last 30 days, 2-3 sentences on near-term price direction with reasoning. Write 'Insufficient data in last 30 days for price outlook' if no data found.",
  "farmerAdvice": "1-2 sentences of specific actionable advice for an Idukki cardamom farmer based on what was found in the last 30 days. Do not give generic advice.",
  "fetchedDate": "${today}",
  "dataQuality": "high" | "partial" | "low"
}

Provide 4-6 keyFactors, but ONLY for topics where you found actual news from the last 30 days. Do not pad with generic factors.`;

    // Use Google Search grounding — every fact must come from a live web source
    // Try with grounding first, fall back without if key doesn't have it enabled
    const makeBody=(withSearch)=>JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      ...(withSearch?{tools:[{google_search:{}}]}:{}),
      generationConfig:{temperature:0,maxOutputTokens:2000}
    });

    let res=await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
      {method:'POST',headers:{'Content-Type':'application/json'},body:makeBody(true),signal:AbortSignal.timeout(40000)}
    );
    // On 429 wait 8s and retry once
    if(res.status===429){
      await new Promise(r=>setTimeout(r,8000));
      res=await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
        {method:'POST',headers:{'Content-Type':'application/json'},body:makeBody(true),signal:AbortSignal.timeout(40000)}
      );
    }
    // If grounding not enabled for this key, fall back to plain (but note confidence will be lower)
    if(!res.ok){
      const errData=await res.json().catch(()=>({}));
      const errMsg=(errData.error?.message||'').toLowerCase();
      if(res.status===400&&(errMsg.includes('tool')||errMsg.includes('search')||errMsg.includes('grounding'))){
        res=await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
          {method:'POST',headers:{'Content-Type':'application/json'},body:makeBody(false),signal:AbortSignal.timeout(40000)}
        );
      }
    }
    if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error?.message||'Gemini API error '+res.status);}
    const json=await res.json();
    const parts=json.candidates?.[0]?.content?.parts||[];
    const text=parts.filter(p=>p.text).map(p=>p.text).join('');
    if(!text){
      // Surface the actual finish reason to help debug
      const reason=json.candidates?.[0]?.finishReason||'unknown';
      throw new Error('No text in response (finishReason: '+reason+')');
    }
    const clean=text.replace(/```json\n?|```\n?/g,'').trim();
    let insights;
    try{insights=JSON.parse(clean);}
    catch(e){
      // Sometimes Gemini wraps the JSON in extra text — try to extract it
      const match=clean.match(/\{[\s\S]*\}/);
      if(match){try{insights=JSON.parse(match[0]);}catch(e2){throw new Error('Could not parse Gemini response');}}
      else throw new Error('Could not parse Gemini response');
    }
    saveInsightsCache(insights);
    writeInsightsToDrive({...insights,ts:Date.now()}); // share with other devices
    showToast('Insights updated ✓');
  }catch(e){
    S._insightsError=e.message&&e.message.length<80?e.message:'Could not load insights. Check your API key or connection.';
    showToast('Insights unavailable — tap Retry');
  }
  S.fetchingInsights=false;S._insightsFetchStart=null;
  if(S.tab==='dashboard')render(); // re-render to show result or error via insightsBodyHTML
}

// ── 5AM IST SCHEDULER ────────────────────────────────────────────────────────
function scheduleInsightsFetch(){
  const IST_OFFSET=5.5*3600000;
  const now=Date.now();
  const istNow=new Date(now+IST_OFFSET);
  const target=new Date(istNow);
  target.setUTCHours(23-5,30,0,0); // 5:00 AM IST = 23:30 UTC previous day... compute properly:
  // 5:00 AM IST = 05*60+00 = 300 mins from midnight IST
  const istMidnight=new Date(istNow);
  istMidnight.setUTCHours(0-5,-(30),0,0); // back to UTC midnight of IST day
  // Simpler: next 5am IST in ms
  const istHour=istNow.getUTCHours()+5+(istNow.getUTCMinutes()>=30?1:0); // approx IST hour
  // Use a clean approach: compute ms until next 5:00 AM IST
  const nowIST=now+IST_OFFSET; // ms in IST "UTC"
  const msInDay=nowIST%(86400000);
  const target5am=5*3600000; // 5am in ms from midnight
  let msUntil=target5am-msInDay;
  if(msUntil<=0)msUntil+=86400000; // already past 5am, wait until tomorrow
  setTimeout(()=>{
    fetchAIInsights(false);
    setInterval(()=>fetchAIInsights(false),INSIGHTS_TTL);
  },msUntil);
}

// ── RENDER HELPERS ────────────────────────────────────────────────────────────
function renderInsightsSetup(){
  const el=document.getElementById('insights-card-body');
  if(!el){setTimeout(renderInsightsSetup,100);return;} // retry if not in DOM yet
  el.innerHTML=`
    <p style="font-size:13px;color:var(--tx2);line-height:1.5;margin-bottom:12px">
      Get daily AI insights on global cardamom markets — Guatemala production, India supply, export demand, price outlook, and advice for Idukki farmers.
    </p>
    <button onclick="showGeminiKeySetup()" style="width:100%;padding:11px;background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--brand-lite);cursor:pointer;font-family:inherit">
      🔑 Set up Gemini API key
    </button>
    <p style="font-size:11px;color:var(--tx3);margin-top:8px;text-align:center">Free · <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--b-tx)">Get key at aistudio.google.com</a></p>`;
}

function renderInsightsLoading(){
  const el=document.getElementById('insights-card-body');
  if(!el){setTimeout(renderInsightsLoading,100);return;}
  el.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">
      ${[80,60,100,90,70].map(w=>`<div style="height:12px;width:${w}%;border-radius:6px;background:var(--bor2);animation:pulse 1.4s ease-in-out infinite"></div>`).join('')}
    </div>
    <p style="font-size:11px;color:var(--tx3);text-align:center;margin-top:10px">Gemini is searching the web &amp; analysingobal cardamom markets…</p>`;
}

function insightsErrorHTML(msg){
  return`<div style="text-align:center;padding:12px 0">
    <div style="font-size:22px;margin-bottom:8px">⚠️</div>
    <div style="font-size:13px;color:var(--tx2);margin-bottom:12px">${msg||'Could not load insights. Check your Gemini API key and internet connection.'}</div>
    <button onclick="fetchAIInsights(true)" style="padding:9px 20px;background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:600;color:var(--brand-lite);cursor:pointer;font-family:inherit">↻ Retry</button>
  </div>`;
}

const OUTLOOK_STYLE={
  bullish:{bg:'var(--g-bg)',border:'var(--g-bor)',color:'var(--brand-lite)',label:'Bullish ↑'},
  bearish:{bg:'var(--r-bg)',border:'var(--r-bor)',color:'var(--r-tx)',label:'Bearish ↓'},
  neutral:{bg:'var(--b-bg)',border:'var(--b-bor)',color:'var(--b-tx)',label:'Neutral →'},
  volatile:{bg:'var(--a-bg)',border:'var(--a-bor)',color:'var(--a-mid)',label:'Volatile ↕'},
};
const IMPACT_DOT={positive:'var(--brand-lite)',negative:'var(--r-tx)',neutral:'var(--tx3)'};
const CONF_LABEL={high:'High confidence',medium:'Medium confidence',low:'Low — verify before acting'};

function renderInsightsCard(d){
  const el=document.getElementById('insights-card-body');
  if(!el)return;
  const ol=OUTLOOK_STYLE[d.outlook]||OUTLOOK_STYLE.neutral;
  const age=d.ts?Math.round((Date.now()-d.ts)/3600000):0;
  const ageLabel=age<1?'Just now':age<24?age+'h ago':'Yesterday';
  const dq=d.dataQuality||d.confidence||'partial';
  const dqLabel={'high':'🟢 Live data','partial':'🟡 Partial data','medium':'🟡 Partial data','low':'🔴 Limited data'}[dq]||'🟡 Partial data';
  const factors=(d.keyFactors||[]).map(f=>`
    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--bor)">
      <div style="font-size:20px;flex-shrink:0;line-height:1.4">${f.icon||'📌'}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600;color:var(--tx)">${f.title}</span>
          <span style="width:7px;height:7px;border-radius:50%;background:${IMPACT_DOT[f.impact]||IMPACT_DOT.neutral};flex-shrink:0;display:inline-block"></span>
        </div>
        <div style="font-size:12px;color:var(--tx2);line-height:1.5">${f.detail}</div>
        ${f.source&&f.source!=='Not found'?`<div style="font-size:10px;color:var(--tx3);margin-top:3px">📎 ${f.source}</div>`:''}
      </div>
    </div>`).join('');
  el.innerHTML=`
    <div style="background:${ol.bg};border:1.5px solid ${ol.border};border-radius:var(--rs);padding:12px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700;color:${ol.color};background:${ol.border};padding:3px 10px;border-radius:10px">${ol.label}</span>
        <span style="font-size:11px;color:var(--tx3)">${ageLabel} · ${d.fetchedDate||''}</span>
        <span style="font-size:10px;color:var(--tx3);margin-left:auto">${dqLabel}</span>
      </div>
      <div style="font-size:14px;font-weight:600;color:var(--tx);line-height:1.4">${d.headline||''}</div>
      <div style="font-size:12px;color:var(--tx2);margin-top:4px">${d.outlookReason||''}</div>
    </div>
    ${d.keralaUpdate?`
    <div style="background:var(--g-bg);border:1px solid var(--g-bor);border-radius:var(--rs);padding:11px 13px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--brand-lite);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">🌿 Kerala update</div>
      <div style="font-size:12px;color:var(--tx2);line-height:1.5">${d.keralaUpdate}</div>
    </div>`:''}
    ${d.globalUpdate?`
    <div style="background:var(--b-bg);border:1px solid var(--b-bor);border-radius:var(--rs);padding:11px 13px;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:var(--b-tx);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">🌍 Global update</div>
      <div style="font-size:12px;color:var(--tx2);line-height:1.5">${d.globalUpdate}</div>
    </div>`:''}
    <div style="margin-bottom:12px">${factors}</div>
    ${d.priceOutlook?`
    <div style="background:var(--sur2);border-radius:var(--rs);padding:12px;margin-bottom:10px;border:1px solid var(--bor)">
      <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">Price outlook</div>
      <div style="font-size:13px;color:var(--tx2);line-height:1.5">${d.priceOutlook}</div>
    </div>`:''}
    ${d.farmerAdvice?`
    <div style="background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);padding:12px">
      <div style="font-size:11px;font-weight:700;color:var(--brand-lite);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">💡 For Idukki farmers</div>
      <div style="font-size:13px;color:var(--tx);line-height:1.5">${d.farmerAdvice}</div>
    </div>`:''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
      <p style="font-size:10px;color:var(--tx3)">Sources: live web search · refreshes daily 5am IST</p>
      <button onclick="fetchAIInsights(true)" style="background:none;border:1.5px solid var(--bor2);border-radius:20px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--tx3);cursor:pointer;font-family:inherit">↻ Refresh</button>
    </div>`;
}

function initInsights(){
  // Cache valid — render() already shows it via insightsBodyHTML(), nothing to do
  if(insightsCacheValid())return;
  // Debounce
  const now=Date.now();
  if(now-S.lastInsightsTrigger<10000)return;
  S.lastInsightsTrigger=now;
  if(!cfg.passphrase||!navigator.onLine)return; // insightsBodyHTML shows correct state
  // Load key then fetch — render() shows loading state via S.fetchingInsights
  loadGeminiKey().then(key=>{
    if(key)fetchAIInsights(false);
    // No key: insightsBodyHTML shows setup prompt automatically
  }).catch(()=>{});
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard(){
  const inc=totalInc(),exp=totalExp(),profit=inc-exp,plants=totalPlants(),ykg=totalYield();
  const byCat={};db.expenses.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+e.amount);
  const maxE=Math.max(...Object.values(byCat),1);
  const bClr={labor:'var(--brand-glow)',pesticide:'var(--r-tx)',rawmat:'var(--a-mid)',crop:'var(--b-tx)',other:'var(--tx3)'};
  const recent=[...db.yields.map(y=>({t:'y',y,ts:y.createdAt||0})),...db.incomes.map(i=>({t:'i',i,ts:i.createdAt||0})),...db.expenses.map(e=>({t:'e',e,ts:e.createdAt||0}))].sort((a,b)=>b.ts-a.ts).slice(0,5);
  const hasPrice=db.priceRaw||db.priceDried;
  const insightsOpen=S.insightsOpen!==false; // default open
  return`
<div class="pbanner">
  <div class="pbanner-label">
    <span>Cardamom prices · Vandanmedu</span>
    <button class="manual-btn" onclick="showEditPrice()">Update</button>
  </div>
  <div class="pbanner-grid">
    <div class="price-block">
      <div class="price-type">Raw / Green</div>
      <div class="price-val">${db.priceRaw?'₹'+db.priceRaw.toLocaleString('en-IN'):'<span style="opacity:0.4">—</span>'}<span>/kg</span></div>
    </div>
    <div class="price-block">
      <div class="price-type">Dried</div>
      <div class="price-val">${db.priceDried?'₹'+db.priceDried.toLocaleString('en-IN'):'<span style="opacity:0.4">—</span>'}<span>/kg</span></div>
    </div>
  </div>
  ${hasPrice?`<div class="price-source">${db.priceSource||'Manual entry'} · ${db.priceDate||''}</div>`:''}
</div>

<div class="card">
  <div class="ct">Farm overview</div>
  <div class="mg">
    <div class="met"><div class="ml">Total plants</div><div class="mv">${plants.toLocaleString('en-IN')}</div><div class="ms">${db.sections.length} sections</div></div>
    <div class="met"><div class="ml">Total yield</div><div class="mv">${ykg} kg</div><div class="ms">${db.yields.length} entries</div></div>
    <div class="met g"><div class="ml">Total income</div><div class="mv">${fc(inc)}</div><div class="ms">${db.incomes.length} sales</div></div>
    <div class="met ${profit>=0?'g':'r'}"><div class="ml">Net profit</div><div class="mv">${fc(profit)}</div><div class="ms">after expenses</div></div>
  </div>
</div>

${Object.keys(byCat).length?`
<div class="card">
  <div class="ct">Expense breakdown</div>
  ${Object.entries(byCat).map(([cat,amt])=>`
  <div class="br-row">
    <div class="br-lbl">${CL[cat]||cat}</div>
    <div class="br-trk"><div class="br-fill" style="background:linear-gradient(90deg,${bClr[cat]},${bClr[cat]}99);width:${Math.round(amt/maxE*100)}%"></div></div>
    <div class="br-val">${fc(amt)}</div>
  </div>`).join('')}
</div>`:''}

${recent.length?`
<div class="card">
  <div class="ct">Recent activity</div>
  ${recent.map(a=>
    a.t==='y'?`<div class="row"><div><div class="rt">Yield — ${secName(a.y.sectionId)}</div><div class="rs">${a.y.date}</div></div><div style="color:var(--brand-lite);font-weight:700;margin-left:8px">${a.y.qty} kg</div></div>`
    :a.t==='i'?`<div class="row"><div><div class="rt">Sale — ${esc(a.i.buyer||'—')}</div><div class="rs">${fd(a.i.date)} · ${a.i.qty}kg @ ₹${a.i.pricePerKg}</div></div><div style="color:var(--brand-lite);font-weight:700;margin-left:8px">${fc(a.i.qty*a.i.pricePerKg)}</div></div>`
    :`<div class="row"><div><div class="rt">Expense — ${esc(a.e.desc)}</div><div class="rs">${CL[a.e.category]||a.e.category}${a.e.date?' · '+fd(a.e.date):''}</div></div><div style="color:var(--r-tx);font-weight:700;margin-left:8px">${fc(a.e.amount)}</div></div>`
  ).join('')}
</div>`:''}

${!cfg.passphrase?`<div class="sbox"><h3>⚙️ Set up sync</h3><p>Tap Sync to configure encrypted Google Drive backup.</p></div>`:
cfg.lastSyncTs?`<p class="slog">Last synced ${new Date(cfg.lastSyncTs).toLocaleString('en-IN')}</p>`:''}

<div class="card" style="margin-bottom:12px;padding:0">
  <button onclick="S.insightsOpen=!S.insightsOpen;render()" style="width:100%;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:none;border:none;padding:14px 16px;min-height:56px;font-family:inherit;text-align:left;-webkit-tap-highlight-color:rgba(0,0,0,0.06)">
    <div style="display:flex;align-items:center;gap:10px;pointer-events:none">
      <span style="font-size:18px;line-height:1">🌍</span>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--tx)">Market insights</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:1px">Global cardamom · AI-powered · Daily</div>
      </div>
    </div>
    <svg style="flex-shrink:0;transition:transform 0.2s;transform:rotate(${insightsOpen?'0':'180'}deg);pointer-events:none" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--tx3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11L9 6L14 11"/></svg>
  </button>
  ${insightsOpen?`<div id="insights-card-body" style="padding:0 16px 16px;border-top:1px solid var(--bor)">
    <div style="padding-top:14px">${insightsBodyHTML()}</div>
  </div>`:''}
</div>`;
}

// Returns the correct insights HTML synchronously based on current state
function insightsBodyHTML(){
  // 1. Valid cached data — render it
  const cached=insightsCacheValid();
  if(cached){
    // Render inline — same as renderInsightsCard but returns string instead of setting innerHTML
    const ol=OUTLOOK_STYLE[cached.outlook]||OUTLOOK_STYLE.neutral;
    const age=cached.ts?Math.round((Date.now()-cached.ts)/3600000):0;
    const ageLabel=age<1?'Just now':age<24?age+'h ago':'Yesterday';
    const dq=cached.dataQuality||cached.confidence||'partial';
    const dqLabel={'high':'🟢 Live data','partial':'🟡 Partial data','medium':'🟡 Partial data','low':'🔴 Limited data'}[dq]||'🟡 Partial data';
    const factors=(cached.keyFactors||[]).map(f=>`
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--bor)">
        <div style="font-size:20px;flex-shrink:0;line-height:1.4">${f.icon||'📌'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">
            <span style="font-size:13px;font-weight:600;color:var(--tx)">${f.title}</span>
            <span style="width:7px;height:7px;border-radius:50%;background:${IMPACT_DOT[f.impact]||IMPACT_DOT.neutral};flex-shrink:0;display:inline-block"></span>
          </div>
          <div style="font-size:12px;color:var(--tx2);line-height:1.5">${f.detail}</div>
          ${f.source&&f.source!=='Not found'?`<div style="font-size:10px;color:var(--tx3);margin-top:3px">📎 ${f.source}</div>`:''}
        </div>
      </div>`).join('');
    return `
      <div style="background:${ol.bg};border:1.5px solid ${ol.border};border-radius:var(--rs);padding:12px 14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;color:${ol.color};background:${ol.border};padding:3px 10px;border-radius:10px">${ol.label}</span>
          <span style="font-size:11px;color:var(--tx3)">${ageLabel} · ${cached.fetchedDate||''}</span>
          <span style="font-size:10px;color:var(--tx3);margin-left:auto">${dqLabel}</span>
        </div>
        <div style="font-size:14px;font-weight:600;color:var(--tx);line-height:1.4">${cached.headline||''}</div>
        <div style="font-size:12px;color:var(--tx2);margin-top:4px">${cached.outlookReason||''}</div>
      </div>
      ${cached.keralaUpdate?`
      <div style="background:var(--g-bg);border:1px solid var(--g-bor);border-radius:var(--rs);padding:11px 13px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--brand-lite);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">🌿 Kerala update</div>
        <div style="font-size:12px;color:var(--tx2);line-height:1.5">${cached.keralaUpdate}</div>
      </div>`:''}
      ${cached.globalUpdate?`
      <div style="background:var(--b-bg);border:1px solid var(--b-bor);border-radius:var(--rs);padding:11px 13px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--b-tx);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">🌍 Global update</div>
        <div style="font-size:12px;color:var(--tx2);line-height:1.5">${cached.globalUpdate}</div>
      </div>`:''}
      <div style="margin-bottom:12px">${factors}</div>
      ${cached.priceOutlook?`
      <div style="background:var(--sur2);border-radius:var(--rs);padding:12px;margin-bottom:10px;border:1px solid var(--bor)">
        <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">Price outlook</div>
        <div style="font-size:13px;color:var(--tx2);line-height:1.5">${cached.priceOutlook}</div>
      </div>`:''}
      ${cached.farmerAdvice?`
      <div style="background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);padding:12px">
        <div style="font-size:11px;font-weight:700;color:var(--brand-lite);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px">💡 For Idukki farmers</div>
        <div style="font-size:13px;color:var(--tx);line-height:1.5">${cached.farmerAdvice}</div>
      </div>`:''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
        <p style="font-size:10px;color:var(--tx3)">Sources: live web search · refreshes daily 5am IST</p>
        <button onclick="fetchAIInsights(true)" style="background:none;border:1.5px solid var(--bor2);border-radius:20px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--tx3);cursor:pointer;font-family:inherit">↻ Refresh</button>
      </div>`;
  }
  // 2. Currently fetching
  if(S.fetchingInsights){
    return `<div style="display:flex;flex-direction:column;gap:8px;padding:4px 0">
      ${[80,60,100,90,70].map(w=>`<div style="height:12px;width:${w}%;border-radius:6px;background:var(--bor2);animation:pulse 1.4s ease-in-out infinite"></div>`).join('')}
    </div>
    <p style="font-size:11px;color:var(--tx3);text-align:center;margin-top:10px">Gemini is searching the web &amp; analysing markets…</p>`;
  }
  // 3. No passphrase or no key
  if(!cfg.passphrase||!S.geminiKey){
    return `<p style="font-size:13px;color:var(--tx2);line-height:1.5;margin-bottom:12px">
      Get daily AI insights on global cardamom markets — Guatemala production, India supply, export demand, price outlook, and advice for Idukki farmers.
    </p>
    <button onclick="showGeminiKeySetup()" style="width:100%;padding:11px;background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--brand-lite);cursor:pointer;font-family:inherit">
      🔑 Set up Gemini API key
    </button>
    <p style="font-size:11px;color:var(--tx3);margin-top:8px;text-align:center">Free · <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--b-tx)">Get key at aistudio.google.com</a></p>`;
  }
  // 4. Previous fetch errored
  if(S._insightsError){
    return `<div style="text-align:center;padding:12px 0">
      <div style="font-size:22px;margin-bottom:8px">⚠️</div>
      <div style="font-size:13px;color:var(--tx2);margin-bottom:12px">${S._insightsError}</div>
      <button onclick="S._insightsError=null;fetchAIInsights(true)" style="padding:9px 20px;background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:600;color:var(--brand-lite);cursor:pointer;font-family:inherit">↻ Retry</button>
    </div>`;
  }
  // 5. Key exists but not fetched yet — show fetch prompt
  return `<p style="font-size:13px;color:var(--tx2);margin-bottom:12px">Insights refresh daily at 5am IST. Tap to fetch now.</p>
    <button onclick="fetchAIInsights(true)" style="width:100%;padding:11px;background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--brand-lite);cursor:pointer;font-family:inherit">
      🔍 Fetch insights now
    </button>`;
}


// ── SECTIONS ──────────────────────────────────────────────────────────────────
function renderSections(){
  return`
<div class="card">
  <div class="ct">Plant sections</div>
  ${db.sections.length===0?`<div class="empty"><svg viewBox="0 0 20 20" fill="none" stroke-width="1.5"><path stroke-linecap="round" d="M3 5h14M3 10h10M3 15h7"/></svg><br>No sections yet</div>`:
  db.sections.map(s=>`
  <div class="row">
    <div style="flex:1;min-width:0">
      <div class="rt">${esc(s.name)}</div>
      <div class="rs">${s.plants} plants · Age ${s.age}yr${s.notes?' · '+esc(s.notes):''}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-left:8px;flex-shrink:0">
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:700;color:var(--brand-lite)">${yieldForSec(s.id)} kg</div>
        <div style="font-size:10px;color:var(--tx3)">yield</div>
      </div>
      <div class="racts">
        <button class="ia e" onclick="showEditSection('${s.id}')">Edit</button>
        <button class="ia d" onclick="confirmDel('section','${s.id}','${esc(s.name)}')">Del</button>
      </div>
    </div>
  </div>`).join('')}
  <button class="add-btn" onclick="showEditSection(null)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 2v10M2 7h10"/></svg>Add section</button>
</div>

<div class="card">
  <div class="ct">Summary</div>
  <div class="mg">
    <div class="met b"><div class="ml">Sections</div><div class="mv">${db.sections.length}</div></div>
    <div class="met"><div class="ml">Total plants</div><div class="mv">${totalPlants().toLocaleString('en-IN')}</div></div>
    <div class="met g"><div class="ml">Avg yield/plant</div><div class="mv">${totalPlants()>0?(totalYield()/totalPlants()).toFixed(2):0} kg</div></div>
    <div class="met a"><div class="ml">Best section</div><div class="mv" style="font-size:13px">${[...db.sections].sort((a,b)=>yieldForSec(b.id)-yieldForSec(a.id))[0]?.name||'—'}</div></div>
  </div>
</div>

`;}

// ── YIELD ─────────────────────────────────────────────────────────────────────
// ── CHART HELPERS ─────────────────────────────────────────────────────────────
// Pure SVG charts — no libraries, theme-aware via CSS vars

function svgBar(data, opts={}){
  // data: [{label, value, color?, sub?}]
  const W=opts.w||460, H=opts.h||180, PAD={t:10,r:12,b:36,l:44};
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const max=Math.max(...data.map(d=>d.value),1);
  const bW=Math.max(4, Math.floor(cW/data.length)-4);
  const gap=(cW-bW*data.length)/(data.length+1);
  // Y grid lines
  const ticks=4;
  let grid='', xlabels='', bars='', ylabels='';
  for(let i=0;i<=ticks;i++){
    const y=PAD.t+cH*(1-i/ticks);
    const val=Math.round(max*i/ticks);
    grid+=`<line x1="${PAD.l}" x2="${W-PAD.r}" y1="${y}" y2="${y}" stroke="var(--bor)" stroke-width="1"/>`;
    ylabels+=`<text x="${PAD.l-5}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--tx3)">${opts.yFmt?opts.yFmt(val):val}</text>`;
  }
  data.forEach((d,i)=>{
    const x=PAD.l+gap*(i+1)+bW*i;
    const bH=Math.max(2,Math.round((d.value/max)*cH));
    const y=PAD.t+cH-bH;
    const col=d.color||'var(--brand-lite)';
    bars+=`<rect x="${x}" y="${y}" width="${bW}" height="${bH}" rx="3" fill="${col}" opacity="0.92"/>`;
    // value label on top if bar is tall enough
    if(bH>18) bars+=`<text x="${x+bW/2}" y="${y-3}" text-anchor="middle" font-size="9" fill="var(--tx3)" font-weight="600">${opts.vFmt?opts.vFmt(d.value):d.value}</text>`;
    // x label
    const lbl=d.label.length>6?d.label.slice(0,6):d.label;
    xlabels+=`<text x="${x+bW/2}" y="${H-PAD.b+14}" text-anchor="middle" font-size="9" fill="var(--tx3)">${lbl}</text>`;
    if(d.sub) xlabels+=`<text x="${x+bW/2}" y="${H-PAD.b+24}" text-anchor="middle" font-size="8" fill="var(--tx3)">${d.sub}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">${grid}${ylabels}${bars}${xlabels}</svg>`;
}

function svgLine(series, opts={}){
  // series: [{label, values:[{x,y}], color}]  x=label string, y=number
  const W=opts.w||460, H=opts.h||160, PAD={t:14,r:12,b:36,l:48};
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const allY=series.flatMap(s=>s.values.map(v=>v.y));
  const maxY=Math.max(...allY,1), minY=0;
  const xLabels=series[0]?.values.map(v=>v.x)||[];
  const nX=xLabels.length; if(nX<2) return '';
  const xStep=cW/(nX-1);
  const py=v=>PAD.t+cH*(1-(v-minY)/(maxY-minY));
  const px=i=>PAD.l+i*xStep;
  const ticks=4;
  let grid='',ylabels='',xlabels='',paths='',dots='',areas='';
  for(let i=0;i<=ticks;i++){
    const y=PAD.t+cH*(1-i/ticks);
    const val=Math.round(maxY*i/ticks);
    grid+=`<line x1="${PAD.l}" x2="${W-PAD.r}" y1="${y}" y2="${y}" stroke="var(--bor)" stroke-width="1"/>`;
    ylabels+=`<text x="${PAD.l-5}" y="${y+4}" text-anchor="end" font-size="9" fill="var(--tx3)">${opts.yFmt?opts.yFmt(val):val}</text>`;
  }
  xLabels.forEach((lbl,i)=>{
    if(i%Math.max(1,Math.floor(nX/6))===0||i===nX-1)
      xlabels+=`<text x="${px(i)}" y="${H-PAD.b+13}" text-anchor="middle" font-size="9" fill="var(--tx3)">${lbl.length>7?lbl.slice(0,7):lbl}</text>`;
  });
  series.forEach(s=>{
    const pts=s.values;
    const col=s.color||'var(--brand-lite)';
    const d='M'+pts.map((p,i)=>`${px(i)},${py(p.y)}`).join('L');
    // area fill
    const areaD=d+`L${px(pts.length-1)},${PAD.t+cH}L${px(0)},${PAD.t+cH}Z`;
    areas+=`<path d="${areaD}" fill="${col}" opacity="0.08"/>`;
    paths+=`<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    pts.forEach((p,i)=>{dots+=`<circle cx="${px(i)}" cy="${py(p.y)}" r="3" fill="${col}" stroke="var(--sur)" stroke-width="1.5"/>`;});
  });
  // legend
  let legend='';
  if(series.length>1) series.forEach((s,i)=>{
    legend+=`<circle cx="${PAD.l+i*80+6}" cy="${H-5}" r="4" fill="${s.color||'var(--brand-lite)'}"/>`;
    legend+=`<text x="${PAD.l+i*80+14}" y="${H-1}" font-size="9" fill="var(--tx2)">${s.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H+(series.length>1?8:0)}" width="100%" style="display:block;overflow:visible">${grid}${ylabels}${areas}${paths}${dots}${xlabels}${legend}</svg>`;
}

function svgDonut(slices, opts={}){
  const total=slices.reduce((s,x)=>s+x.value,0); if(!total) return '';
  const R=opts.r||54, r=opts.inner||32, CX=opts.cx||70, CY=opts.cy||70, W=opts.w||280;
  // Height must fit: circle bottom (CY+R+8 padding) AND all legend rows
  const legendRows=slices.length;
  const legendBottom=14+legendRows*20+8;
  const circleBottom=CY+R+8;
  const H=opts.h||Math.max(circleBottom, legendBottom);
  let angle=-Math.PI/2, paths='', legend='';
  slices.forEach((sl,i)=>{
    const sweep=(sl.value/total)*Math.PI*2;
    const x1=CX+R*Math.cos(angle), y1=CY+R*Math.sin(angle);
    const x2=CX+R*Math.cos(angle+sweep), y2=CY+R*Math.sin(angle+sweep);
    const xi1=CX+r*Math.cos(angle), yi1=CY+r*Math.sin(angle);
    const xi2=CX+r*Math.cos(angle+sweep), yi2=CY+r*Math.sin(angle+sweep);
    const lg=sweep>Math.PI?1:0;
    const d=`M${xi1},${yi1} L${x1},${y1} A${R},${R},0,${lg},1,${x2},${y2} L${xi2},${yi2} A${r},${r},0,${lg},0,${xi1},${yi1}Z`;
    paths+=`<path d="${d}" fill="${sl.color}" opacity="0.9"/>`;
    const pct=Math.round(sl.value/total*100);
    const lrow=i;
    legend+=`<rect x="${CX+R+14}" y="${14+lrow*20}" width="10" height="10" rx="2" fill="${sl.color}"/>`;
    legend+=`<text x="${CX+R+28}" y="${22+lrow*20}" font-size="10" fill="var(--tx2)" font-weight="500">${sl.label}</text>`;
    legend+=`<text x="${W-8}" y="${22+lrow*20}" text-anchor="end" font-size="10" fill="var(--tx3)">${pct}%</text>`;
    angle+=sweep;
  });
  const cLabel=opts.centerLabel||'';
  const cSub=opts.centerSub||'';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible"><circle cx="${CX}" cy="${CY}" r="${R+2}" fill="var(--sur2)"/>${paths}<text x="${CX}" y="${CY-6}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--tx)">${cLabel}</text><text x="${CX}" y="${CY+10}" text-anchor="middle" font-size="9" fill="var(--tx3)">${cSub}</text>${legend}</svg>`;
}

// ── PERIOD FILTER HELPER ──────────────────────────────────────────────────────
function periodFilterUI(stateKey, onchange){
  const p=S[stateKey];
  const btn=(v,lbl)=>`<button onclick="S['${stateKey}']='${v}';render()" style="padding:5px 12px;font-size:11px;font-weight:600;border-radius:14px;border:1.5px solid ${p===v?'var(--b-tx)':'var(--bor2)'};background:${p===v?'var(--b-bg)':'transparent'};color:${p===v?'var(--b-tx)':'var(--tx3)'};cursor:pointer;font-family:inherit">${lbl}</button>`;
  return`<div style="display:flex;gap:6px;margin-bottom:12px">${btn('month','Monthly')}${btn('quarter','Quarterly')}${btn('year','Yearly')}</div>`;
}

function groupByPeriod(entries, dateFn, valFn, period){
  // returns sorted [{label, value}]
  const map={};
  entries.forEach(e=>{
    const d=dateFn(e); if(!d) return;
    let key;
    if(period==='month') key=d.slice(0,7);
    else if(period==='quarter'){
      const yr=d.slice(0,4), mo=parseInt(d.slice(5,7));
      key=yr+' Q'+Math.ceil(mo/3);
    } else key=d.slice(0,4);
    map[key]=(map[key]||0)+valFn(e);
  });
  return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>({label:k,value:v}));
}

function shortLabel(l,period){
  if(period==='month') return l.slice(2); // 24-03 → 03
  if(period==='quarter') return l.replace(/20(\d\d)/,'\'$1'); // 2024 Q3 → '24 Q3
  return l.slice(2); // 2024 → 24
}

// ── RECORDS (wrapper with sub-tabs) ───────────────────────────────────────────
function renderRecords(){
  const t=S.recTab||'yield';
  const tabs=[
    {id:'yield', label:'Yield', icon:'📈'},
    {id:'expenses', label:'Expenses', icon:'💸'},
    {id:'income', label:'Income', icon:'💰'},
    {id:'drying', label:'Drying', icon:'☀️'},
  ];
  const subNav=`<div class="subtab-bar" style="position:sticky;top:57px;z-index:10">
    ${tabs.map(tb=>`<button class="stb ${t===tb.id?'active':''}" onclick="S.recTab='${tb.id}';render()">${tb.label}</button>`).join('')}
  </div>`;
  const inner={yield:renderYield,expenses:renderExpenses,income:renderIncome,drying:renderDrying}[t]||renderYield;
  return subNav+inner();
}

// ── YIELD ─────────────────────────────────────────────────────────────────────
function renderYield(){
  const period=S.yieldPeriod||'month';
  const grouped=groupByPeriod(db.yields, y=>y.date?y.date+'-01':null, y=>y.qty||0, period);
  const totalKg=db.yields.reduce((s,y)=>s+(y.qty||0),0);
  const avgPeriod=grouped.length?Math.round(totalKg/grouped.length):0;
  const peakEntry=grouped.length?grouped.reduce((a,b)=>b.value>a.value?b:a):null;
  const bySec={};
  db.yields.forEach(y=>{const k=y.sectionId||'__all';bySec[k]=(bySec[k]||0)+y.qty;});
  const secColors=['var(--brand-lite)','var(--a-mid)','var(--b-tx)','var(--b-tx)','var(--r-tx)','var(--brand-glow)'];
  const secSlices=Object.entries(bySec).map(([id,v],i)=>({label:secName(id).slice(0,12),value:v,color:secColors[i%secColors.length]}));
  const lineData=grouped.map(g=>({x:shortLabel(g.label,period),y:g.value}));
  const periodLbl={month:'month',quarter:'quarter',year:'year'}[period];
  return`
<div class="card">
  <button class="add-btn" onclick="showEditYield(null)" style="width:100%;margin-bottom:14px;padding:11px;background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--brand-lite);cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 2v10M2 7h10"/></svg>Add yield record</button>
  <div class="ct">Yield overview</div>
  <div class="mg" style="margin-bottom:14px">
    <div class="met g"><div class="ml">Total yield</div><div class="mv">${totalKg} kg</div><div class="ms">${db.yields.length} records</div></div>
    <div class="met b"><div class="ml">Avg / ${periodLbl}</div><div class="mv">${avgPeriod} kg</div><div class="ms">over ${grouped.length} ${periodLbl}s</div></div>
    <div class="met"><div class="ml">Best ${periodLbl}</div><div class="mv" style="font-size:13px">${peakEntry?shortLabel(peakEntry.label,period):'—'}</div><div class="ms">${peakEntry?peakEntry.value+' kg':''}</div></div>
    <div class="met a"><div class="ml">Yield/plant</div><div class="mv" style="font-size:16px">${totalPlants()>0?(totalKg/totalPlants()).toFixed(2):0}</div><div class="ms">kg/plant</div></div>
  </div>
  ${periodFilterUI('yieldPeriod')}
  ${grouped.length>=2?`
  <div style="margin-bottom:4px">
    <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Yield over time (kg)</div>
    ${svgLine([{label:'Yield',values:lineData,color:'var(--brand-lite)'}],{h:150,yFmt:v=>v})}
  </div>`:grouped.length===1?`
  <div style="margin-bottom:4px">
    ${svgBar(grouped.map(g=>({label:shortLabel(g.label,period),value:g.value,color:'var(--brand-lite)'})),{h:120})}
  </div>`:''}
  ${secSlices.length>1?`
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bor)">
    <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">By section</div>
    ${svgDonut(secSlices,{centerLabel:totalKg+'kg',centerSub:'total',w:290})}
  </div>`:''}
</div>
<div class="card">
  <div class="ct">Records
    ${db.yields.length>10?`<span style="font-size:11px;color:var(--tx3);margin-left:auto">${db.yields.length} total</span>`:''}
  </div>
  ${(()=>{
    const all=[...db.yields].reverse();
    const shown=S.showAllYield?all:all.slice(0,10);
    if(all.length===0)return'<div class="empty">No records</div>';
    return shown.map(y=>`
  <div class="row">
    <div style="flex:1;min-width:0">
      <div class="rt">${secName(y.sectionId)}</div>
      <div class="rs">${y.date}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-left:8px;flex-shrink:0">
      <div style="color:var(--brand-lite);font-weight:700;font-size:15px">${y.qty} kg</div>
      <div class="racts">
        <button class="ia e" onclick="showEditYield('${y.id}')">Edit</button>
        <button class="ia d" onclick="confirmDel('yield','${y.id}','${y.qty}kg on ${y.date}')">Del</button>
      </div>
    </div>
  </div>`).join('')+(all.length>10?`<button onclick="S.showAllYield=!S.showAllYield;render()" style="width:100%;margin-top:10px;padding:9px;background:transparent;border:1px solid var(--bor2);border-radius:var(--rs);font-size:12px;color:var(--tx3);cursor:pointer;font-family:inherit">${S.showAllYield?'Show less ↑':'Show all '+all.length+' records ↓'}</button>`:'');
  })()}
</div>`;
}

// ── EXPENSES ──────────────────────────────────────────────────────────────────
function renderExpenses(){
  const period=S.expPeriod||'month';
  const t=S.expTab,filtered=t==='all'?db.expenses:db.expenses.filter(e=>e.category===t);
  const totalAll=db.expenses.reduce((s,e)=>s+e.amount,0);
  const byCat={};
  db.expenses.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+e.amount);
  const catColors={labor:'var(--brand-glow)',pesticide:'var(--r-tx)',rawmat:'var(--a-mid)',crop:'var(--b-tx)',other:'var(--tx2)'};
  const catSlices=Object.entries(byCat).filter(([,v])=>v>0).map(([k,v])=>({label:CL[k]||k,value:v,color:catColors[k]||'var(--tx3)'}));
  const grouped=groupByPeriod(db.expenses, e=>e.date, e=>e.amount||0, period);
  const avgPeriod=grouped.length?Math.round(totalAll/grouped.length):0;
  const peakEntry=grouped.length?grouped.reduce((a,b)=>b.value>a.value?b:a):null;
  const periodLbl={month:'month',quarter:'quarter',year:'year'}[period];
  return`
<div class="card">
  <button onclick="showEditExpense(null)" style="width:100%;margin-bottom:14px;padding:11px;background:var(--r-bg);border:1.5px solid var(--r-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--r-tx);cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 2v10M2 7h10"/></svg>Add expense</button>
  <div class="ct">Expense overview</div>
  <div class="mg" style="margin-bottom:14px">
    <div class="met r"><div class="ml">Total spent</div><div class="mv">${fc(totalAll)}</div><div class="ms">${db.expenses.length} entries</div></div>
    <div class="met"><div class="ml">Avg / ${periodLbl}</div><div class="mv" style="font-size:15px">${fc(avgPeriod)}</div><div class="ms">over ${grouped.length} ${periodLbl}s</div></div>
    <div class="met a"><div class="ml">Highest ${periodLbl}</div><div class="mv" style="font-size:13px">${peakEntry?shortLabel(peakEntry.label,period):'—'}</div><div class="ms">${peakEntry?fc(peakEntry.value):''}</div></div>
    <div class="met b"><div class="ml">Top category</div><div class="mv" style="font-size:13px">${catSlices.length?[...catSlices].sort((a,b)=>b.value-a.value)[0].label:'—'}</div></div>
  </div>
  ${catSlices.length>1?`
  <div style="margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">By category</div>
    ${svgDonut(catSlices,{centerLabel:fc(totalAll).replace('₹',''),centerSub:'total ₹',w:290})}
  </div>`:''}
  ${periodFilterUI('expPeriod')}
  ${grouped.length>=2?`
  <div style="padding-top:4px">
    <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Spend trend</div>
    ${svgLine([{label:'Expenses',values:grouped.map(g=>({x:shortLabel(g.label,period),y:g.value})),color:'var(--r-tx)'}],{h:140,yFmt:v=>'₹'+Math.round(v/1000)+'k'})}
  </div>`:''}
</div>
<div class="card">
  <div class="ct">Expenses</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
    ${['all','labor','pesticide','rawmat','crop','other'].map(c=>`<button onclick="S.expTab='${c}';render()" style="padding:5px 12px;font-size:11px;font-weight:500;border-radius:14px;border:1.5px solid ${t===c?'var(--b-tx)':'var(--bor2)'};background:${t===c?'var(--b-bg)':'transparent'};color:${t===c?'var(--b-tx)':'var(--tx3)'};cursor:pointer;font-family:inherit;white-space:nowrap">${c==='all'?'All':CL[c]||c}</button>`).join('')}
  </div>
  ${(()=>{
    const all=[...filtered].sort((a,b)=>b.date?.localeCompare(a.date||'')||0);
    if(all.length===0)return`<div class="empty">No expenses${t!=='all'?' in this category':''}</div>`;
    const shown=S.showAllExp?all:all.slice(0,10);
    return shown.map(e=>`
  <div class="row">
    <div style="flex:1;min-width:0">
      <div class="rt">${esc(e.desc)}</div>
      <div class="rs">${CL[e.category]||e.category}${e.date?' · '+fd(e.date):''}${e.sectionId?' · '+secName(e.sectionId):''}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-left:8px;flex-shrink:0">
      <div style="color:var(--r-tx);font-weight:700;font-size:14px">${fc(e.amount)}</div>
      <div class="racts">
        <button class="ia e" onclick="showEditExpense('${e.id}')">Edit</button>
        <button class="ia d" onclick="confirmDel('expense','${e.id}','${esc(e.desc)}')">Del</button>
      </div>
    </div>
  </div>`).join('')+(all.length>10?`<button onclick="S.showAllExp=!S.showAllExp;render()" style="width:100%;margin-top:10px;padding:9px;background:transparent;border:1px solid var(--bor2);border-radius:var(--rs);font-size:12px;color:var(--tx3);cursor:pointer;font-family:inherit">${S.showAllExp?'Show less ↑':'Show all '+all.length+' expenses ↓'}</button>`:'');
  })()}
</div>`;
}

// ── INCOME ────────────────────────────────────────────────────────────────────
function renderIncome(){
  const period=S.incPeriod||'month';
  const total=db.incomes.reduce((s,i)=>s+(i.qty||0)*(i.pricePerKg||0),0);
  const kg=db.incomes.reduce((s,i)=>s+(i.qty||0),0);
  const avg=kg>0?Math.round(total/kg):0;
  const grouped=groupByPeriod(db.incomes, i=>i.date, i=>(i.qty||0)*(i.pricePerKg||0), period);
  const expGrouped=groupByPeriod(db.expenses, e=>e.date, e=>e.amount||0, period);
  const expMap=Object.fromEntries(expGrouped.map(g=>[g.label,g.value]));
  const allPeriods=[...new Set([...grouped.map(g=>g.label),...expGrouped.map(g=>g.label)])].sort();
  const hasOverlap=allPeriods.length>=2&&grouped.length>=1&&expGrouped.length>=1;
  const netProfit=total-totalExp();
  const peakEntry=grouped.length?grouped.reduce((a,b)=>b.value>a.value?b:a):null;
  const periodLbl={month:'month',quarter:'quarter',year:'year'}[period];
  return`
<div class="card">
  <button onclick="showEditIncome(null)" style="width:100%;margin-bottom:14px;padding:11px;background:var(--g-bg);border:1.5px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--brand-lite);cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 2v10M2 7h10"/></svg>Add sale / income</button>
  <div class="ct">Income overview</div>
  <div class="mg" style="margin-bottom:14px">
    <div class="met g"><div class="ml">Total income</div><div class="mv">${fc(total)}</div><div class="ms">${db.incomes.length} sales</div></div>
    <div class="met b"><div class="ml">Kg sold</div><div class="mv">${kg} kg</div></div>
    <div class="met a"><div class="ml">Avg price/kg</div><div class="mv">₹${avg.toLocaleString('en-IN')}</div></div>
    <div class="met ${netProfit>=0?'g':'r'}"><div class="ml">Net profit</div><div class="mv" style="font-size:15px">${fc(netProfit)}</div></div>
  </div>
  ${periodFilterUI('incPeriod')}
  ${grouped.length>=2?`
  <div style="margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Income over time</div>
    ${svgLine([{label:'Income',values:grouped.map(g=>({x:shortLabel(g.label,period),y:g.value})),color:'var(--brand-lite)'}],{h:150,yFmt:v=>'₹'+Math.round(v/1000)+'k'})}
  </div>`:''}
  ${hasOverlap?`
  <div style="margin-bottom:14px;padding-top:14px;border-top:1px solid var(--bor)">
    <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Income vs expenses</div>
    ${svgLine([
      {label:'Income',values:allPeriods.map(m=>({x:shortLabel(m,period),y:grouped.find(g=>g.label===m)?.value||0})),color:'var(--brand-lite)'},
      {label:'Expenses',values:allPeriods.map(m=>({x:shortLabel(m,period),y:expMap[m]||0})),color:'var(--r-tx)'}
    ],{h:160,yFmt:v=>'₹'+Math.round(v/1000)+'k'})}
  </div>`:''}
</div>
<div class="card">
  <div class="ct">Income records
    ${db.incomes.length>10?`<span style="font-size:11px;color:var(--tx3);margin-left:auto">${db.incomes.length} total</span>`:''}
  </div>
  ${(()=>{
    const all=[...db.incomes].sort((a,b)=>b.date.localeCompare(a.date));
    if(all.length===0)return`<div class="empty"><svg viewBox="0 0 20 20" fill="none" stroke-width="1.5"><circle cx="10" cy="10" r="7" stroke-linecap="round"/><path stroke-linecap="round" d="M10 6.5v3.5l2.5 1.5"/></svg><br>No income recorded</div>`;
    const shown=S.showAllInc?all:all.slice(0,10);
    return shown.map(i=>`
  <div class="row">
    <div style="flex:1;min-width:0">
      <div class="rt">${esc(i.buyer||'—')} <span style="font-size:10px;color:var(--tx3);font-weight:500;background:var(--bor2);padding:1px 5px;border-radius:8px;margin-left:3px">${i.type==='raw'?'Raw':'Dried'}</span></div>
      <div class="rs">${fd(i.date)} · ${i.qty}kg @ ₹${i.pricePerKg}/kg</div>
      ${i.notes?`<div style="font-size:11px;color:var(--tx3);margin-top:1px">${esc(i.notes)}</div>`:''}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-left:8px;flex-shrink:0">
      <div style="color:var(--brand-lite);font-weight:700;font-size:14px">${fc(i.qty*i.pricePerKg)}</div>
      <div class="racts">
        <button class="ia e" onclick="showEditIncome('${i.id}')">Edit</button>
        <button class="ia d" onclick="confirmDel('income','${i.id}','sale ${fd(i.date)}')">Del</button>
      </div>
    </div>
  </div>`).join('')+(all.length>10?`<button onclick="S.showAllInc=!S.showAllInc;render()" style="width:100%;margin-top:10px;padding:9px;background:transparent;border:1px solid var(--bor2);border-radius:var(--rs);font-size:12px;color:var(--tx3);cursor:pointer;font-family:inherit">${S.showAllInc?'Show less ↑':'Show all '+all.length+' records ↓'}</button>`:'');
  })()}
</div>`;
}

// ── DRYING ────────────────────────────────────────────────────────────────────
function renderDrying(){
  const period=S.dryPeriod||'month';
  if(!db.dryings)db.dryings=[];
  const totalRawIn=db.dryings.reduce((s,d)=>s+(d.rawQty||0),0);
  const totalDriedOut=db.dryings.reduce((s,d)=>s+(d.driedQty||0),0);
  const avgRatio=totalRawIn>0?((totalDriedOut/totalRawIn)*100).toFixed(1):0;

  // Income split by type
  const rawIncome=db.incomes.filter(i=>i.type==='raw').reduce((s,i)=>s+(i.qty||0)*(i.pricePerKg||0),0);
  const driedIncome=db.incomes.filter(i=>i.type==='dried'||(i.type==null&&i.pricePerKg)).reduce((s,i)=>s+(i.qty||0)*(i.pricePerKg||0),0);

  const rawGrouped=groupByPeriod(db.incomes.filter(i=>i.type==='raw'), i=>i.date, i=>(i.qty||0)*(i.pricePerKg||0), period);
  const driedGrouped=groupByPeriod(db.incomes.filter(i=>i.type==='dried'||!i.type), i=>i.date, i=>(i.qty||0)*(i.pricePerKg||0), period);
  const allPeriods=[...new Set([...rawGrouped.map(g=>g.label),...driedGrouped.map(g=>g.label)])].sort();
  const rMap=Object.fromEntries(rawGrouped.map(g=>[g.label,g.value]));
  const dMap=Object.fromEntries(driedGrouped.map(g=>[g.label,g.value]));

  return`
<div class="card">
  <button onclick="showEditDrying(null)" style="width:100%;margin-bottom:14px;padding:11px;background:var(--a-bg);border:1.5px solid var(--a-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--a-mid);cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 2v10M2 7h10"/></svg>Add drying record</button>
  <div class="ct">Drying overview</div>
  <div class="mg" style="margin-bottom:14px">
    <div class="met"><div class="ml">Raw green in</div><div class="mv">${totalRawIn} kg</div><div class="ms">${db.dryings.length} batches</div></div>
    <div class="met g"><div class="ml">Dried out</div><div class="mv">${totalDriedOut} kg</div></div>
    <div class="met a"><div class="ml">Avg ratio</div><div class="mv">${avgRatio}%</div><div class="ms">raw → dried</div></div>
    <div class="met b"><div class="ml">Typical ratio</div><div class="mv">22–28%</div><div class="ms">industry avg</div></div>
  </div>
  <p style="font-size:11px;color:var(--tx3);margin-bottom:14px;line-height:1.5">Industry average: ~4–4.5 kg raw green cardamom yields 1 kg dried (22–26% ratio). Track each batch below to monitor your drying efficiency.</p>
</div>

<div class="card">
  <div class="ct">Income: Raw vs Dried</div>
  <div class="mg" style="margin-bottom:14px">
    <div class="met"><div class="ml">🌿 Raw / green</div><div class="mv" style="font-size:15px">${fc(rawIncome)}</div><div class="ms">${db.incomes.filter(i=>i.type==='raw').length} sales</div></div>
    <div class="met g"><div class="ml">☀️ Dried</div><div class="mv" style="font-size:15px">${fc(driedIncome)}</div><div class="ms">${db.incomes.filter(i=>i.type==='dried'||!i.type).length} sales</div></div>
  </div>
  ${periodFilterUI('dryPeriod')}
  ${allPeriods.length>=2?`
  <div style="margin-top:4px">
    <div style="font-size:11px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">Raw vs dried income</div>
    ${svgLine([
      {label:'🌿 Raw',values:allPeriods.map(m=>({x:shortLabel(m,period),y:rMap[m]||0})),color:'var(--brand-glow)'},
      {label:'☀️ Dried',values:allPeriods.map(m=>({x:shortLabel(m,period),y:dMap[m]||0})),color:'var(--a-mid)'}
    ],{h:160,yFmt:v=>'₹'+Math.round(v/1000)+'k'})}
  </div>`:allPeriods.length>0?`<p style="font-size:12px;color:var(--tx3);text-align:center;padding:8px 0">Add income records with type Raw or Dried to see the chart</p>`:''}
</div>

<div class="card">
  <div class="ct">Drying records
    ${db.dryings.length>10?`<span style="font-size:11px;color:var(--tx3);margin-left:auto">${db.dryings.length} total</span>`:''}
  </div>
  ${(()=>{
    const all=[...db.dryings].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    if(all.length===0)return'<div class="empty">No drying records yet</div>';
    const shown=S.showAllDry?all:all.slice(0,10);
    return shown.map(d=>{
      const ratio=d.rawQty>0?((d.driedQty/d.rawQty)*100).toFixed(1):0;
      const ratioColor=ratio>=22?'var(--brand-lite)':'var(--r-tx)';
      return`<div class="row">
    <div style="flex:1;min-width:0">
      <div class="rt">${fd(d.date)}${d.notes?' · '+esc(d.notes):''}</div>
      <div class="rs">${d.rawQty}kg raw → ${d.driedQty}kg dried</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-left:8px;flex-shrink:0">
      <div style="color:${ratioColor};font-weight:700;font-size:14px">${ratio}%</div>
      <div class="racts">
        <button class="ia e" onclick="showEditDrying('${d.id}')">Edit</button>
        <button class="ia d" onclick="confirmDel('drying','${d.id}','drying ${fd(d.date)}')">Del</button>
      </div>
    </div>
  </div>`;}).join('')+(all.length>10?`<button onclick="S.showAllDry=!S.showAllDry;render()" style="width:100%;margin-top:10px;padding:9px;background:transparent;border:1px solid var(--bor2);border-radius:var(--rs);font-size:12px;color:var(--tx3);cursor:pointer;font-family:inherit">${S.showAllDry?'Show less ↑':'Show all '+all.length+' records ↓'}</button>`:'');
  })()}
</div>`;
}

function renderForecast(){
  const plants=totalPlants();
  const now=new Date();
  const thisYear=now.getFullYear(), thisMonth=now.getMonth();

  // ── YIELD BASIS ──
  // Use actual yield data from the last 12 months grouped by month-of-year
  const yieldByMo={};  // month index (0-11) → [qty, ...]
  db.yields.forEach(y=>{
    if(!y.date)return;
    const d=new Date(y.date+'-01');
    const age=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());
    if(age>=0&&age<12){
      const mo=d.getMonth();
      if(!yieldByMo[mo])yieldByMo[mo]=[];
      yieldByMo[mo].push(y.qty||0);
    }
  });
  // Monthly avg from actuals, fall back to seasonal pattern if no data
  const PEAK_PAT=[0.04,0.04,0.05,0.06,0.07,0.08,0.12,0.14,0.13,0.11,0.09,0.07]; // seasonal distribution
  const totalActualYield=db.yields.reduce((s,y)=>s+(y.qty||0),0);
  const annualYield=totalActualYield>0?totalActualYield*(12/Math.max(db.yields.length,1)):plants*0.45;

  // ── EXPENSE BASIS ──
  // Group actual expenses by category and month, compute monthly averages
  const expByCat={labor:0,pesticide:0,rawmat:0,crop:0,other:0};
  const expMonths=new Set();
  db.expenses.forEach(e=>{
    if(e.date)expMonths.add(e.date.slice(0,7));
    expByCat[e.category]=(expByCat[e.category]||0)+(e.amount||0);
  });
  const nMonths=Math.max(expMonths.size,1);
  const monthlyExpByCat={};
  Object.entries(expByCat).forEach(([k,v])=>monthlyExpByCat[k]=v/nMonths);
  const totalMonthlyExp=Object.values(monthlyExpByCat).reduce((s,v)=>s+v,0);

  // ── 8-MONTH ROWS ──
  const isPeakMo=mo=>[6,7,8,9].includes(mo); // Jul–Oct (0-indexed)
  const rows=Array.from({length:8},(_,i)=>{
    const d=new Date(thisYear,thisMonth+i+1,1);
    const mo=d.getMonth();
    const isPeak=isPeakMo(mo);
    // Projected yield: use actual monthly avg if available, else pattern
    const pat=PEAK_PAT[mo];
    const projYield=yieldByMo[mo]
      ?Math.round(yieldByMo[mo].reduce((s,v)=>s+v,0)/yieldByMo[mo].length)
      :Math.round(annualYield*pat);
    // Projected expenses: scale by seasonal factor
    const expScale=isPeak?1.3:0.85;
    const projExp=Math.round(totalMonthlyExp*expScale);
    const projExpByCat={};
    Object.entries(monthlyExpByCat).forEach(([k,v])=>projExpByCat[k]=Math.round(v*expScale));
    return{
      label:d.toLocaleDateString('en-IN',{month:'short',year:'numeric'}),
      mo,isPeak,projYield,projExp,projExpByCat,
      hasActual:!!yieldByMo[mo]
    };
  });

  const maxYield=Math.max(...rows.map(r=>r.projYield),1);
  const maxExp=Math.max(...rows.map(r=>r.projExp),1);
  const CL2={labor:'Labor',pesticide:'Pesticide',rawmat:'Raw mat.',crop:'Crop',other:'Other'};
  const expColors={labor:'var(--brand-glow)',pesticide:'var(--r-tx)',rawmat:'var(--a-mid)',crop:'var(--b-tx)',other:'var(--tx3)'};

  return`
<div class="card">
  <div class="ct">Basis</div>
  <div class="mg">
    <div class="met b"><div class="ml">Total plants</div><div class="mv">${plants}</div></div>
    <div class="met g"><div class="ml">Actual yield (all time)</div><div class="mv">${totalActualYield} kg</div><div class="ms">${db.yields.length} records</div></div>
    <div class="met"><div class="ml">Monthly avg exp</div><div class="mv" style="font-size:16px">${fc(totalMonthlyExp)}</div><div class="ms">over ${nMonths} months</div></div>
    <div class="met a"><div class="ml">Peak harvest</div><div class="mv" style="font-size:13px">Jul – Oct</div></div>
  </div>
  <p style="font-size:11px;color:var(--tx3);margin-top:10px;line-height:1.5">
    Yield projection uses <strong>actual recorded data</strong> for months with history, seasonal pattern for others.
    Expense projection scales your average by season.
  </p>
</div>

<div class="card">
  <div class="ct">Projected yield — next 8 months</div>
  ${rows.map(r=>`
  <div class="br-row">
    <div class="br-lbl" style="font-size:11px;font-weight:${r.isPeak?700:400}">${r.label}${r.isPeak?'<span class="pk" style="margin-left:3px">Peak</span>':''}</div>
    <div class="br-trk"><div class="br-fill" style="width:${Math.round(r.projYield/maxYield*100)}%;${r.hasActual?'background:linear-gradient(90deg,var(--b-tx),var(--b-bor))':''}"></div></div>
    <div class="br-val">${r.projYield} kg${r.hasActual?' ✓':''}</div>
  </div>`).join('')}
  <p style="font-size:10px;color:var(--tx3);margin-top:8px">✓ = based on your actual recorded data for that month</p>
</div>

<div class="card">
  <div class="ct">Projected expenses — next 8 months</div>
  ${rows.map(r=>`
  <div style="padding:8px 0;border-bottom:1px solid var(--bor)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
      <span style="font-size:13px;font-weight:600">${r.label}${r.isPeak?'<span class="pk" style="margin-left:4px">Peak</span>':''}</span>
      <span style="font-size:14px;font-weight:700;color:var(--a-mid)">${fc(r.projExp)}</span>
    </div>
    <div style="display:flex;gap:3px;height:6px;border-radius:4px;overflow:hidden">
      ${Object.entries(r.projExpByCat).filter(([,v])=>v>0).map(([cat,v])=>`
        <div style="flex:${v};background:${expColors[cat]};min-width:3px" title="${CL2[cat]}: ${fc(v)}"></div>
      `).join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px">
      ${Object.entries(r.projExpByCat).filter(([,v])=>v>0).map(([cat,v])=>`
        <span style="font-size:10px;color:var(--tx3)">${CL2[cat]} ${fc(v)}</span>
      `).join('')}
    </div>
  </div>`).join('')}
</div>

${db.expenses.length===0?`
<div class="sbox">
  <h3>No expense data yet</h3>
  <p>Add expenses in the Expenses tab to get accurate projections. Currently showing a flat estimate.</p>
</div>`:''}
`;
}

// ── MODALS ────────────────────────────────────────────────────────────────────
function modal(body,title){
  const r=document.getElementById('modal-root');r.style.pointerEvents='';
  r.innerHTML=`
    <div class="mo" onclick="if(event.target===this)closeModal()">
      <div class="md">
        <div class="mh"></div>
        ${title?`<div class="mt">${title}</div>`:''}
        ${body}
      </div>
    </div>`;
}
function closeModal(){const r=document.getElementById('modal-root');r.innerHTML='';r.style.pointerEvents='none';}

function confirmDel(type,id,label){
  modal(`<div class="cbox"><p>Delete <strong>${label}</strong>?<br>This cannot be undone.</p></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnd" onclick="doDel('${type}','${id}')">Delete</button></div>`,'Confirm delete');
}
function doDel(type,id){deleteItem(type,id);closeModal();render();}

// SECTION
function showEditSection(id){
  const s=id?db.sections.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Section name</label><input id="f-sn" type="text" value="${esc(s?.name||'')}" placeholder="e.g. Block D East"/></div>
<div class="fg"><label class="fl">Number of plants</label><input id="f-sp" type="number" value="${s?.plants||''}" placeholder="100"/></div>
<div class="fg"><label class="fl">Age of plants (years)</label><input id="f-sa" type="number" value="${s?.age||''}" placeholder="2"/></div>
<div class="fg"><label class="fl">Notes</label><input id="f-sno" type="text" value="${esc(s?.notes||'')}" placeholder="Slope, shade, irrigation…"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveSection('${id||''}')">Save</button></div>`,s?'Edit section':'Add section');
}
function saveSection(id){
  const name=document.getElementById('f-sn').value.trim();if(!name)return;
  const data={name,plants:parseInt(document.getElementById('f-sp').value)||0,age:parseInt(document.getElementById('f-sa').value)||0,notes:document.getElementById('f-sno').value.trim(),updatedAt:Date.now()};
  if(id){const i=db.sections.findIndex(x=>x.id===id);if(i>=0)db.sections[i]={...db.sections[i],...data};}
  else db.sections.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),500);
}

// SEASON — removed

// YIELD
function showEditYield(id){
  const y=id?db.yields.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Date</label><input id="f-yd" type="date" value="${y?.date||new Date().toISOString().slice(0,10)}"/></div>
<div class="fg"><label class="fl">Section</label><select id="f-ys">${secOpts('Entire farm')}</select></div>
<div class="fg"><label class="fl">Yield (kg)</label><input id="f-yq" type="number" value="${y?.qty||''}" placeholder="50"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveYield('${id||''}')">Save</button></div>`,y?'Edit yield':'Add yield');
  if(y){const s=document.getElementById('f-ys');if(s&&y.sectionId)s.value=y.sectionId;}
}
function saveYield(id){
  const qty=parseFloat(document.getElementById('f-yq').value);if(!qty)return;
  const data={sectionId:document.getElementById('f-ys').value||null,date:document.getElementById('f-yd').value,qty,updatedAt:Date.now()};
  if(id){const i=db.yields.findIndex(x=>x.id===id);if(i>=0)db.yields[i]={...db.yields[i],...data};}
  else db.yields.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),500);
}

// EXPENSE
function showEditExpense(id){
  const e=id?db.expenses.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Date</label><input id="f-edt" type="date" value="${e?.date||new Date().toISOString().slice(0,10)}"/></div>
<div class="fg"><label class="fl">Category</label>
<select id="f-ec"><option value="labor" ${e?.category==='labor'?'selected':''}>Labor</option><option value="pesticide" ${e?.category==='pesticide'?'selected':''}>Pesticide</option><option value="rawmat" ${e?.category==='rawmat'?'selected':''}>Raw material</option><option value="crop" ${e?.category==='crop'?'selected':''}>Crop</option><option value="other" ${e?.category==='other'?'selected':''}>Other</option></select>
</div>
<div class="fg"><label class="fl">Description</label><input id="f-ed" type="text" value="${esc(e?.desc||'')}" placeholder="e.g. Weeding labor"/></div>
<div class="fg"><label class="fl">Amount (₹)</label><input id="f-ea" type="number" value="${e?.amount||''}" placeholder="5000"/></div>
<div class="fg"><label class="fl">Section (optional)</label><select id="f-es">${secOpts()}</select></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveExpense('${id||''}')">Save</button></div>`,e?'Edit expense':'Add expense');
  if(e){const s=document.getElementById('f-es');if(s&&e.sectionId)s.value=e.sectionId;}
}
function saveExpense(id){
  const amount=parseFloat(document.getElementById('f-ea').value),desc=document.getElementById('f-ed').value.trim();if(!amount||!desc)return;
  const data={category:document.getElementById('f-ec').value,desc,amount,date:document.getElementById('f-edt').value,sectionId:document.getElementById('f-es').value||null,updatedAt:Date.now()};
  if(id){const i=db.expenses.findIndex(x=>x.id===id);if(i>=0)db.expenses[i]={...db.expenses[i],...data};}
  else db.expenses.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),500);
}

// INCOME — note: price NOT prefilled
function showEditIncome(id){
  const i=id?db.incomes.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Date</label><input id="f-id" type="date" value="${i?.date||new Date().toISOString().slice(0,10)}"/></div>
<div class="fg"><label class="fl">Quantity sold (kg)</label><input id="f-iq" type="number" value="${i?.qty||''}" placeholder="100"/></div>
<div class="fg"><label class="fl">Price per kg (₹)</label><input id="f-ip" type="number" value="${i?.pricePerKg||''}" placeholder="Enter price"/></div>
<div class="fg"><label class="fl">Type</label>
<select id="f-ity"><option value="raw" ${(i?.type||'raw')==='raw'?'selected':''}>Raw / green cardamom</option><option value="dried" ${i?.type==='dried'?'selected':''}>Dried cardamom</option></select>
</div>
<div class="fg"><label class="fl">Buyer / market</label><input id="f-ib" type="text" value="${esc(i?.buyer||'')}" placeholder="Vandanmedu auction"/></div>
<div class="fg"><label class="fl">Section (optional)</label><select id="f-is">${secOpts()}</select></div>
<div class="fg"><label class="fl">Notes</label><input id="f-ino" type="text" value="${esc(i?.notes||'')}" placeholder="Grade, batch…"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveIncome('${id||''}')">Save</button></div>`,i?'Edit income':'Add income / sale');
  if(i){const s=document.getElementById('f-is');if(s&&i.sectionId)s.value=i.sectionId;}
}
function saveIncome(id){
  const qty=parseFloat(document.getElementById('f-iq').value),pricePerKg=parseFloat(document.getElementById('f-ip').value);if(!qty||!pricePerKg)return;
  const data={date:document.getElementById('f-id').value,qty,pricePerKg,type:document.getElementById('f-ity').value,buyer:document.getElementById('f-ib').value.trim(),sectionId:document.getElementById('f-is').value||null,notes:document.getElementById('f-ino').value.trim(),updatedAt:Date.now()};
  if(id){const i=db.incomes.findIndex(x=>x.id===id);if(i>=0)db.incomes[i]={...db.incomes[i],...data};}
  else db.incomes.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),500);
}

// MARKET PRICE
function showEditPrice(){
  modal(`
<div class="fg"><label class="fl">Raw / Green cardamom price (₹/kg)</label><input id="f-mr" type="number" value="${db.priceRaw||''}" placeholder="e.g. 1800"/></div>
<div class="fg"><label class="fl">Dried cardamom price (₹/kg)</label><input id="f-md" type="number" value="${db.priceDried||''}" placeholder="e.g. 2500"/></div>
<div class="fg"><label class="fl">Source / date</label><input id="f-ms" type="text" value="${esc(db.priceSource||'')}" placeholder="Vandanmedu auction, 13 Mar"/></div>
<p style="font-size:11px;color:var(--tx3);margin-top:4px">Prices sync to all family members automatically.</p>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="savePrice()">Update</button></div>`,'Update market prices');
}
function savePrice(){
  const r=parseFloat(document.getElementById('f-mr').value),d=parseFloat(document.getElementById('f-md').value);
  if(!r&&!d)return;
  if(r)db.priceRaw=r;if(d)db.priceDried=d;
  db.priceDate=new Date().toLocaleDateString('en-IN');
  db.priceSource=document.getElementById('f-ms').value||'Manual entry';
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),500);
}


// SYNC SETUP
function showGeminiKeySetup(){
  const masked=S.geminiKey?S.geminiKey.slice(0,8)+'…':'';
  modal(`
<div class="sbox"><h3>Gemini API key</h3>
<p>Get a <strong>free</strong> key at <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--b-tx)">aistudio.google.com</a> → Create API key.</p>
<p>The key is <strong>encrypted and stored in your Google Drive</strong> — same encryption as your farm data. Never stored in plain text.</p>
<p>Free tier: 1,500 requests/day — once-a-day usage costs nothing. Uses live Google Search to ground every insight.</p></div>
<div class="fg"><label class="fl">Gemini API Key</label><input id="ak-in" type="password" placeholder="AIza..." autocomplete="off"/></div>
${masked?`<p style="font-size:11px;color:var(--tx3);margin-top:-8px">Current key: ${masked} (leave blank to keep)</p>`:''}
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveGeminiKey()">Save to Drive</button></div>`,'Gemini API key');
}
async function saveGeminiKey(){
  const v=document.getElementById('ak-in').value.trim();
  const keyToSave=v||(S.geminiKey||'');
  if(!keyToSave){showToast('Enter a valid API key');return;}
  if(!cfg.passphrase){showToast('Set up sync passphrase first — needed to encrypt the key');return;}
  closeModal();
  showToast('Saving key to Drive…');
  try{
    await getOAuthToken();
    await saveGeminiKeyToDrive(keyToSave);
    showToast('API key saved securely ✓');
    setTimeout(()=>fetchAIInsights(true),400);
  }catch(e){showToast('Save failed: '+e.message);}
}

// DRYING
function showEditDrying(id){
  const d=id?db.dryings.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Date</label><input id="f-dd" type="date" value="${d?.date||new Date().toISOString().slice(0,10)}"/></div>
<div class="fg"><label class="fl">Raw green input (kg)</label><input id="f-dr" type="number" value="${d?.rawQty||''}" placeholder="400"/></div>
<div class="fg"><label class="fl">Dried output (kg)</label><input id="f-do" type="number" value="${d?.driedQty||''}" placeholder="95"/></div>

<div class="fg"><label class="fl">Notes</label><input id="f-dn" type="text" value="${esc(d?.notes||'')}" placeholder="Grade, batch ref…"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveDrying('${id||''}')">Save</button></div>`,d?'Edit drying record':'Add drying record');
}
function saveDrying(id){
  const rawQty=parseFloat(document.getElementById('f-dr').value),driedQty=parseFloat(document.getElementById('f-do').value);
  if(!rawQty||!driedQty)return;
  const data={date:document.getElementById('f-dd').value,rawQty,driedQty,notes:document.getElementById('f-dn').value.trim(),updatedAt:Date.now()};
  if(!db.dryings)db.dryings=[];
  if(id){const i=db.dryings.findIndex(x=>x.id===id);if(i>=0)db.dryings[i]={...db.dryings[i],...data};}
  else db.dryings.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),500);
}

// SHARED FOLDER SETUP
function showSharedFolderSetup(){
  modal(`
<div class="sbox">
  <h3>Shared Drive folder</h3>
  <p>This allows multiple Google accounts to sync to the same data. One person (the host) creates a shared Google Drive folder and shares it with all family members.</p>
  <p style="margin-top:8px"><strong>To set up:</strong></p>
  <ol style="margin:8px 0 0 16px;font-size:13px;line-height:1.8;color:var(--tx2)">
    <li>Open Google Drive on the host account</li>
    <li>Create a new folder — name it <strong>V-Plantations</strong></li>
    <li>Right-click → Share → add all family Gmail addresses with <strong>Editor</strong> access</li>
    <li>Open the folder → copy the folder ID from the URL:<br>
      <span style="font-family:monospace;font-size:11px;color:var(--b-tx)">drive.google.com/drive/folders/<strong>THIS_PART</strong></span>
    </li>
    <li>Paste the folder ID below on all devices</li>
  </ol>
</div>
<div class="fg"><label class="fl">Shared folder ID</label><input id="sfid-in" type="text" value="${esc(cfg.sharedFolderId||'')}" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74…"/></div>
<p style="font-size:11px;color:var(--tx3);margin-top:-6px">Leave blank to use personal Drive (original behaviour)</p>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveSharedFolderId()">Save</button></div>`,'Shared folder setup');
}
function saveSharedFolderId(){
  const v=document.getElementById('sfid-in').value.trim();
  cfg.sharedFolderId=v||null;
  cfg.driveFileId=null; // reset cached file ID — will re-discover in new folder
  clearCachedToken();   // force fresh OAuth so new scope takes effect
  saveCfg();
  closeModal();
  showToast(v?'Shared folder set — tap Sync to connect':'Reverted to personal Drive');
}

function showPassphraseSetup(){
  modal(`
<div class="sbox"><h3>Set encryption passphrase</h3><p>All users must use the same passphrase. Data is encrypted before uploading — Google cannot read it.</p><p><strong>Write it down and share with family.</strong></p></div>
<div class="fg"><label class="fl">Passphrase (min 6 characters)</label><div style="display:flex;gap:6px;align-items:center"><input id="pp-in" type="password" autocomplete="new-password" style="flex:1"/><button type="button" onclick="const i=document.getElementById('pp-in');i.type=i.type==='password'?'text':'password'" style="padding:6px 10px;font-size:11px;background:var(--sur2);border:1px solid var(--bor2);border-radius:6px;cursor:pointer;font-family:inherit;color:var(--tx2)">Show</button></div></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="savePassphrase()">Save &amp; sync</button></div>`,'Encryption setup');
}
function savePassphrase(){const v=normPP(document.getElementById('pp-in').value);if(!v||v.length<6){alert('Passphrase must be at least 6 characters');return;}cfg.passphrase=v;saveCfg();closeModal();triggerSync(true);}

function showClientIdSetup(){
  modal(`
<div class="sbox"><h3>Enter Google OAuth Client ID</h3><ol><li>Go to console.cloud.google.com</li><li>Enable Google Drive API</li><li>Create OAuth 2.0 Client ID (Web app)</li><li>Add your GitHub Pages URL as authorised origin</li><li>Add your Gmail as test user in OAuth consent screen</li><li>Copy and paste Client ID below</li></ol></div>
<div class="fg"><label class="fl">Client ID</label><input id="cid-in" type="text" placeholder="…apps.googleusercontent.com"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveClientId()">Save &amp; sync</button></div>`,'Google Drive setup');
}
function saveClientId(){const v=document.getElementById('cid-in').value.trim();if(!v||!v.includes('.apps.googleusercontent.com')){alert('Paste a valid Client ID');return;}cfg.clientId=v;saveCfg();closeModal();triggerSync(true);}

// ── SETTINGS & BACKUP ─────────────────────────────────────────────────────────
function renderSettings(){
  const lastSync=cfg.lastSyncTs?new Date(cfg.lastSyncTs).toLocaleString('en-IN'):'Never';
  const counts=`${db.sections.length} sections · ${db.yields.length} yield · ${db.expenses.length} expenses · ${db.incomes.length} income`;
  return`
<div class="settings-group">
  <div class="settings-group-title">Sync &amp; account</div>
  <div class="settings-row">
    <div>
      <div class="settings-row-label">Google account</div>
      <div class="settings-row-sub">${cfg.googleAccountHint||'Not signed in'}</div>
    </div>
    ${cfg.googleAccountHint?`<button onclick="disconnectGoogle();render()" style="font-size:12px;color:var(--r-tx);background:none;border:none;cursor:pointer;font-family:inherit;padding:0">Switch</button>`:''}
  </div>
  <div class="settings-row">
    <div>
      <div class="settings-row-label">Shared folder</div>
      <div class="settings-row-sub">${cfg.sharedFolderId?'Connected ✓':'Not set'}</div>
    </div>
    <button onclick="showSharedFolderSetup()" class="ia e">${cfg.sharedFolderId?'Change':'Set up'}</button>
  </div>
  <div class="settings-row">
    <div>
      <div class="settings-row-label">Passphrase</div>
      <div class="settings-row-sub" id="pp-display">${cfg.passphrase?'Set ✓ — tap to reveal':'Not set'}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      ${cfg.passphrase?`<button onclick="const el=document.getElementById('pp-display');el.textContent=el.textContent.startsWith('Set')?'${cfg.passphrase.replace(/'/g,"\'")}':'Set ✓ — tap to reveal'" style="font-size:11px;color:var(--b-tx);background:var(--b-bg);border:1px solid var(--b-bor);border-radius:6px;padding:4px 8px;cursor:pointer;font-family:inherit">Reveal</button>`:''}
      <button onclick="showChangePassphrase()" class="ia e">Change</button>
    </div>
  </div>
  <div class="settings-row">
    <div>
      <div class="settings-row-label">Google Client ID</div>
      <div class="settings-row-sub">${cfg.clientId?cfg.clientId.slice(0,28)+'…':'Not set'}</div>
    </div>
    <button onclick="showClientIdSetup()" class="ia e">Change</button>
  </div>
  <div class="settings-row" style="border-bottom:none">
    <div>
      <div class="settings-row-label">Last synced</div>
      <div class="settings-row-sub">${lastSync}</div>
    </div>
    <div style="display:flex;gap:5px">
      <button onclick="manualBackup()" class="ia e">Snapshot</button>
      <button onclick="showBackups()" class="ia e">Restore</button>
    </div>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">AI features</div>
  <div class="settings-row" style="border-bottom:none">
    <div>
      <div class="settings-row-label">Gemini API key</div>
      <div class="settings-row-sub">${S.geminiKey?S.geminiKey.slice(0,8)+'… (stored in Drive)':'Not set — needed for insights'}</div>
    </div>
    <button onclick="showGeminiKeySetup()" class="ia e">${S.geminiKey?'Change':'Set up'}</button>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">Display</div>
  <div class="settings-row" style="border-bottom:none">
    <div class="settings-row-label" id="theme-setting-label">Theme</div>
    <div style="display:flex;gap:5px">
      <button onclick="setThemePref('light')" id="tbtn-light" class="ia">☀️</button>
      <button onclick="setThemePref('system')" id="tbtn-system" class="ia">Auto</button>
      <button onclick="setThemePref('dark')" id="tbtn-dark" class="ia">🌙</button>
    </div>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">Add to home screen</div>
  <div style="padding:12px 16px">
    <div id="a2hs-content">
      <div style="background:var(--b-bg);border:1px solid var(--b-bor);border-radius:var(--rs);padding:12px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:600;color:var(--b-tx);margin-bottom:6px">iPhone / iPad (Safari)</div>
        <ol style="margin:0 0 0 16px;font-size:12px;color:var(--tx2);line-height:1.8"><li>Open in Safari → tap Share</li><li>Tap "Add to Home Screen" → Add</li></ol>
      </div>
      <div style="background:var(--g-bg);border:1px solid var(--g-bor);border-radius:var(--rs);padding:12px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:600;color:var(--brand-lite);margin-bottom:6px">Android (Chrome)</div>
        <ol style="margin:0 0 0 16px;font-size:12px;color:var(--tx2);line-height:1.8"><li>Open in Chrome → tap ⋮ menu</li><li>Tap "Add to Home screen" → Add</li></ol>
      </div>
      <div id="a2hs-btn-wrap" style="display:none">
        <button id="a2hs-btn" onclick="triggerA2HS()" style="width:100%;padding:11px;background:var(--g-bg);border:1px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:600;color:var(--brand-lite);cursor:pointer;font-family:inherit">＋ Add to home screen</button>
      </div>
    </div>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">Data</div>
  <div style="padding:12px 16px">
    <p style="font-size:12px;color:var(--tx3);margin-bottom:10px">${counts}</p>
    <div style="display:flex;gap:8px">
      <button onclick="exportJSON()" style="flex:1;padding:10px;background:var(--b-bg);border:1px solid var(--b-bor);border-radius:var(--rs);font-size:12px;font-weight:600;color:var(--b-tx);cursor:pointer;font-family:inherit">Export JSON</button>
      <button onclick="document.getElementById('import-file').click()" style="flex:1;padding:10px;background:var(--a-bg);border:1px solid var(--a-bor);border-radius:var(--rs);font-size:12px;font-weight:600;color:var(--a-mid);cursor:pointer;font-family:inherit">Import JSON</button>
    </div>
    <input type="file" id="import-file" accept=".json" style="display:none" onchange="importJSON(this)"/>
  </div>
</div>

<div class="settings-group settings-danger">
  <div class="settings-group-title">Danger zone</div>
  <div class="settings-row" onclick="confirmClearLocal()" style="cursor:pointer">
    <div><div class="settings-row-label">Clear local data</div><div class="settings-row-sub">Keeps Drive — re-sync to restore</div></div>
    <span style="color:var(--r-tx);font-size:20px">›</span>
  </div>
  <div class="settings-row" onclick="confirmResetDrive()" style="cursor:pointer">
    <div><div class="settings-row-label">Reset Drive sync file</div><div class="settings-row-sub">Fix persistent wrong passphrase errors</div></div>
    <span style="color:var(--r-tx);font-size:20px">›</span>
  </div>
  <div class="settings-row" onclick="runDriveCleanup()" style="cursor:pointer;border-bottom:none">
    <div><div class="settings-row-label">Clean up Drive duplicates</div><div class="settings-row-sub">Remove extra copies of sync files</div></div>
    <span style="color:var(--r-tx);font-size:20px">›</span>
  </div>
</div>`;
}
// DRIVE CLEANUP — removes duplicate files, keeps only the most recent of each
async function runDriveCleanup(){
  setSyncUI('syncing','Cleaning…');
  try{
    await getOAuthToken();
    const cleaned=await cleanupDrive();
    showToast(cleaned>0?`Cleaned up ${cleaned} duplicate file${cleaned>1?'s':''} ✓`:'No duplicates found — Drive is clean ✓');
  }catch(e){
    console.error('Cleanup failed:',e);
    showToast('Cleanup failed: '+e.message);
  }
  setSyncUI('idle','Sync');
}

// RESET DRIVE FILE — deletes the corrupted Drive file so next sync creates a fresh one
async function resetDriveFile(){
  closeModal();
  setSyncUI('syncing','Resetting…');
  try{
    await getOAuthToken();
    const file=await findFile();
    if(file){
      await driveFetch(`drive/v3/files/${file.id}`,{method:'DELETE'});
      showToast('Drive file deleted — tap Sync to create a fresh one');
    } else {
      showToast('No Drive file found — tap Sync to create one');
    }
    // Also clear local driveFileId so we don't try to update the deleted file
    cfg.driveFileId=null;saveCfg();
  }catch(e){
    console.error('Reset failed:',e);
    showToast('Reset failed: '+e.message);
  }
  setSyncUI('idle','Sync');
}

function confirmResetDrive(){
  modal(`
<div class="sbox" style="border-color:var(--r-bor);background:var(--r-bg)">
  <p style="color:var(--r-tx);font-weight:700;margin-bottom:6px">⚠️ Delete Drive file?</p>
  <p style="font-size:13px;color:var(--tx2);line-height:1.5">This deletes the encrypted file from Google Drive. Your local data on this device is kept. After deleting, tap Sync to upload a fresh copy — all devices will then be able to sync again.</p>
  <p style="font-size:12px;color:var(--tx3);margin-top:8px">Use this if you are getting a "Wrong passphrase" error that won't go away.</p>
</div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnd" onclick="resetDriveFile()">Delete &amp; reset</button></div>`,'Reset Drive sync');
}

// EXPORT JSON
function exportJSON(){
  const json=JSON.stringify(db,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='vplantations_backup_'+new Date().toISOString().slice(0,10)+'.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export saved to downloads');
}

// IMPORT JSON
let _pendingImport=null;
function importJSON(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.sections||!data.yields){showToast('Invalid backup file');return;}
      _pendingImport=data;
      modal(`
<div class="cbox"><p>This will <strong>replace all local data</strong> with the imported file.<br>Drive data is unaffected until next sync.</p></div>
<div style="font-size:13px;color:var(--tx2);margin-bottom:14px">
  Importing: ${data.sections?.length||0} sections · ${data.yields?.length||0} yield records · ${data.expenses?.length||0} expenses · ${data.incomes?.length||0} income records
</div>
<div class="btn-row">
  <button class="btnc" onclick="closeModal()">Cancel</button>
  <button class="btnp" onclick="doImport()">Import</button>
</div>`,'Confirm import');
    }catch(err){showToast('Could not read file — invalid JSON');}
  };
  reader.readAsText(file);
  input.value='';
}
function doImport(){
  try{if(!_pendingImport)return;db={...db,..._pendingImport};_pendingImport=null;saveLocal();closeModal();render();showToast('Data imported successfully');}
  catch(e){showToast('Import failed');}
}

// MANUAL SNAPSHOT
async function manualBackup(){
  if(!cfg.passphrase){showToast('Set up sync first');return;}
  if(!navigator.onLine){showToast('No internet connection');return;}
  showToast('Saving snapshot…');
  try{
    await getOAuthToken();
    const enc=await encrypt(db,cfg.passphrase);
    const file=await findFile();
    if(file){await rotateBackups(await readFile(file.id));}
    showToast('Snapshot saved to Drive ✓');
  }catch(e){showToast('Snapshot failed — check connection');}
}

// VIEW & RESTORE BACKUPS FROM DRIVE
async function showBackups(){
  if(!cfg.passphrase){showToast('Set up sync passphrase first');return;}
  if(!navigator.onLine){showToast('Need internet to load backups');return;}
  modal(`<div style="text-align:center;padding:20px;color:var(--tx3)">Loading backups from Drive…</div>`,'Drive backups');
  try{
    await getOAuthToken();
    const files=await Promise.all(BACKUP_FILES.map(n=>findNamedFile(n)));
    const items=files.map((f,i)=>({f,name:BACKUP_FILES[i],label:`Backup ${i+1}`})).filter(x=>x.f);
    if(!items.length){
      document.querySelector('.md').innerHTML=`<div class="mh"></div><div class="mt">Drive backups</div><div class="empty">No backups found yet.<br>They're created automatically on each sync.</div><div class="btn-row"><button class="btnc" onclick="closeModal()">Close</button></div>`;
      return;
    }
    // Try to read timestamps from each backup
    const rows=await Promise.all(items.map(async item=>{
      try{
        const raw=await readFile(item.f.id);
        const data=await decrypt(raw,cfg.passphrase);
        const ts=data.updatedAt?new Date(data.updatedAt).toLocaleString('en-IN'):'Unknown date';
        const counts=`${data.sections?.length||0} sec · ${data.yields?.length||0} yield · ${data.expenses?.length||0} exp · ${data.incomes?.length||0} income`;
        return{...item,ts,counts,ok:true};
      }catch(e){return{...item,ts:'Could not read',counts:'',ok:false};}
    }));
    const html=rows.map((r,i)=>`
<div class="row">
  <div style="flex:1;min-width:0">
    <div class="rt">${r.label}</div>
    <div class="rs">${r.ts}</div>
    <div class="rs">${r.counts}</div>
  </div>
  ${r.ok?`<button class="ia e" onclick="confirmRestore('${r.f.id}','${r.label}')">Restore</button>`:'<span style="font-size:11px;color:var(--r-tx)">Unreadable</span>'}
</div>`).join('');
    document.querySelector('.md').innerHTML=`<div class="mh"></div><div class="mt">Drive backups</div>${html}<div class="btn-row"><button class="btnc" onclick="closeModal()">Close</button></div>`;
  }catch(e){document.querySelector('.md').innerHTML=`<div class="mh"></div><div class="mt">Drive backups</div><div class="empty">Failed to load backups.<br>${e.message}</div><div class="btn-row"><button class="btnc" onclick="closeModal()">Close</button></div>`;}
}

function confirmRestore(fileId,label){
  modal(`
<div class="cbox"><p>Restore from <strong>${label}</strong>?<br>This replaces current local data. A snapshot of your current data will be saved first.</p></div>
<div class="btn-row">
  <button class="btnc" onclick="showBackups()">← Back</button>
  <button class="btnp" onclick="doRestore('${fileId}')">Restore</button>
</div>`,'Confirm restore');
}
async function doRestore(fileId){
  closeModal();showToast('Restoring…');
  try{
    // Save current state as a snapshot first
    const enc=await encrypt(db,cfg.passphrase);
    const mainFile=await findFile();
    if(mainFile)await rotateBackups(await readFile(mainFile.id));
    // Load the backup
    const raw=await readFile(fileId);
    const data=await decrypt(raw,cfg.passphrase);
    db={...db,...data};saveLocal();render();
    showToast('Restored successfully ✓');
  }catch(e){showToast('Restore failed: '+e.message);}
}

// CHANGE PASSPHRASE
function showChangePassphrase(){
  modal(`
<div class="sbox"><h3>Change passphrase</h3><p>All devices must update to the new passphrase before syncing, or they will get a "Wrong passphrase" error.</p></div>
<div class="fg"><label class="fl">Current passphrase</label><input id="pp-old" type="password"/></div>
<div class="fg"><label class="fl">New passphrase (min 6 chars)</label><input id="pp-new" type="password"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="doChangePassphrase()">Change &amp; re-sync</button></div>`,'Change passphrase');
}
async function doChangePassphrase(){
  const oldPP=document.getElementById('pp-old').value;
  const newPP=document.getElementById('pp-new').value.trim();
  if(!oldPP||!newPP||newPP.length<6){showToast('Fill both fields (min 6 chars)');return;}
  if(oldPP!==cfg.passphrase){showToast('Current passphrase is incorrect');return;}
  if(!navigator.onLine){showToast('Need internet to re-encrypt Drive file');return;}
  closeModal();showToast('Re-encrypting…');
  try{
    await getOAuthToken();
    const file=await findFile();
    if(file){
      const raw=await readFile(file.id);
      let data;
      try{data=await decrypt(raw,oldPP);}catch(e){showToast('Could not decrypt with old passphrase');return;}
      const enc=await encrypt(data,newPP);
      await writeFile(file.id,enc);
    }
    cfg.passphrase=newPP;saveCfg();
    showToast('Passphrase changed ✓ — update all devices');
  }catch(e){showToast('Failed: '+e.message);}
}

// CLEAR LOCAL
function confirmClearLocal(){
  modal(`
<div class="cbox"><p>Clear all local data on this device?<br>Your Drive backup is safe — re-sync to restore.</p></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnd" onclick="doClearLocal()">Clear local data</button></div>`,'Clear local data');
}
function doClearLocal(){
  localStorage.removeItem(DB_KEY);
  db={sections:[],seasons:[],yields:[],expenses:[],incomes:[],dryings:[],priceRaw:null,priceDried:null,priceDate:null,priceSource:null,updatedAt:Date.now()};
  closeModal();render();showToast('Local data cleared. Tap Sync to restore from Drive.');
}

function setThemePref(pref){
  cfg.theme=pref;saveCfg();applyTheme();
  // Update active state on buttons if settings tab is open
  ['light','system','dark'].forEach(t=>{
    const b=document.getElementById('tbtn-'+t);
    if(b){b.style.background=t===pref?'var(--g-bg)':'';b.style.borderColor=t===pref?'var(--g-bor)':'var(--bor2)';b.style.color=t===pref?'var(--brand-lite)':'var(--tx2)';}
  });
  const lbl=document.getElementById('theme-setting-label');
  if(lbl)lbl.textContent=pref==='system'?'Following system':pref==='dark'?'Dark mode':'Light mode';
}

// ── ROUTER ────────────────────────────────────────────────────────────────────
function setTab(tab){
  const prevTab=S.tab;
  // sub-tabs live inside Records
  const recTabs=['yield','expenses','income','drying'];
  if(recTabs.includes(tab)){
    S.recTab=tab;
    S.tab='records';
    document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
    document.getElementById('nav-records')?.classList.add('active');
  } else {
    S.tab=tab;
    document.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
    document.getElementById('nav-'+tab)?.classList.add('active');
  }
  const wasDashboard=(prevTab==='dashboard'&&S.tab==='dashboard');
  render();
  updateFabVisibility();
  // Only init insights when actually navigating TO dashboard, not on every render
  if(S.tab==='dashboard'&&!wasDashboard) initInsights();
}
function render(){
  const el=document.getElementById('main-content');if(!el)return;
  const map={dashboard:renderDashboard,sections:renderSections,records:renderRecords,forecast:renderForecast,settings:renderSettings};
  el.innerHTML=(map[S.tab]||renderDashboard)();
  if(S.tab==='settings') setThemePref(resolveTheme());
}

// ── QUICK-ADD FAB ─────────────────────────────────────────────────────────────
function toggleFab(){
  const items=document.getElementById('fab-items');
  const btn=document.getElementById('fab-main-btn');
  const open=!items.classList.contains('hidden');
  if(open){closeFab();}
  else{items.classList.remove('hidden');btn.classList.add('open');}
}
function closeFab(){
  const items=document.getElementById('fab-items');
  const btn=document.getElementById('fab-main-btn');
  if(items){items.classList.add('hidden');}
  if(btn){btn.classList.remove('open');}
}
// Show FAB only on dashboard tab
function updateFabVisibility(){
  const fab=document.getElementById('quick-fab');
  if(fab) fab.style.display=S.tab==='dashboard'?'flex':'none';
}

// ── ADD TO HOME SCREEN ────────────────────────────────────────────────────────
let _a2hsPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  _a2hsPrompt=e;
  // Show the native install button on Android Chrome
  const wrap=document.getElementById('a2hs-btn-wrap');
  if(wrap)wrap.style.display='block';
});
function triggerA2HS(){
  if(_a2hsPrompt){
    _a2hsPrompt.prompt();
    _a2hsPrompt.userChoice.then(r=>{
      if(r.outcome==='accepted')showToast('Added to home screen ✓');
      _a2hsPrompt=null;
    });
  }
}
window.addEventListener('appinstalled',()=>{
  showToast('V-Plantations installed ✓');
  _a2hsPrompt=null;
});

render();
updateFabVisibility();
// Single startup insights init — initInsights handles caching + debounce
if(S.tab==='dashboard') initInsights();
scheduleInsightsFetch();
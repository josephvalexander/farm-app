// V-Plantations · core.js — constants, state, persistence, theme, crypto, helpers

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const APP_VERSION='__VERSION__'; // replaced at deploy time — or just increment manually
const DB_KEY='vp_data_v1', CFG_KEY='vp_config_v1';
const DRIVE_FILE='vplantations_data.enc', SCOPES='https://www.googleapis.com/auth/drive.file';
const BACKUP_FILES=['vplantations_bak1.enc','vplantations_bak2.enc','vplantations_bak3.enc'];
const CID_PH='YOUR_GOOGLE_CLIENT_ID_HERE';
const AUTO_SYNC_INTERVAL=15*60*1000; // 15min — reduces Drive write race window
const NEWS_KEY='vp_news_v1';
const NEWS_TTL=24*60*60*1000; // 24 hours

// ── STATE ─────────────────────────────────────────────────────────────────────
let cfg={driveFileId:null,sharedFolderId:null,passphrase:null,lastSyncTs:null,clientId:null,googleAccountHint:null,deviceId:'dev_'+Math.random().toString(36).slice(2,8)};
let db={sections:[],seasons:[],yields:[],expenses:[],incomes:[],dryings:[],workers:[],workerRates:[],buyers:[],priceHistory:[],
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
      return result; // first variant that decrypts successfully wins
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
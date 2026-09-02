// V-Plantations · render.js — all render functions, charts, analytics

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
  const curYear=new Date().getFullYear();
  const yrPfx=curYear+'-';
  const yrYields=db.yields.filter(y=>y.date&&y.date.startsWith(yrPfx));
  const yrIncomes=db.incomes.filter(i=>i.date&&i.date.startsWith(yrPfx));
  const yrExpenses=db.expenses.filter(e=>e.date&&e.date.startsWith(yrPfx));
  const ykg=yrYields.reduce((s,y)=>s+(y.qty||0),0);
  const inc=yrIncomes.reduce((s,i)=>s+(i.qty||0)*(i.pricePerKg||0),0);
  const exp=yrExpenses.reduce((s,e)=>s+(e.amount||0),0);
  const profit=inc-exp;
  const plants=totalPlants();
  const byCat={};yrExpenses.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+e.amount);
  const maxE=Math.max(...Object.values(byCat),1);
  const bClr={labor:'#e07b00',pesticide:'#c0392b',rawmat:'#2980b9',crop:'#27ae60',other:'#95a5a6'};
  const recent=[...db.yields.map(y=>({t:'y',y,ts:y.createdAt||0})),...db.incomes.map(i=>({t:'i',i,ts:i.createdAt||0})),...db.expenses.map(e=>({t:'e',e,ts:e.createdAt||0}))].sort((a,b)=>b.ts-a.ts).slice(0,5);
  const hasPrice=db.priceRaw||db.priceDried;
  const insightsOpen=S.insightsOpen!==false; // default open
  return`
<div class="pbanner">
  <div class="pbanner-label">
    <span>Cardamom prices</span>
    <div style="display:flex;gap:6px">
      <button class="manual-btn" onclick="localStorage.removeItem(PRICE_FETCH_KEY);fetchCardamomPrice(true);showToast('Fetching price…')" style="display:flex;align-items:center;gap:4px">
        <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10a6 6 0 0110.5-4M16 10a6 6 0 01-10.5 4"/><path d="M14 6l.5-2.5 2.5.5M6 14l-.5 2.5-2.5-.5"/></svg>
        Auto
      </button>
      <button class="manual-btn" onclick="showEditPrice()">Manual</button>
    </div>
  </div>
  <div class="pbanner-grid">
    <div class="price-block">
      <div class="price-type">Raw / Green</div>
      ${db.priceRaw
        ?`<div class="price-val">₹${db.priceRaw.toLocaleString('en-IN')}<span>/kg</span></div>`
        :`<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
            <input type="number" placeholder="Enter price" onkeydown="if(event.key==='Enter'){const v=parseFloat(this.value);if(v){db.priceRaw=v;db.priceDate=new Date().toISOString().slice(0,10);db.priceSource='Manual entry';saveLocal();render();triggerSync(false);}}" style="width:110px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 10px;color:#fff;font-size:16px;font-weight:600;font-family:inherit"/>
            <button onclick="const i=this.previousElementSibling;const v=parseFloat(i.value);if(v){db.priceRaw=v;db.priceDate=new Date().toISOString().slice(0,10);db.priceSource='Manual entry';saveLocal();render();triggerSync(false);}" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 10px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Save</button>
          </div>`}
    </div>
    <div class="price-block">
      <div class="price-type">Dried <span style="font-size:9px;opacity:0.5;margin-left:2px">auto</span></div>
      <div class="price-val">${db.priceDried?'₹'+db.priceDried.toLocaleString('en-IN'):'<span style="opacity:0.4">—</span>'}<span>/kg</span></div>
    </div>
  </div>
  ${db.priceDried?`<div class="price-source">${db.priceSource||'Auto-fetched'} · ${db.priceDate||''}</div>`:''}
  ${db.priceRaw&&!db.priceDried?`<div class="price-source">Raw: Manual entry · ${db.priceDate||''}</div>`:''}
  ${(()=>{
    const hist=db.priceHistory||[];
    if(hist.length<2)return'';
    const recent=hist.slice(-14);
    const maxP=Math.max(...recent.map(p=>p.avg));
    const minP=Math.min(...recent.map(p=>p.avg));
    const range=Math.max(maxP-minP,100);
    const W=280,H=48,pad=4;
    const pts=recent.map((p,i)=>{
      const x=pad+i*(W-pad*2)/(recent.length-1);
      const y=H-pad-(p.avg-minP)/range*(H-pad*2);
      return[x,y];
    });
    const polyline=pts.map(([x,y])=>x+','+y).join(' ');
    const area=pts.map(([x,y])=>x+','+y).join(' ')+' '+pts[pts.length-1][0]+','+(H)+' '+pts[0][0]+','+H;
    const last=recent[recent.length-1];
    const prev=recent[recent.length-2];
    const trend=last.avg>prev.avg?'\u2191':'\u2193';
    const trendColor=last.avg>prev.avg?'#86efac':'#fca5a5';
    return`<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:10px;color:rgba(255,255,255,0.45)">14-day price trend (avg ₹/kg)</span>
        <span style="font-size:11px;color:${trendColor};font-weight:600">${trend} ${last.avg.toLocaleString('en-IN')}</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block">
        <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#86efac" stop-opacity="0.3"/><stop offset="100%" stop-color="#86efac" stop-opacity="0"/></linearGradient></defs>
        <polygon points="${area}" fill="url(#pg)"/>
        <polyline points="${polyline}" fill="none" stroke="#86efac" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="3" fill="#86efac"/>
      </svg>
      <div style="display:flex;justify-content:space-between;margin-top:2px">
        <span style="font-size:9px;color:rgba(255,255,255,0.3)">${recent[0].date.slice(5).replace('-','/')}</span>
        <span style="font-size:9px;color:rgba(255,255,255,0.3)">${last.date.slice(5).replace('-','/')}</span>
      </div>
    </div>`;
  })()}
</div>

<div class="card">
  <div class="ct">Farm overview <span style="font-size:11px;font-weight:600;background:var(--g-bg);color:var(--g-tx);border:1px solid var(--g-bor);border-radius:10px;padding:2px 8px;margin-left:4px">${curYear}</span></div>
  <div class="mg">
    <div class="met"><div class="ml">Total plants</div><div class="mv">${plants.toLocaleString('en-IN')}</div><div class="ms">${db.sections.length} sections</div></div>
    <div class="met"><div class="ml">Total yield</div><div class="mv">${ykg} kg</div></div>
    <div class="met g"><div class="ml">Total income</div><div class="mv">${fc(inc)}</div></div>
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
      <div class="rs">${s.plants} plants${s.plantType?' · '+s.plantType:''}${s.age?' · Planted '+s.age:''}${s.notes?' · '+esc(s.notes):''}</div>
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
  const t=S.recTab||'harvest';
  const tabs=[
    {id:'harvest', label:'Harvest'},
    {id:'expenses',label:'Expenses'},
    {id:'workers', label:'Workers'},
  ];
  const subNav=`<div class="subtab-bar" style="position:sticky;top:57px;z-index:10">
    ${tabs.map(tb=>`<button class="stb ${t===tb.id?'active':''}" onclick="S.recTab='${tb.id}';render()">${tb.label}</button>`).join('')}
  </div>`;
  if(t==='harvest') return subNav+renderHarvestList();
  if(t==='expenses')return subNav+renderExpenses();
  if(t==='workers') return subNav+renderWorkersList();
  return subNav+renderYield(); // fallback
}

// ── HARVEST LIST ──────────────────────────────────────────────────────────────
function renderHarvestList(){
  const sorted=[...db.yields].sort((a,b)=>b.date.localeCompare(a.date));
  const show=S.showAllYield?sorted:sorted.slice(0,10);
  const yr=new Date().getFullYear()+'';
  const yrYields=db.yields.filter(y=>y.date&&y.date.startsWith(yr));
  const yrIncomes=db.incomes.filter(i=>i.date&&i.date.startsWith(yr));
  const totalKg=yrYields.reduce((s,y)=>s+(y.qty||0),0);
  const totalInc=yrIncomes.reduce((s,i)=>s+(i.qty||0)*(i.pricePerKg||0),0);
  return`
<div class="card">
  <div class="ct">Year to date <span style="font-size:11px;font-weight:600;background:var(--g-bg);color:var(--g-tx);border:1px solid var(--g-bor);border-radius:10px;padding:2px 8px;margin-left:4px">${yr}</span></div>
  <div class="mg">
    <div class="met g"><div class="ml">Harvested</div><div class="mv">${totalKg.toLocaleString('en-IN')} kg</div></div>
    <div class="met g"><div class="ml">Income</div><div class="mv" style="font-size:16px">${fc(totalInc)}</div></div>
  </div>
</div>
<div class="card" style="padding:0;overflow:hidden">
  <div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--bor)">
    <div style="font-size:12px;color:var(--tx3)">Records <span>(${db.yields.length})</span></div>
    <button onclick="showEditHarvest(null)" style="background:var(--brand-mid);color:#fff;border:none;border-radius:var(--rp);padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>Add harvest
    </button>
  </div>
  ${sorted.length===0?`<div class="empty">No harvest records yet<br><span style="font-size:12px">Tap + Add to record today's harvest</span></div>`:`
  ${show.map(y=>{
    const income=db.incomes.find(i=>i.linkedYieldId===y.id);
    const total=income?(income.qty*(income.pricePerKg||0)):null;
    return`<div class="row" style="padding:12px 16px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="rt">${fd(y.date)}</div>
          ${y.sectionId?`<span class="section-chip">${secName(y.sectionId)}</span>`:''}
        </div>
        <div class="rs" style="margin-top:3px">
          ${y.qty} kg${income?` · ₹${income.pricePerKg}/kg → ${fc(total)}`:''}${income?.buyer?' · '+esc(income.buyer):''}${y.labourers?' · '+y.labourers+' workers':''}
        </div>
        ${income?.notes?`<div style="font-size:11px;color:var(--tx3);margin-top:2px">${esc(income.notes)}</div>`:''}
      </div>
      <div class="racts">
        <button class="ia e" onclick="showEditHarvest('${y.id}')">Edit</button>
        <button class="ia d" onclick="confirmDel('yield','${y.id}','harvest ${fd(y.date)}')">Del</button>
      </div>
    </div>`;}).join('')}
  ${sorted.length>10?`<div style="padding:12px 16px;text-align:center;border-top:1px solid var(--bor)"><button onclick="S.showAllYield=!S.showAllYield;render()" class="ia">${S.showAllYield?'Show less':'Show all '+sorted.length}</button></div>`:''}`}
</div>`;
}

// ── WORKERS LIST ──────────────────────────────────────────────────────────────
function renderWorkersList(){
  if(!db.workers)db.workers=[];
  const sorted=[...db.workers].sort((a,b)=>b.date.localeCompare(a.date));
  const show=S.showAllDry?sorted:sorted.slice(0,10);
  const totalWorkers=sorted.reduce((s,w)=>s+(w.totalWorkers||0),0);
  const totalCost=sorted.reduce((s,w)=>s+(w.totalCost||0),0);
  // This calendar week (Mon–Sun)
  const now=new Date();
  const dow=now.getDay()||7; // 1=Mon, 7=Sun
  const weekStart=new Date(now); weekStart.setDate(now.getDate()-dow+1); weekStart.setHours(0,0,0,0);
  const weekEnd=new Date(weekStart); weekEnd.setDate(weekStart.getDate()+6);
  const weekStr=weekStart.toISOString().slice(0,10);
  const weekEndStr=weekEnd.toISOString().slice(0,10);
  const weekWorkers=sorted.filter(w=>w.date>=weekStr&&w.date<=weekEndStr);
  const weekTotal=weekWorkers.reduce((s,w)=>s+(w.totalWorkers||0),0);
  const weekCost=weekWorkers.reduce((s,w)=>{
    // Recompute cost using rate effective on that date for accuracy
    if(w.totalCost)return s+w.totalCost; // already computed at save time
    const r=workerRateForDate(w.date);
    return s+Math.round((w.male||0)*(r.male||0)+(w.female||0)*(r.female||0)+(w.bengali||0)*(r.bengali||0));
  },0);
  const weekLabel=`${weekStart.getDate()} ${weekStart.toLocaleString('en-IN',{month:'short'})} – ${weekEnd.getDate()} ${weekEnd.toLocaleString('en-IN',{month:'short'})}`;
  // Type totals across all records
  const totalMale=sorted.reduce((s,w)=>s+(w.male||0),0);
  const totalFemale=sorted.reduce((s,w)=>s+(w.female||0),0);
  const totalBengali=sorted.reduce((s,w)=>s+(w.bengali||0),0);
  return`
<div class="card">
  <div class="ct">Summary</div>
  <div class="mg">
    <div class="met b">
      <div class="ml">Worker days</div>
      <div class="mv">${totalWorkers.toLocaleString('en-IN')}</div>
      <div class="ms" style="line-height:1.8">
        ${[totalMale?`Male: ${totalMale}`:'', totalFemale?`Female: ${totalFemale}`:'', totalBengali?`Bengali: ${totalBengali}`:''].filter(Boolean).join(' · ')||'No records'}
      </div>
      ${weekTotal>0?`<div class="ms" style="margin-top:2px">${weekLabel}: ${weekTotal}</div>`:''}
    </div>
    <div class="met a">
      <div class="ml">Wages</div>
      <div class="mv" style="font-size:16px">${fc(totalCost)}</div>
      ${weekCost>0?`<div class="ms" style="margin-top:2px">${weekLabel}: ${fc(weekCost)}</div>`:''}
    </div>
  </div>
</div>
<div class="card" style="padding:0;overflow:hidden">
  <div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--bor)">
    <div style="font-size:12px;color:var(--tx3)">Records <span>(${sorted.length})</span></div>
    <button onclick="showEditWorker(null)" style="background:var(--brand-mid);color:#fff;border:none;border-radius:var(--rp);padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>Add workers
    </button>
  </div>
  ${sorted.length===0?`<div class="empty">No worker records yet<br><span style="font-size:12px">Tap + Add to log today's workers</span></div>`:`
  ${show.map(w=>{
    const parts=[];
    if(w.male)parts.push(w.male+' M');
    if(w.female)parts.push(w.female+' F');
    if(w.bengali)parts.push(w.bengali+' B');
    return`<div class="row" style="padding:12px 16px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="rt">${fd(w.date)}</div>
          <span style="font-size:12px;font-weight:600;color:var(--b-tx)">${w.totalWorkers} workers</span>
        </div>
        <div class="rs" style="margin-top:3px">${parts.join(' · ')}${w.totalCost?' · '+fc(w.totalCost):''}${w.notes?' · '+esc(w.notes):''}</div>
      </div>
      <div class="racts">
        <button class="ia e" onclick="showEditWorker('${w.id}')">Edit</button>
        <button class="ia d" onclick="confirmDel('worker','${w.id}','workers ${fd(w.date)}')">Del</button>
      </div>
    </div>`;}).join('')}
  ${sorted.length>10?`<div style="padding:12px 16px;text-align:center;border-top:1px solid var(--bor)"><button onclick="S.showAllDry=!S.showAllDry;render()" class="ia">${S.showAllDry?'Show less':'Show all '+sorted.length}</button></div>`:''}`}
</div>`;
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
      <div class="rs">${y.date}${y.labourers?' · '+y.labourers+' labourers':''}</div>
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
  const yr=new Date().getFullYear()+'';
  const yrExp=db.expenses.filter(e=>e.date&&e.date.startsWith(yr));
  const t=S.expTab,filtered=t==='all'?yrExp:yrExp.filter(e=>e.category===t);
  const totalAll=yrExp.reduce((s,e)=>s+e.amount,0);
  const byCat={};
  yrExp.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+e.amount);
  const catColors={labor:'#e07b00',pesticide:'#c0392b',rawmat:'#2980b9',crop:'#27ae60',other:'#95a5a6'};
  const catSlices=Object.entries(byCat).filter(([,v])=>v>0).map(([k,v])=>({label:CL[k]||k,value:v,color:catColors[k]||'var(--tx3)'}));
  const grouped=groupByPeriod(yrExp, e=>e.date, e=>e.amount||0, period);
  const avgPeriod=grouped.length?Math.round(totalAll/grouped.length):0;
  const peakEntry=grouped.length?grouped.reduce((a,b)=>b.value>a.value?b:a):null;
  const periodLbl={month:'month',quarter:'quarter',year:'year'}[period];
  return`
<div class="card">
  <button onclick="showEditExpense(null)" style="width:100%;margin-bottom:14px;padding:11px;background:var(--r-bg);border:1.5px solid var(--r-bor);border-radius:var(--rs);font-size:13px;font-weight:700;color:var(--r-tx);cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 2v10M2 7h10"/></svg>Add expense</button>
  <div class="ct">Year to date <span style="font-size:11px;font-weight:600;background:var(--a-bg);color:var(--a-tx);border:1px solid var(--a-bor);border-radius:10px;padding:2px 8px;margin-left:4px">${yr}</span></div>
  <div class="mg" style="margin-bottom:14px">
    <div class="met r"><div class="ml">Total spent</div><div class="mv">${fc(totalAll)}</div></div>
    <div class="met"><div class="ml">Avg / ${periodLbl}</div><div class="mv" style="font-size:15px">${fc(avgPeriod)}</div><div class="ms">over ${grouped.length} ${periodLbl}s</div></div>

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
    <div class="met g"><div class="ml">Total income</div><div class="mv">${fc(total)}</div></div>
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
  const now=new Date();
  const curYear=now.getFullYear();
  const plants=totalPlants();
  const noData=db.yields.length===0&&db.expenses.length===0;
  if(noData)return`<div class="card"><div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3v18h18M7 16l4-5 4 3 4-6"/></svg><br>Add yield and expense records to see analytics</div></div>`;

  // ── DATE RANGE ────────────────────────────────────────────────────────────────
  const defaultFrom=curYear+'-01-01';
  const defaultTo=now.toISOString().slice(0,10);
  if(!S.analyticsFrom)S.analyticsFrom=defaultFrom;
  if(!S.analyticsTo)S.analyticsTo=defaultTo;
  const aFrom=S.analyticsFrom;
  const aTo=S.analyticsTo;

  // Compute ranges at render time — avoids closure issues in onclick strings
  const lmStart=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,10);
  const lmEnd=new Date(now.getFullYear(),now.getMonth(),0).toISOString().slice(0,10);
  const lyStart=(curYear-1)+'-01-01';
  const lyEnd=(curYear-1)+'-12-31';
  const allDates=[...db.yields,...db.expenses,...db.incomes].map(r=>r.date).filter(Boolean).sort();
  const atStart=allDates[0]||defaultFrom;
  const quickSets=[
    {label:'Last month',  from:lmStart, to:lmEnd},
    {label:'This year',   from:defaultFrom, to:defaultTo},
    {label:'Last year',   from:lyStart, to:lyEnd},
    {label:'All time',    from:atStart, to:defaultTo},
  ];

  // ── FILTER DATA TO RANGE ──────────────────────────────────────────────────────
  const inRange=d=>d&&d>=aFrom&&d<=aTo;
  const fYields=db.yields.filter(y=>inRange(y.date));
  const fExpenses=db.expenses.filter(e=>inRange(e.date));
  const fIncomes=db.incomes.filter(i=>inRange(i.date));

  // ── HELPERS ──────────────────────────────────────────────────────────────────
  const moKey=d=>d.slice(0,7);
  const moLabel=k=>{const[y,m]=k.split('-');return new Date(+y,+m-1,1).toLocaleDateString('en-IN',{month:'short',year:'2-digit'});};
  const trendArrow=(curr,prev)=>prev<=0?'':curr>prev*1.05?'<span style="color:var(--g-mid)">↑</span>':curr<prev*0.95?'<span style="color:var(--r-tx)">↓</span>':'<span style="color:var(--tx3)">→</span>';
  const pct=v=>v===Infinity||isNaN(v)?'—':Math.round(v)+'%';
  const bar=(val,max,color='var(--brand-lite)')=>`<div style="flex:1;height:7px;background:var(--sur2);border-radius:4px;overflow:hidden;border:1px solid var(--bor)"><div style="width:${Math.min(100,Math.round(val/Math.max(max,1)*100))}%;height:100%;background:${color};border-radius:4px"></div></div>`;

  // ── AGGREGATE BY MONTH (filtered) ─────────────────────────────────────────────
  const yieldByMo={},expByMo={},incByMo={},labByMo={};
  fYields.forEach(y=>{
    const k=moKey(y.date);
    if(!yieldByMo[k])yieldByMo[k]=0;
    yieldByMo[k]+=(y.qty||0);
    if(y.labourers){if(!labByMo[k])labByMo[k]={kg:0,days:0};labByMo[k].kg+=(y.qty||0);labByMo[k].days+=(y.labourers||0);}
  });
  fExpenses.forEach(e=>{
    const k=moKey(e.date);
    if(!expByMo[k])expByMo[k]={total:0,labor:0,pesticide:0,rawmat:0,crop:0,other:0};
    expByMo[k].total+=(e.amount||0);
    expByMo[k][e.category]=(expByMo[k][e.category]||0)+(e.amount||0);
  });
  fIncomes.forEach(i=>{
    const k=moKey(i.date);
    if(!incByMo[k])incByMo[k]=0;
    incByMo[k]+=(i.qty||0)*(i.pricePerKg||0);
  });

  const allMos=[...new Set([...Object.keys(yieldByMo),...Object.keys(expByMo),...Object.keys(incByMo)])].sort();
  const last6=allMos.slice(-6);

  // Totals (filtered)
  const totalYield=fYields.reduce((s,y)=>s+(y.qty||0),0);
  const totalExp=fExpenses.reduce((s,e)=>s+(e.amount||0),0);
  const totalInc=fIncomes.reduce((s,i)=>s+(i.qty||0)*(i.pricePerKg||0),0);
  const totalLaborExp=fExpenses.filter(e=>e.category==='labor').reduce((s,e)=>s+(e.amount||0),0);


  // ── SECTION PERFORMANCE (use filtered data) ─────────────────────────────────
  const secYield={};
  fYields.forEach(y=>{const k=y.sectionId||'__all';secYield[k]=(secYield[k]||0)+(y.qty||0);});
  const secRanked=Object.entries(secYield)
    .map(([id,kg])=>{const sec=db.sections.find(s=>s.id===id);const p=sec?.plants||0;return{name:sec?sec.name:'All sections',kg,plants:p,kgPerPlant:p>0?+(kg/p).toFixed(2):null};})
    .sort((a,b)=>b.kg-a.kg);
  const maxSecKg=Math.max(...secRanked.map(s=>s.kg),1);

  const harvestTrend=last6.map(k=>({mo:k,label:moLabel(k),kg:yieldByMo[k]||0}));
  const maxHarvest=Math.max(...harvestTrend.map(r=>r.kg),1);
  const prevHarvest=harvestTrend.length>=2?harvestTrend[harvestTrend.length-2].kg:0;
  const currHarvest=harvestTrend.length>=1?harvestTrend[harvestTrend.length-1].kg:0;
  const avg6=harvestTrend.reduce((s,r)=>s+r.kg,0)/Math.max(harvestTrend.length,1);

  const byMoOfYear=Array(12).fill(0).map(()=>({total:0,count:0}));
  fYields.forEach(y=>{const mo=parseInt(y.date.slice(5,7))-1;byMoOfYear[mo].total+=(y.qty||0);byMoOfYear[mo].count++;});
  const moNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const bestMoIdx=byMoOfYear.reduce((bi,m,i,a)=>m.total>a[bi].total?i:bi,0);
  const bestMoData=byMoOfYear.map((m,i)=>({label:moNames[i],avg:m.count>0?Math.round(m.total/m.count):0}));
  const maxMoAvg=Math.max(...bestMoData.map(m=>m.avg),1);

  const labMos=Object.entries(labByMo).sort().slice(-6);
  const hasLabData=labMos.length>0;
  const maxLabEff=hasLabData?Math.max(...labMos.map(([,v])=>v.days>0?v.kg/v.days:0),1):1;

  const costPerKg=totalYield>0?totalExp/totalYield:null;
  const last3Mos=last6.slice(-3);
  const cpkByMo=last3Mos.map(k=>({label:moLabel(k),cpk:(yieldByMo[k]||0)>0?(expByMo[k]?.total||0)/(yieldByMo[k]||1):null}));

  const marginTrend=last6.map(k=>{const inc=incByMo[k]||0,exp=expByMo[k]?.total||0;const margin=inc>0?Math.round((inc-exp)/inc*100):null;return{label:moLabel(k),inc,exp,margin,profit:inc-exp};});
  const prevMargin=marginTrend.length>=2?marginTrend[marginTrend.length-2].margin:null;
  const currMargin=marginTrend.length>=1?marginTrend[marginTrend.length-1].margin:null;

  const cats=['labor','pesticide','rawmat','crop','other'];
  const catColors={labor:'#e07b00',pesticide:'#c0392b',rawmat:'#2980b9',crop:'#27ae60',other:'#95a5a6'};
  const half=Math.ceil(allMos.length/2);
  const firstHalf=allMos.slice(0,half),secondHalf=allMos.slice(half);
  const sumCat=(mos,cat)=>mos.reduce((s,k)=>s+(expByMo[k]?.[cat]||0),0);
  const catDrift=cats.map(c=>{const a=sumCat(firstHalf,c),b=sumCat(secondHalf,c);const drift=a>0?Math.round((b-a)/a*100):null;return{cat:c,label:CL[c],total:b,drift};}).filter(c=>c.total>0).sort((a,b)=>b.total-a.total);
  const maxCatTotal=Math.max(...catDrift.map(c=>c.total),1);

  const recentMos=last6;
  const recentYield=recentMos.reduce((s,k)=>s+(yieldByMo[k]||0),0);
  const recentExp=recentMos.reduce((s,k)=>s+(expByMo[k]?.total||0),0);
  const breakEven=recentYield>0?Math.ceil(recentExp/recentYield):null;
  const lastSalePrice=fIncomes.length>0?fIncomes[fIncomes.length-1].pricePerKg:null;

  const waterfall=last6.map(k=>({label:moLabel(k),inc:Math.round(incByMo[k]||0),exp:Math.round(expByMo[k]?.total||0),profit:Math.round((incByMo[k]||0)-(expByMo[k]?.total||0))}));
  const maxWF=Math.max(...waterfall.map(w=>Math.max(w.inc,w.exp)),1);

  const laborPct=totalInc>0?Math.round(totalLaborExp/totalInc*100):null;
  const laborMoTrend=last6.map(k=>({label:moLabel(k),pct:(incByMo[k]||0)>0?Math.round((expByMo[k]?.labor||0)/(incByMo[k]||1)*100):null}));

  return`

<!-- ── DATE RANGE PICKER ── -->
<div class="card" style="padding:14px 16px">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
    ${quickSets.map(q=>{const active=aFrom===q.from&&aTo===q.to;return`<button onclick="S.analyticsFrom='${q.from}';S.analyticsTo='${q.to}';render()" style="padding:5px 12px;font-size:11px;font-weight:600;border-radius:20px;border:1.5px solid ${active?'var(--g-bor)':'var(--bor2)'};background:${active?'var(--g-bg)':'none'};color:${active?'var(--g-tx)':'var(--tx3)'};cursor:pointer;font-family:inherit">${q.label}</button>`;}).join('')}
  </div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:120px">
      <span style="font-size:11px;color:var(--tx3);white-space:nowrap">From</span>
      <input type="date" value="${aFrom}" onchange="S.analyticsFrom=this.value;render()" style="flex:1;font-size:12px;padding:6px 8px;border:1px solid var(--bor2);border-radius:var(--rs);background:var(--sur);color:var(--tx);font-family:inherit"/>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:120px">
      <span style="font-size:11px;color:var(--tx3);white-space:nowrap">To</span>
      <input type="date" value="${aTo}" onchange="S.analyticsTo=this.value;render()" style="flex:1;font-size:12px;padding:6px 8px;border:1px solid var(--bor2);border-radius:var(--rs);background:var(--sur);color:var(--tx);font-family:inherit"/>
    </div>
  </div>
  <div style="font-size:11px;color:var(--tx3);margin-top:8px">${allMos.length} months · ${fYields.length} yield records · ${fExpenses.length} expenses · ${fIncomes.length} sales in range</div>
</div>

<!-- ════ YIELD ANALYSIS ════ -->
<div class="card" style="margin-bottom:6px">
  <div style="font-size:11px;font-weight:700;color:var(--tx3);letter-spacing:1px;text-transform:uppercase;margin-bottom:14px">Yield analysis</div>
  <div class="mg" style="margin-bottom:0">
    <div class="met g"><div class="ml">Total yield</div><div class="mv">${totalYield} kg</div><div class="ms">${db.yields.length} records</div></div>
    <div class="met"><div class="ml">6-month avg</div><div class="mv">${Math.round(avg6)} kg/mo</div><div class="ms">last 6 months</div></div>
  </div>
</div>

<!-- Section performance -->
<div class="card">
  <div class="ct">Section performance</div>
  ${secRanked.length===0?'<div class="empty" style="padding:16px">No yield data yet</div>':secRanked.map((s,i)=>`
  <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bor)">
    <div style="width:18px;height:18px;border-radius:50%;background:${i===0?'var(--g-bg)':'var(--sur2)'};border:1.5px solid ${i===0?'var(--g-bor)':'var(--bor)'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${i===0?'var(--g-tx)':'var(--tx3)'};flex-shrink:0">${i+1}</div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:13px;font-weight:600;color:var(--tx)">${esc(s.name)}</span>
        <span style="font-size:13px;font-weight:700;color:var(--g-tx)">${s.kg} kg</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${bar(s.kg,maxSecKg,'var(--g-mid)')}
        <span style="font-size:10px;color:var(--tx3);white-space:nowrap">${s.kgPerPlant!==null?s.kgPerPlant+' kg/plant':s.plants===0?'no plants set':''}</span>
      </div>
    </div>
  </div>`).join('')}
</div>

<!-- Harvest trend -->
<div class="card">
  <div class="ct">Harvest trend <span style="font-weight:400;color:var(--tx3)">— last 6 months</span>
    <span>${trendArrow(currHarvest,prevHarvest)}</span>
  </div>
  ${harvestTrend.length===0?'<div class="empty" style="padding:16px">No harvest data</div>':
  `<div style="display:flex;align-items:flex-end;gap:6px;height:80px;margin-bottom:8px">
    ${harvestTrend.map(r=>`
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%">
      <div style="flex:1;display:flex;align-items:flex-end;width:100%">
        <div style="width:100%;background:${r.kg>=avg6?'var(--g-mid)':'var(--g-bg)'};border:1px solid var(--g-bor);border-radius:4px 4px 0 0;height:${Math.max(4,Math.round(r.kg/maxHarvest*100))}%" title="${r.kg} kg"></div>
      </div>
      <div style="font-size:9px;color:var(--tx3);text-align:center">${r.label}</div>
    </div>`).join('')}
  </div>
  <div style="font-size:11px;color:var(--tx3)">Darker bar = above 6-month average (${Math.round(avg6)} kg)</div>`}
</div>

<!-- Best harvest month -->
<div class="card">
  <div class="ct">Best harvest month
    <span style="font-size:12px;font-weight:600;color:var(--g-mid)">${byMoOfYear[bestMoIdx].count>0?moNames[bestMoIdx]:'—'}</span>
  </div>
  ${byMoOfYear.every(m=>m.count===0)?'<div class="empty" style="padding:16px">Need more data across different months</div>':
  `<div style="display:flex;align-items:flex-end;gap:3px;height:70px;margin-bottom:4px">
    ${bestMoData.map((m,i)=>`
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%">
      <div style="flex:1;display:flex;align-items:flex-end;width:100%">
        <div style="width:100%;background:${i===bestMoIdx?'var(--brand-lite)':m.avg>0?'var(--g-bg)':'var(--sur2)'};border-radius:3px 3px 0 0;height:${m.avg>0?Math.max(3,Math.round(m.avg/maxMoAvg*100)):2}%;border:1px solid ${i===bestMoIdx?'var(--brand-lite)':'var(--bor)'}"></div>
      </div>
      <div style="font-size:8px;color:${i===bestMoIdx?'var(--brand-lite)':'var(--tx3)'};font-weight:${i===bestMoIdx?700:400};margin-top:2px">${m.label.slice(0,1)}</div>
    </div>`).join('')}
  </div>
  <div style="font-size:11px;color:var(--tx3)">Average yield by calendar month across all recorded history</div>`}
</div>

<!-- Yield per labourer -->
<div class="card">
  <div class="ct">Yield per labourer <span style="font-weight:400;color:var(--tx3)">kg/person/day</span></div>
  ${!hasLabData?'<div class="empty" style="padding:16px">Add "Labourers picking" when recording yield to see efficiency data</div>':
  `${labMos.map(([k,v])=>{const eff=v.days>0?+(v.kg/v.days).toFixed(1):0;return`
  <div class="br-row">
    <div class="br-lbl">${moLabel(k)}</div>
    ${bar(eff,maxLabEff,'var(--b-mid)')}
    <div class="br-val">${eff} kg</div>
  </div>`;}).join('')}`}
</div>

<!-- ════ FINANCIAL ANALYSIS ════ -->
<div class="card" style="margin-bottom:6px">
  <div style="font-size:11px;font-weight:700;color:var(--tx3);letter-spacing:1px;text-transform:uppercase;margin-bottom:14px">Financial analysis</div>
  <div class="mg">
    <div class="met g"><div class="ml">Total income</div><div class="mv" style="font-size:16px">${fc(totalInc)}</div></div>
    <div class="met a"><div class="ml">Total expenses</div><div class="mv" style="font-size:16px">${fc(totalExp)}</div></div>
    <div class="met ${totalInc-totalExp>=0?'g':'r'}"><div class="ml">Net profit</div><div class="mv" style="font-size:16px">${fc(totalInc-totalExp)}</div></div>
    <div class="met b"><div class="ml">Gross margin</div><div class="mv">${totalInc>0?pct((totalInc-totalExp)/totalInc*100):'—'}</div></div>
  </div>
</div>

<!-- Cost per kg -->
<div class="card">
  <div class="ct">Cost per kg
    <span style="font-size:16px;font-weight:700;color:var(--a-mid)">${costPerKg?'₹'+Math.round(costPerKg):db.yields.length===0?'No yield data':'—'}</span>
  </div>
  ${cpkByMo.some(m=>m.cpk!==null)?`
  ${cpkByMo.map(m=>`
  <div class="br-row">
    <div class="br-lbl">${m.label}</div>
    ${bar(m.cpk||0,Math.max(...cpkByMo.map(x=>x.cpk||0),1),'var(--a-mid)')}
    <div class="br-val">${m.cpk?'₹'+Math.round(m.cpk):'—'}</div>
  </div>`).join('')}
  <div style="font-size:11px;color:var(--tx3);margin-top:8px">Total expenses ÷ total kg harvested. Lower is better.</div>`:'<div style="font-size:12px;color:var(--tx3)">Need both yield and expense records in the same months</div>'}
</div>

<!-- Gross margin trend -->
<div class="card">
  <div class="ct">Gross margin trend
    ${currMargin!==null?`<span style="font-size:14px;font-weight:700;color:${currMargin>=0?'var(--g-mid)':'var(--r-tx)'}">${currMargin}%</span>`:''}
    ${currMargin!==null&&prevMargin!==null?trendArrow(currMargin,prevMargin):''}
  </div>
  ${marginTrend.every(m=>m.inc===0&&m.exp===0)?'<div class="empty" style="padding:16px">No income or expense data</div>':
  marginTrend.map(m=>`
  <div style="padding:8px 0;border-bottom:1px solid var(--bor)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
      <span style="font-size:12px;color:var(--tx2)">${m.label}</span>
      <div style="display:flex;gap:12px;align-items:center">
        <span style="font-size:11px;color:var(--tx3)">${fc(m.inc)} in · ${fc(m.exp)} out</span>
        <span style="font-size:13px;font-weight:700;color:${m.profit>=0?'var(--g-mid)':'var(--r-tx)'}">${m.margin!==null?m.margin+'%':'—'}</span>
      </div>
    </div>
    <div style="display:flex;gap:2px;height:6px;border-radius:4px;overflow:hidden;background:var(--sur2)">
      ${m.inc>0?`<div style="width:${Math.round(m.inc/maxWF*100)}%;background:var(--g-mid);border-radius:4px 0 0 4px"></div>`:''}
      ${m.exp>0?`<div style="width:${Math.round(m.exp/maxWF*100)}%;background:var(--r-mid);border-radius:0 4px 4px 0"></div>`:''}
    </div>
  </div>`).join('')}
</div>

<!-- Expense category drift -->
<div class="card">
  <div class="ct">Expense category drift</div>
  ${catDrift.length===0?'<div class="empty" style="padding:16px">No expense data</div>':
  `<div style="font-size:11px;color:var(--tx3);margin-bottom:10px">Comparing first half vs second half of your expense history</div>
  ${catDrift.map(c=>`
  <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--bor)">
    <div style="width:68px;flex-shrink:0">
      <div style="font-size:12px;color:var(--tx);font-weight:500">${c.label}</div>
      <div style="font-size:10px;color:var(--tx3)">${fc(c.total)}</div>
    </div>
    ${bar(c.total,maxCatTotal,catColors[c.cat])}
    <div style="width:44px;text-align:right;flex-shrink:0">
      ${c.drift!==null?`<span style="font-size:12px;font-weight:700;color:${c.drift>10?'var(--r-tx)':c.drift<-10?'var(--g-mid)':'var(--tx3)'}">${c.drift>0?'+':''}${c.drift}%</span>`:'<span style="font-size:11px;color:var(--tx3)">new</span>'}
    </div>
  </div>`).join('')}
  <div style="font-size:10px;color:var(--tx3);margin-top:8px">% change vs earlier period. Red = growing cost, green = shrinking.</div>`}
</div>

<!-- Break-even price -->
<div class="card">
  <div class="ct">Break-even price</div>
  <div style="display:flex;align-items:flex-end;gap:20px;margin-bottom:14px">
    <div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:3px">Break-even</div>
      <div style="font-size:32px;font-weight:700;color:var(--tx);letter-spacing:-1px">${breakEven?'₹'+breakEven:db.yields.length===0?'—':fc(0)}<span style="font-size:13px;color:var(--tx3);font-weight:400">/kg</span></div>
    </div>
    ${lastSalePrice?`
    <div>
      <div style="font-size:11px;color:var(--tx3);margin-bottom:3px">Last sale price</div>
      <div style="font-size:24px;font-weight:700;color:${lastSalePrice>=(breakEven||0)?'var(--g-mid)':'var(--r-tx)'};letter-spacing:-0.5px">₹${lastSalePrice}<span style="font-size:12px;font-weight:400">/kg</span></div>
    </div>`:''}
  </div>
  ${breakEven&&lastSalePrice?`
  <div style="background:${lastSalePrice>=breakEven?'var(--g-bg)':'var(--r-bg)'};border:1px solid ${lastSalePrice>=breakEven?'var(--g-bor)':'var(--r-bor)'};border-radius:var(--rs);padding:10px 12px;font-size:12px;color:${lastSalePrice>=breakEven?'var(--g-tx)':'var(--r-tx)'}">
    ${lastSalePrice>=breakEven?`Selling at ₹${lastSalePrice}/kg gives you ₹${Math.round((lastSalePrice-breakEven))} margin per kg (${Math.round((lastSalePrice-breakEven)/lastSalePrice*100)}% above break-even)`:`Current sale price is ₹${Math.round(breakEven-lastSalePrice)} below break-even — expenses exceed income at this price`}
  </div>`:''}
  <div style="font-size:11px;color:var(--tx3);margin-top:10px">Based on last 6 months of expenses and yield records.</div>
</div>

<!-- Income vs expense grouped bar chart -->
<div class="card">
  <div class="ct">Income vs expenses — monthly</div>
  ${waterfall.every(w=>w.inc===0&&w.exp===0)?'<div class="empty" style="padding:16px">No income or expense data yet</div>':`
  <div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-bottom:10px">
    ${waterfall.map(w=>{
      const incH=w.inc>0?Math.max(4,Math.round(w.inc/maxWF*100)):0;
      const expH=w.exp>0?Math.max(4,Math.round(w.exp/maxWF*100)):0;
      return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%">
        <div style="flex:1;display:flex;align-items:flex-end;gap:2px;width:100%">
          <div style="flex:1;background:var(--g-mid);border-radius:3px 3px 0 0;height:${incH}%" title="Income ${fc(w.inc)}"></div>
          <div style="flex:1;background:var(--a-mid);border-radius:3px 3px 0 0;height:${expH}%" title="Expense ${fc(w.exp)}"></div>
        </div>
        <div style="font-size:9px;color:var(--tx3);text-align:center;white-space:nowrap">${w.label}</div>
      </div>`;
    }).join('')}
  </div>
  <div style="display:flex;gap:16px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:2px;background:var(--g-mid)"></div><span style="font-size:11px;color:var(--tx3)">Income</span></div>
    <div style="display:flex;align-items:center;gap:5px"><div style="width:10px;height:10px;border-radius:2px;background:var(--a-mid)"></div><span style="font-size:11px;color:var(--tx3)">Expenses</span></div>
  </div>
  <div style="border-top:1px solid var(--bor);padding-top:8px">
    ${waterfall.map(w=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px">
      <span style="color:var(--tx2)">${w.label}</span>
      <span style="color:${w.profit>=0?'var(--g-mid)':'var(--r-tx)'};font-weight:600">${w.profit>=0?'+':''}${fc(w.profit)}</span>
    </div>`).join('')}
  </div>`}
</div>

<!-- ════ LABOUR & OPERATIONS ════ -->
<div class="card" style="margin-bottom:6px">
  <div style="font-size:11px;font-weight:700;color:var(--tx3);letter-spacing:1px;text-transform:uppercase;margin-bottom:14px">Labour &amp; operations</div>
  <div class="mg">
    <div class="met a"><div class="ml">Total labour cost</div><div class="mv" style="font-size:16px">${fc(totalLaborExp)}</div><div class="ms">${totalExp>0?Math.round(totalLaborExp/totalExp*100)+'% of expenses':''}</div></div>
    <div class="met ${laborPct!==null&&laborPct<=55?'g':'r'}"><div class="ml">Labour % of income</div><div class="mv">${laborPct!==null?laborPct+'%':'—'}</div><div class="ms">benchmark: 40–55%</div></div>
  </div>
</div>

<!-- Labour cost % of income -->
<div class="card">
  <div class="ct">Labour cost as % of income</div>
  ${laborMoTrend.every(m=>m.pct===null)?'<div class="empty" style="padding:16px">Need both labour expenses and income records</div>':
  laborMoTrend.map(m=>`
  <div class="br-row">
    <div class="br-lbl">${m.label}</div>
    ${bar(m.pct||0,100,m.pct!==null&&m.pct>55?'var(--r-mid)':m.pct!==null&&m.pct<=40?'var(--g-mid)':'var(--a-mid)')}
    <div class="br-val">${m.pct!==null?m.pct+'%':'—'}</div>
  </div>`).join('')+`<div style="font-size:10px;color:var(--tx3);margin-top:8px">Industry benchmark: 40–55%. Green = efficient, red = high.</div>`}
</div>

<!-- Harvest efficiency over time -->
<div class="card">
  <div class="ct">Harvest efficiency over time</div>
  ${!hasLabData?'<div class="empty" style="padding:16px">Add labourer count when recording yield to track efficiency</div>':
  `${labMos.map(([k,v])=>{
    const eff=v.days>0?+(v.kg/v.days).toFixed(1):0;
    return`<div class="br-row">
    <div class="br-lbl">${moLabel(k)}</div>
    ${bar(eff,maxLabEff,eff>=2?'var(--g-mid)':eff>=1?'var(--a-mid)':'var(--r-mid)')}
    <div class="br-val">${eff} kg/d</div>
  </div>`;}).join('')}
  <div style="font-size:10px;color:var(--tx3);margin-top:8px">kg harvested per labourer per picking day</div>`}
</div>

<!-- Projected expenses -->
${(()=>{
  const isPeakMo=mo=>[6,7,8,9].includes(mo);
  const expByCat2={labor:0,pesticide:0,rawmat:0,crop:0,other:0};
  const expMonths2=new Set();
  db.expenses.forEach(e=>{if(e.date)expMonths2.add(e.date.slice(0,7));expByCat2[e.category]=(expByCat2[e.category]||0)+(e.amount||0);});
  const nM=Math.max(expMonths2.size,1);
  const monthlyByCat={};Object.entries(expByCat2).forEach(([k,v])=>monthlyByCat[k]=v/nM);
  const totalMoExp=Object.values(monthlyByCat).reduce((s,v)=>s+v,0);
  const rows=Array.from({length:5},(_,i)=>{
    const d=new Date(now.getFullYear(),now.getMonth()+i+1,1);
    const mo=d.getMonth();const isPeak=isPeakMo(mo);
    const scale=isPeak?1.3:0.85;
    const projByCat={};Object.entries(monthlyByCat).forEach(([k,v])=>projByCat[k]=Math.round(v*scale));
    return{label:d.toLocaleDateString('en-IN',{month:'short',year:'numeric'}),isPeak,projExp:Math.round(totalMoExp*scale),projByCat};
  });
  const CL2={labor:'Labor',pesticide:'Pesticide',rawmat:'Raw mat.',crop:'Crop',other:'Other'};
  const expCols={labor:'var(--brand-glow)',pesticide:'var(--r-tx)',rawmat:'var(--a-mid)',crop:'var(--b-tx)',other:'var(--tx3)'};
  return`<div class="card">
  <div class="ct">Projected expenses — next 5 months</div>
  ${rows.map(r=>`
  <div style="padding:8px 0;border-bottom:1px solid var(--bor)">
    <div style="display:flex;justify-content:space-between;margin-bottom:5px">
      <span style="font-size:13px;font-weight:600">${r.label}${r.isPeak?'<span class="pk" style="margin-left:4px">Peak</span>':''}</span>
      <span style="font-size:14px;font-weight:700;color:var(--a-mid)">${fc(r.projExp)}</span>
    </div>
    <div style="display:flex;gap:3px;height:6px;border-radius:4px;overflow:hidden">
      ${Object.entries(r.projByCat).filter(([,v])=>v>0).map(([cat,v])=>`<div style="flex:${v};background:${expCols[cat]};min-width:3px"></div>`).join('')}
    </div>
  </div>`).join('')}
</div>`;
})()}
`;
}
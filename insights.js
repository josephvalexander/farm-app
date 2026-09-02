// V-Plantations · insights.js — Gemini AI insights, price fetch, schedulers

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

// ── CARDAMOM PRICE AUTO-FETCH (cardamom.farm) ─────────────────────────────────
const PRICE_FETCH_KEY='vp_price_fetch_ts';
const PRICE_FETCH_TTL=12*60*60*1000; // fetch at most every 12h

async function fetchCardamomPrice(force=false){
  const last=parseInt(localStorage.getItem(PRICE_FETCH_KEY)||'0');
  if(!force&&Date.now()-last<PRICE_FETCH_TTL)return;

  const key=await loadGeminiKey();
  if(!key){return;}

  const todayIST=new Date(Date.now()+5.5*3600000);
  const todayStr=todayIST.toISOString().slice(0,10);

  // Use web_search tool — more reliable than grounding for structured data extraction
  const prompt=`Search the web for "cardamom auction price today site:cardamom.farm" OR "cardamom.farm price ${todayStr}".

Find the latest small cardamom e-auction average price in Kerala, India from cardamom.farm.
The site shows daily auction results with average price in ₹/kg and date.

Return ONLY this JSON (no markdown, no explanation):
{"date":"YYYY-MM-DD","avg":NUMBER,"max":NUMBER,"found":true}

Use found:false if no recent price found. avg and max must be plain integers like 3055.`;

  try{
    // Try with web search tool first
    const makeBody=(tool)=>JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      ...(tool?{tools:[{google_search:{}}]}:{}),
      generationConfig:{temperature:0,maxOutputTokens:150}
    });

    let res=await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
      {method:'POST',headers:{'Content-Type':'application/json'},body:makeBody(true),signal:AbortSignal.timeout(25000)}
    );

    if(!res.ok){
      const err=await res.json().catch(()=>({}));
      const msg=(err.error?.message||'').toLowerCase();
      // Fallback without grounding
      if(res.status===400&&(msg.includes('tool')||msg.includes('search'))){
        res=await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
          {method:'POST',headers:{'Content-Type':'application/json'},body:makeBody(false),signal:AbortSignal.timeout(25000)}
        );
      }
    }
    if(!res.ok)throw new Error('API error '+res.status);

    const data=await res.json();

    // Handle empty content (grounding ran but returned no text)
    const parts=data.candidates?.[0]?.content?.parts||[];
    const text=parts.map(p=>p.text||'').join('').trim();

    if(!text){
      console.warn('[Price] Gemini returned empty response — grounding may have blocked page access');
      localStorage.setItem(PRICE_FETCH_KEY,Date.now().toString());
      return;
    }

    // Extract JSON
    let parsed=null;
    try{parsed=JSON.parse(text.replace(/```json|```/gi,'').trim());}catch(e){}
    if(!parsed){const m=text.match(/\{[^{}]+\}/);if(m)try{parsed=JSON.parse(m[0]);}catch(e){}}
    if(!parsed){
      // Extract individual fields
      const avgM=text.match(/"avg"\s*:\s*(\d{3,6})/)||text.match(/avg[^:]*:\s*(\d{3,6})/i);
      const dateM=text.match(/"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)||text.match(/(\d{4}-\d{2}-\d{2})/);
      const maxM=text.match(/"max"\s*:\s*(\d{3,6})/);
      if(avgM&&dateM){parsed={found:true,date:dateM[1],avg:parseInt(avgM[1]),max:maxM?parseInt(maxM[1]):parseInt(avgM[1])};}
    }

    if(!parsed?.found||!parsed.avg||parsed.avg<500||parsed.avg>200000){
      localStorage.setItem(PRICE_FETCH_KEY,Date.now().toString());
      return;
    }

    // Reject if older than 7 days
    if(parsed.date){
      const daysDiff=(Date.now()-new Date(parsed.date+'T00:00:00Z').getTime())/86400000;
      if(daysDiff>7){console.warn('[Price] Stale date rejected:',parsed.date);localStorage.setItem(PRICE_FETCH_KEY,Date.now().toString());return;}
    }

    // Update history
    const existing=db.priceHistory.findIndex(p=>p.date===parsed.date);
    const entry={date:parsed.date,avg:parsed.avg,max:parsed.max||parsed.avg,fetchedAt:Date.now()};
    if(existing>=0)db.priceHistory[existing]=entry;
    else db.priceHistory.push(entry);
    db.priceHistory.sort((a,b)=>a.date.localeCompare(b.date));
    if(db.priceHistory.length>60)db.priceHistory=db.priceHistory.slice(-60);

    db.priceDried=parsed.avg;
    db.priceDate=parsed.date;
    db.priceSource='cardamom.farm';
    db.priceUpdatedAt=Date.now();
    saveLocal();
    triggerSync(false);
    if(S.tab==='dashboard')render();
    showToast('Price updated · ₹'+parsed.avg.toLocaleString('en-IN')+'/kg ✓');
  }catch(e){
    console.warn('[Price] Failed:',e.message);
  }
  localStorage.setItem(PRICE_FETCH_KEY,Date.now().toString());
}


// ── 5AM IST SCHEDULER ────────────────────────────────────────────────────────
function schedulePriceFetch(){
  const IST=5.5*3600000;
  const now=Date.now();
  const istNow=new Date(now+IST);
  const target=new Date(istNow);
  target.setHours(18,0,0,0); // 6pm IST
  let ms=target.getTime()-istNow.getTime();
  if(ms<0)ms+=86400000;
  setTimeout(()=>{fetchCardamomPrice(false);setInterval(()=>fetchCardamomPrice(false),86400000);},ms);
}

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
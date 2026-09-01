// V-Plantations · modals.js — modals, forms, settings, router, FAB

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
const PLANT_TYPES=['Njallani','Sundari','Kumily','Other'];
function showEditSection(id){
  const s=id?db.sections.find(x=>x.id===id):null;
  const ptOpts=PLANT_TYPES.map(t=>`<option value="${t}" ${(s?.plantType||'Njallani')===t?'selected':''}>${t}</option>`).join('');
  modal(`
<div class="fg"><label class="fl">Section name <span style="color:var(--r-tx)">*</span></label><input id="f-sn" type="text" value="${esc(s?.name||'')}" placeholder="e.g. Block D East"/></div>
<div class="fg"><label class="fl">Number of plants</label><input id="f-sp" type="number" value="${s?.plants||''}" placeholder="100"/></div>
<div class="fg"><label class="fl">Plant type</label><select id="f-spt">${ptOpts}</select></div>
<div class="fg"><label class="fl">Year planted</label><input id="f-sa" type="number" value="${s?.age||''}" placeholder="${new Date().getFullYear()}"/></div>
<div class="fg"><label class="fl">Notes</label><input id="f-sno" type="text" value="${esc(s?.notes||'')}" placeholder="Slope, shade, irrigation…"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveSection('${id||''}')">Save</button></div>`,s?'Edit section':'Add section');
}
function saveSection(id){
  const name=document.getElementById('f-sn').value.trim();
  if(!name){document.getElementById('f-sn').style.borderColor='var(--r-tx)';document.getElementById('f-sn').focus();return;}
  const data={name,plants:parseInt(document.getElementById('f-sp').value)||0,plantType:document.getElementById('f-spt').value||'Njallani',age:parseInt(document.getElementById('f-sa').value)||0,notes:document.getElementById('f-sno').value.trim(),updatedAt:Date.now()};
  if(id){const i=db.sections.findIndex(x=>x.id===id);if(i>=0)db.sections[i]={...db.sections[i],...data};}
  else db.sections.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),2000);
}

// SEASON — removed

// YIELD
function showEditYield(id){
  const y=id?db.yields.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Date <span style="color:var(--r-tx)">*</span></label><input id="f-yd" type="date" value="${y?.date||new Date().toISOString().slice(0,10)}"/></div>
<div class="fg"><label class="fl">Section</label><select id="f-ys">${secOpts('Entire farm')}</select></div>
<div class="fg"><label class="fl">Yield (kg) <span style="color:var(--r-tx)">*</span></label><input id="f-yq" type="number" value="${y?.qty||''}" placeholder="50"/></div>
<div class="fg"><label class="fl">Labourers picking</label><input id="f-yl" type="number" value="${y?.labourers||''}" placeholder="e.g. 5" min="0"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveYield('${id||''}')">Save</button></div>`,y?'Edit yield':'Add yield');
  if(y){const s=document.getElementById('f-ys');if(s&&y.sectionId)s.value=y.sectionId;}
}
function saveYield(id){
  const qtyEl=document.getElementById('f-yq');
  const qty=parseFloat(qtyEl.value);
  if(!qty){qtyEl.style.borderColor='var(--r-tx)';qtyEl.focus();return;}
  const data={sectionId:document.getElementById('f-ys').value||null,date:document.getElementById('f-yd').value,qty,labourers:parseInt(document.getElementById('f-yl').value)||null,updatedAt:Date.now()};
  if(id){const i=db.yields.findIndex(x=>x.id===id);if(i>=0)db.yields[i]={...db.yields[i],...data};}
  else db.yields.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),2000);
}

// EXPENSE
function showEditExpense(id){
  const e=id?db.expenses.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Date <span style="color:var(--r-tx)">*</span></label><input id="f-edt" type="date" value="${e?.date||new Date().toISOString().slice(0,10)}"/></div>
<div class="fg"><label class="fl">Category <span style="color:var(--r-tx)">*</span></label>
<select id="f-ec"><option value="labor" ${e?.category==='labor'?'selected':''}>Labor</option><option value="pesticide" ${e?.category==='pesticide'?'selected':''}>Pesticide</option><option value="rawmat" ${e?.category==='rawmat'?'selected':''}>Raw material</option><option value="crop" ${e?.category==='crop'?'selected':''}>Crop</option><option value="other" ${e?.category==='other'?'selected':''}>Other</option></select>
</div>
<div class="fg"><label class="fl">Description <span style="color:var(--r-tx)">*</span></label><input id="f-ed" type="text" value="${esc(e?.desc||'')}" placeholder="e.g. Weeding labor"/></div>
<div class="fg"><label class="fl">Amount (₹) <span style="color:var(--r-tx)">*</span></label><input id="f-ea" type="number" value="${e?.amount||''}" placeholder="5000"/></div>
<div class="fg"><label class="fl">Section (optional)</label><select id="f-es">${secOpts()}</select></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveExpense('${id||''}')">Save</button></div>`,e?'Edit expense':'Add expense');
  if(e){const s=document.getElementById('f-es');if(s&&e.sectionId)s.value=e.sectionId;}
}
function saveExpense(id){
  const descEl=document.getElementById('f-ed'),amtEl=document.getElementById('f-ea');
  const desc=descEl.value.trim(),amount=parseFloat(amtEl.value);
  if(!desc){descEl.style.borderColor='var(--r-tx)';descEl.focus();return;}
  if(!amount){amtEl.style.borderColor='var(--r-tx)';amtEl.focus();return;}
  const data={category:document.getElementById('f-ec').value,desc,amount,date:document.getElementById('f-edt').value,sectionId:document.getElementById('f-es').value||null,updatedAt:Date.now()};
  if(id){const i=db.expenses.findIndex(x=>x.id===id);if(i>=0)db.expenses[i]={...db.expenses[i],...data};}
  else db.expenses.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),2000);
}

// INCOME — note: price NOT prefilled
function showEditIncome(id){
  const i=id?db.incomes.find(x=>x.id===id):null;
  modal(`
<div class="fg"><label class="fl">Date <span style="color:var(--r-tx)">*</span></label><input id="f-id" type="date" value="${i?.date||new Date().toISOString().slice(0,10)}"/></div>
<div class="fg"><label class="fl">Quantity sold (kg) <span style="color:var(--r-tx)">*</span></label><input id="f-iq" type="number" value="${i?.qty||''}" placeholder="100"/></div>
<div class="fg"><label class="fl">Price per kg (₹) <span style="color:var(--r-tx)">*</span></label><input id="f-ip" type="number" value="${i?.pricePerKg||''}" placeholder="Enter price"/></div>
<div class="fg"><label class="fl">Type</label>
<select id="f-ity"><option value="raw" ${(i?.type||'raw')==='raw'?'selected':''}>Raw / green cardamom</option><option value="dried" ${i?.type==='dried'?'selected':''}>Dried cardamom</option></select>
</div>
<div class="fg"><label class="fl">Buyer / market <span style="color:var(--r-tx)">*</span></label>
  <select id="f-ib" onchange="if(this.value==='__new__'){const n=prompt('Enter buyer name:');if(n&&n.trim()){if(!db.buyers.includes(n.trim()))db.buyers.push(n.trim());saveLocal();triggerSync(false);this.outerHTML='<select id=\'f-ib\'>'+buyerOpts(n.trim())+'</select>';}else{this.value='';}}">
    ${buyerOpts(i?.buyer||'')}
  </select>
</div>
<div class="fg"><label class="fl">Section (optional)</label><select id="f-is">${secOpts()}</select></div>
<div class="fg"><label class="fl">Notes</label><input id="f-ino" type="text" value="${esc(i?.notes||'')}" placeholder="Grade, batch…"/></div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="saveIncome('${id||''}')">Save</button></div>`,i?'Edit sale':'Add sale / income');
  if(i){const s=document.getElementById('f-is');if(s&&i.sectionId)s.value=i.sectionId;}
}
function saveIncome(id){
  const qtyEl=document.getElementById('f-iq'),priceEl=document.getElementById('f-ip'),buyerEl=document.getElementById('f-ib');
  const qty=parseFloat(qtyEl.value),pricePerKg=parseFloat(priceEl.value);
  if(!qty){qtyEl.style.borderColor='var(--r-tx)';qtyEl.focus();return;}
  if(!pricePerKg){priceEl.style.borderColor='var(--r-tx)';priceEl.focus();return;}
  if(buyerEl&&!buyerEl.value){buyerEl.style.borderColor='var(--r-tx)';buyerEl.focus();return;}
  const data={date:document.getElementById('f-id').value,qty,pricePerKg,type:document.getElementById('f-ity').value,buyer:document.getElementById('f-ib').value.trim(),sectionId:document.getElementById('f-is').value||null,notes:document.getElementById('f-ino').value.trim(),updatedAt:Date.now()};
  if(id){const i=db.incomes.findIndex(x=>x.id===id);if(i>=0)db.incomes[i]={...db.incomes[i],...data};}
  else db.incomes.push({id:uid(),createdAt:Date.now(),...data});
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),2000);
}

// MARKET PRICE
function showEditPrice(){
  modal(`
<p style="font-size:13px;color:var(--tx2);margin-bottom:16px;line-height:1.5">Enter today's Raw / Green price from your local auction or trader. Shared across all devices.</p>
<div class="fg">
  <label class="fl">Raw / Green price (₹/kg)</label>
  <input id="f-mr" type="number" value="${db.priceRaw||''}" placeholder="e.g. 2800" style="font-size:20px;font-weight:600;padding:12px 14px"/>
</div>
<div class="btn-row"><button class="btnc" onclick="closeModal()">Cancel</button><button class="btnp" onclick="savePrice()">Save</button></div>`,'Raw cardamom price');
  setTimeout(()=>document.getElementById('f-mr')?.focus(),100);
}
function savePrice(){
  const el=document.getElementById('f-mr');
  const r=parseFloat(el.value);
  if(!r){el.style.borderColor='var(--r-tx)';el.focus();return;}
  db.priceRaw=r;
  db.priceDate=new Date().toISOString().slice(0,10);
  if(!db.priceSource||db.priceSource.startsWith('Auto'))db.priceSource='Manual entry';
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),2000);
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
  saveLocal();closeModal();render();setTimeout(()=>triggerSync(false),2000);
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
  <div class="settings-group-title">Buyers list</div>
  <div style="padding:12px 16px">
    <p style="font-size:12px;color:var(--tx3);margin-bottom:10px">Buyers appear as a dropdown when adding a sale. Shared across all devices via Drive.</p>
    ${(db.buyers||[]).length===0?'<p style="font-size:13px;color:var(--tx3);margin-bottom:10px">No buyers added yet.</p>':''}
    ${(db.buyers||[]).map((b,i)=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bor)">
      <span style="font-size:13px;color:var(--tx)">${esc(b)}</span>
      <button onclick="db.buyers.splice(${i},1);saveLocal();triggerSync(false);render()" style="font-size:11px;color:var(--r-tx);background:var(--r-bg);border:1px solid var(--r-bor);border-radius:6px;padding:3px 8px;cursor:pointer;font-family:inherit">Remove</button>
    </div>`).join('')}
    <button onclick="const n=prompt('Buyer name:');if(n&&n.trim()&&!db.buyers.includes(n.trim())){db.buyers.push(n.trim());saveLocal();triggerSync(false);render();}" style="width:100%;margin-top:10px;padding:10px;background:var(--g-bg);border:1px solid var(--g-bor);border-radius:var(--rs);font-size:13px;font-weight:600;color:var(--brand-lite);cursor:pointer;font-family:inherit">+ Add buyer</button>
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
  db={sections:[],seasons:[],yields:[],expenses:[],incomes:[],dryings:[],buyers:[],priceHistory:[],priceRaw:null,priceDried:null,priceDate:null,priceSource:null,updatedAt:Date.now()};
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
  schedulePriceFetch();
  // Attempt price fetch on load (respects 12h rate limit)
  setTimeout(()=>fetchCardamomPrice(false),8000);
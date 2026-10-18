import { MOTORS, DEFAULTS, simulate } from './physics.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const format = (n, digits = 1) => Number.isFinite(n) ? n.toLocaleString('es-MX', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE_KEY = 'orbita-missions-v1';
const fields = ['motorId','dryMass','diameter','cd','angle','wind','railLength','parachute','chuteDiameter','bottleVolume','waterFill','pressure','nozzleDiameter'];
const labels = {pad:'En plataforma',boost:'Ascenso propulsado',coast:'Vuelo libre',descent:'Descenso balístico',recovery:'Recuperación',landed:'Misión completada'};
let mode = 'estes', result, flightTime = 0, playing = false, previousFrame = 0, frameId, view = 'simulador';
let debounceId, toastTimeout, canvasMap;
let drafts = {estes:{...DEFAULTS.estes},water:{...DEFAULTS.water}};
let saved = readSaved();
const numberKeys = fields.filter(k => !['motorId','parachute'].includes(k));

function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(m => m && typeof m.id === 'string' && typeof m.name === 'string' && m.config && m.summary && ['estes','water'].includes(m.config.mode)).slice(0,30);
  } catch {return [];}
}
function toast(message) {
  clearTimeout(toastTimeout); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimeout = setTimeout(() => {$('#toast').hidden = true;}, 4200);
}
function persist(next) {
  try {localStorage.setItem(STORAGE_KEY, JSON.stringify(next));saved=next;return true;}
  catch {toast('No se pudo guardar: el almacenamiento del navegador no está disponible. Exporta una copia CSV.');return false;}
}
function readForm() {
  const config = {...DEFAULTS[mode], mode};
  for (const key of fields) {
    const el = $('#'+key);
    if (key==='parachute') config[key]=el.checked;
    else if (key==='motorId') config[key]=el.value;
    else config[key] = el.value.trim()==='' ? NaN : Number(el.value);
  }
  config.dryMass /= 1000; config.diameter /= 1000; config.chuteDiameter /= 100;
  return config;
}
function loadForm(config) {
  for (const key of fields) {
    const el = $('#'+key);
    if(key==='parachute') el.checked = config[key];
    else {
      const factor = key==='dryMass'||key==='diameter' ? 1000 : key==='chuteDiameter' ? 100 : 1;
      el.value = typeof config[key]==='number' ? String(Number((config[key]*factor).toFixed(6))) : config[key];
    }
  }
  updateFormLabels();
}
function updateFormLabels() {
  $('#angle-output').value = $('#angle').value+'°';
  $('#chuteDiameter').disabled = !$('#parachute').checked;
  const motor = MOTORS.find(m=>m.id===$('#motorId').value);
  $('#motor-impulse').textContent = format(motor.impulse,1)+' N·s';
  $('#motor-duration').textContent = format(motor.burnTime,1)+' s de combustión';
  $('#vehicle-tag').textContent = mode==='estes' ? Math.round(motor.diameter*1000)+' MM' : $('#bottleVolume').value+' L';
}
function setMode(next, config) {
  if(!config && next===mode) return;
  const previous = readForm();
  if(numberKeys.every(key=>Number.isFinite(previous[key]))) drafts[mode]=previous;
  mode=next;
  $$('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  $('#estes-fields').hidden=mode!=='estes'; $('#water-fields').hidden=mode!=='water';
  $('#vehicle-name').textContent=mode==='estes'?'Modelo de motor sólido':'Modelo de cohete de agua';
  $('#vehicle-subtitle').textContent=mode==='estes'?'Motor comercial · masa configurable':'Agua + aire · expansión adiabática';
  $('#recovery-note').textContent=mode==='estes'?'Apertura según retardo del motor.':'Apertura ideal en el apogeo.';
  $('#chart-mode').textContent=mode==='estes'?'MOTOR SÓLIDO':'PROPULSIÓN DE AGUA';
  $('#vehicle-drawing').classList.toggle('water-vehicle',mode==='water');
  if(mode==='water') $('#vehicle-drawing').innerHTML='<svg viewBox="0 0 220 62"><path d="m58 22-13-13h22l14 13m-23 18-13 13h22l14-13" fill="#78b9c5"/><path d="M58 22h84q16 0 23 9-7 9-23 9H58Z" fill="#8ec6cc22" stroke="#8ec6cc" stroke-width="1.4"/><path d="M58 22h38v18H58z" fill="#7dc4ce77"/><path d="M48 26h10v10H48z" fill="#b1bdb9"/><path d="M72 24v14m55-14v14m7-14v14" stroke="#9bc7cd55"/><text x="103" y="33" fill="#a3cbd0" font-size="5" font-family="monospace">H₂O</text></svg>';
  else $('#vehicle-drawing').innerHTML=solidDrawing;
  loadForm(config || drafts[mode]); recalculate();
}
function invalid(message) {
  stop();$('#form-error').textContent=message;$('#form-error').hidden=false;
  ['launch','save-mission','export-csv','play-pause','timeline'].forEach(id=>$('#'+id).disabled=true);
  $('#play-state').innerHTML='<i></i>REVISAR DATOS';
}
function recalculate() {
  clearTimeout(debounceId);stop();
  const config=readForm();
  for (const key of numberKeys) {
    if((mode==='estes' && ['bottleVolume','waterFill','pressure','nozzleDiameter'].includes(key)) || (key==='chuteDiameter'&&!config.parachute)) continue;
    if(!$('#'+key).validity.valid || $('#'+key).value==='') {
      const el=$('#'+key),label=el.closest('label')?.childNodes[0]?.textContent?.trim()||key;
      invalid(`${label}: introduce un valor entre ${el.min} y ${el.max}.`);return false;
    }
  }
  // Retain valid hidden values when switching propulsion or disabling recovery.
  if(!config.parachute && (!Number.isFinite(config.chuteDiameter)||config.chuteDiameter<0.05||config.chuteDiameter>2)) config.chuteDiameter=DEFAULTS[mode].chuteDiameter;
  try {result=simulate(config);}catch(error){invalid(error.message);return false;}
  drafts[mode]={...result.config}; flightTime=0;$('#form-error').hidden=true;
  ['launch','save-mission','export-csv','play-pause','timeline'].forEach(id=>$('#'+id).disabled=false);
  updateFormLabels();updateSummary();renderEvents();renderLive();draw();return true;
}
function updateSummary() {
  const s=result.summary;
  $('#metric-apogee').textContent=format(s.apogee);
  $('#metric-speed').textContent=format(s.maxSpeed);
  const partial=result.events.some(e=>e.type==='timeout');
  $('#metric-time').textContent=format(s.flightTime)+(partial?'*':'');
  $('#metric-time').closest('.metric').querySelector('.metric-foot').textContent=partial?'* Simulación parcial, sigue en vuelo':'Desde ignición hasta el suelo';
  $('#metric-drift').textContent=format(s.drift);
  $('#metric-mach').textContent=format(s.maxSpeed*3.6)+' km/h';
  $('#wind-display').textContent=format(Math.abs(result.config.wind))+' m/s '+(result.config.wind<0?'←':result.config.wind>0?'→':'·');
  $('#event-count').textContent=result.events.length+' EVENTOS';
  $('#model-note').textContent=mode==='estes'?'Predicción educativa · Curva de empuje aproximada. No evalúa estabilidad.':'Predicción educativa · Sólo fase de expulsión de agua; omite el impulso final del aire.';
  const warnings=result.warnings.filter(w=>!w.startsWith('Los perfiles')&&!w.startsWith('Hidrocohete:'));
  $('#flight-warnings').hidden=!warnings.length;
  $('#flight-warnings').innerHTML=warnings.map(w=>`<p>${escapeHTML(w)}</p>`).join('');
}
function sampleAt(t) {
  const samples=result.samples;
  let lo=0,hi=samples.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(samples[mid].t<=t)lo=mid;else hi=mid-1;}
  const a=samples[lo],b=samples[Math.min(lo+1,samples.length-1)];
  const f=b.t===a.t?0:Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));
  const out={...a,t};
  for(const key of ['x','y','vx','vy','speed','acceleration','thrust','mass'])out[key]=a[key]+(b[key]-a[key])*f;
  return out;
}
function renderEvents() {
  $('#event-list').innerHTML=result.events.map(e=>`<li data-time="${e.t}"><span>${escapeHTML(e.label)}</span><time>T+ ${format(e.t,2)} s</time></li>`).join('');
}
function renderLive() {
  if(!result)return;
  const sample=sampleAt(flightTime);
  const min=String(Math.floor(flightTime/60)).padStart(2,'0');
  const sec=(flightTime%60).toFixed(2).padStart(5,'0');
  $('#mission-time').textContent=`T+ ${min}:${sec}`;
  $('#phase').textContent=labels[sample.phase]||sample.phase;
  $('#live-altitude').innerHTML=format(sample.y)+'<small> m</small>';
  $('#live-speed').innerHTML=format(sample.speed)+'<small> m/s</small>';
  $('#live-thrust').innerHTML=format(sample.thrust)+'<small> N</small>';
  $('#timeline').value=result.summary.flightTime>0?flightTime/result.summary.flightTime*1000:0;
  $('#timeline-label').textContent=`${format(flightTime)} / ${format(result.summary.flightTime)} s`;
  let current=-1;const eventEls=$$('#event-list li');
  eventEls.forEach((el,i)=>{const reached=Number(el.dataset.time)<=flightTime+0.001;el.classList.toggle('completed',reached);if(reached)current=i;el.classList.remove('current');});
  if(current>=0)eventEls[current].classList.add('current');
  const ended=flightTime>=result.summary.flightTime&&flightTime>0;
  const partial=result.events.some(e=>e.type==='timeout');
  if(ended&&partial)$('#phase').textContent='Límite de simulación · resultado parcial';
  $('#play-state').innerHTML='<i></i>'+(playing?'EN SIMULACIÓN':ended?(partial?'PARCIAL':result.summary.landed?'FINALIZADA':'SIN DESPEGUE'):flightTime>0?'EN PAUSA':'VISTA PREVIA');
  $('#play-state').classList.toggle('running',playing);
  $('#play-pause').innerHTML=icon(playing?'pause':'play');
  $('#play-pause').setAttribute('aria-label',playing?'Pausar simulación':'Reproducir simulación');
  $('#launch').innerHTML=icon(playing?'pause':'play')+'<span>'+(playing?'Pausar simulación':ended?'Repetir simulación':flightTime>0?'Continuar simulación':'Iniciar simulación')+'</span><span class="launch-arrow">↗</span>';
}
function stop(){playing=false;cancelAnimationFrame(frameId);previousFrame=0;}
function togglePlay(){
  clearTimeout(debounceId);
  if($('#launch').disabled){return;}
  if(playing){stop();renderLive();return;}
  if(!result)return;
  if(result.summary.apogee<=0){flightTime=result.summary.flightTime;renderLive();draw();toast('Sin despegue. Revisa las observaciones del modelo.');return;}
  if(flightTime>=result.summary.flightTime)flightTime=0;
  playing=true;previousFrame=0;renderLive();frameId=requestAnimationFrame(tick);
}
function tick(timestamp){
  if(!playing)return;
  if(previousFrame)flightTime=Math.min(result.summary.flightTime,flightTime+Math.min((timestamp-previousFrame)/1000,.15)*Number($('#playback-speed').value));
  previousFrame=timestamp;
  if(flightTime>=result.summary.flightTime){stop();toast(result.summary.landed?'Vuelo completado. Puedes guardar o exportar la misión.':'Fin del intervalo simulado. El resultado es parcial; revisa las observaciones.');}
  renderLive();draw();if(playing)frameId=requestAnimationFrame(tick);
}
function resizeCanvas(canvas){
  const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  if(r.width===0||r.height===0)return null;
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);
  return {ctx,w:r.width,h:r.height};
}
function roundedLabel(ctx,text,x,y,color='#efb96d'){
  ctx.font='8px "IBM Plex Mono", monospace';const width=ctx.measureText(text).width+14;
  ctx.fillStyle='#14212a';ctx.strokeStyle='#495548';ctx.lineWidth=.7;ctx.beginPath();ctx.roundRect(x,y-11,width,20,3);ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.fillText(text,x+7,y+2);
}
function drawRocket(ctx,x,y,sample){
  ctx.save();ctx.translate(x,y);
  if(sample.phase==='recovery'){
    ctx.strokeStyle='#a2bbb4';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(-16,-22);ctx.lineTo(0,3);ctx.lineTo(16,-22);ctx.moveTo(-6,-24);ctx.lineTo(0,3);ctx.lineTo(6,-24);ctx.stroke();
    ctx.fillStyle='#c4b485';ctx.beginPath();ctx.arc(0,-22,16,Math.PI,0);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#887f65';ctx.beginPath();ctx.ellipse(0,-22,6,16,0,Math.PI,0);ctx.stroke();ctx.rotate(.08);
  }else ctx.rotate(sample.speed>1?Math.atan2(sample.vx,sample.vy):result.config.angle*Math.PI/180);
  if(sample.thrust>.1&&sample.phase==='boost'){
    ctx.fillStyle=mode==='water'?'#78c8d188':'#e89c50aa';ctx.beginPath();ctx.moveTo(-3,8);ctx.lineTo(0,22+Math.sin(flightTime*40)*4);ctx.lineTo(3,8);ctx.fill();
    ctx.fillStyle=mode==='water'?'#ceeff3':'#ffe8a8';ctx.beginPath();ctx.moveTo(-1.5,8);ctx.lineTo(0,17);ctx.lineTo(1.5,8);ctx.fill();
  }
  ctx.fillStyle=mode==='water'?'#8bc4ce':'#dc744d';ctx.beginPath();ctx.moveTo(-3,2);ctx.lineTo(-7,10);ctx.lineTo(-3,8);ctx.moveTo(3,2);ctx.lineTo(7,10);ctx.lineTo(3,8);ctx.fill();
  ctx.fillStyle='#e5e8dd';ctx.fillRect(-3,-7,6,16);ctx.fillStyle=mode==='water'?'#8bc4ce':'#dc744d';ctx.beginPath();ctx.moveTo(-3,-7);ctx.lineTo(0,-15);ctx.lineTo(3,-7);ctx.fill();
  ctx.fillStyle='#445963';ctx.fillRect(-3,4,6,2);ctx.restore();
}
function draw(){if(view!=='simulador'||!result)return;drawFlight();drawTelemetry();}
function drawFlight(){
  const setup=resizeCanvas($('#flight-canvas'));if(!setup)return;
  const {ctx,w,h}=setup;
  // Distant terrain is an illustration, not a map or a launch-site model.
  ctx.fillStyle='#20313b';ctx.beginPath();ctx.moveTo(0,h-33);[[0.08,50],[.18,42],[.25,66],[.32,54],[.4,61],[.5,40],[.62,52],[.69,72],[.77,56],[.85,66],[.93,43],[1,49]].forEach(([x,y])=>ctx.lineTo(w*x,h-y));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
  ctx.fillStyle='#253740';ctx.beginPath();ctx.moveTo(0,h-27);[[.15,35],[.28,29],[.4,38],[.51,34],[.63,41],[.75,32],[.89,38],[1,29]].forEach(([x,y])=>ctx.lineTo(w*x,h-y));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
  const bottom=h-38,top=108,left=53,right=w-30;
  const maxY=Math.max(10,Math.ceil(result.summary.apogee/10)*10)*1.12;
  let minX=0,maxX=0;for(const p of result.samples){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);}
  let xSpan=Math.max(15,maxX-minX);minX-=xSpan*.07;maxX=minX+xSpan*1.22;xSpan=maxX-minX;
  const px=x=>left+(x-minX)/xSpan*(right-left),py=y=>bottom-y/maxY*(bottom-top);
  canvasMap={px,py,left,right,top,bottom,minX,maxX,maxY};
  ctx.strokeStyle='#5f81901b';ctx.lineWidth=.7;ctx.setLineDash([2,5]);
  for(let i=0;i<=5;i++){
    const y=bottom-(bottom-top)*i/5;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
    ctx.fillStyle='#678491';ctx.font='7px "IBM Plex Mono", monospace';ctx.textAlign='right';ctx.fillText(format(maxY*i/5,0),left-11,y+3);
  }
  for(let i=0;i<=5;i++){
    const x=left+(right-left)*i/5;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
    ctx.fillStyle='#718e99';ctx.textAlign='center';ctx.fillText(format(minX+xSpan*i/5,0),x,bottom+17);
  }
  ctx.setLineDash([]);ctx.textAlign='left';ctx.font='7px "IBM Plex Mono", monospace';ctx.fillStyle='#74909d';ctx.fillText('ALTITUD (m)',left,top-13);ctx.textAlign='right';ctx.fillText('DESPLAZAMIENTO (m)',right,h-7);ctx.textAlign='left';
  // Prediction and playback share the same deterministic simulation.
  ctx.beginPath();ctx.moveTo(px(result.samples[0].x),py(0));for(const p of result.samples)ctx.lineTo(px(p.x),py(p.y));ctx.lineTo(px(result.samples.at(-1).x),py(0));ctx.closePath();
  const grad=ctx.createLinearGradient(0,top,0,bottom);grad.addColorStop(0,'#d8b16e09');grad.addColorStop(1,'#d8b16e01');ctx.fillStyle=grad;ctx.fill();
  ctx.strokeStyle='#d2ad7077';ctx.lineWidth=1.2;ctx.setLineDash([4,4]);ctx.beginPath();result.samples.forEach((p,i)=>{if(i===0)ctx.moveTo(px(p.x),py(p.y));else ctx.lineTo(px(p.x),py(p.y));});ctx.stroke();ctx.setLineDash([]);
  if(flightTime>0){ctx.strokeStyle='#9bc6b9';ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(px(0),py(0));for(const p of result.samples){if(p.t>flightTime)break;ctx.lineTo(px(p.x),py(p.y));}const current=sampleAt(flightTime);ctx.lineTo(px(current.x),py(current.y));ctx.stroke();}
  const apogeeSample=result.samples.reduce((best,p)=>p.y>best.y?p:best,result.samples[0]);
  if(result.summary.apogee>0){const ax=px(apogeeSample.x),ay=py(apogeeSample.y);ctx.fillStyle='#efb96d';ctx.beginPath();ctx.arc(ax,ay,3,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#efb96d44';ctx.beginPath();ctx.arc(ax,ay,6,0,Math.PI*2);ctx.stroke();roundedLabel(ctx,'APOGEO '+format(result.summary.apogee)+' m',Math.min(right-123,ax+12),ay-3);}
  const ox=px(0),oy=py(0);ctx.strokeStyle='#708994';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(ox-11,oy+3);ctx.lineTo(ox+11,oy+3);ctx.moveTo(ox-7,oy+4);ctx.lineTo(ox-10,oy+10);ctx.moveTo(ox+7,oy+4);ctx.lineTo(ox+10,oy+10);ctx.moveTo(ox+5,oy);ctx.lineTo(ox+5,oy-26);ctx.stroke();
  const current=sampleAt(flightTime);drawRocket(ctx,px(current.x),py(current.y)-10,current);
  if(flightTime>0){ctx.strokeStyle='#a5cabb33';ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(px(current.x),py(current.y));ctx.lineTo(px(current.x),bottom);ctx.stroke();ctx.setLineDash([]);}
}
function drawTelemetry(){
  const setup=resizeCanvas($('#telemetry-canvas'));if(!setup)return;const {ctx,w,h}=setup;
  const x=t=>t/Math.max(.01,result.summary.flightTime)*(w-24)+22,y=v=>h-13-v/Math.max(10,result.summary.apogee)*(h-18);
  ctx.font='6px "IBM Plex Mono", monospace';ctx.fillStyle='#708995';ctx.strokeStyle='#52697433';ctx.lineWidth=.6;
  for(let i=0;i<3;i++){const v=Math.max(10,result.summary.apogee)*i/2,yp=y(v);ctx.beginPath();ctx.moveTo(22,yp);ctx.lineTo(w,yp);ctx.stroke();ctx.fillText(format(v,0),0,yp+2);}
  ctx.beginPath();ctx.moveTo(x(0),y(0));for(const p of result.samples)ctx.lineTo(x(p.t),y(p.y));ctx.lineTo(x(result.summary.flightTime),y(0));ctx.closePath();const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#efb96d20');grad.addColorStop(1,'#efb96d00');ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();result.samples.forEach((p,i)=>i?ctx.lineTo(x(p.t),y(p.y)):ctx.moveTo(x(p.t),y(p.y)));ctx.strokeStyle='#c7a56d';ctx.lineWidth=1.1;ctx.stroke();
  const current=sampleAt(flightTime);ctx.strokeStyle='#b7cbd477';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(x(flightTime),0);ctx.lineTo(x(flightTime),h-13);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#efb96d';ctx.beginPath();ctx.arc(x(flightTime),y(current.y),2.5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#708995';for(let i=0;i<=4;i++){const t=result.summary.flightTime*i/4;ctx.textAlign=i===4?'right':'center';ctx.fillText(format(t,0),x(t),h-2);}ctx.textAlign='left';
}
function showView(next){
  if(!['simulador','misiones','ciencia','guia'].includes(next))next='simulador';
  if(next!=='simulador'){stop();renderLive();}
  view=next;$$('.page-view').forEach(el=>el.hidden=el.id!=='view-'+next);
  $$('.nav-button').forEach(b=>{b.classList.toggle('active',b.dataset.view===next);if(b.dataset.view===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(location.hash!=='#'+next)history.replaceState(null,'','#'+next);
  if(next==='misiones')renderSaved();
  if(next==='simulador')requestAnimationFrame(draw);
  window.scrollTo({top:0,behavior:'instant'});
}
function renderSaved(){
  $('#export-missions').disabled=!saved.length;
  if(!saved.length){$('#saved-missions').innerHTML=`<div class="empty-state">${icon('folder')}<h2>Tu próxima misión empieza aquí.</h2><p>Guarda un vuelo desde el simulador para comenzar tu bitácora.</p><button class="button launch" data-view="simulador">Crear una misión ↗</button></div>`;return;}
  $('#saved-missions').innerHTML='<div class="mission-table-wrap"><table><thead><tr><th>Misión</th><th>Propulsión</th><th>Apogeo</th><th>Vel. máxima</th><th>Duración</th><th>Acciones</th></tr></thead><tbody>'+saved.map(m=>`<tr><td>${escapeHTML(m.name)}<small>${escapeHTML(new Date(m.createdAt).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'}))}</small></td><td>${m.config.mode==='estes'?escapeHTML(m.config.motorId):'Hidrocohete'}<small>${format(m.config.dryMass*1000,0)} g · masa seca</small></td><td class="table-number">${format(m.summary.apogee)} m</td><td class="table-number">${format(m.summary.maxSpeed)} m/s</td><td class="table-number">${format(m.summary.flightTime)} s</td><td><button class="text-button" data-load="${escapeHTML(m.id)}">Abrir ↗</button><button class="text-button delete-mission" data-delete="${escapeHTML(m.id)}">Eliminar</button></td></tr>`).join('')+'</tbody></table></div>';
}
function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function exportCSV(){
  if(!result)return;
  const columns=['t','x','y','vx','vy','speed','acceleration','thrust','mass','phase'];
  const header=['tiempo_s','x_m','altitud_m','vx_m_s','vy_m_s','velocidad_m_s','aceleracion_m_s2','empuje_N','masa_kg','fase'];
  const csv=header.join(',')+'\r\n'+result.samples.map(s=>columns.map(k=>typeof s[k]==='number'?s[k].toFixed(6):s[k]).join(',')).join('\r\n');
  download('\ufeff'+csv,'text/csv;charset=utf-8',`orbita-${mode==='estes'?result.config.motorId:'hidrocohete'}-${Date.now()}.csv`);toast('Telemetría exportada en CSV.');
}
function renderReferences(){
  const refs=[
    {name:'RocketModeler',tag:'NASA GLENN',role:'EL REFERENTE PARA EL VUELO',description:'Diseño y vuelo de modelos de motor sólido e hidrocohetes. Un punto de partida para explorar cómo cambian la trayectoria, la estabilidad y la recuperación.',url:'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocketmodeler/',link:'Explorar RocketModeler'},
    {name:'Open MCT',tag:'CÓDIGO ABIERTO · APACHE 2.0',role:'LOS DATOS, EN CONTEXTO',description:'Framework de visualización de operaciones. Inspira la organización del panel, las gráficas de telemetría y la lectura de una misión a lo largo del tiempo.',url:'https://nasa.github.io/openmct/',link:'Conocer Open MCT'},
    {name:'Core Flight System',tag:'CÓDIGO ABIERTO · APACHE 2.0',role:'UNA MISIÓN, MUCHOS EVENTOS',description:'Arquitectura modular de software de vuelo. Una referencia para separar comandos, estados y eventos; aquí representados en una secuencia educativa local.',url:'https://software.nasa.gov/software/GSC-18719-1',link:'Ver cFS en el catálogo'},
    {name:'GMAT',tag:'CÓDIGO ABIERTO · APACHE 2.0',role:'EL SIGUIENTE HORIZONTE',description:'Herramienta avanzada de diseño y análisis de misiones espaciales. Es un recurso para explorar órbitas; no se usa como motor físico de estos vuelos de baja altitud.',url:'https://software.nasa.gov/software/GSC-19640-1',link:'Explorar misiones orbitales'}
  ];
  $('#reference-grid').innerHTML=refs.map((r,i)=>`<article class="reference-card panel"><div class="reference-index"><span>0${i+1} /</span><span>${r.tag}</span></div><h2>${r.name}</h2><span class="reference-role">${r.role}</span><p>${r.description}</p><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.link}${icon('arrow')}</a></article>`).join('');
  $('#motor-sources').innerHTML=MOTORS.map(m=>`<a href="${m.source}" target="_blank" rel="noopener noreferrer">${m.id} ↗</a>`).join('');
}

const solidDrawing=$('#vehicle-drawing').innerHTML;
$('#motorId').innerHTML=MOTORS.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
loadForm(DEFAULTS.estes);renderReferences();recalculate();showView(location.hash.slice(1)||'simulador');
$('#config-form').addEventListener('submit',e=>e.preventDefault());
$('#config-form').addEventListener('input',()=>{updateFormLabels();stop();['launch','save-mission','export-csv','play-pause','timeline'].forEach(id=>$('#'+id).disabled=true);clearTimeout(debounceId);debounceId=setTimeout(recalculate,180);});
$('#config-form').addEventListener('change',()=>recalculate());
$$('[data-mode]').forEach(el=>el.addEventListener('click',()=>setMode(el.dataset.mode)));
document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-view]');if(nav)showView(nav.dataset.view);
  const load=e.target.closest('[data-load]');if(load){const m=saved.find(s=>s.id===load.dataset.load);if(m){try{simulate(m.config);showView('simulador');setMode(m.config.mode,m.config);toast('Misión cargada: '+m.name);}catch{toast('Esta misión tiene una configuración incompatible.');}}}
  const del=e.target.closest('[data-delete]');if(del){const item=saved.find(m=>m.id===del.dataset.delete);if(item && persist(saved.filter(m=>m.id!==item.id))){renderSaved();toast('Misión eliminada de este navegador.');}}
});
window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
$('#launch').addEventListener('click',togglePlay);$('#play-pause').addEventListener('click',togglePlay);
$('#reset-flight').addEventListener('click',()=>{stop();flightTime=0;renderLive();draw();});
$('#timeline').addEventListener('input',()=>{stop();flightTime=Number($('#timeline').value)/1000*result.summary.flightTime;renderLive();draw();});
$('#restore').addEventListener('click',()=>{loadForm(DEFAULTS[mode]);recalculate();toast('Valores del modo restablecidos.');});
$('#export-csv').addEventListener('click',exportCSV);
$('#save-mission').addEventListener('click',()=>{if(saved.length>=30){toast('La bitácora admite 30 misiones. Exporta una copia y elimina alguna para guardar otra.');return;}$('#mission-name').value=`${mode==='estes'?result.config.motorId:'Hidrocohete'} · Vuelo ${String(saved.length+1).padStart(2,'0')}`;$('#save-dialog').showModal();$('#mission-name').select();});
$('#cancel-save').addEventListener('click',()=>$('#save-dialog').close());
$('#save-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#mission-name').value.trim();if(!name){$('#mission-name').focus();return;}if(saved.length>=30){toast('La bitácora ya tiene 30 misiones.');return;}const m={id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),config:{...result.config},summary:{...result.summary},version:1};if(persist([m,...saved])){$('#save-dialog').close();toast('Misión guardada en tu bitácora local.');}});
$('#export-missions').addEventListener('click',()=>{download(JSON.stringify({application:'ÓRBITA',version:1,exportedAt:new Date().toISOString(),missions:saved},null,2),'application/json','orbita-misiones.json');toast('Bitácora exportada en JSON.');});
$('#flight-canvas').addEventListener('pointermove',e=>{
  if(!canvasMap||!result)return;const rect=e.currentTarget.getBoundingClientRect(),cx=e.clientX-rect.left,cy=e.clientY-rect.top;
  let nearest,dist=Infinity;for(const p of result.samples){const d=Math.hypot(canvasMap.px(p.x)-cx,canvasMap.py(p.y)-cy);if(d<dist){dist=d;nearest=p;}}
  if(dist<25&&nearest){const tip=$('#chart-tooltip');tip.textContent=`T+ ${format(nearest.t)} s · ${format(nearest.y)} m · ${format(nearest.speed)} m/s`;tip.hidden=false;tip.style.left=Math.max(8,Math.min(rect.width-tip.offsetWidth-8,cx+14))+'px';tip.style.top=Math.max(8,cy-31)+'px';}else $('#chart-tooltip').hidden=true;
});
$('#flight-canvas').addEventListener('pointerleave',()=>$('#chart-tooltip').hidden=true);
new ResizeObserver(()=>draw()).observe($('.mission-area'));
document.fonts?.ready.then(draw);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stop();renderLive();}});

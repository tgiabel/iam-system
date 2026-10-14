"use strict";

// SOFA BFF response for the signed-in user's Genesys queues.
const LIVE_URL = "/api/reporting/genesys-live";
const REFRESH_MS = 15000;
let live = null;
let loadError = "";
let loading = false;
let selectedId = null;
const $ = id => document.getElementById(id);
const CARD_MIN_WIDTH = 176;
const CARD_GAP = 10;
const INACTIVE_KEY = "genesysLive.inactiveOpen";
const PANEL_KEY = "genesysLive.panelGroups";
let panelOpen = {queue:true,pause:false,busy:false};
try { panelOpen = {...panelOpen,...JSON.parse(localStorage.getItem(PANEL_KEY)||"{}")}; } catch (error) {}
let inactiveOpen = false;
try { inactiveOpen = localStorage.getItem(INACTIVE_KEY) === "1"; } catch (error) {}

function safe(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c])}
const AGENT_ICON='<svg class="queue-mini-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="3.2"/><path d="M5.5 19c.3-3.5 2.6-5.4 6.5-5.4s6.2 1.9 6.5 5.4"/></svg>';
const PHONE_ICON='<svg class="queue-mini-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h4l2 5-2.4 2.4a17 17 0 0 0 6 6L16 14l5 2v4a2 2 0 0 1-2.2 2A19 19 0 0 1 2 5.2 2 2 0 0 1 4 3Z"/></svg>';

function queueCard(queue){
  const selected=selectedId===queue.queue_id;
  const onQueue=queue.people.on_queue,waiting=queue.voice.waiting;
  return `<button type="button" class="queue-card${queue.mine.joined?"":" is-inactive"}" data-queue-id="${safe(queue.queue_id)}" aria-pressed="${selected}" aria-label="${safe(queue.label)}: ${onQueue.total} in Warteschleife, ${onQueue.idle} frei${waiting?`, ${waiting} wartend`:""}">
    <span class="queue-card-top"><span class="queue-card-name" title="${safe(queue.name)}">${safe(queue.label)}</span><span class="queue-card-state" aria-hidden="true"></span></span>
    <span class="queue-card-main"><strong class="queue-card-value">${onQueue.total}</strong><span class="queue-card-label" title="Genesys On Queue">In Warteschleife</span></span>
    <span class="queue-card-bottom"><span>${AGENT_ICON}<strong class="${onQueue.idle?"":"is-zero"}">${onQueue.idle} frei</strong></span><span class="${waiting?"has-waiting":""}">${PHONE_ICON}${waiting} wartend</span></span>
  </button>`;
}

function renderCards(){
  const mine=live?live.queues.filter(q=>q.mine.member):[];
  const byWaiting=(a,b)=>b.voice.waiting-a.voice.waiting;
  const active=mine.filter(q=>q.mine.joined).sort(byWaiting);
  const inactive=mine.filter(q=>!q.mine.joined).sort(byWaiting);
  $("activeCount").textContent=active.length;
  $("inactiveCount").textContent=inactive.length;
  const empty=!live?"":!live.account_linked?"Kein Genesys-Konto verknüpft":"Keine aktivierten Queues";
  $("activeQueues").innerHTML=active.length?active.map(queueCard).join(""):`<p class="queue-empty">${empty}</p>`;
  $("inactiveQueues").innerHTML=inactive.map(queueCard).join("");
  $("inactiveStrip").innerHTML=$("inactiveQueues").innerHTML;
  $("inactiveSection").hidden=!inactive.length;
  layoutGrids();
}

function isCompact(){
  return window.matchMedia("(max-width: 800px)").matches;
}

// Wide layout: a fixed number of rows, as many columns as fit, scrolling sideways in whole pages.
function layoutGrid(grid,rows){
  const scroller=grid.closest(".queue-scroller");
  const style=getComputedStyle(scroller);
  const width=scroller.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  const fit=Math.max(1,Math.floor((width+CARD_GAP)/(CARD_MIN_WIDTH+CARD_GAP)));
  const count=grid.children.length;
  const columns=Math.max(fit,Math.ceil(count/rows));
  const columnWidth=(width-(fit-1)*CARD_GAP)/fit;
  grid.style.gridTemplateRows=`repeat(${rows},minmax(0,1fr))`;
  grid.style.gridTemplateColumns=`repeat(${columns},${columnWidth}px)`;
  scroller.dataset.page=String(fit*(columnWidth+CARD_GAP));
}

function layoutGrids(){
  $("inactiveSection").classList.toggle("is-open",inactiveOpen);
  $("inactiveSection").parentElement.classList.toggle("is-inactive-open",inactiveOpen);
  $("inactiveToggle").setAttribute("aria-expanded",String(inactiveOpen));
  $("inactiveCarousel").hidden=!inactiveOpen&&!isCompact();
  for(const grid of [$("activeQueues"),$("inactiveQueues")]){grid.style.gridTemplateRows="";grid.style.gridTemplateColumns=""}
  if(!isCompact()){
    layoutGrid($("activeQueues"),inactiveOpen?2:3);
    if(inactiveOpen)layoutGrid($("inactiveQueues"),1);
  }
  requestAnimationFrame(updateScrollArrows);
}

function updateScrollArrows(){
  for(const carousel of document.querySelectorAll(".queue-carousel")){
    const scroller=carousel.querySelector(".queue-scroller");
    const overflow=scroller.scrollWidth>scroller.clientWidth+2;
    carousel.querySelector(".scroll-arrow-prev").hidden=!overflow||scroller.scrollLeft<=2;
    carousel.querySelector(".scroll-arrow-next").hidden=!overflow||scroller.scrollLeft+scroller.clientWidth>=scroller.scrollWidth-2;
  }
}

function kpiRow(label,value,denominator,color,{emphasis=false,waiting=false,tone="",hint="",child=false,solo=false}={}){
  const percent=Math.max(0,Math.min(100,Math.round(value/Math.max(1,denominator)*100)));
  return `<div class="kpi-row${emphasis?" is-emphasis":""}${waiting?" is-waiting":""}${child?" is-child":""}${solo?" is-solo":""}${tone?` is-${tone}`:""}${value===0?" is-zero":""}" style="--bar:${color}"><span class="kpi-row-label"${hint?` title="${safe(hint)}"`:""}>${label}</span><strong class="kpi-row-value">${value}</strong><span class="kpi-track" aria-hidden="true"><span class="kpi-fill" style="width:${percent}%"></span></span></div>`;
}

const CHEVRON='<svg class="kpi-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const INFO_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>';

// A status block: the parent row toggles its breakdown; collapsed, it may show a different headline row.
function infoTip(id,label,body){
  return `<span class="info-tip" tabindex="0" role="button" aria-label="${safe(label)}" aria-describedby="${id}">${INFO_ICON}</span><span class="info-tip-text" id="${id}" role="tooltip">${body}</span>`;
}

function kpiGroup(key,parent,children){
  const open=panelOpen[key];
  const head=open||!parent.collapsed?parent:{...parent,...parent.collapsed};
  const percent=Math.max(0,Math.min(100,Math.round(head.value/Math.max(1,head.denominator)*100)));
  return `<div class="kpi-group${open?" is-open":""}">
    <button type="button" class="kpi-row kpi-parent${head.emphasis?" is-emphasis":""}${head.tone?` is-${head.tone}`:""}${head.value===0?" is-zero":""}" style="--bar:${head.color}" data-kpi-group="${key}" aria-expanded="${open}" aria-controls="kpi-${key}"><span class="kpi-row-label">${CHEVRON}${head.label}</span><strong class="kpi-row-value">${head.value}</strong><span class="kpi-track" aria-hidden="true"><span class="kpi-fill" style="width:${percent}%"></span></span></button>
    <div class="kpi-children" id="kpi-${key}"${open?"":" hidden"}>${children.join("")}</div>
  </div>`;
}

function renderPanel(){
  if(!live){$("panelContent").innerHTML=`<p class="panel-empty">${safe(loadError||"Lädt …")}</p>`;return}
  const queue=live.queues.find(q=>q.queue_id===selectedId);
  const data=queue||live.total;
  $("panelTitle").textContent=queue?queue.label:"Alle Queues";
  $("panelMark").textContent=queue?"Queue":`${live.total.queue_count} Queues`;
  const selection=$("selectionBar");
  if(queue){
    selection.hidden=false;
    selection.innerHTML=`<span>Filter · ${safe(queue.label)}</span><button type="button" class="clear-selection" id="clearSelection" aria-label="Queue-Filter aufheben" title="Filter aufheben">×</button>`;
  }else{selection.hidden=true;selection.innerHTML=""}

  const voice=data.voice,people=data.people,onQueue=people.on_queue;
  const voiceTotal=Math.max(1,voice.interacting+voice.waiting);
  const otherOnQueue=onQueue.communicating+onQueue.not_responding;
  const otherTip=infoTip("otherTip","Was zählt zu Sonstige?",`<span>In Warteschleife, aber gerade nicht für Queue-Anrufe bereit:</span><span class="info-tip-line"><span>Anruf außerhalb einer Queue</span><strong>${onQueue.communicating}</strong></span><span class="info-tip-line"><span>Nicht antwortend</span><strong>${onQueue.not_responding}</strong></span>`);
  // Rows come from the response, so a new Genesys status shows up without a frontend change.
  const statusRows=(group,color)=>live.statuses[group].map(row=>kpiRow(
    row.unspecified?`${safe(row.label)}${infoTip(`${group}OtherTip`,"Was zählt zu Sonstige?","<span>Beschäftigt ohne nähere Angabe gewählt.</span>")}`:safe(row.label),
    people[group].by_status[row.key]||0,people[group].total,color,{child:true}));
  const attendance=[
    kpiGroup("queue",{label:"In Warteschleife",value:onQueue.total,denominator:people.present,color:"var(--gl-blue-fill)",
      collapsed:{label:"Frei in Warteschleife",value:onQueue.idle,denominator:onQueue.total,color:"var(--gl-green-fill)",emphasis:true,tone:"green"}},[
      kpiRow("Davon frei",onQueue.idle,onQueue.total,"var(--gl-green-fill)",{child:true,emphasis:true,tone:"green"}),
      kpiRow("Im Gespräch",onQueue.interacting,onQueue.total,"var(--gl-orange-fill)",{child:true,hint:"Genesys Interacting; umfasst auch andere Kanäle und Nachbearbeitung."}),
      kpiRow(`Sonstige${otherTip}`,otherOnQueue,onQueue.total,"var(--gl-purple-fill)",{child:true}),
    ]),
    kpiGroup("pause",{label:"Pause",value:people.pause.total,denominator:people.present,color:"var(--gl-orange-fill)"},statusRows("pause","var(--gl-orange-fill)")),
    kpiGroup("busy",{label:"Beschäftigt",value:people.busy.total,denominator:people.present,color:"var(--gl-red-fill)"},statusRows("busy","var(--gl-red-fill)")),
    // Away is not used actively; the row only appears when someone is in it.
    ...(people.away?[kpiRow("Außer Haus",people.away,people.present,"var(--gl-grey-fill)",{solo:true})]:[]),
  ].join("");

  $("panelContent").innerHTML=`
    <div class="panel-group"><div class="group-heading"><h3 class="group-label">${PHONE_ICON}Interaktionen · Voice</h3><span class="group-total" title="Laufende und wartende Voice-Interaktionen">${voice.interacting+voice.waiting} gesamt</span></div>
      ${kpiRow("Laufend",voice.interacting,voiceTotal,"var(--gl-blue-fill)",{emphasis:true})}
      ${kpiRow("Wartend",voice.waiting,voiceTotal,"var(--gl-orange-fill)",{emphasis:true,waiting:true})}
    </div>
    <div class="panel-group attendance"><div class="group-heading"><h3 class="group-label">${AGENT_ICON}Anwesenheit</h3><span class="group-total" title="Eindeutige Personen, die nicht offline sind">${people.present} Anwesende</span></div>${attendance}</div>
    ${queue?`<div class="panel-foot"><strong>${queue.joined_count}</strong> von ${queue.member_count} Mitgliedern aktiviert</div>`:""}`;
}

function renderTime(){
  const asof=$("updatedAt").parentElement;
  asof.classList.toggle("is-stale",Boolean(live&&live.stale));
  asof.title=live&&live.stale?"Daten veraltet":"";
  $("staleNotice").hidden=!(live&&live.stale);
  $("updatedAt").textContent=live?new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Europe/Berlin"}).format(new Date(live.as_of)):"–";
}

async function load(manual=false){
  if(loading)return;
  loading=true;
  try{
    const response=await fetch(LIVE_URL,{cache:"no-store"});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    live=await response.json();loadError="";
    if(selectedId&&!live.queues.some(q=>q.queue_id===selectedId))selectedId=null;
  }catch(error){
    loadError="Live-Daten nicht verfügbar";
    if(live)live={...live,stale:true};
    if(manual&&typeof window.showFlash==="function")window.showFlash("Live-Daten konnten nicht aktualisiert werden.","failure");
  }finally{
    loading=false;
  }
  renderCards();renderPanel();renderTime();
}

for(const scroller of document.querySelectorAll(".queue-scroller"))scroller.addEventListener("scroll",updateScrollArrows,{passive:true});
window.addEventListener("resize",layoutGrids);
if("ResizeObserver" in window){const observer=new ResizeObserver(layoutGrids);for(const scroller of document.querySelectorAll(".queue-scroller"))observer.observe(scroller)}

document.addEventListener("click",event=>{
  const arrow=event.target.closest("[data-scroll]");
  if(arrow){
    const scroller=arrow.closest(".queue-carousel").querySelector(".queue-scroller");
    const page=isCompact()?Math.max(160,scroller.clientWidth*.85):Number(scroller.dataset.page)||scroller.clientWidth;
    scroller.scrollBy({left:Number(arrow.dataset.scroll)*page,behavior:"smooth"});return
  }
  if(event.target.closest("#inactiveToggle")){
    inactiveOpen=!inactiveOpen;
    try{localStorage.setItem(INACTIVE_KEY,inactiveOpen?"1":"0")}catch(error){}
    layoutGrids();return
  }
  const group=event.target.closest("[data-kpi-group]");
  if(group){
    panelOpen[group.dataset.kpiGroup]=!panelOpen[group.dataset.kpiGroup];
    try{localStorage.setItem(PANEL_KEY,JSON.stringify(panelOpen))}catch(error){}
    renderPanel();$(`kpi-${group.dataset.kpiGroup}`).previousElementSibling.focus();return
  }
  const clear=event.target.closest("#clearSelection");
  if(clear){selectedId=null;renderCards();renderPanel();return}
  const card=event.target.closest("[data-queue-id]");
  if(card){selectedId=selectedId===card.dataset.queueId?null:card.dataset.queueId;renderCards();renderPanel();return}
  if(event.target.closest("#refreshButton")){load(true);return}
});

load();
setInterval(()=>{if(!document.hidden)load()},REFRESH_MS);

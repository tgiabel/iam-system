"use strict";

// SOFA BFF response for the signed-in user's Genesys queues.
const LIVE_URL = "/api/reporting/genesys-live";
const REFRESH_MS = 15000;
// Ohne jeden Stand (Kaltstart der SD-API, 503) kurz nachfassen statt bis zum nächsten Takt zu warten.
const COLD_RETRY_MS = 3000;
const COLD_RETRIES = 3;
let coldRetries = 0;
let live = null;
let loadError = "";
let loading = false;
let selectedId = null;
const $ = id => document.getElementById(id);
const CARD_MIN_WIDTH = 176;
const CARD_GAP = 10;
const INACTIVE_KEY = "genesysLive.inactiveOpen";
const livePanel = window.GenesysLivePanel;
let panelOpen = livePanel.loadOpen(localStorage);
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

  $("panelContent").innerHTML=livePanel.panelBody(live,data,queue,panelOpen);
}

function renderTime(){
  const info=live?livePanel.freshness(live.as_of,live.stale):{text:"–",tone:"",title:""};
  const asof=$("updatedAt").parentElement;
  asof.dataset.tone=info.tone;
  asof.title=info.title;
  $("updatedAt").textContent=info.text;
}

async function load(manual=false){
  if(loading)return;
  loading=true;
  let retry=false;
  try{
    const response=await fetch(LIVE_URL,{cache:"no-store"});
    if(!response.ok){retry=response.status>=500;throw new Error(`HTTP ${response.status}`)}
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
  if(retry&&!live&&coldRetries<COLD_RETRIES){coldRetries++;setTimeout(load,COLD_RETRY_MS)}
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
    livePanel.saveOpen(localStorage,panelOpen);
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

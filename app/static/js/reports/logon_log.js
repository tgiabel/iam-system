"use strict";
const LL_PAGE_SIZE = 100;
const llState = {report: null, page: 1, expanded: new Set(), names: {}, reportToken: 0, namesToken: 0,
    analysis: null, analysisTarget: null, analysisPage: 1, analysisToken: 0, userToken: 0, review: null, reviewToken: 0};
const llDom = {};
const LL_BASE = "/api/reporting/logon-log";
const llEscape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const llNormalize = value => String(value ?? "").trim().toLocaleLowerCase("de");
function llToday() { return new Intl.DateTimeFormat("sv-SE", {timeZone:"Europe/Berlin", year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()); }
function llShift(day, amount) { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0,10); }
function llDate(value) { return String(value ?? "").replace("T", " "); }
function llErrorText(payload) { return typeof payload?.detail === "string" ? payload.detail : payload?.detail?.message || "Die Anfrage konnte nicht verarbeitet werden."; }
async function llApi(path, options={}) {
    const response = await fetch(LL_BASE + path, {cache:"no-store", ...options, headers:{"Content-Type":"application/json", ...options.headers}});
    if (!response.ok) { let p; try { p = await response.json(); } catch (_) {} throw new Error(llErrorText(p)); }
    return response.json();
}
function llStatusLabels(item) {
    const labels = [];
    if (item.classification === "unresolved") labels.push("? Zuordnung ungeklärt");
    else if (item.classification === "anomaly") labels.push("△ Auffällig · derzeit keine Prüfpflicht");
    else labels.push("! Agenten-Finding");
    const states = {open:"! Offen", reviewed:"✓ Geprüft", changed:"! Erneut prüfen", legacy:"Altbestand · kein digitaler Prüfnachweis", workflow_inactive:"Digitale Prüfung noch gesperrt"};
    if (states[item.review_state]) labels.push(states[item.review_state]);
    if (item.quality) labels.push(item.quality === "confirmed" ? "Zeitlich belegt" : "Verdacht · Sitzungsende angenommen/offen");
    return labels;
}
function llBadges(item) {
    const cls = item.review_required ? "ll-urgent" : item.review_state === "reviewed" ? "ll-reviewed" : "";
    return llStatusLabels(item).map(label=>`<span class="ll-badge ${cls}">${llEscape(label)}</span>`).join("");
}
function llFiltered(events, cases, filters) {
    const byKey = new Map(cases.map(c=>[c.key,c]));
    return events.filter(e=>{
        const linked = (e.case_keys || []).map(k=>byKey.get(k)).filter(Boolean);
        const statuses = new Set(linked.flatMap(c=>[c.classification,c.review_state]));
        if (e.identity_unresolved) statuses.add("unresolved");
        return (!filters.search || [e.username,e.computer,e.ip].some(v=>llNormalize(v).includes(llNormalize(filters.search)))) &&
            (!filters.type || e.type === filters.type) && (!filters.status || statuses.has(filters.status));
    });
}
function llGroups(events, field) {
    if (!field) return events;
    const groups = new Map();
    for (const e of events) { const key=llNormalize(e[field]); if(!groups.has(key)) groups.set(key,{key,label:e[field] || "Ohne Wert",events:[]}); groups.get(key).events.push(e); }
    return [...groups.values()];
}
function llFilters() { return {search:llDom.llSearch.value,type:llDom.llType.value,status:llDom.llFilter.value}; }
function llEventRow(event, cases, showNames=false) {
    const linked = (event.case_keys || []).map(k=>cases.find(c=>c.key===k)).filter(Boolean);
    let status=linked.map(llBadges).join("");
    if (!status && event.identity_unresolved) status='<span class="ll-badge">? Benutzerzuordnung ungeklärt</span>';
    if(event.data_hint) status+=`<span class="ll-context">${llEscape(event.data_hint)}</span>`;
    const name = showNames && llState.names[event.username] ? `<span class="ll-name">${llEscape(llState.names[event.username])}</span>` : "";
    return `<tr><td>${status || "—"}</td><td>${llEscape(llDate(event.timestamp))}</td><td>${llEscape(event.username)}${name}</td><td>${llEscape(event.computer)}</td><td>${llEscape(event.ip)}</td><td>${llEscape(event.type)}</td></tr>`;
}
function llCaseCard(item) {
    const canCheck=llDom.llReport.dataset.canCheck==="true";
    const reviewButton=canCheck && item.user_id && (item.classification==="finding" || item.review_version) ?
        `<button type="button" data-review-user="${item.user_id}" data-review-day="${llEscape(item.day)}">${item.review_state==="reviewed" ? "Prüfung ansehen / korrigieren" : "Finding ansehen / prüfen"}</button>` : "";
    const continuation=item.continuation ? `<p class="ll-context">Fortsetzung: Prüftag ${llEscape(item.day)} <button type="button" data-day="${llEscape(item.day)}">Zum zuständigen Tag</button></p>` : "";
    return `<article class="ll-case ${item.review_required ? "ll-urgent" : item.review_state==="reviewed" ? "ll-reviewed" : ""}"><div class="ll-case-head"><strong>${llEscape(item.usernames.join(", "))} · ${llEscape(item.day)}</strong>${reviewButton}</div>${llBadges(item)}<p>Genutzte Rechner: ${llEscape(item.computers.join(", "))} · ${item.overlaps.length} Überschneidung(en)</p>${continuation}<details><summary>Überschneidungen anzeigen</summary>${item.overlaps.map(o=>`<p>${llEscape(o.computers.join(" / "))}: ${llEscape(llDate(o.started_at))} – ${llEscape(llDate(o.ended_at))} · ${o.quality==="confirmed" ? "belegt" : "Verdacht"}</p>`).join("")}</details></article>`;
}
function llRetainedCards(items) {
    return (items || []).map(item=>`<article class="ll-case ll-reviewed"><strong>${llEscape(item.usernames.join(", "))} · ${llEscape(item.day)}</strong><p>✓ Gespeicherter Prüfnachweis · aktuell keine zugeordnete Überschneidung. Genutzte Rechner im Prüfstand: ${llEscape(item.computers.join(", "))}</p>${llDom.llReport.dataset.canCheck==="true" ? `<button type="button" data-review-user="${item.user_id}" data-review-day="${item.day}">Prüfnachweis ansehen</button>` : ""}</article>`).join("");
}
function llRender() {
    const report=llState.report;
    if (!report) return;
    const filtered=llFiltered(report.events,report.cases,llFilters());
    const field=llDom.llGroup.value;
    const items=llGroups(filtered,field), pages=Math.max(1,Math.ceil(items.length/LL_PAGE_SIZE));
    llState.page=Math.min(llState.page,pages);
    const visible=items.slice((llState.page-1)*LL_PAGE_SIZE,llState.page*LL_PAGE_SIZE);
    const showNames=!!llDom.llNames?.checked;
    llDom.llRows.innerHTML=field ? visible.map(group=>{
        const key=field+":"+group.key, expanded=llState.expanded.has(key), control="llGroup"+visible.indexOf(group);
        const cases=report.cases.filter(c=>group.events.some(e=>e.case_keys.includes(c.key)));
        return `<tr><td><button type="button" data-expand="${llEscape(key)}" aria-expanded="${expanded}" aria-controls="${control}">${expanded ? "▾" : "▸"} ${llEscape(group.label)}</button></td><td colspan="5">${group.events.length} Ereignisse ${cases.map(llBadges).join("")}</td></tr>`+
            `<tr id="${control}" ${expanded ? "" : "hidden"}><td colspan="6">${expanded ? `<div class="ll-group-detail"><table class="ll-table"><tbody>${group.events.map(e=>llEventRow(e,report.cases,showNames)).join("")}</tbody></table></div>` : ""}</td></tr>`;
    }).join("") : visible.map(e=>llEventRow(e,report.cases,showNames)).join("");
    if (!items.length) llDom.llRows.innerHTML='<tr><td colspan="6">Keine Logeinträge für diese Auswahl.</td></tr>';
    llDom.llCount.textContent=`${filtered.length} von ${report.event_count} Ereignissen · ${report.case_count} Auffälligkeitsfälle`;
    llDom.llPageLabel.textContent=`Seite ${llState.page} / ${pages}`;
    llDom.llPagePrev.disabled=llState.page<=1; llDom.llPageNext.disabled=llState.page>=pages;
}
async function llLoadDay(day=llDom.llDay.value) {
    if(!day || day>llToday()) { llDom.llStatus.textContent="Bitte einen Tag bis einschließlich heute wählen."; return; }
    const token=++llState.reportToken;
    llState.report=null; llState.names={}; ++llState.namesToken;
    llDom.llRows.innerHTML=""; llDom.llOpenCases.innerHTML=""; llDom.llOtherDays.innerHTML="";
    llDom.llDataAsOf.textContent=""; llDom.llCount.textContent=""; llDom.llPageLabel.textContent="";
    llDom.llExport.disabled=true; llDom.llStatus.textContent="Anmeldeprotokoll wird geladen…";
    llDom.llDay.max=llToday(); llDom.llDay.value=day; llDom.llNext.disabled=day>=llToday();
    try {
        const result=await llApi("/day?day="+encodeURIComponent(day));
        if(token!==llState.reportToken) return;
        llState.report=result; llState.page=1; llState.expanded.clear();
        llDom.llDataAsOf.textContent=`Stand ${llDate(result.data_as_of)}${result.ongoing ? " · laufender Tag" : ""}`;
        llDom.llWorkflowNote.textContent=result.workflow_enabled ? `Digitale Prüfaufgaben seit ${result.introduction_day}. Ältere Fälle sind Altbestand ohne digitalen Prüfnachweis.` : "Digitale Prüfung noch nicht aktiviert. Die Prüfung erfolgt weiterhin im bisherigen Papierverfahren.";
        const open=result.cases.filter(c=>c.review_required && c.day===day);
        llDom.llOpenCases.innerHTML=open.length ? open.map(llCaseCard).join("") : "<p>Keine offenen digitalen Prüfungen dieses Tages.</p>";
        llDom.llOtherDays.innerHTML=result.other_open_days.length ? `<p>Offene Prüfungen anderer Tage: ${result.other_open_days.map(d=>`<button type="button" data-day="${d.day}">${d.day} (${d.count})</button>`).join(" ")}</p>` : "";
        // Cases remain accessible even when their context lies outside today's
        // raw events (e.g. a session begun yesterday).
        const remaining=result.cases.filter(c=>!open.includes(c));
        if(remaining.length) llDom.llOpenCases.innerHTML+=`<details><summary>Weitere Auffälligkeiten und Prüfstände (${remaining.length})</summary>${remaining.map(llCaseCard).join("")}</details>`;
        llDom.llOpenCases.innerHTML+=llRetainedCards(result.retained_reviews);
        llDom.llStatus.textContent=result.events.length ? "" : "Für diesen Tag liegen keine Logereignisse vor.";
        llDom.llExport.disabled=false; llRender();
        if(llDom.llNames?.checked) await llLoadNames();
    } catch(error) { if(token===llState.reportToken) llDom.llStatus.textContent=error.message; }
}
async function llLoadNames() {
    const token=++llState.namesToken;
    if (!llDom.llNames?.checked) { llState.names={};llRender();llRenderAnalysis();return; }
    if(!llState.report) return;
    const usernames=[...new Set(llState.report.events.map(e=>e.username))];
    try {
        const data=await llApi("/names",{method:"POST",body:JSON.stringify({usernames})});
        if(token===llState.namesToken && llDom.llNames.checked) { llState.names=data.names;llRender(); }
    } catch(error) { if(token===llState.namesToken) { llDom.llNames.checked=false;llState.names={};llDom.llStatus.textContent=error.message;llRender(); } }
}
async function llUsers() {
    const token=++llState.userToken;
    llDom.llUserStatus.textContent="Benutzer werden gesucht…";
    try {
        const data=await llApi("/users?q="+encodeURIComponent(llDom.llUserQuery.value));
        if(token!==llState.userToken) return;
        llDom.llUser.innerHTML='<option value="">Benutzer auswählen</option>'+data.users.map(u=>`<option value="${u.user_id}">${llEscape(u.name)} · ${llEscape(u.usernames.join(", "))}${u.is_active ? "" : " · ausgeschieden"}</option>`).join("");
        llDom.llUserStatus.textContent=data.users.length ? "" : "Keine eindeutig zugeordneten Benutzer gefunden.";
    } catch(error) { if(token===llState.userToken) llDom.llUserStatus.textContent=error.message; }
}
async function llLoadAnalysis(includeLogs=false) {
    const target=llState.analysisTarget, token=++llState.analysisToken;
    if(!target) return;
    llDom.llAnalysisStatus.textContent="Auswertung wird geladen…";
    llDom.llAnalysisSection.hidden=false;
    const params=new URLSearchParams({user_id:target.user_id,start:target.start,end:target.end,include_logs:String(includeLogs)});
    try {
        const result=await llApi("/analysis?"+params);
        if(token!==llState.analysisToken) return;
        llState.analysis=result;llState.analysisPage=1;
        llDom.llAnalysisTitle.textContent=`${target.name} · ${target.start} bis ${target.end}`;
        llDom.llAnalysisStatus.textContent=`${result.case_count} Auffälligkeitsfälle · ${result.event_count} Benutzerlogs · Stand ${llDate(result.data_as_of)}`;
        llRenderAnalysis();
    } catch(error) { if(token===llState.analysisToken) llDom.llAnalysisStatus.textContent=error.message; }
}
function llRenderAnalysis() {
    const result=llState.analysis;
    if(!result) return;
    llDom.llAnalysisCases.innerHTML=result.cases.length ? result.cases.map(llCaseCard).join("") : "<p>Keine Parallelauffälligkeiten im Zeitraum.</p>";
    llDom.llAnalysisCases.innerHTML+=llRetainedCards(result.retained_reviews);
    llDom.llLoadAll.disabled=result.logs_loaded;
    if (!result.logs_loaded) { llDom.llAnalysisLogs.innerHTML=""; return; }
    const pages=Math.max(1,Math.ceil(result.events.length/LL_PAGE_SIZE));
    llState.analysisPage=Math.max(1,Math.min(llState.analysisPage,pages));
    const visible=result.events.slice((llState.analysisPage-1)*LL_PAGE_SIZE,llState.analysisPage*LL_PAGE_SIZE);
    llDom.llAnalysisLogs.innerHTML=`<div class="ll-table-wrap"><table class="ll-table"><thead><tr><th>Status</th><th>Zeitstempel</th><th>y-User</th><th>Rechnername</th><th>IP</th><th>Ereignis</th></tr></thead><tbody>${visible.map(e=>llEventRow(e,result.cases)).join("") || '<tr><td colspan="6">Keine Logs vorhanden.</td></tr>'}</tbody></table></div><div class="ll-toolbar"><button type="button" data-analysis-page="-1" ${llState.analysisPage<=1?"disabled":""}>Vorherige Seite</button><span>Seite ${llState.analysisPage} / ${pages}</span><button type="button" data-analysis-page="1" ${llState.analysisPage>=pages?"disabled":""}>Nächste Seite</button></div>`;
}
async function llOpenReview(userId,day) {
    const token=++llState.reviewToken;
    llState.review=null; llDom.llReviewSave.disabled=true;
    llDom.llReviewSummary.innerHTML="";llDom.llReviewEvidence.innerHTML="";llDom.llReviewHistory.innerHTML="";
    llDom.llCause.value="";llDom.llMeasures.value="";llDom.llReason.value="";
    llDom.llReviewStatus.textContent="Prüffall wird geladen…";
    llDom.llReviewDialog.showModal();
    try {
        const result=await llApi(`/reviews/${userId}/${day}`);
        if(token!==llState.reviewToken || !llDom.llReviewDialog.open) return;
        const item=result.case;
        llState.review={...result,userId,day};
        llDom.llReviewSummary.innerHTML=`<p><strong>Name:</strong> ${llEscape(result.name || "Nicht zugeordnet")}</p><p><strong>y-User:</strong> ${llEscape(item?.usernames.join(", ") || result.history[0]?.snapshot?.usernames.join(", ") || "")}</p><p><strong>Genutzte Rechner:</strong> ${llEscape(item?.computers.join(", ") || result.history[0]?.snapshot?.computers.join(", ") || "")}</p><p>Prüftag ${llEscape(day)}</p>`;
        if(item) llDom.llReviewEvidence.innerHTML=llCaseCard({...item,user_id:null})+`<details><summary>Beteiligte Rohereignisse einschließlich Zeitraumkontext</summary><div class="ll-table-wrap"><table class="ll-table"><tbody>${item.events.map(e=>llEventRow(e,[])).join("")}</tbody></table></div></details>`;
        const prior=result.history[0];
        llDom.llCause.value=prior?.cause || "";llDom.llMeasures.value=prior?.measures || "";
        llDom.llReasonLabel.hidden=!prior;llDom.llReason.required=!!prior;
        const canSave=result.workflow_enabled && item && !["legacy","not_required"].includes(item.review_state) && (item.classification==="finding" || item.review_version);
        llDom.llReviewSave.disabled=!canSave;
        llDom.llReviewStatus.textContent=canSave ? (prior ? "Änderungsgrund für eine neue Prüfversion erforderlich." : "Ursache ist Pflicht; Maßnahmen sind optional.") : "Dieser Prüfstand kann derzeit nur eingesehen werden.";
        llDom.llReviewHistory.innerHTML=result.history.length ? `<h3>Prüfhistorie</h3>${result.history.map(v=>`<details><summary>Version ${v.version} · ${llEscape(v.reviewer_name)} · ${llEscape(llDate(v.reviewed_at))}</summary><p>Name zum Prüfzeitpunkt: ${llEscape(v.snapshot.name)}</p><p><strong>Ursache:</strong> ${llEscape(v.cause)}</p><p><strong>Maßnahmen:</strong> ${llEscape(v.measures || "Keine")}</p><p><strong>Änderungsgrund:</strong> ${llEscape(v.change_reason || "Erstprüfung")}</p><details><summary>Gespeicherte Belege und Regeln</summary><pre>${llEscape(JSON.stringify(v.snapshot,null,2))}</pre></details></details>`).join("")}` : "";
    } catch(error) { if(token===llState.reviewToken) llDom.llReviewStatus.textContent=error.message; }
}
async function llSaveReview(event) {
    event.preventDefault();
    const review=llState.review;
    if(!review?.case || llDom.llReviewSave.disabled) return;
    const cause=llDom.llCause.value.trim(), reason=llDom.llReason.value.trim();
    if(!cause || (review.case.review_version && !reason)) { llDom.llReviewStatus.textContent="Ursache und gegebenenfalls Änderungsgrund ausfüllen.";return; }
    llDom.llReviewSave.disabled=true;
    try {
        await llApi(`/reviews/${review.userId}/${review.day}`,{method:"POST",body:JSON.stringify({expected_fingerprint:review.case.fingerprint,expected_version:review.case.review_version,cause,measures:llDom.llMeasures.value.trim(),change_reason:reason})});
        llDom.llReviewDialog.close();
        await llLoadDay();
        if(llState.analysis) await llLoadAnalysis(llState.analysis.logs_loaded);
    } catch(error) { llDom.llReviewStatus.textContent=error.message+" Ihre Eingaben bleiben erhalten. Bei geändertem Prüfstand schließen und erneut öffnen.";llDom.llReviewSave.disabled=false; }
}
async function llExport(scope) {
    const filters=scope==="day" ? llFilters() : {search:"",type:"",status:""};
    const params=new URLSearchParams({scope,search:filters.search,event_type:filters.type,status:filters.status});
    if(scope==="day") params.set("day",llDom.llDay.value);
    else {
        const t=llState.analysisTarget;if(!t) return;
        params.set("user_id",t.user_id);params.set("start",t.start);params.set("end",t.end);
    }
    const filterText=[filters.search&&`Suche „${filters.search}“`,filters.type,filters.status].filter(Boolean).join(", ");
    llDom.llExportNotice.textContent=`CSV: ${scope==="findings" ? "beteiligte Auffälligkeitslogs einschließlich erforderlichem Kontext außerhalb des Zeitraums" : scope==="all" ? "alle Benutzerlogs im Zeitraum" : "alle gefilterten Tageslogs"}; ${filterText || "keine zusätzlichen Filter"}. Alle Seiten, chronologisch und ohne Klartextnamen.`;
    try {
        const response=await fetch(LL_BASE+"/export?"+params,{cache:"no-store"});
        if(!response.ok) { let p;try {p=await response.json();}catch(_){} throw new Error(llErrorText(p)); }
        const url=URL.createObjectURL(await response.blob()), link=document.createElement("a");
        link.href=url;link.download=`logon-log-${scope}-${scope==="day" ? llDom.llDay.value : llState.analysisTarget.start}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) { llDom.llExportNotice.textContent=error.message; }
}
function llInit() {
    document.querySelectorAll('[id^="ll"]').forEach(e=>{llDom[e.id]=e;});
    if(!llDom.llReport) return;
    const today=llToday();llDom.llDay.max=today;llDom.llFrom.max=today;llDom.llTo.max=today;llDom.llTo.value=today;
    const d=new Date(today+"T12:00:00Z"), lastDay=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-6);
    const maxDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(lastDay,maxDay));llDom.llFrom.value=d.toISOString().slice(0,10);
    const requested=new URL(location.href).searchParams.get("day");
    llDom.llDay.value=requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested<=today ? requested : today;
    llDom.llPrev.addEventListener("click",()=>llLoadDay(llShift(llDom.llDay.value,-1)));
    llDom.llNext.addEventListener("click",()=>llLoadDay(llShift(llDom.llDay.value,1)));
    llDom.llDay.addEventListener("change",()=>llLoadDay());llDom.llReload.addEventListener("click",()=>llLoadDay());
    for(const id of ["llSearch","llGroup","llType","llFilter"]) llDom[id].addEventListener(id==="llSearch"?"input":"change",()=>{llState.page=1;llRender();});
    llDom.llNames?.addEventListener("change",llLoadNames);
    llDom.llPagePrev.addEventListener("click",()=>{--llState.page;llRender();});llDom.llPageNext.addEventListener("click",()=>{++llState.page;llRender();});
    llDom.llExport.addEventListener("click",()=>llExport("day"));
    llDom.llAnalyze?.addEventListener("click",()=>{llDom.llAnalysisDialog.showModal();llUsers();});
    let timer;llDom.llUserQuery.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(llUsers,200);});
    llDom.llAnalysisCancel.addEventListener("click",()=>llDom.llAnalysisDialog.close());
    llDom.llAnalysisForm.addEventListener("submit",event=>{event.preventDefault();if(llDom.llFrom.value>llDom.llTo.value){llDom.llUserStatus.textContent="Startdatum muss vor oder am Enddatum liegen.";return;}llState.analysisTarget={user_id:llDom.llUser.value,name:llDom.llUser.selectedOptions[0].textContent,start:llDom.llFrom.value,end:llDom.llTo.value};llState.analysis=null;llDom.llAnalysisCases.innerHTML="";llDom.llAnalysisLogs.innerHTML="";llDom.llAnalysisDialog.close();llLoadAnalysis();});
    llDom.llLoadAll.addEventListener("click",()=>llLoadAnalysis(true));
    llDom.llAnalysisClose.addEventListener("click",()=>{++llState.analysisToken;llState.analysis=null;llState.analysisTarget=null;llDom.llAnalysisSection.hidden=true;});
    llDom.llExportFindings.addEventListener("click",()=>llExport("findings"));llDom.llExportAll.addEventListener("click",()=>llExport("all"));
    llDom.llReviewCancel.addEventListener("click",()=>llDom.llReviewDialog.close());
    llDom.llReviewDialog.addEventListener("close",()=>{++llState.reviewToken;llState.review=null;});
    llDom.llReviewForm.addEventListener("submit",llSaveReview);
    document.addEventListener("click",event=>{
        const target=event.target.closest("button");if(!target) return;
        if(target.dataset.day) llLoadDay(target.dataset.day);
        if(target.dataset.reviewUser) llOpenReview(target.dataset.reviewUser,target.dataset.reviewDay);
        if(target.dataset.expand) {const key=target.dataset.expand;llState.expanded.has(key)?llState.expanded.delete(key):llState.expanded.add(key);llRender();[...llDom.llRows.querySelectorAll("[data-expand]")].find(e=>e.dataset.expand===key)?.focus();}
        if(target.dataset.analysisPage) {llState.analysisPage+=Number(target.dataset.analysisPage);llRenderAnalysis();}
    });
    llLoadDay();
}
if(typeof document!=="undefined") document.addEventListener("DOMContentLoaded",llInit);
if(typeof module!=="undefined") module.exports={llFiltered,llGroups,llStatusLabels,llEscape,llShift,LL_PAGE_SIZE};

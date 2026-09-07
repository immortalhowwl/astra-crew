const $ = (id) => document.getElementById(id);
const names = ["TOKYO","BERLIN","RIO","DENVER","LISBON","STOCKHOLM","NAIROBI","HELSINKI","PALERMO","PROFESSOR"];
const roles = ["SCOUT","CRITERIA","CHAIN PROOF","SOCIAL PROOF","VALIDATION","PAIR POLICY","BRIEF","AUDIT","VETO GATE","FINAL"];
let selected = null;
let timer = null;
let latestSnapshot = null;
let activeFilter = "ALL";
const short = (value, size=6) => `${value.slice(0,size+2)}…${value.slice(-4)}`;
const explorer = (hash) => `https://robinhoodchain.blockscout.com/tx/${hash}`;
const tokenExplorer = (address) => `https://robinhoodchain.blockscout.com/address/${address}`;
const pons = (address) => `https://www.ponsfamily.com/launchpad/${address}`;
const pct = (bps) => `${(bps / 100).toFixed(2)}%`;

function buildRoute(){
  const root=$("route"); root.replaceChildren();
  names.forEach((name,i)=>{const el=document.createElement("div");el.className="agent";el.dataset.index=String(i);const role=document.createElement("span");role.textContent=`0${i+1}`.slice(-2)+" / "+roles[i];const title=document.createElement("strong");title.textContent=name;const status=document.createElement("small");status.textContent="STANDBY";el.append(role,title,status);root.append(el)});
}

function animate(decision){
  if(timer) clearInterval(timer); let i=0; const cards=[...document.querySelectorAll(".agent")];
  cards.forEach((card,index)=>{card.className="agent";card.querySelector("small").textContent="STANDBY";if(index===0)card.classList.add("active")});
  timer=setInterval(()=>{if(i>=cards.length){clearInterval(timer);return}const h=decision.handoffs[i];const card=cards[i];card.classList.remove("active");card.classList.add("done",h.outcome.toLowerCase());card.querySelector("small").textContent=h.outcome;i++;cards[i]?.classList.add("active")},120);
}

function selectLaunch(launch){
  selected=launch;
  document.querySelectorAll(".intercept").forEach(el=>el.classList.toggle("selected",el.dataset.tx===launch.transactionHash));
  $("selected-token").textContent=short(launch.token,8);$("trace-id").textContent=short(launch.transactionHash,8);
  $("pons-link").href=pons(launch.token);$("token-link").href=tokenExplorer(launch.token);$("tx-link").href=explorer(launch.transactionHash);
  const card=$("decision-card");card.className=`decision-card ${launch.verdict.toLowerCase()}`;$("decision").textContent=launch.verdict;$("decision-copy").textContent=launch.handoffs[9].message;
  const market=launch.market;
  $("score").textContent=String(launch.assessment.score).padStart(2,"0");
  $("progress").textContent=market.status==="VERIFIED"?pct(market.progressBps):"UNKNOWN";
  $("phase").textContent=market.status==="VERIFIED"?market.phase:market.status;
  $("taxes").textContent=market.status==="VERIFIED"?`${pct(market.creatorTaxBps)} / ${pct(market.currentSnipeTaxBps)}`:"—";
  const assessment=launch.assessment;
  const evidence=[];
  if(assessment.blockers.length)evidence.push(`BLOCKERS — ${assessment.blockers.join(" · ")}`);
  evidence.push(`SCORE — ${assessment.reasons.join(" · ")}`);
  evidence.push(`UNRESOLVED — ${assessment.unknowns.join(" · ")}`);
  $("evidence").textContent=evidence.join("  /  ");
  const trace=$("trace");trace.replaceChildren();launch.handoffs.forEach(h=>{const li=document.createElement("li");li.className=h.outcome.toLowerCase();const seq=document.createElement("span");seq.textContent=`${String(h.sequence).padStart(2,"0")} / ${h.outcome}`;const title=document.createElement("strong");title.textContent=h.agent;const copy=document.createElement("p");copy.textContent=h.message;li.append(seq,title,copy);trace.append(li)});animate(launch);
}

function renderFeed(snapshot){
  const feed=$("feed");feed.replaceChildren();
  const launches=activeFilter==="ALL"?snapshot.launches:snapshot.launches.filter(x=>x.verdict===activeFilter);
  if(!launches.length){const empty=document.createElement("p");empty.className="empty";empty.textContent=`No ${activeFilter.toLowerCase()} launches in the current block window.`;feed.append(empty);return}
  launches.forEach((launch,i)=>{const button=document.createElement("button");button.type="button";button.className="intercept";button.dataset.tx=launch.transactionHash;const n=document.createElement("span");n.className="ordinal";n.textContent=String(i+1).padStart(2,"0");const body=document.createElement("div");const title=document.createElement("strong");title.textContent=short(launch.token,8);const meta=document.createElement("small");const progress=launch.market.status==="VERIFIED"?pct(launch.market.progressBps):"UNKNOWN";meta.textContent=`${launch.assessment.score}/100 · ${progress} CURVE · ${launch.pairLabel}`;body.append(title,meta);const badge=document.createElement("span");badge.className=`badge ${launch.verdict.toLowerCase()}`;badge.textContent=launch.verdict;button.append(n,body,badge);button.addEventListener("click",()=>selectLaunch(launch));feed.append(button)});
  const stillPresent=selected&&launches.find(x=>x.transactionHash===selected.transactionHash);selectLaunch(stillPresent||launches[0]);
}

function render(snapshot){
  latestSnapshot=snapshot;$("pulse").classList.add("online");$("block").textContent=`#${snapshot.headBlock.toLocaleString()}`;$("sync").textContent="LIVE";
  $("launch-count").textContent=String(snapshot.launches.length).padStart(2,"0");$("watch-count").textContent=String(snapshot.launches.filter(x=>x.verdict==="WATCH").length).padStart(2,"0");$("veto-count").textContent=String(snapshot.launches.filter(x=>x.verdict==="VETO").length).padStart(2,"0");
  $("updated").textContent=`SYNC ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`;
  renderFeed(snapshot);
}

async function sync(){try{const response=await fetch("/api/snapshot",{headers:{accept:"application/json"}});if(!response.ok)throw new Error(`HTTP ${response.status}`);render(await response.json())}catch(error){$("pulse").classList.remove("online");$("sync").textContent="RETRYING";$("block").textContent="OFFLINE";$("updated").textContent=String(error.message||error).slice(0,70)}}

document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{activeFilter=button.dataset.filter;document.querySelectorAll("[data-filter]").forEach(item=>item.classList.toggle("active",item===button));if(latestSnapshot)renderFeed(latestSnapshot)}));
buildRoute();sync();setInterval(sync,10000);

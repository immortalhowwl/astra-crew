const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const NAMES = ["TOKYO","BERLIN","RIO","DENVER","LISBON","STOCKHOLM","NAIROBI","HELSINKI","PALERMO","PROFESSOR"];
const ROLES = ["SCOUT","CRITERIA","CHAIN PROOF","SOCIAL PROOF","VALIDATION","PAIR POLICY","BRIEF","AUDIT","VETO GATE","FINAL"];
const DESCRIPTIONS = [
  "Finds the launch event and opens the case.",
  "Locks the policy before the evidence arrives.",
  "Matches factory, curve, deployer and pair on chain.",
  "Separates declared links from external reputation.",
  "Rejects malformed or contradictory reads.",
  "Checks whether the pair is inside policy.",
  "Compresses known facts and visible unknowns.",
  "Attaches the explorer-linked custody trail.",
  "Kills any route that crosses a blocker.",
  "Prints WATCH or VETO. It cannot place an order."
];
const short = (value, size=6) => typeof value === "string" && value.length > size * 2 + 3 ? `${value.slice(0,size+2)}…${value.slice(-4)}` : value || "—";
const pct = (bps) => `${(bps / 100).toFixed(2)}%`;
const el = (name, attrs = {}, text = "") => {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
};

const pathRoom = location.pathname.split("/").filter(Boolean)[0] || "trace";
const room = ["trace","crew","method","vault"].includes(pathRoom) ? pathRoom : "trace";
document.querySelectorAll("[data-room]").forEach((view) => { view.hidden = view.dataset.room !== room; });
document.querySelectorAll("[data-room-link]").forEach((link) => link.classList.toggle("active", link.dataset.roomLink === room));
$("room-name").textContent = room.toUpperCase();
document.title = `GPTHEIST / ${room.toUpperCase()}`;

function renderCrew() {
  const root = $("crew-line");
  if (!root) return;
  root.replaceChildren();
  NAMES.forEach((name,index) => {
    const card = document.createElement("article");
    card.className = `crew-card ${name === "PALERMO" ? "kill" : ""} ${name === "PROFESSOR" ? "final" : ""}`;
    const ordinal = document.createElement("span"); ordinal.textContent = String(index + 1).padStart(2,"0");
    const face = document.createElement("div"); face.className = "crew-face"; face.textContent = name.slice(0,2);
    const title = document.createElement("h2"); title.textContent = name;
    const role = document.createElement("b"); role.textContent = ROLES[index];
    const copy = document.createElement("p"); copy.textContent = DESCRIPTIONS[index];
    card.append(ordinal,face,title,role,copy); root.append(card);
  });
}

function drawFingerprint(launch) {
  const svg = $("fingerprint"); if (!svg) return;
  svg.replaceChildren();
  const market = launch.market;
  const feeScore = market.status === "VERIFIED" ? Math.min(
    market.creatorTaxBps <= 200 ? 100 : market.creatorTaxBps <= 500 ? 50 : 0,
    market.currentSnipeTaxBps <= 200 ? 100 : market.currentSnipeTaxBps <= 500 ? 50 : 0
  ) : 0;
  const active = market.status === "VERIFIED" && ["CURVE","POOL"].includes(market.phase);
  const values = [market.status === "VERIFIED" ? 100 : 0, launch.pairLabel === "ETH" ? 100 : 0, active ? 100 : 0, feeScore,
    market.status === "VERIFIED" ? Math.min(100, market.progressBps / 25) : 0];
  const labels = ["PROVENANCE","PAIR","PHASE","FEE SAFETY","PROGRESS"];
  const cx=210,cy=145,max=108,count=5;
  const point=(i,r)=>{const a=-Math.PI/2+i*Math.PI*2/count;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r]};
  [1,.75,.5,.25].forEach(scale=>svg.append(el("polygon",{points:labels.map((_,i)=>point(i,max*scale).join(",")).join(" "),class:"radar-grid"})));
  labels.forEach((label,i)=>{const [x,y]=point(i,max+28);svg.append(el("line",{x1:cx,y1:cy,x2:point(i,max)[0],y2:point(i,max)[1],class:"radar-axis"}));svg.append(el("text",{x,y,"text-anchor":"middle",class:"radar-label"},label));});
  svg.append(el("polygon",{points:values.map((v,i)=>point(i,max*v/100).join(",")).join(" "),class:"radar-value"}));
  values.forEach((v,i)=>{const [x,y]=point(i,max*v/100);svg.append(el("circle",{cx:x,cy:y,r:4,class:"radar-dot"}));});
  const key=$("axis-key");key.replaceChildren();labels.forEach((label,i)=>{const item=document.createElement("span");item.textContent=`${label} ${Math.round(values[i])}`;key.append(item)});
}

function drawChord(launch) {
  const svg=$("handoff-chord"); if(!svg)return; svg.replaceChildren();
  const cx=310,cy=190,r=132;
  const pts=launch.handoffs.map((h,i)=>{const a=-Math.PI/2+i*Math.PI*2/launch.handoffs.length;return {x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r,h,a}});
  pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];if(i<pts.length-1)svg.append(el("path",{d:`M ${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}`,class:`chord-edge ${q.h.outcome.toLowerCase()}`}));});
  pts.forEach((p,i)=>{svg.append(el("circle",{cx:p.x,cy:p.y,r:i===8?24:20,class:`chord-node ${p.h.outcome.toLowerCase()}`}));svg.append(el("text",{x:p.x,y:p.y+4,"text-anchor":"middle",class:"chord-index"},String(i+1).padStart(2,"0")));const lx=cx+Math.cos(p.a)*(r+50),ly=cy+Math.sin(p.a)*(r+50);svg.append(el("text",{x:lx,y:ly,"text-anchor":lx<cx?"end":lx>cx?"start":"middle",class:"chord-label"},p.h.agent));});
  svg.append(el("circle",{cx,cy,r:48,class:"chord-core"}));svg.append(el("text",{x:cx,y:cy-3,"text-anchor":"middle",class:"chord-core-copy"},launch.verdict));svg.append(el("text",{x:cx,y:cy+15,"text-anchor":"middle",class:"chord-core-sub"},`${launch.assessment.score}/100`));
}

function drawGraph(launch) {
  const svg=$("evidence-graph"); if(!svg)return; svg.replaceChildren();
  const meta=launch.metadata, market=launch.market;
  const socials=meta.status==="DECLARED"?Object.entries(meta.socials).filter(([,v])=>v).map(([k])=>k.toUpperCase()).slice(0,3):[];
  const nodes=[
    {id:"token",label:meta.status==="DECLARED"?`${meta.name||"TOKEN"} / $${meta.symbol||"—"}`:short(launch.token,7),x:455,y:205,type:"token"},
    {id:"factory",label:"PONS V2 FACTORY",x:110,y:82,type:"verified"},
    {id:"curve",label:`CURVE ${market.status==="VERIFIED"?pct(market.progressBps):"UNKNOWN"}`,x:275,y:92,type:"verified"},
    {id:"deployer",label:`DEV ${short(launch.deployer,5)}`,x:685,y:88,type:"verified"},
    {id:"pair",label:`PAIR ${launch.pairLabel}`,x:825,y:205,type:"verified"},
    {id:"fee",label:`FEE ${market.status==="VERIFIED"?short(market.creatorFeeRecipient,5):"UNKNOWN"}`,x:685,y:330,type:market.status==="VERIFIED"?"verified":"unknown"},
    {id:"social",label:socials.length?socials.join(" · "):"NO DECLARED SOCIALS",x:275,y:330,type:socials.length?"declared":"unknown"},
    {id:"unknown",label:"SLIPPAGE / UNMEASURED",x:110,y:330,type:"unknown"}
  ];
  const edges=[["factory","token","LAUNCHED"],["curve","token","PRICES"],["deployer","token","DEPLOYED"],["pair","token","PAIRED"],["fee","token","RECEIVES FEES"],["social","token","DECLARES"],["unknown","token","NOT SCORED"]];
  const byId=Object.fromEntries(nodes.map(n=>[n.id,n]));
  edges.forEach(([a,b,label])=>{const p=byId[a],q=byId[b];svg.append(el("line",{x1:p.x,y1:p.y,x2:q.x,y2:q.y,class:`graph-edge ${p.type}`}));const tx=(p.x+q.x)/2,ty=(p.y+q.y)/2;svg.append(el("text",{x:tx,y:ty-5,"text-anchor":"middle",class:"graph-edge-label"},label));});
  nodes.forEach(n=>{svg.append(el("circle",{cx:n.x,cy:n.y,r:n.type==="token"?43:28,class:`graph-node ${n.type}`}));svg.append(el("text",{x:n.x,y:n.y+(n.type==="token"?64:47),"text-anchor":"middle",class:"graph-label"},n.label));});
}

function renderLedger(launch) {
  const root=$("score-ledger");if(!root)return;root.replaceChildren();
  const entries=launch.assessment.reasons.map((reason)=>{const match=reason.match(/\(\+(\d+)\)/);return {reason,points:match?Number(match[1]):0,status:"plus"}})
    .concat(launch.assessment.blockers.map(reason=>({reason,points:0,status:"block"})))
    .concat(launch.assessment.unknowns.map(reason=>({reason,points:0,status:"unknown"})));
  entries.forEach(item=>{const row=document.createElement("div");row.className=`ledger-row ${item.status}`;const label=document.createElement("span");label.textContent=item.reason;const track=document.createElement("i");const fill=document.createElement("b");fill.className=`points-${Math.min(25,item.points)}`;track.append(fill);const value=document.createElement("strong");value.textContent=item.status==="plus"?`+${item.points}`:item.status==="block"?"VETO":"OPEN";row.append(label,track,value);root.append(row)});
}

function renderLog(launch) {
  const root=$("war-log");if(!root)return;root.replaceChildren();
  launch.handoffs.forEach(h=>{const row=document.createElement("li");row.className=h.outcome.toLowerCase();const seq=document.createElement("span");seq.textContent=String(h.sequence).padStart(2,"0");const agent=document.createElement("b");agent.textContent=h.agent;const message=document.createElement("p");message.textContent=h.message;row.append(seq,agent,message);root.append(row)});
}

function renderTrace(launch) {
  $("war-verdict").textContent=launch.verdict;$("war-verdict").dataset.verdict=launch.verdict;
  $("war-score").textContent=`${launch.assessment.score}/100`;$("war-pair").textContent=launch.pairLabel;
  $("war-curve").textContent=launch.market.status==="VERIFIED"?pct(launch.market.progressBps):"UNKNOWN";
  $("war-phase").textContent=launch.market.status==="VERIFIED"?launch.market.phase:launch.market.status;
  $("war-reason").textContent=launch.assessment.blockers[0]||launch.handoffs[9]?.message||"Watch gate cleared.";
  $("trace-token-link").href=`https://robinhoodchain.blockscout.com/address/${launch.token}`;
  drawFingerprint(launch);drawChord(launch);drawGraph(launch);renderLedger(launch);renderLog(launch);
}

function populateTrace(snapshot) {
  const select=$("trace-launch");if(!select)return;select.replaceChildren();
  snapshot.launches.forEach((launch,index)=>{const option=document.createElement("option");const label=launch.metadata.status==="DECLARED"?`${launch.metadata.name} / $${launch.metadata.symbol}`:short(launch.token,8);option.value=launch.transactionHash;option.textContent=`${String(index+1).padStart(2,"0")} · ${label} · ${launch.verdict} ${launch.assessment.score}`;select.append(option)});
  const choose=()=>{const launch=snapshot.launches.find(item=>item.transactionHash===select.value)||snapshot.launches[0];if(launch)renderTrace(launch)};select.addEventListener("change",choose,{once:false});choose();
}

async function sync() {
  try {
    const response=await fetch("/api/snapshot",{headers:{accept:"application/json"}});if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const snapshot=await response.json();$("pulse").classList.add("online");$("block").textContent=`#${snapshot.headBlock.toLocaleString()}`;$("updated").textContent=`SYNC ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`;
    if(room==="trace")populateTrace(snapshot);
  } catch(error) { $("pulse").classList.remove("online");$("block").textContent="OFFLINE";$("updated").textContent=String(error?.message||error).slice(0,70); }
}

renderCrew();sync();

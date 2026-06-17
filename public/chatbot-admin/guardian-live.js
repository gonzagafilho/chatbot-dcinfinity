async function cleanupThreat(name){

  if(!confirm(`Limpar ameaça "${name}" ?`)){
    return;
  }

  const r = await fetch("/api/guardian/cleanup",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ process:name })
  });

  const j = await r.json();

  if(j.ok){
    alert("Ameaça limpa.");
    refreshGuardian();
setInterval(tickGuardianUptime,1000);
  }else{
    alert("Falha ao limpar.");
  }
}

const presentationToggle = document.getElementById("presentationToggle");
const statusBanner = document.getElementById("statusBanner");
const cpu = document.getElementById("cpu");
const ram = document.getElementById("ram");
const disk = document.getElementById("disk");
const load = document.getElementById("load");
const dockerStatus = document.getElementById("dockerStatus");
const dockerRaw = document.getElementById("dockerRaw");
const processesRaw = document.getElementById("processesRaw");
const eventsBody = document.getElementById("eventsBody");
const blockedStatus = document.getElementById("blockedStatus");
const blockedIpsRaw = document.getElementById("blockedIpsRaw");
const nocChart = document.getElementById("nocChart");
const svcOnline = document.getElementById("svcOnline");
const svcOffline = document.getElementById("svcOffline");
const eventCount = document.getElementById("eventCount");
const blockCount = document.getElementById("blockCount");
const lastUpdate = document.getElementById("lastUpdate");
const socTimeline = document.getElementById("socTimeline");
const executiveSummary = document.getElementById("executiveSummary");
const executiveTitle = document.getElementById("executiveTitle");
const executiveSub = document.getElementById("executiveSub");

const operationStatus = document.getElementById("operationStatus");
const operationTitle = document.getElementById("operationTitle");
const operationSub = document.getElementById("operationSub");
const operationBadge = document.getElementById("operationBadge");
const availabilityPct = document.getElementById("availabilityPct");
const monitoredServices = document.getElementById("monitoredServices");
const activeProtections = document.getElementById("activeProtections");
const criticalEvents = document.getElementById("criticalEvents");
const freshnessStatus = document.getElementById("freshnessStatus");
const latInternet = document.getElementById("latInternet");
const latInternetState = document.getElementById("latInternetState");
const latDns = document.getElementById("latDns");
const latDnsState = document.getElementById("latDnsState");
const latChatbot = document.getElementById("latChatbot");
const latChatbotState = document.getElementById("latChatbotState");
const latLocal = document.getElementById("latLocal");
const latLocalState = document.getElementById("latLocalState");
const serverUptime = document.getElementById("serverUptime");
const serverBootAt = document.getElementById("serverBootAt");
const guardianLastCheck = document.getElementById("guardianLastCheck");
const guardianFreshness = document.getElementById("guardianFreshness");
const guardianRuntimeState = document.getElementById("guardianRuntimeState");
const pm2Online = document.getElementById("pm2Online");
const pm2Offline = document.getElementById("pm2Offline");
const pm2Total = document.getElementById("pm2Total");
const pm2State = document.getElementById("pm2State");
const pm2Table = document.getElementById("pm2Table");
const pm2Search = document.getElementById("pm2Search");
const pm2Filter = document.getElementById("pm2Filter");
const nodeInternet = document.getElementById("nodeInternet");
const nodeNginx = document.getElementById("nodeNginx");
const nodeMongo = document.getElementById("nodeMongo");
const nodeChatbot = document.getElementById("nodeChatbot");
const nodeXpdcnet = document.getElementById("nodeXpdcnet");
const nodeNexora = document.getElementById("nodeNexora");

async function getJson(url){
  const r = await fetch(url + "?t=" + Date.now(), { cache:"no-store" });
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}



const guardianToastStack = document.getElementById("guardianToastStack");
const guardianAlertAudio = document.getElementById("guardianAlertAudio");

const guardianAlertMemory = new Map();

function playGuardianAlert(){
  if(!guardianAlertAudio) return;

  guardianAlertAudio.currentTime = 0;

  guardianAlertAudio.play().catch(()=>{});
}

function pushGuardianToast(level,title,message){
  if(!guardianToastStack) return;

  const dedupeKey = level + "|" + title + "|" + message;
  const now = Date.now();

  const old = guardianAlertMemory.get(dedupeKey);

  if(old && (now - old) < 15000){
    return;
  }

  guardianAlertMemory.set(dedupeKey, now);

  const toast = document.createElement("div");

  toast.className = `guardian-toast ${level}`;

  toast.innerHTML = `
    <div class="guardian-toast-title">${title}</div>
    <div class="guardian-toast-message">${message}</div>
    <div class="guardian-toast-time">
      ${new Date().toLocaleTimeString("pt-BR")}
    </div>
  `;

  guardianToastStack.prepend(toast);

  if(level === "bad"){
    playGuardianAlert();
  }

  setTimeout(() => {
    toast.style.animation = "guardianToastOut .35s ease forwards";

    setTimeout(() => {
      toast.remove();
    }, 350);
  }, 7000);
}

function runGuardianAlerts(status, health, pm2, latency){
  try{

    const cpu = Number(status?.metrics?.cpu || 0);
    const ram = Number(status?.metrics?.ram || 0);

    if(cpu >= 90){
      pushGuardianToast(
        "bad",
        "🔴 CRITICAL · CPU",
        `Uso de CPU em ${cpu}%`
      );
    }else if(cpu >= 75){
      pushGuardianToast(
        "warn",
        "🟠 WARNING · CPU",
        `CPU elevada em ${cpu}%`
      );
    }

    if(ram >= 90){
      pushGuardianToast(
        "bad",
        "🔴 CRITICAL · RAM",
        `Uso de RAM em ${ram}%`
      );
    }

    for(const [name,v] of Object.entries(health || {})){
      if(v && typeof v === "object" && v.ok === false){
        pushGuardianToast(
          "bad",
          "🔴 SERVIÇO OFFLINE",
          `${name} está offline`
        );
      }
    }

    for(const app of (pm2?.apps || [])){
      if(app.status !== "online"){
        pushGuardianToast(
          "bad",
          "🔴 PM2 OFFLINE",
          `${app.name} saiu do ar`
        );
      }

      if(Number(app.restart || 0) >= 50){
        pushGuardianToast(
          "warn",
          "🟠 RESTART EXCESSIVO",
          `${app.name} reiniciou ${app.restart}x`
        );
      }
    }

    const lat = Number(latency?.internet?.ms || 0);

    if(lat >= 800){
      pushGuardianToast(
        "bad",
        "🔴 LATÊNCIA CRÍTICA",
        `Internet em ${lat}ms`
      );
    }else if(lat >= 300){
      pushGuardianToast(
        "warn",
        "🟠 LATÊNCIA ALTA",
        `Internet em ${lat}ms`
      );
    }

  }catch(e){
    console.error("[guardian_alert_engine]", e);
  }
}


function metricClass(v, warn=75, bad=90){
  v = Number(v || 0);
  if(v >= bad) return "value bad";
  if(v >= warn) return "value warn";
  return "value ok";
}

function pill(ok){
  return ok
    ? '<span class="pill ok">ONLINE</span>'
    : '<span class="pill bad">OFFLINE</span>';
}






function latencyText(ms){
  ms = Number(ms || 0);
  if(ms <= 0) return {label:"Sem resposta", cls:"bad"};
  if(ms <= 100) return {label:"Excelente", cls:"ok"};
  if(ms <= 300) return {label:"Normal", cls:"ok"};
  if(ms <= 800) return {label:"Atenção", cls:"warn"};
  return {label:"Lento", cls:"bad"};
}

function setLatencyValue(valueEl, stateEl, item){
  if(!valueEl || !stateEl) return;

  const ms = Number(item?.ms || 0);
  const state = latencyText(ms);

  valueEl.textContent = ms > 0 ? `${ms} ms` : "-- ms";
  valueEl.className = `latency-ms ${state.cls}`;

  stateEl.textContent = state.label;
  stateEl.className = `latency-state ${state.cls}`;
}




function setInfraNode(el, ok){
  if(!el) return;
  el.classList.remove("bad","warn");
  if(!ok) el.classList.add("bad");
}

function updateInfraMap(health){
  if(!health) return;

  setInfraNode(nodeInternet, !!health.internet?.ok);
  setInfraNode(nodeNginx, !!health.nginx?.ok);
  setInfraNode(nodeMongo, !!health.mongo?.ok);
  setInfraNode(nodeChatbot, !!health.chatbot?.ok);
  setInfraNode(nodeXpdcnet, !!health.xpdcnet?.ok);
  setInfraNode(nodeNexora, !!health.nexora?.ok);
}


function renderPm2(pm2){
  if(!pm2Table) return;

  pm2Online.textContent = pm2?.online ?? 0;
  pm2Offline.textContent = pm2?.offline ?? 0;
  pm2Total.textContent = pm2?.total ?? 0;

  if((pm2?.offline || 0) > 0){
    pm2State.textContent = "Instável";
    pm2State.className = "value bad";
  }else{
    pm2State.textContent = "Operacional";
    pm2State.className = "value ok";
  }

  const query = String(pm2Search?.value || "").toLowerCase().trim();
  const filter = String(pm2Filter?.value || "all");

  let apps = [...(pm2?.apps || [])];

  if(query){
    apps = apps.filter(app => String(app.name || "").toLowerCase().includes(query));
  }

  if(filter === "online"){
    apps = apps.filter(app => app.status === "online");
  }

  if(filter === "offline"){
    apps = apps.filter(app => app.status !== "online");
  }

  if(filter === "restart"){
    apps.sort((a,b) => Number(b.restart || 0) - Number(a.restart || 0));
  }

  if(filter === "memory"){
    apps.sort((a,b) => Number(b.memoryMb || 0) - Number(a.memoryMb || 0));
  }

  pm2Table.innerHTML = "";

  if(!apps.length){
    pm2Table.innerHTML = `<tr><td colspan="5">Nenhuma aplicação encontrada.</td></tr>`;
    return;
  }

  for(const app of apps){
    const tr = document.createElement("tr");

    const restarts = Number(app.restart || 0);

    if(app.status !== "online"){
      tr.className = "pm2-row-bad";
    }else if(restarts >= 50){
      tr.className = "pm2-row-warn";
    }

    const statusClass =
      app.status === "online"
        ? "pill ok"
        : "pill bad";

    tr.innerHTML = `
      <td>${app.name}</td>
      <td><span class="${statusClass}">${app.status}</span></td>
      <td>${app.memoryMb} MB</td>
      <td>${app.cpu}%</td>
      <td>${app.restart}</td>
    `;

    pm2Table.appendChild(tr);
  }
}



let guardianUptimeBaseSeconds = 0;
let guardianUptimeBaseMs = 0;

function formatUptimePtBr(totalSeconds){
  totalSeconds = Math.max(0, Number(totalSeconds || 0));

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [];

  if(days > 0) parts.push(days + " " + (days === 1 ? "dia" : "dias"));
  if(hours > 0) parts.push(hours + " " + (hours === 1 ? "hora" : "horas"));
  if(minutes > 0) parts.push(minutes + " " + (minutes === 1 ? "minuto" : "minutos"));

  parts.push(seconds + " " + (seconds === 1 ? "segundo" : "segundos"));

  return parts.join(", ");
}

function tickGuardianUptime(){
  if(!serverUptime || !guardianUptimeBaseMs) return;

  const elapsed = Math.floor((Date.now() - guardianUptimeBaseMs) / 1000);
  serverUptime.textContent = formatUptimePtBr(guardianUptimeBaseSeconds + elapsed);
}

function updateUptimeCards(uptime){
  if(!serverUptime || !serverBootAt || !guardianLastCheck || !guardianFreshness || !guardianRuntimeState) return;

  serverUptime.textContent = uptime?.pretty || "--";
  serverBootAt.textContent = uptime?.bootAt || "--";
  guardianLastCheck.textContent = uptime?.updatedAt || "--";

  if(uptime?.updatedAt){
    guardianFreshness.textContent = "Ao vivo";
    guardianFreshness.className = "latency-state ok";
    guardianRuntimeState.textContent = "Ativo";
    guardianRuntimeState.className = "latency-ms ok";
  }else{
    guardianFreshness.textContent = "Sem sinal";
    guardianFreshness.className = "latency-state bad";
    guardianRuntimeState.textContent = "Parado";
    guardianRuntimeState.className = "latency-ms bad";
  }
}


function updateLatencyCards(latency){
  if(!latency) return;

  setLatencyValue(latInternet, latInternetState, latency.internet);
  setLatencyValue(latDns, latDnsState, latency.googleDns || latency.cloudflareDns);
  setLatencyValue(latChatbot, latChatbotState, latency.chatbotHttps || latency.guardianLocal);
  setLatencyValue(latLocal, latLocalState, latency.localApi);
}


function updateAvailabilityIndicators(events, health, blockedIps, status){
  if(!availabilityPct || !monitoredServices || !activeProtections || !criticalEvents || !freshnessStatus) return;

  let total = 0;
  let online = 0;

  for(const v of Object.values(health || {})){
    if(v && typeof v === "object" && v.ok !== undefined){
      total++;
      if(v.ok) online++;
    }
  }

  const pct = total ? Math.round((online / total) * 100) : 0;
  const crit = (events || []).filter(e => e.severity === "critical").length;
  const blocks = (blockedIps || []).length;

  availabilityPct.textContent = pct + "%";
  monitoredServices.textContent = total;
  activeProtections.textContent = blocks;
  criticalEvents.textContent = crit;

  availabilityPct.className = pct >= 95 ? "value ok" : pct >= 80 ? "value warn" : "value bad";
  criticalEvents.className = crit > 0 ? "value bad" : "value ok";
  activeProtections.className = blocks > 0 ? "value warn" : "value ok";

  freshnessStatus.textContent = status?.updatedAt ? "Ao vivo" : "Sem sinal";
  freshnessStatus.className = status?.updatedAt ? "value ok" : "value bad";
}



function updateExecutiveSummary(events, health, pm2, latency){
  if(!executiveSummary || !executiveTitle || !executiveSub) return;

  const criticalEvents = (events || []).filter(e => e.severity === "critical").length;
  const offlineApps = Number(pm2?.offline || 0);

  const latencyValues = [];

  for(const key of Object.keys(latency || {})){
    const item = latency[key];
    if(item && typeof item === "object" && item.ms){
      latencyValues.push(Number(item.ms || 0));
    }
  }

  const avgLatency =
    latencyValues.length
      ? Math.round(latencyValues.reduce((a,b)=>a+b,0) / latencyValues.length)
      : 0;

  if(criticalEvents > 0 || offlineApps > 0){
    executiveSummary.classList.add("executive-bad");

    executiveTitle.textContent =
      "Atenção operacional detectada";

    executiveSub.textContent =
      `${offlineApps} aplicações offline, ${criticalEvents} eventos críticos detectados e latência média de ${avgLatency}ms. O Guardian continua monitorando automaticamente a infraestrutura em tempo real.`;

    return;
  }

  executiveSummary.classList.remove("executive-bad");

  executiveTitle.textContent =
    "Operação estável e protegida";

  executiveSub.textContent =
    `${pm2?.online || 0} aplicações online, latência média de ${avgLatency}ms, nenhuma ameaça ativa detectada e monitoramento automático funcionando normalmente.`;
}


function updateOperationStatus(events, health, blockedIps){
  if(!operationStatus || !operationTitle || !operationSub || !operationBadge) return;

  let offline = 0;
  for(const v of Object.values(health || {})){
    if(v && typeof v === "object" && v.ok !== undefined && !v.ok){
      offline++;
    }
  }

  const criticalEvents = (events || []).filter(e => e.severity === "critical").length;
  const blocks = (blockedIps || []).length;

  operationStatus.className = "operation-status";

  if(offline > 0 || criticalEvents > 0){
    operationStatus.classList.add("bad");
    operationTitle.textContent = "Atenção crítica";
    operationSub.textContent = `${offline} serviço(s) com atenção e ${criticalEvents} evento(s) crítico(s) registrados.`;
    operationBadge.textContent = "CRÍTICO";
    return;
  }

  if(blocks > 0){
    operationStatus.classList.add("warn");
    operationTitle.textContent = "Proteção ativa";
    operationSub.textContent = `${blocks} IP(s) bloqueado(s) automaticamente pelo Guardian.`;
    operationBadge.textContent = "PROTEGIDO";
    return;
  }

  operationTitle.textContent = "Operação estável";
  operationSub.textContent = "Todos os sistemas estão funcionando normalmente.";
  operationBadge.textContent = "SAUDÁVEL";
}


function renderSocTimeline(events, health, blockedIps){
  if(!socTimeline) return;

  const items = [];

  const offline = [];
  for(const [name,v] of Object.entries(health || {})){
    if(v && typeof v === "object" && v.ok !== undefined && !v.ok){
      offline.push(name);
    }
  }

  if(offline.length){
    items.push({
      time: new Date().toLocaleTimeString("pt-BR"),
      severity: "critical",
      title: "Serviços offline detectados",
      detail: offline.join(", ")
    });
  }

  if(blockedIps.length){
    items.push({
      time: new Date().toLocaleTimeString("pt-BR"),
      severity: "critical",
      title: "IPs bloqueados pelo Guardian",
      detail: blockedIps.join("\\n")
    });
  }

  for(const e of events.slice(0,8)){
    items.push({
      time: e.time || "--",
      severity: e.severity || "warning",
      title: `${e.type || "EVENTO"} · ${e.action || "observe"}`,
      detail: e.detail || JSON.stringify(e)
    });
  }

  if(!items.length){
    items.push({
      time: new Date().toLocaleTimeString("pt-BR"),
      severity: "ok",
      title: "SOC limpo",
      detail: "Nenhum evento crítico, serviço offline ou bloqueio ativo no momento."
    });
  }

  socTimeline.innerHTML = items.slice(0,10).map(item => {
    const cls = item.severity === "critical" ? "bad" : item.severity === "warning" ? "warn" : "";
    return `
      <div class="timeline-item ${cls}">
        <div class="timeline-time">${item.time}</div>
        <div class="timeline-title">${item.title}</div>
        <div class="timeline-detail">${item.detail}</div>
      </div>
    `;
  }).join("");
}





function setLegend(id, percent, okText, warnText, badText){
  const el = document.getElementById(id);
  if(!el) return;

  const safePercent = Number(percent || 0);

  el.className = "g-legend";

  if(safePercent >= 90){
    el.classList.add("bad");
    el.textContent = badText;
  }else if(safePercent >= 75){
    el.classList.add("warn");
    el.textContent = warnText;
  }else{
    el.textContent = okText;
  }
}

function setGauge(id, percent){
  const el = document.getElementById(id);
  if(!el) return;

  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const safePercent = Math.max(0, Math.min(Number(percent || 0), 100));
  const offset = circumference - (safePercent / 100) * circumference;

  el.style.strokeDasharray = `${circumference}`;
  el.style.strokeDashoffset = `${offset}`;
  el.style.opacity = safePercent <= 0 ? "0.18" : "1";

  el.classList.remove("level-ok","level-warn","level-bad");

  if(safePercent >= 90){
    el.classList.add("level-bad");
  }else if(safePercent >= 75){
    el.classList.add("level-warn");
  }else{
    el.classList.add("level-ok");
  }
}


function drawNocChart(points){
  if(!nocChart || !points.length) return;

  const ctx = nocChart.getContext("2d");
  const w = nocChart.width;
  const h = nocChart.height;

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0,0,w,h);

  function line(key, max){
    ctx.beginPath();
    points.forEach((p,i)=>{
      const x = points.length === 1 ? 0 : (i/(points.length-1))*w;
      const y = h - ((Number(p[key] || 0)/max) * (h-24)) - 12;
      if(i === 0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.stroke();
  }

  ctx.lineWidth = 2;

  ctx.strokeStyle = "#60a5fa";
  line("cpu",100);

  ctx.strokeStyle = "#34d399";
  line("ram",100);

  ctx.strokeStyle = "#fbbf24";
  line("disk",100);

  ctx.fillStyle = "#d1d5db";
  ctx.font = "12px Arial";
  ctx.fillText("CPU azul | RAM verde | DISCO amarelo", 14, 20);
}


function canCleanup(e){
  const t = String(e.type || "");
  return t.includes("PROCESS") || t.includes("MINER") || t.includes("SUSPECT");
}


let guardianRefreshing = false;

async function refreshGuardian(){

  if(guardianRefreshing){
    return;
  }

  guardianRefreshing = true;

  try{
    const status = await getJson("/chatbot-admin/guardian/status.json");
    const health = await getJson("/chatbot-admin/guardian/health.json");
    const events = await getJson("/chatbot-admin/guardian/events.json");
      let metricsHistory = [];
      try{
        metricsHistory = await getJson("/chatbot-admin/guardian/metrics-history.json");
      }catch(_){
        metricsHistory = [];
      }
      let pm2 = {};
        try{
          pm2 = await getJson("/chatbot-admin/guardian/pm2-status.json");
        }catch(_){
          pm2 = {};
        }

        let uptime = {};
        try{
          uptime = await getJson("/chatbot-admin/guardian/uptime.json");
        }catch(_){
          uptime = {};
        }

        let latency = {};
        try{
          latency = await getJson("/chatbot-admin/guardian/latency.json");
        }catch(_){
          latency = {};
        }

        let blockedIps = [];
      try{
        blockedIps = await getJson("/chatbot-admin/guardian/blocked_ips.json");
      }catch(_){
        blockedIps = [];
      }

    const m = status.metrics || {};

      drawNocChart(metricsHistory);
      renderSocTimeline(events, health, blockedIps);
      updateOperationStatus(events, health, blockedIps);
      updateExecutiveSummary(events, health, pm2, latency);
      updateAvailabilityIndicators(events, health, blockedIps, status);
      updateLatencyCards(latency);
      updateUptimeCards(uptime);
      renderPm2(pm2);
      updateInfraMap(health);
        runGuardianAlerts(status, health, pm2, latency);

      if(svcOnline && svcOffline && eventCount && blockCount && lastUpdate){
        let online = 0;
        let offline = 0;

        for(const v of Object.values(health)){
          if(v && typeof v === "object" && v.ok !== undefined){
            if(v.ok) online++;
            else offline++;
          }
        }

        svcOnline.textContent = online;
        svcOffline.textContent = offline;
        eventCount.textContent = events.length;
        blockCount.textContent = blockedIps.length;
        lastUpdate.textContent = status.updatedAt || "--";
      }

    statusBanner.innerHTML = `
      <span class="pill ${status.ok ? "ok":"bad"}">${status.ok ? "🟢 Guardian operacional":"🔴 ameaça detectada"}</span>
      <div style="margin-top:10px;color:#6b7280">Host: ${status.host || "--"}</div>
      <div style="margin-top:6px;color:#6b7280">Atualizado: ${status.updatedAt || "--"}</div>
      <div style="margin-top:12px;font-weight:700">${status.message || ""}</div>
    `;

    cpu.textContent = (m.cpu ?? "--") + "%";
      setGauge("cpuGauge", Number(m.cpu || 0));
    ram.textContent = (m.ram ?? "--") + "%";
      setGauge("ramGauge", Number(m.ram || 0));
    disk.textContent = (m.disk ?? "--") + "%";
      setGauge("diskGauge", Number(m.disk || 0));
    setGauge("loadGauge", Math.min(Number(m.load1 || 0) * 20, 100));
      load.innerHTML = `
        <div class="load-lines">
          <div><strong>${m.load1 ?? "--"}</strong><span>1m</span></div>
          <div><strong>${m.load5 ?? "--"}</strong><span>5m</span></div>
          <div><strong>${m.load15 ?? "--"}</strong><span>15m</span></div>
        </div>
      `;

    cpu.className = "g-value";
    ram.className = "g-value";
    disk.className = "g-value";

    const dockerRawText = health.docker?.raw?.trim() || "";
    dockerStatus.innerHTML = dockerRawText ? '<span class="pill warn">Docker em uso</span>' : '<span class="pill ok">Docker limpo</span>';
    dockerRaw.textContent = dockerRawText || "Nenhum container ativo.";

    const suspicious = status.processesSuspicious || [];

      if(blockedStatus && blockedIpsRaw){
        blockedStatus.innerHTML = blockedIps.length
          ? '<span class="pill bad">IPs bloqueados: ' + blockedIps.length + '</span>'
          : '<span class="pill ok">Nenhum IP bloqueado pelo Guardian</span>';

        blockedIpsRaw.textContent = blockedIps.length
          ? blockedIps.join("\n")
          : "Nenhum IP bloqueado automaticamente ainda.";
      }
    processesRaw.textContent = suspicious.length ? JSON.stringify(suspicious,null,2) : "Nenhum processo suspeito encontrado.";

    const hb = document.getElementById("healthBody");
    if(hb){
      hb.innerHTML = "";
      for(const [k,v] of Object.entries(health)){
        if(typeof v === "object" && v.ok !== undefined){
          hb.innerHTML += `<tr><td>${k}</td><td>${pill(v.ok)}</td></tr>`;
        }
      }
    }

    eventsBody.innerHTML = "";

    if(!events.length){
      eventsBody.innerHTML = `<tr><td colspan="5">Nenhum evento crítico registrado.</td></tr>`;
    }else{
      for(const e of events.slice(0,50)){
        const safeType = String(e.type || "").replace(/'/g, "");

        eventsBody.innerHTML += `
          <tr>
            <td>${e.time || "--"}</td>
            <td>${e.type || "--"}</td>
            <td><span class="pill ${e.severity === "critical" ? "bad":"warn"}">${e.severity || "--"}</span></td>
            <td>${e.action || "--"}</td>
            <td>
              <pre>${JSON.stringify(e,null,2)}</pre>
              ${
                canCleanup(e)
                  ? `<button onclick="cleanupThreat('${safeType}')" style="margin-top:10px;background:#dc2626;color:#fff;border:none;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;">🧹 Limpar ameaça</button>`
                  : ""
              }
            </td>
          </tr>
        `;
      }
    }
  
    }catch(err){

    statusBanner.innerHTML = `<span class="pill bad">Guardian offline</span><div style="margin-top:12px">${err.message}</div>`;
  }
}

refreshGuardian();
setInterval(tickGuardianUptime,1000);
setInterval(refreshGuardian,10000);


if(pm2Search){
  pm2Search.addEventListener("input", refreshGuardian);
}

if(pm2Filter){
  pm2Filter.addEventListener("change", refreshGuardian);
}


if(presentationToggle){
  presentationToggle.addEventListener("click", () => {
    document.body.classList.toggle("presentation-mode");

    presentationToggle.textContent =
      document.body.classList.contains("presentation-mode")
        ? "Sair da apresentação"
        : "Modo apresentação";
  });
}

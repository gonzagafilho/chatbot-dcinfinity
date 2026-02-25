const API = "/api";
let token = localStorage.getItem("TENANT_TOKEN") || "";
let me = null;
let selectedPhone = null;

function setStatus(text, cls = "muted") {
  const el = document.getElementById("status");
  if (!el) return;
  el.className = cls;
  el.textContent = text;
}

function setMsg(id, text, cls = "muted") {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = cls;
  el.textContent = text;
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers["Authorization"] = "Bearer " + token;
  if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";

  const res = await fetch(path.startsWith("http") ? path : (API + path), { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function normalizeText(m) {
  return (m.body ?? m.text ?? "").toString();
}

function normalizeDirection(m) {
  const d = (m.direction || "").toString();
  if (d === "inbound" || d === "outbound" || d === "system") return d;
  return "system";
}

function badgeClassFromStatus(status) {
  const s = (status || "").toLowerCase();
  if (s === "em_atendimento") return "ok";
  if (s === "handoff") return "warn";
  if (s === "resolvido") return "info";
  return "bad"; // "novo" e qualquer outro
}

function shortPhoneLabel(phone) {
  // pode ajustar depois se quiser mostrar "web_teste999" ao invés de "web:web_teste999"
  return (phone || "");
}

async function loadMe() {
  const r = await api("/tenant/me");
  if (!r.ok || !r.data?.ok) return false;

  me = r.data.user;

  setStatus(`Logado: ${me.email} (${me.role}) - tenant: ${me.tenant}`, "ok");

  const loginCard = document.getElementById("loginCard");
  const app = document.getElementById("app");
  if (loginCard) loginCard.style.display = "none";
  if (app) app.style.display = "";

  return true;
}

async function loadLeads() {
  const statusEl = document.getElementById("filterStatus");
  const qEl = document.getElementById("q");

  const status = statusEl ? statusEl.value : "";
  const q = qEl ? qEl.value.trim() : "";

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (q) qs.set("q", q);

  const r = await api("/tenant/leads" + (qs.toString() ? ("?" + qs.toString()) : ""));
  if (!r.ok || !r.data?.ok) {
    setMsg("actionMsg", "Erro ao carregar leads", "err");
    return;
  }

  const box = document.getElementById("leads");
  if (!box) return;

  box.innerHTML = "";

  (r.data.leads || []).forEach((l) => {
    const div = document.createElement("div");
    div.className = "lead" + (l.phone === selectedPhone ? " active" : "");
    div.onclick = () => selectLead(l.phone, l);

    const badgeClass = badgeClassFromStatus(l.status);

    div.innerHTML = `
      <div class="titleRow">
        <div class="title">${shortPhoneLabel(l.phone)}</div>
        <span class="badge ${badgeClass}">${l.status || "-"}</span>
      </div>
      <div class="small" style="margin-top:6px">${(l.lastMessage || "").slice(0, 90)}</div>
      <div class="small" style="margin-top:6px">Dono: ${l.assignedToEmail || "-"}</div>
    `;

    box.appendChild(div);
  });
}

async function selectLead(phone, lead) {
  selectedPhone = phone;

  const leadTitle = document.getElementById("leadTitle");
  const leadMeta = document.getElementById("leadMeta");

  if (leadTitle) leadTitle.textContent = phone;

  if (leadMeta) {
    const updatedAt = lead.updatedAt ? new Date(lead.updatedAt).toLocaleString() : "-";
    leadMeta.textContent = `status=${lead.status} | dono=${lead.assignedToEmail || "-"} | updatedAt=${updatedAt}`;
  }

  await loadMessages();
  await loadLeads(); // marca o active no card
}

async function loadMessages() {
  if (!selectedPhone) return;

  const r = await api("/tenant/messages?phone=" + encodeURIComponent(selectedPhone));
  if (!r.ok || !r.data?.ok) {
    setMsg("actionMsg", "Erro ao carregar mensagens", "err");
    return;
  }

  const chat = document.getElementById("chat");
  if (!chat) return;

  chat.innerHTML = "";

  (r.data.messages || []).forEach((m) => {
    const d = normalizeDirection(m);
    const div = document.createElement("div");
    div.className = "msg " + d;

    const when = m.createdAt ? new Date(m.createdAt).toLocaleString() : "-";

    div.innerHTML = `
      <div class="meta">${(m.origin || "")} • ${d} • ${when}</div>
      <div>${normalizeText(m).replace(/\n/g, "<br>")}</div>
    `;

    chat.appendChild(div);
  });

  chat.scrollTop = chat.scrollHeight;
}

async function take() {
  if (!selectedPhone) {
    setMsg("actionMsg", "Selecione um lead", "err");
    return;
  }

  const r = await api("/tenant/lead/assign", {
    method: "POST",
    body: JSON.stringify({ phone: selectedPhone, mode: "take" }),
  });

  if (!r.ok || !r.data?.ok) {
    setMsg(
      "actionMsg",
      r.data?.error ? `${r.data.error} (dono: ${r.data.assignedToEmail || "-"})` : "Erro",
      "err"
    );
    return;
  }

  setMsg("actionMsg", "Assumido com sucesso", "ok");
  await loadLeads();
  await loadMessages();
}

async function release() {
  if (!selectedPhone) {
    setMsg("actionMsg", "Selecione um lead", "err");
    return;
  }

  const r = await api("/tenant/lead/assign", {
    method: "POST",
    body: JSON.stringify({ phone: selectedPhone, mode: "release" }),
  });

  if (!r.ok || !r.data?.ok) {
    setMsg(
      "actionMsg",
      r.data?.error ? `${r.data.error} (dono: ${r.data.assignedToEmail || "-"})` : "Erro",
      "err"
    );
    return;
  }

  setMsg("actionMsg", "Liberado com sucesso", "ok");
  await loadLeads();
  await loadMessages();
}

async function send() {
  // seu HTML pode estar usando id="text" (pelo index que você mostrou)
  const input = document.getElementById("text") || document.getElementById("msg");
  const text = (input ? input.value : "").trim();

  if (!selectedPhone) {
    setMsg("actionMsg", "Selecione um lead", "err");
    return;
  }
  if (!text) {
    setMsg("actionMsg", "Digite uma mensagem", "err");
    return;
  }

  const r = await api("/tenant/send", {
    method: "POST",
    body: JSON.stringify({ phone: selectedPhone, message: text }),
  });

  if (!r.ok || !r.data?.ok) {
    setMsg(
      "actionMsg",
      r.data?.error ? `${r.data.error} (dono: ${r.data.assignedToEmail || "-"})` : "Erro",
      "err"
    );
    return;
  }

  if (input) input.value = "";
  setMsg("actionMsg", "Enviado", "ok");
  await loadLeads();
  await loadMessages();
}

/* ======= EVENTOS ======= */

const btnLogin = document.getElementById("btnLogin");
if (btnLogin) {
  btnLogin.onclick = async () => {
    const tenant = (document.getElementById("tenant")?.value || "").trim();
    const email = (document.getElementById("email")?.value || "").trim();
    const password = document.getElementById("password")?.value || "";

    setMsg("loginMsg", "Entrando...", "muted");

    const r = await api("/tenant/login", {
      method: "POST",
      body: JSON.stringify({ tenant, email, password }),
    });

    if (!r.ok || !r.data?.ok) {
      setMsg("loginMsg", r.data?.error || "Erro no login", "err");
      return;
    }

    token = r.data.token;
    localStorage.setItem("TENANT_TOKEN", token);
    setMsg("loginMsg", "OK", "ok");

    await loadMe();
    await loadLeads();
  };
}

document.getElementById("btnRefresh")?.addEventListener("click", loadLeads);
document.getElementById("btnTake")?.addEventListener("click", take);
document.getElementById("btnRelease")?.addEventListener("click", release);
document.getElementById("btnSend")?.addEventListener("click", send);

document.getElementById("btnLogout")?.addEventListener("click", () => {
  localStorage.removeItem("TENANT_TOKEN");
  token = "";
  location.reload();
});

/* ======= INIT ======= */
(async () => {
  if (token) {
    const ok = await loadMe();
    if (ok) await loadLeads();
  }
})();
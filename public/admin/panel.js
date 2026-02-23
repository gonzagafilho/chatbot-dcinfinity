(function () {
  const API_BASE = location.origin; // https://chatbot.dcinfinity.net.br

  const els = {};
  function qs(id) { return document.getElementById(id); }

  function setText(el, text, cls) {
    el.textContent = text || "";
    el.className = cls ? cls : "muted";
  }

  function getToken() {
    return localStorage.getItem("dcinf_admin_token") || "";
  }

  function setToken(token) {
    localStorage.setItem("dcinf_admin_token", token || "");
  }

  async function api(path, { method = "GET", body } = {}) {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString("pt-BR");
    } catch {
      return iso || "";
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function login(email, password) {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: { email, password },
    });
    if (!data?.token) throw new Error("token não retornou");
    setToken(data.token);
    return data;
  }

  async function loadLeads() {
    const tenant = els.tenant.value.trim();
    const limit = Number(els.limit.value || 50);

    setText(els.leadsStatus, "Carregando...");
    els.leadsTbody.innerHTML = "";

    const data = await api(`/api/admin/leads?tenant=${encodeURIComponent(tenant)}&limit=${encodeURIComponent(Math.min(limit,200))}`);
    const rows = data?.data || [];

    if (!rows.length) {
      setText(els.leadsStatus, "Nenhum lead.", "muted");
      return;
    }

    setText(els.leadsStatus, `${rows.length} lead(s)`, "ok");

    for (const r of rows) {
      const sessionId = (r.phone || "").startsWith("web:") ? r.phone.slice(4) : r.phone; // normaliza
      const tr = document.createElement("tr");
      tr.className = "click";
      tr.innerHTML = `
        <td>${escapeHtml(fmtDate(r.updatedAt || r.createdAt))}</td>
        <td><span class="pill">${escapeHtml(r.tenant || "")}</span></td>
        <td>${escapeHtml(sessionId)}</td>
        <td>${escapeHtml(r.status || "")}</td>
        <td>${escapeHtml((r.lastMessage || "").slice(0, 120))}</td>
      `;
      tr.addEventListener("click", () => openConversation(sessionId, r.tenant || tenant));
      els.leadsTbody.appendChild(tr);
    }
  }

  async function openConversation(sessionId, tenant) {
    els.convBox.style.display = "block";
    els.convTitle.textContent = `Session: ${sessionId} | Tenant: ${tenant}`;
    els.convMsgs.innerHTML = "Carregando mensagens...";

    const data = await api(`/api/admin/conversations/${encodeURIComponent(sessionId)}?tenant=${encodeURIComponent(tenant)}`);
    const msgs = data?.data || [];

    if (!msgs.length) {
      els.convMsgs.innerHTML = "<div class='muted'>Sem mensagens.</div>";
      return;
    }

    els.convMsgs.innerHTML = msgs.map((m) => {
      const who = m.direction === "inbound" ? "Cliente" : "Bot";
      const txt = escapeHtml(m.text || "");
      const dt = escapeHtml(fmtDate(m.createdAt));
      return `
        <div style="margin:10px 0;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04)">
          <div class="muted">${who} • ${dt}</div>
          <div style="margin-top:6px;white-space:pre-wrap">${txt}</div>
        </div>
      `;
    }).join("");

    els.convMsgs.scrollTop = els.convMsgs.scrollHeight;
  }

  function init() {
    els.email = qs("email");
    els.password = qs("password");
    els.loginForm = qs("loginForm");
    els.loginStatus = qs("loginStatus");

    els.tenant = qs("tenant");
    els.limit = qs("limit");
    els.btnLoadLeads = qs("btnLoadLeads");
    els.leadsStatus = qs("leadsStatus");
    els.leadsTbody = qs("leadsTbody");

    els.convBox = qs("convBox");
    els.convTitle = qs("convTitle");
    els.convMsgs = qs("convMsgs");

    // eventos
    els.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setText(els.loginStatus, "Entrando...");
      try {
        const email = els.email.value.trim();
        const password = els.password.value;
        await login(email, password);
        setText(els.loginStatus, "Logado ✅", "ok");
      } catch (err) {
        setToken("");
        setText(els.loginStatus, `Erro: ${err.message}`, "err");
      }
    });

    els.btnLoadLeads.addEventListener("click", async () => {
      try {
        await loadLeads();
      } catch (err) {
        setText(els.leadsStatus, `Erro: ${err.message}`, "err");
      }
    });

    // se já tem token salvo
    if (getToken()) setText(els.loginStatus, "Token carregado (localStorage)", "ok");
  }

  document.addEventListener("DOMContentLoaded", init);
})();

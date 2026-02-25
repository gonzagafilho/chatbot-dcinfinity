(function () {
  const API_BASE = location.origin;

  const els = {};
  function qs(id) { return document.getElementById(id); }

  function setText(el, text, cls) {
    if (!el) return;
    el.textContent = text || "";
    el.className = cls ? cls : "muted";
  }

  function getToken() {
    return localStorage.getItem("dcinf_admin_token") || "";
  }

  function setToken(token) {
    if (!token) localStorage.removeItem("dcinf_admin_token");
    else localStorage.setItem("dcinf_admin_token", token);
  }

  let loginInFlight = false;

  // paginação
  let pageSkip = 0;
  let lastPage = { total: 0, limit: 20, skip: 0, hasMore: false };

  // conversa atual
  let current = { tenant: "", sessionId: "", lead: null };

  // quem está logado
  let me = { sub: "", email: "", role: "" };

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
      const err = new Error(msg);
      err.payload = data;
      throw err;
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

  function setLoggedUI(isLogged) {
    els.email.disabled = isLogged;
    els.password.disabled = isLogged;
    els.btnLogin.disabled = isLogged;
    els.btnLogout.style.display = isLogged ? "inline-block" : "none";
    if (isLogged) els.password.value = "********";
  }

  function setSendUIEnabled(enabled, reasonText) {
    if (!els.btnSend || !els.replyText) return;
    els.btnSend.disabled = !enabled;
    els.replyText.disabled = !enabled;
    if (!enabled && reasonText) setText(els.sendStatus, reasonText, "muted");
  }

  async function loadMe() {
    if (!getToken()) return;
    try {
      const data = await api("/api/admin/me");
      me = data?.admin || me;
    } catch {
      // se token inválido, limpa
      me = { sub: "", email: "", role: "" };
    }
  }

  async function login(email, password) {
    if (loginInFlight) return;
    loginInFlight = true;
    els.btnLogin.disabled = true;

    setText(els.loginStatus, "Entrando...");
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: { email, password },
      });

      if (!data?.token) throw new Error("token não retornou");
      setToken(data.token);

      await loadMe();

      setText(els.loginStatus, "Logado ✅", "ok");
      setLoggedUI(true);
    } catch (err) {
      setToken("");
      setLoggedUI(false);
      setText(els.loginStatus, `Erro: ${err.message}`, "err");
    } finally {
      loginInFlight = false;
      els.btnLogin.disabled = false;
    }
  }

  function logout() {
    setToken("");
    me = { sub: "", email: "", role: "" };
    setText(els.loginStatus, "Deslogado", "muted");
    els.password.value = "";
    setLoggedUI(false);

    setText(els.leadsStatus, "");
    if (els.pageInfo) els.pageInfo.textContent = "";
    if (els.leadsTbody) els.leadsTbody.innerHTML = "";
    if (els.convBox) els.convBox.style.display = "none";
  }

  async function loadLeads() {
    const tenant = (els.tenant?.value || "").trim();
    const limit = Number(els.limit?.value || 20);
    const status = (els.status?.value || "").trim();
    const q = (els.q?.value || "").trim();

    if (!getToken()) {
      setText(els.leadsStatus, "Faça login primeiro.", "err");
      return;
    }
    if (!tenant) {
      setText(els.leadsStatus, "Selecione o tenant.", "err");
      return;
    }

    setText(els.leadsStatus, "Carregando...");
    els.leadsTbody.innerHTML = "";

    const params = new URLSearchParams();
    params.set("tenant", tenant);
    params.set("limit", String(Math.min(limit, 200)));
    params.set("skip", String(pageSkip));
    if (status) params.set("status", status);
    if (q) params.set("q", q);

    const data = await api(`/api/admin/leads?${params.toString()}`);
    const rows = data?.data || [];
    lastPage = data?.page || { total: 0, limit, skip: pageSkip, hasMore: false };

    const shownFrom = lastPage.total ? (lastPage.skip + 1) : 0;
    const shownTo = lastPage.skip + rows.length;
    if (els.pageInfo) els.pageInfo.textContent = `Mostrando ${shownFrom}-${shownTo} de ${lastPage.total}`;

    if (els.btnPrev) els.btnPrev.disabled = pageSkip <= 0;
    if (els.btnNext) els.btnNext.disabled = !lastPage.hasMore;

    if (!rows.length) {
      setText(els.leadsStatus, "Nenhum lead.", "muted");
      return;
    }

    setText(els.leadsStatus, `${rows.length} lead(s)`, "ok");

    for (const r of rows) {
      const sessionId = (r.phone || "").startsWith("web:") ? r.phone.slice(4) : r.phone;

      const tr = document.createElement("tr");
      tr.className = "click";
      tr.innerHTML = `
        <td>${escapeHtml(fmtDate(r.updatedAt || r.createdAt))}</td>
        <td><span class="pill">${escapeHtml(r.tenant || "")}</span></td>
        <td>${escapeHtml(sessionId)}</td>
        <td>${escapeHtml(r.status || "")}</td>
        <td>${escapeHtml((r.lastMessage || "").slice(0, 120))}</td>
      `;
      tr.addEventListener("click", () => openConversation(sessionId, r.tenant || tenant, r));
      els.leadsTbody.appendChild(tr);
    }
  }

  function renderOwnerInfo(lead) {
    if (!els.ownerInfo) return;
    const owner = lead?.assignedToEmail || "";
    if (!owner) {
      els.ownerInfo.textContent = "Atendente: (livre) — clique em Assumir para atender.";
      return;
    }
    els.ownerInfo.textContent = `Atendente: ${owner}`;
  }

  function updateControlsByOwner(lead) {
    const ownerId = lead?.assignedTo || "";
    const ownerEmail = lead?.assignedToEmail || "";
    const isOwner = ownerId && me?.sub && ownerId === me.sub;
    const isFree = !ownerId;
    const isSuper = String(me?.role || "").toUpperCase() === "SUPERADMIN";

    // botões status
    if (els.btnAssumir) els.btnAssumir.style.display = (isFree || isSuper) ? "inline-block" : "none";
    if (els.btnLiberar) els.btnLiberar.style.display = (isOwner || isSuper) && !isFree ? "inline-block" : "none";

    // enviar
    if (isOwner || isSuper) {
      setSendUIEnabled(true);
    } else {
      if (isFree) setSendUIEnabled(false, "Assuma o lead para enviar mensagem.");
      else setSendUIEnabled(false, `Bloqueado: em atendimento por ${ownerEmail || "outro atendente"}.`);
    }

    // finalizar/resolvido só dono/super
    if (els.btnFinalizar) els.btnFinalizar.disabled = !(isOwner || isSuper);
    if (els.btnHandoff) els.btnHandoff.disabled = !(isOwner || isSuper);
  }

  async function openConversation(sessionId, tenant, leadObj) {
    current = { tenant, sessionId, lead: leadObj || null };

    els.convBox.style.display = "block";
    els.convTitle.textContent = `Session: ${sessionId} | Tenant: ${tenant}`;
    els.convMsgs.innerHTML = "Carregando mensagens...";

    if (els.sendStatus) els.sendStatus.textContent = "";
    if (els.statusStatus) els.statusStatus.textContent = "";
    if (els.replyText) els.replyText.value = "";

    renderOwnerInfo(current.lead);
    updateControlsByOwner(current.lead);

    const data = await api(`/api/admin/conversations/${encodeURIComponent(sessionId)}?tenant=${encodeURIComponent(tenant)}`);
    const msgs = data?.data || [];

    if (!msgs.length) {
      els.convMsgs.innerHTML = "<div class='muted'>Sem mensagens.</div>";
      return;
    }

    els.convMsgs.innerHTML = msgs.map((m) => {
      const direction = m.direction || "";
      const who =
        direction === "inbound" ? "Cliente" :
        direction === "outbound" ? "Atendente/Bot" :
        direction === "system" ? "Sistema" : "Mensagem";

      const txt = escapeHtml(m.body || m.text || "");
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

  async function setLeadStatus(newStatus) {
    try {
      if (!getToken()) {
        setText(els.statusStatus, "Faça login primeiro.", "err");
        return;
      }
      if (!current.sessionId || !current.tenant) {
        setText(els.statusStatus, "Abra uma conversa primeiro.", "err");
        return;
      }

      // trava
      els.btnAssumir.disabled = true;
      els.btnLiberar.disabled = true;
      els.btnFinalizar.disabled = true;
      els.btnHandoff.disabled = true;

      setText(els.statusStatus, "Atualizando status...");

      await api("/api/admin/lead/status", {
        method: "POST",
        body: {
          tenant: current.tenant,
          sessionId: current.sessionId,
          status: newStatus,
        },
      });

      setText(els.statusStatus, `Status atualizado: ${newStatus} ✅`, "ok");
      await loadLeads();
    } catch (err) {
      setText(els.statusStatus, `Erro: ${err.message}`, "err");
    } finally {
      els.btnAssumir.disabled = false;
      els.btnLiberar.disabled = false;
      els.btnFinalizar.disabled = false;
      els.btnHandoff.disabled = false;
    }
  }

  async function assign(mode) {
    try {
      if (!getToken()) return setText(els.statusStatus, "Faça login primeiro.", "err");
      if (!current.sessionId || !current.tenant) return setText(els.statusStatus, "Abra uma conversa primeiro.", "err");

      setText(els.statusStatus, mode === "take" ? "Assumindo..." : "Liberando...");

      const r = await api("/api/admin/lead/assign", {
        method: "POST",
        body: { tenant: current.tenant, sessionId: current.sessionId, mode },
      });

      current.lead = r?.data || current.lead;

      renderOwnerInfo(current.lead);
      updateControlsByOwner(current.lead);

      setText(els.statusStatus, mode === "take" ? "Assumido ✅" : "Liberado ✅", "ok");

      await loadLeads();
    } catch (err) {
      if (err.message === "lead_already_assigned") {
        const who = err?.payload?.assignedToEmail || "outro atendente";
        setText(els.statusStatus, `Já está em atendimento por: ${who}`, "err");
      } else {
        setText(els.statusStatus, `Erro: ${err.message}`, "err");
      }
    }
  }

  function init() {
    els.email = qs("email");
    els.password = qs("password");
    els.loginForm = qs("loginForm");
    els.loginStatus = qs("loginStatus");
    els.btnLogin = qs("btnLogin");
    els.btnLogout = qs("btnLogout");

    els.tenant = qs("tenant");
    els.limit = qs("limit");
    els.status = qs("status");
    els.q = qs("q");

    els.btnLoadLeads = qs("btnLoadLeads");
    els.leadsStatus = qs("leadsStatus");
    els.leadsTbody = qs("leadsTbody");

    els.btnPrev = qs("btnPrev");
    els.btnNext = qs("btnNext");
    els.pageInfo = qs("pageInfo");

    els.convBox = qs("convBox");
    els.convTitle = qs("convTitle");
    els.ownerInfo = qs("ownerInfo");
    els.convMsgs = qs("convMsgs");

    // status buttons (conv)
    els.btnAssumir = qs("btnAssumir");
    els.btnLiberar = qs("btnLiberar");
    els.btnFinalizar = qs("btnFinalizar");
    els.btnHandoff = qs("btnHandoff");
    els.statusStatus = qs("statusStatus");

    // send box
    els.replyText = qs("replyText");
    els.btnSend = qs("btnSend");
    els.sendStatus = qs("sendStatus");

    // login
    els.loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (loginInFlight) return;

      const email = els.email.value.trim();
      const password = els.password.value;

      if (!email || !password) {
        setText(els.loginStatus, "Informe email e senha.", "err");
        return;
      }
      await login(email, password);
    });

    els.btnLogout.addEventListener("click", () => logout());

    // leads
    els.btnLoadLeads.addEventListener("click", async () => {
      try {
        pageSkip = 0;
        await loadLeads();
      } catch (err) {
        setText(els.leadsStatus, `Erro: ${err.message}`, "err");
      }
    });

    // pagination
    els.btnPrev.addEventListener("click", async () => {
      try {
        const step = Number(els.limit.value || 20);
        pageSkip = Math.max(0, pageSkip - step);
        await loadLeads();
      } catch (err) {
        setText(els.leadsStatus, `Erro: ${err.message}`, "err");
      }
    });

    els.btnNext.addEventListener("click", async () => {
      try {
        if (!lastPage.hasMore) return;
        const step = Number(els.limit.value || 20);
        pageSkip = pageSkip + step;
        await loadLeads();
      } catch (err) {
        setText(els.leadsStatus, `Erro: ${err.message}`, "err");
      }
    });

    if (els.status) els.status.addEventListener("change", () => { pageSkip = 0; });
    if (els.q) els.q.addEventListener("keyup", () => { pageSkip = 0; });
    if (els.tenant) els.tenant.addEventListener("change", () => { pageSkip = 0; });

    // assign/controls
    els.btnAssumir.addEventListener("click", () => assign("take"));
    els.btnLiberar.addEventListener("click", () => assign("release"));

    els.btnFinalizar.addEventListener("click", () => setLeadStatus("resolvido"));
    els.btnHandoff.addEventListener("click", () => setLeadStatus("handoff"));

    // send
    els.btnSend.addEventListener("click", async () => {
      try {
        if (!getToken()) return setText(els.sendStatus, "Faça login primeiro.", "err");
        if (!current.sessionId || !current.tenant) return setText(els.sendStatus, "Abra uma conversa primeiro.", "err");

        const text = (els.replyText.value || "").trim();
        if (!text) return setText(els.sendStatus, "Digite uma mensagem.", "err");

        els.btnSend.disabled = true;
        setText(els.sendStatus, "Enviando...");

        await api("/api/admin/send", {
          method: "POST",
          body: { tenant: current.tenant, sessionId: current.sessionId, text },
        });

        setText(els.sendStatus, "Enviado ✅", "ok");
        els.replyText.value = "";

        await openConversation(current.sessionId, current.tenant, current.lead);
        await loadLeads();
      } catch (err) {
        if (err.message === "not_assigned_to_you") {
          const who = err?.payload?.assignedToEmail || "outro atendente";
          setText(els.sendStatus, `Bloqueado: em atendimento por ${who}`, "err");
        } else {
          setText(els.sendStatus, `Erro: ${err.message}`, "err");
        }
      } finally {
        els.btnSend.disabled = false;
      }
    });

    // init state
    if (getToken()) {
      setText(els.loginStatus, "Token carregado (localStorage) ✅", "ok");
      setLoggedUI(true);
      loadMe();
    } else {
      setLoggedUI(false);
    }

    // default: disable send until a conversation opens and owner rules apply
    setSendUIEnabled(false, "Abra uma conversa para responder.");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
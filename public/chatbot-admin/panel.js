(function () {
  const API = location.origin;
  const TOKEN_KEY = "dcinf_chatbot_content_token";

  function qs(id) {
    return document.getElementById(id);
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(t) {
    if (!t) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, t);
  }

  async function api(path, opts) {
    const headers = { "Content-Type": "application/json" };
    const tok = getToken();
    if (tok) headers.Authorization = "Bearer " + tok;
    const res = await fetch(API + path, {
      method: opts?.method || "GET",
      headers,
      body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      const err = new Error(data.error || "HTTP_" + res.status);
      err.data = data;
      throw err;
    }
    return data;
  }

  function setText(el, text, cls) {
    if (!el) return;
    el.textContent = text || "";
    el.className = cls || "muted";
  }

  function setSidebarVisible(visible) {
    var sidebar = qs("sidebar");
    if (!sidebar) return;
    sidebar.hidden = !visible;
  }

  function setDashboardStatus(text, kind) {
    var el = qs("dashboardStatus");
    var dot = qs("dashboardDot");
    if (el) el.textContent = text || "";
    if (!dot) return;
    dot.classList.remove("is-ok", "is-warn", "is-err");
    if (kind === "ok") dot.classList.add("is-ok");
    else if (kind === "warn") dot.classList.add("is-warn");
    else if (kind === "err") dot.classList.add("is-err");
  }

  var MB_CONFIRM = "CONFIRMAR ENVIO DC NET";
  var mbPreviewOk = false;
  var mbPollTimer = null;
  var mbActiveJobId = "";

  function getBroadcastBase() {
    var aud = document.querySelector('input[name="mb_audience"]:checked');
    var r = (qs("mb_return") && qs("mb_return").value.trim()) || "";
    return {
      tenant: (qs("tenant") && qs("tenant").value.trim()) || "dcnet",
      title: (qs("mb_title") && qs("mb_title").value.trim()) || "",
      message: (qs("mb_message") && qs("mb_message").value.trim()) || "",
      returnText: r,
      expectedReturn: r,
      audience: aud ? aud.value : "all",
    };
  }

  function setMbResult(obj) {
    var pre = qs("mb_result");
    if (!pre) return;
    try {
      pre.textContent = JSON.stringify(obj, null, 2);
    } catch (e) {
      pre.textContent = String(obj);
    }
  }

  function invalidateMbPreview() {
    mbPreviewOk = false;
    updateMbCreateState();
  }

  function updateMbCreateState() {
    var btn = qs("btnMbCreate");
    var h = qs("mb_createHint");
    if (!btn) return;
    var phraseOk = qs("mb_confirm") && qs("mb_confirm").value.trim() === MB_CONFIRM;
    var aware = qs("mb_ciente") && qs("mb_ciente").checked;
    btn.disabled = !mbPreviewOk || !phraseOk || !aware;
    if (h) {
      h.textContent = btn.disabled
        ? "Habilite o botão: 1) Prévia OK 2) Frase exata 3) Estou ciente"
        : "Pode criar o lote (a API confirma horário comercial e frase de segurança).";
    }
  }

  function clearMbJobPoll() {
    if (mbPollTimer) {
      clearInterval(mbPollTimer);
      mbPollTimer = null;
    }
  }

  function mbIsTerminalStatus(st) {
    return st === "completed" || st === "canceled" || st === "failed";
  }

  function showJobCard() {
    if (qs("mb_jobCard")) qs("mb_jobCard").style.display = "block";
  }

  function applyJobToUI(job) {
    if (!job) return;
    if (qs("mb_jobId")) qs("mb_jobId").textContent = job.id || "—";
    if (qs("mb_jobStatus")) qs("mb_jobStatus").textContent = job.status || "—";
    if (qs("mb_c_total")) qs("mb_c_total").textContent = String(job.totalQueued != null ? job.totalQueued : 0);
    if (qs("mb_c_sent")) qs("mb_c_sent").textContent = String(job.totalSent != null ? job.totalSent : 0);
    if (qs("mb_c_fail")) qs("mb_c_fail").textContent = String(job.totalFailed != null ? job.totalFailed : 0);
    if (qs("mb_c_pend")) qs("mb_c_pend").textContent = String(job.pending != null ? job.pending : 0);
    if (qs("mb_jobLogs")) {
      var logs = job.logs || [];
      qs("mb_jobLogs").textContent = logs.length ? JSON.stringify(logs, null, 2) : "(nenhum log ainda)";
    }
    if (mbIsTerminalStatus(job.status)) {
      clearMbJobPoll();
    }
  }

  function startMbJobPoll(jobId) {
    if (!jobId) return;
    clearMbJobPoll();
    mbActiveJobId = jobId;
    showJobCard();
    var tick = function () {
      if (!getToken() || !mbActiveJobId) {
        clearMbJobPoll();
        return;
      }
      api("/api/chatbot-admin/maintenance-broadcast/jobs/" + encodeURIComponent(mbActiveJobId))
        .then(function (data) {
          if (data && data.job) applyJobToUI(data.job);
        })
        .catch(function () {
          /* ignore */
        });
    };
    tick();
    mbPollTimer = setInterval(tick, 2500);
  }

  function maintenanceBroadcastPreview() {
    invalidateMbPreview();
    setMbResult({ status: "prévia…" });
    var b = getBroadcastBase();
    api("/api/chatbot-admin/maintenance-broadcast/preview", { method: "POST", body: b })
      .then(function (data) {
        setMbResult(data);
        if (data && data.ok) {
          mbPreviewOk = true;
        }
        updateMbCreateState();
      })
      .catch(function (e) {
        setMbResult({ ok: false, error: e.message || String(e) });
        updateMbCreateState();
      });
  }

  function maintenanceBroadcastTest() {
    setMbResult({ status: "teste (1 envio)…" });
    var b = getBroadcastBase();
    var body = Object.assign({}, b, { testPhone: (qs("mb_testPhone") && qs("mb_testPhone").value.trim()) || "" });
    api("/api/chatbot-admin/maintenance-broadcast/test", { method: "POST", body: body })
      .then(function (data) {
        setMbResult(data);
      })
      .catch(function (e) {
        setMbResult({ ok: false, error: e.message || String(e) });
      });
  }

  function maintenanceCreateBatch() {
    if (!mbPreviewOk) {
      setMbResult({ error: "Faça a prévia primeiro (1 — Preparar envio)." });
      return;
    }
    if (qs("mb_confirm").value.trim() !== MB_CONFIRM) {
      setMbResult({ error: "Frase de confirmação incorreta." });
      return;
    }
    if (!qs("mb_ciente").checked) {
      setMbResult({ error: "Marque Estou ciente." });
      return;
    }
    if (!window.confirm("Confirma a criação de um lote de envio real, enfileirado (taxa do servidor)?")) return;
    if (!window.confirm("Confirmação final: a mensagem será entregue aos números da BeesWeb conforme público selecionado.")) {
      return;
    }
    var b = getBroadcastBase();
    var body = Object.assign({}, b, {
      confirmPhrase: MB_CONFIRM,
      previewAccepted: true,
      allowOutsideBusinessHours: !!(qs("mb_outside") && qs("mb_outside").checked),
    });
    setMbResult({ status: "criando lote…" });
    api("/api/chatbot-admin/maintenance-broadcast/create", { method: "POST", body: body })
      .then(function (data) {
        setMbResult(data);
        if (data && data.jobId) {
          startMbJobPoll(String(data.jobId));
        }
      })
      .catch(function (e) {
        setMbResult({ ok: false, error: e.message || String(e), data: (e && e.data) || undefined });
      });
  }

  function mbAction(path) {
    if (!mbActiveJobId) return;
    return api(
      "/api/chatbot-admin/maintenance-broadcast/jobs/" + encodeURIComponent(mbActiveJobId) + path,
      { method: "POST", body: {} }
    );
  }

  function switchTab(tabId) {
    var nav = document.querySelectorAll(".sidebar-link[data-tab]");
    var panels = document.querySelectorAll(".tab-panel");
    nav.forEach(function (btn) {
      var active = btn.getAttribute("data-tab") === tabId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach(function (panel) {
      var active = panel.id === "tab-" + tabId;
      panel.classList.toggle("is-active", active);
      if (active) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "hidden");
    });
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    var c = cfg.campaigns || {};
    qs("c_aniversarioImage").value = c.aniversarioImage || "";
    qs("c_pascoaImage").value = c.pascoaImage || "";
    qs("c_diaDasMaesImage").value = c.diaDasMaesImage || "";
    qs("c_diaDosPaisImage").value = c.diaDosPaisImage || "";
    qs("c_natalImage").value = c.natalImage || "";
    qs("c_anoNovoImage").value = c.anoNovoImage || "";

    var t = cfg.campaignTexts || {};
    qs("t_aniversarioText").value = t.aniversarioText || "";

    var a = cfg.campaignActive || {};
    qs("a_aniversario").checked = a.aniversario !== false;

    var o = cfg.operationalMessages || {};
    qs("o_maintenanceMessage").value = o.maintenanceMessage || "";
    qs("o_instabilityMessage").value = o.instabilityMessage || "";
    qs("o_expectedReturnMessage").value = o.expectedReturnMessage || "";
    qs("o_shortAlertMessage").value = o.shortAlertMessage || "";

    var m = cfg.maintenance || {};
    qs("m_active").checked = !!m.active;
    qs("m_title").value = m.title || "";
    qs("m_body").value = m.body || "";
    qs("m_eta").value = m.eta ? String(m.eta) : "";

    document.querySelectorAll("img.preview").forEach(function (img) {
      var id = img.getAttribute("data-for");
      var inp = id ? qs(id) : null;
      if (!inp || !inp.value.trim()) {
        img.classList.remove("show");
        img.removeAttribute("src");
        return;
      }
      img.src = inp.value.trim();
      img.classList.add("show");
    });
  }

  function collectPatch() {
    return {
      campaigns: {
        aniversarioImage: qs("c_aniversarioImage").value.trim(),
        pascoaImage: qs("c_pascoaImage").value.trim(),
        diaDasMaesImage: qs("c_diaDasMaesImage").value.trim(),
        diaDosPaisImage: qs("c_diaDosPaisImage").value.trim(),
        natalImage: qs("c_natalImage").value.trim(),
        anoNovoImage: qs("c_anoNovoImage").value.trim(),
      },
      campaignTexts: {
        aniversarioText: qs("t_aniversarioText").value.trim(),
      },
      campaignActive: {
        aniversario: qs("a_aniversario").checked,
      },
      operationalMessages: {
        maintenanceMessage: qs("o_maintenanceMessage").value.trim(),
        instabilityMessage: qs("o_instabilityMessage").value.trim(),
        expectedReturnMessage: qs("o_expectedReturnMessage").value.trim(),
        shortAlertMessage: qs("o_shortAlertMessage").value.trim(),
      },
      maintenance: {
        active: qs("m_active").checked,
        title: qs("m_title").value.trim(),
        body: qs("m_body").value.trim(),
        eta: qs("m_eta").value.trim() ? qs("m_eta").value.trim() : null,
      },
    };
  }

  async function login() {
    setText(qs("loginStatus"), "Entrando...", "muted");
    try {
      var data = await api("/api/admin/login", {
        method: "POST",
        body: {
          email: qs("email").value.trim(),
          password: qs("password").value,
        },
      });
      if (!data.token) throw new Error("sem_token");
      setToken(data.token);
      await api("/api/chatbot-admin/me");
      setText(qs("loginStatus"), "Autenticado.", "ok");
      qs("password").value = "";
      qs("loginCard").style.display = "none";
      qs("editorCard").style.display = "block";
      setSidebarVisible(true);
      if (qs("btnLogout")) qs("btnLogout").style.display = "inline-block";
    } catch (e) {
      setToken("");
      setText(qs("loginStatus"), "Erro: " + (e.message || e), "err");
    }
  }

  function logout() {
    clearMbJobPoll();
    mbActiveJobId = "";
    setToken("");
    qs("editorCard").style.display = "none";
    setSidebarVisible(false);
    qs("loginCard").style.display = "block";
    if (qs("btnLogout")) qs("btnLogout").style.display = "none";
    setText(qs("loginStatus"), "Desconectado.", "muted");
    switchTab("dashboard");
  }

  async function loadConfig() {
    setText(qs("saveStatus"), "Carregando...", "muted");
    setDashboardStatus("Carregando configuração…", "warn");
    try {
      var tenant = qs("tenant").value.trim() || "dcnet";
      var data = await api("/api/chatbot-admin/config?tenant=" + encodeURIComponent(tenant));
      applyConfig(data.config);
      setText(qs("saveStatus"), "Config carregada.", "ok");
      setDashboardStatus("Configuração carregada com sucesso.", "ok");
    } catch (e) {
      setText(qs("saveStatus"), "Erro: " + (e.message || e), "err");
      setDashboardStatus("Erro ao carregar: " + (e.message || e), "err");
    }
  }

  async function save() {
    setText(qs("saveStatus"), "Salvando...", "muted");
    setDashboardStatus("Salvando alterações…", "warn");
    try {
      var tenant = qs("tenant").value.trim() || "dcnet";
      var patch = collectPatch();
      patch.tenant = tenant;
      var data = await api("/api/chatbot-admin/config", { method: "PATCH", body: patch });
      applyConfig(data.config);
      setText(qs("saveStatus"), "Salvo com sucesso", "ok");
      setDashboardStatus("Salvo com sucesso. Alterações aplicadas.", "ok");
    } catch (e) {
      setText(qs("saveStatus"), "Erro: " + (e.message || e), "err");
      setDashboardStatus("Erro ao salvar: " + (e.message || e), "err");
    }
  }

  function wirePreviews() {
    ["c_aniversarioImage", "c_pascoaImage", "c_diaDasMaesImage", "c_diaDosPaisImage", "c_natalImage", "c_anoNovoImage"].forEach(
      function (id) {
        var el = qs(id);
        if (!el) return;
        el.addEventListener("blur", function () {
          var img = document.querySelector('img.preview[data-for="' + id + '"]');
          if (!img) return;
          var v = el.value.trim();
          if (!v) {
            img.classList.remove("show");
            img.removeAttribute("src");
            return;
          }
          img.src = v;
          img.classList.add("show");
        });
      }
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    qs("btnLogin").addEventListener("click", login);
    qs("btnLogout").addEventListener("click", logout);
    qs("btnLoad").addEventListener("click", loadConfig);
    qs("btnSave").addEventListener("click", save);
    wirePreviews();

    document.querySelectorAll(".sidebar-link[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-tab");
        if (id) switchTab(id);
      });
    });

    if (qs("btnMbPreview")) qs("btnMbPreview").addEventListener("click", maintenanceBroadcastPreview);
    if (qs("btnMbTest")) qs("btnMbTest").addEventListener("click", maintenanceBroadcastTest);
    if (qs("btnMbCreate")) qs("btnMbCreate").addEventListener("click", maintenanceCreateBatch);
    if (qs("mb_confirm")) qs("mb_confirm").addEventListener("input", updateMbCreateState);
    if (qs("mb_ciente")) qs("mb_ciente").addEventListener("change", updateMbCreateState);
    if (qs("btnMbPause")) {
      qs("btnMbPause").addEventListener("click", function () {
        mbAction("/pause")
          .then(function (d) {
            if (d && d.job) applyJobToUI(d.job);
            setMbResult(d);
          })
          .catch(function (e) {
            setMbResult({ ok: false, error: e.message || String(e) });
          });
      });
    }
    if (qs("btnMbResume")) {
      qs("btnMbResume").addEventListener("click", function () {
        mbAction("/resume")
          .then(function (d) {
            if (d && d.job) applyJobToUI(d.job);
            setMbResult(d);
          })
          .catch(function (e) {
            setMbResult({ ok: false, error: e.message || String(e) });
          });
      });
    }
    if (qs("btnMbCancel")) {
      qs("btnMbCancel").addEventListener("click", function () {
        if (!window.confirm("Cancela o lote? Envios ainda enfileirados deixarão de processar (próximos ciclos).")) {
          return;
        }
        mbAction("/cancel")
          .then(function (d) {
            if (d && d.job) applyJobToUI(d.job);
            setMbResult(d);
          })
          .catch(function (e) {
            setMbResult({ ok: false, error: e.message || String(e) });
          });
      });
    }
    var mbInvalEls = ["mb_title", "mb_message", "mb_return", "tenant"];
    mbInvalEls.forEach(function (id) {
      if (qs(id)) qs(id).addEventListener("input", invalidateMbPreview);
      if (qs(id)) qs(id).addEventListener("change", invalidateMbPreview);
    });
    document.querySelectorAll('input[name="mb_audience"]').forEach(function (r) {
      r.addEventListener("change", invalidateMbPreview);
    });
    updateMbCreateState();

    if (getToken()) {
      api("/api/chatbot-admin/me")
        .then(function () {
          qs("loginCard").style.display = "none";
          qs("editorCard").style.display = "block";
          setSidebarVisible(true);
          if (qs("btnLogout")) qs("btnLogout").style.display = "inline-block";
          setText(qs("loginStatus"), "Sessão restaurada.", "ok");
          return loadConfig();
        })
        .catch(function () {
          setToken("");
        });
    }
  });
})();

let waHistoryPollTimer = null;
let conversationsPollTimer = null;
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
      const err = new Error(data.message || data.error || "HTTP_" + res.status);
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function apiForm(path, form, method) {
    const tok = getToken();
    const headers = tok ? { Authorization: "Bearer " + tok } : {};
    const res = await fetch(API + path, { method: method || "POST", headers, body: form });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const err = new Error(data.message || data.error || "HTTP_" + res.status);
      err.data = data;
      err.status = res.status;
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

  function initMobileMenu() {
    var btn = qs("mobileMenuBtn");
    var sidebar = qs("sidebar");
    if (!btn || !sidebar) return;

    function openMenu() {
      sidebar.hidden = false;
      sidebar.classList.add("is-open");
      document.body.classList.add("mobile-menu-open");
      btn.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
      sidebar.classList.remove("is-open");
      document.body.classList.remove("mobile-menu-open");
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();

      if (sidebar.hidden || !sidebar.classList.contains("is-open")) {
        openMenu();
      } else {
        closeMenu();
      }
    });

    document.addEventListener("click", function (ev) {
      if (!document.body.classList.contains("mobile-menu-open")) return;
      if (sidebar.contains(ev.target)) return;
      if (btn.contains(ev.target)) return;
      closeMenu();
    });

    document.querySelectorAll(".sidebar-link").forEach(function (link) {
      link.addEventListener("click", function () {
        closeMenu();
      });
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 768) {
        sidebar.classList.remove("is-open");
        document.body.classList.remove("mobile-menu-open");
        btn.setAttribute("aria-expanded", "false");
      }
    });
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
  var metaTemplates = [];
  var metaSelectedTemplate = null;
  var waHistoryRows = [];
  var waHistoryPage = 1;
  var waHistoryHasMore = false;
  var conversationRows = [];
  var conversationOperators = [];
  var conversationDashboard = null;
  var currentAdmin = null;
  var conversationSelectedPhone = "";
  var conversationUserOpened = false;
  var conversationSelectedLead = null;
  var conversationAvailableTags = ["Comercial", "Financeiro", "Suporte", "Instalação", "Cobertura", "Campanha", "Urgente", "Favorito"];
  var conversationActiveFilter = "all";
  var conversationContextPhone = "";
  var conversationLongPressTimer = null;
  var conversationTemplateTargetMessage = null;
  var conversationSelectedTemplateId = "";
  var conversationTemplateResults = {};
  var conversationMetaDetailsById = {};
  var conversationKnownLastIds = {};
  var conversationNewPhones = new Set();
  var conversationLastMessages = [];
  var conversationReplyTarget = null;
  var conversationAttachment = null;
  var conversationThreadSearch = "";
  var conversationSoundEnabled = localStorage.getItem("dcnet_conversation_sound") !== "off";
  var conversationNotifyEnabled = localStorage.getItem("dcnet_conversation_notify") === "on";
  var conversationAudioReady = false;
  var _googleMap = null;
  var _googleMarker = null;
  var _googleCircle = null;
  var _googleStoreMarker = null;
  var _coverageMapFormListenersBound = false;
  var _coverageMapButtonsBound = false;
  var _googleMapLoadTimeout = null;
  var loginInFlight = false;

  const DCNET_STORE_LAT = -15.603549953007636;
  const DCNET_STORE_LNG = -47.680468257463;
  const DEFAULT_COVERAGE_RADIUS = 2500;

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

  function parseTemplateVariables() {
    var raw = (qs("mb_bodyVariables") && qs("mb_bodyVariables").value) || "";
    return raw.split(/\r?\n|,/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function applyTemplateDefaultsFrom131047(data, imageUrl) {
    if (!data || data.metaCode !== 131047) return;
    if (qs("mb_headerImageUrl") && !qs("mb_headerImageUrl").value.trim()) {
      qs("mb_headerImageUrl").value = (data.templateDefaults && data.templateDefaults.headerImageUrl) || imageUrl || "";
    }
    if (qs("mb_languageCode") && !qs("mb_languageCode").value.trim()) {
      qs("mb_languageCode").value = (data.templateDefaults && data.templateDefaults.languageCode) || "pt_BR";
    }
    if (qs("mb_bodyVariables") && !qs("mb_bodyVariables").value.trim()) {
      var vars = (data.templateDefaults && data.templateDefaults.bodyVariables) || [];
      qs("mb_bodyVariables").value = Array.isArray(vars) ? vars.join("\n") : "";
    }
    var btn = qs("btnMbTemplateTest");
    if (btn) {
      btn.classList.add("is-primary");
      btn.focus();
    }
  }

  function maintenanceBroadcastTemplateTest() {
    var btn = qs("btnMbTemplateTest");
    if (btn) btn.disabled = true;

    setMbResult({ status: "enviando via Template Meta…" });

    var b = getBroadcastBase();
    var body = Object.assign({}, b, {
      testPhone: (qs("mb_testPhone") && qs("mb_testPhone").value.trim()) || "",
      templateName: (qs("mb_templateName") && qs("mb_templateName").value.trim()) || "",
      languageCode: (qs("mb_languageCode") && qs("mb_languageCode").value.trim()) || "pt_BR",
      headerImageUrl: (qs("mb_headerImageUrl") && qs("mb_headerImageUrl").value.trim()) || "",
      bodyVariables: parseTemplateVariables(),
    });

    api("/api/chatbot-admin/maintenance-broadcast/test-template", { method: "POST", body: body })
      .then(function (data) {
        setMbResult(data);
      })
      .catch(function (e) {
        setMbResult(e.data || { ok: false, error: e.message || String(e) });
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function maintenanceBroadcastTest() {
    var btn = qs("btnMbTest");
    if (btn) btn.disabled = true;

    setMbResult({ status: "teste (1 envio)…" });

    var b = getBroadcastBase();

    var imageUrl =
      (qs("mb_imageUrl") && qs("mb_imageUrl").value.trim()) ||
      (qs("campaignImageGeneratedUrl") && qs("campaignImageGeneratedUrl").value.trim()) ||
      "";

    var body = Object.assign({}, b, {
      testPhone: (qs("mb_testPhone") && qs("mb_testPhone").value.trim()) || "",
      imageUrl: imageUrl,
    });

    api("/api/chatbot-admin/maintenance-broadcast/test", { method: "POST", body: body })
      .then(function (data) {
        setMbResult(data);
      })
      .catch(function (e) {
        var data = e.data || { ok: false, error: e.message || String(e) };
        if (data.metaCode === 131047) {
          data.message = data.message || "Este número está fora da janela de atendimento de 24h da Meta. Use um Template Meta aprovado.";
          data.action = "Abra Meta WhatsApp > Templates, escolha um template aprovado e envie pela Central Meta.";
          applyTemplateDefaultsFrom131047(data, imageUrl);
        }
        setMbResult(data);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
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

  function buildFlyerPlanLink(speed) {
    const base = "https://wa.me/5561996627145?text=";
    return base + encodeURIComponent("Quero contratar o plano de " + speed + " Mega");
  }

  function copyTextToClipboard(text, successMessage) {
    if (!text) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(function () {
          alert(successMessage || "Copiado!");
        })
        .catch(function () {
          fallbackCopyText(text, successMessage);
        });
      return;
    }

    fallbackCopyText(text, successMessage);
  }

  function fallbackCopyText(text, successMessage) {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.setAttribute("readonly", "");
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
    alert(successMessage || "Copiado!");
  }

  function initDigitalFlyerLinks() {
    const plans = [
      { speed: "350", price: "R$78,99", input: "flyerLink350", copy: "btnCopyFlyer350", open: "btnOpenFlyer350" },
      { speed: "400", price: "R$88,99", input: "flyerLink400", copy: "btnCopyFlyer400", open: "btnOpenFlyer400" },
      { speed: "500", price: "R$98,99", input: "flyerLink500", copy: "btnCopyFlyer500", open: "btnOpenFlyer500" },
      { speed: "600", price: "R$119,99", input: "flyerLink600", copy: "btnCopyFlyer600", open: "btnOpenFlyer600" },
    ];

    plans.forEach(function (plan) {
      const link = buildFlyerPlanLink(plan.speed);
      const input = qs(plan.input);
      const copyBtn = qs(plan.copy);
      const openBtn = qs(plan.open);

      if (input) input.value = link;

      if (copyBtn) {
        copyBtn.addEventListener("click", function () {
          copyTextToClipboard(link, "Link do plano " + plan.speed + " Mega copiado!");
        });
      }

      if (openBtn) {
        openBtn.addEventListener("click", function () {
          window.open(link, "_blank", "noopener,noreferrer");
        });
      }
    });

    const caption = qs("flyerCaptionText");
    if (caption) {
      caption.value =
        "🚀 DC NET — Internet fibra óptica\n\n" +
        "Escolha seu plano e consulte cobertura pelo WhatsApp:\n\n" +
        "🔥 350 Mega — R$78,99\n" +
        buildFlyerPlanLink("350") +
        "\n\n" +
        "🔥 400 Mega — R$88,99\n" +
        buildFlyerPlanLink("400") +
        "\n\n" +
        "🔥 500 Mega — R$98,99\n" +
        buildFlyerPlanLink("500") +
        "\n\n" +
        "🔥 600 Mega — R$119,99\n" +
        buildFlyerPlanLink("600") +
        "\n\n" +
        "📍 Clique no plano desejado e consulte disponibilidade.";
    }

    const btnCopyCaption = qs("btnCopyFlyerCaption");
    if (btnCopyCaption && caption) {
      btnCopyCaption.addEventListener("click", function () {
        copyTextToClipboard(caption.value, "Legenda do panfleto copiada!");
      });
    }
  }

  function getCoverageTenant() {
    return (qs("tenant") && qs("tenant").value && String(qs("tenant").value).trim()) || "dcnet";
  }

  function isValidLatLng(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }

  function setCoverageMapMessage(text, type) {
    var el = qs("coverageMapMessage");
    if (!el) return;
    if ((text == null || String(text) === "") && (type == null || type === "")) {
      el.textContent = "";
      el.className = "coverage-map-message";
      return;
    }
    el.textContent = text != null ? String(text) : "";
    el.className = "coverage-map-message";
    if (type === "ok") {
      el.classList.add("coverage-map-message--ok");
    } else if (type === "err") {
      el.classList.add("coverage-map-message--err");
    } else if (type === "info") {
      el.classList.add("coverage-map-message--info");
    }
  }

  function centerCoverageMap(lat, lng, zoom) {
    if (!_googleMap || !window.google || !google.maps) return;
    var z = zoom != null && zoom !== "" ? Number(zoom) : 16;
    if (!Number.isFinite(z)) {
      z = 16;
    }
    _googleMap.setCenter({ lat: Number(lat), lng: Number(lng) });
    _googleMap.setZoom(z);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setCoverageMapMessage(
        "Não foi possível obter sua localização. Autorize a localização no navegador ou preencha manualmente.",
        "err"
      );
      return;
    }
    setCoverageMapMessage("Obtendo localização…", "info");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var la = pos.coords.latitude;
        var lo = pos.coords.longitude;
        if (!qs("coverageLat") || !qs("coverageLng")) return;
        if (!setCoveragePoint(la, lo)) {
          return;
        }
        if (_googleMap) {
          _googleMap.setCenter({ lat: la, lng: lo });
          _googleMap.setZoom(16);
        }
        setCoverageMapMessage("Localização recebida. Ajuste o raio e salve, se desejar.", "ok");
      },
      function () {
        setCoverageMapMessage(
          "Não foi possível obter sua localização. Autorize a localização no navegador ou preencha manualmente.",
          "err"
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function bindCoverageMapButtons() {
    if (_coverageMapButtonsBound) return;
    _coverageMapButtonsBound = true;
    if (qs("btnUseMyLocation")) {
      qs("btnUseMyLocation").addEventListener("click", useMyLocation);
    }
    if (qs("btnCenterDcnetStore")) {
      qs("btnCenterDcnetStore").addEventListener("click", function () {
        if (!_googleMap) {
          setCoverageMapMessage("Mapa indisponível. Preencha latitude, longitude e raio manualmente.", "err");
          return;
        }
        _googleMap.setCenter({ lat: DCNET_STORE_LAT, lng: DCNET_STORE_LNG });
        _googleMap.setZoom(16);
        setCoverageMapMessage("Mapa centralizado na Loja DC NET.", "ok");
      });
    }
  }

  function setCoveragePoint(lat, lng) {
    if (!qs("coverageLat") || !qs("coverageLng")) return false;
    var la = Number(lat);
    var lo = Number(lng);
    if (!isValidLatLng(la, lo)) {
      setCoverageMapMessage(
        "Coordenadas inválidas. Clique dentro do mapa ou use valores válidos.",
        "err"
      );
      return false;
    }
    qs("coverageLat").value = String(la.toFixed(6));
    qs("coverageLng").value = String(lo.toFixed(6));
    setCoverageMapMessage("", null);
    if (_googleMap) {
      var pos = { lat: la, lng: lo };
      var r = parseInt((qs("coverageRadius") && qs("coverageRadius").value) || "0", 10);
      if (!Number.isFinite(r) || r < 1) {
        r = DEFAULT_COVERAGE_RADIUS;
      }
      if (!_googleMarker) {
        _googleMarker = new window.google.maps.Marker({
          position: pos,
          map: _googleMap,
          title: "Centro da área de cobertura",
          draggable: true,
        });
        _googleMarker.addListener("dragend", function () {
          var p = _googleMarker.getPosition();
          if (p) setCoveragePoint(p.lat(), p.lng());
        });
      } else {
        _googleMarker.setPosition(pos);
      }
      if (!_googleCircle) {
        _googleCircle = new window.google.maps.Circle({
          map: _googleMap,
          center: pos,
          radius: r,
          fillColor: "#2563eb",
          fillOpacity: 0.2,
          strokeColor: "#2563eb",
          strokeOpacity: 0.8,
        });
      } else {
        _googleCircle.setCenter(pos);
        _googleCircle.setRadius(r);
      }
      _googleMap.setCenter(pos);
    }
    return true;
  }

  function onCoverageMapLoadFailed() {
    if (_googleMapLoadTimeout) {
      clearTimeout(_googleMapLoadTimeout);
      _googleMapLoadTimeout = null;
    }
    if (qs("coverageMapFallback")) qs("coverageMapFallback").hidden = false;
    if (qs("coverageMap")) qs("coverageMap").classList.add("is-hidden");
    setCoverageMapMessage(
      "Mapa indisponível. Preencha latitude, longitude e raio manualmente, ou confira a chave da API Google Maps.",
      "err"
    );
  }

  function initCoverageMap() {
    if (!qs("coverageMap")) return;
    if (qs("coverageMap")) qs("coverageMap").classList.remove("is-hidden");
    if (qs("coverageMapActions")) qs("coverageMapActions").removeAttribute("hidden");
    if (qs("coverageMapFallback")) qs("coverageMapFallback").hidden = true;
    if (qs("coverageLat") && !String(qs("coverageLat").value).trim()) {
      qs("coverageLat").value = String(DCNET_STORE_LAT);
    }
    if (qs("coverageLng") && !String(qs("coverageLng").value).trim()) {
      qs("coverageLng").value = String(DCNET_STORE_LNG);
    }
    if (qs("coverageRadius") && !String(qs("coverageRadius").value).trim()) {
      qs("coverageRadius").value = String(DEFAULT_COVERAGE_RADIUS);
    }
    var initLat = parseFloat((qs("coverageLat") && qs("coverageLat").value) || "");
    var initLng = parseFloat((qs("coverageLng") && qs("coverageLng").value) || "");
    if (!isValidLatLng(initLat, initLng)) {
      if (qs("coverageLat")) qs("coverageLat").value = String(DCNET_STORE_LAT);
      if (qs("coverageLng")) qs("coverageLng").value = String(DCNET_STORE_LNG);
    }
    if (!_coverageMapFormListenersBound) {
      _coverageMapFormListenersBound = true;
      if (qs("coverageRadius")) {
        qs("coverageRadius").addEventListener("input", function () {
          if (_googleMap && _googleCircle) {
            var rad = parseInt((qs("coverageRadius") && qs("coverageRadius").value) || "0", 10);
            if (!Number.isFinite(rad) || rad < 1) {
              rad = DEFAULT_COVERAGE_RADIUS;
            }
            _googleCircle.setRadius(rad);
          }
        });
      }
      ["coverageLat", "coverageLng"].forEach(function (id) {
        var el = qs(id);
        if (el) {
          el.addEventListener("change", function () {
            var clat = parseFloat((qs("coverageLat") && qs("coverageLat").value) || "");
            var clng = parseFloat((qs("coverageLng") && qs("coverageLng").value) || "");
            if (isValidLatLng(clat, clng)) {
              setCoveragePoint(clat, clng);
            }
          });
        }
      });
    }
    bindCoverageMapButtons();
    if (typeof window.google !== "undefined" && window.google && window.google.maps && !_googleMap) {
      try {
        if (typeof window.initGoogleCoverageMap === "function") {
          window.initGoogleCoverageMap();
        }
      } catch (eInit) {
        onCoverageMapLoadFailed();
      }
    }
    if (_googleMapLoadTimeout) {
      clearTimeout(_googleMapLoadTimeout);
    }
    _googleMapLoadTimeout = setTimeout(function () {
      _googleMapLoadTimeout = null;
      if (!_googleMap) {
        onCoverageMapLoadFailed();
      }
    }, 15000);
  }

  window.initGoogleCoverageMap = function initGoogleCoverageMap() {
    if (typeof window.google === "undefined" || !window.google || !window.google.maps) {
      onCoverageMapLoadFailed();
      return;
    }
    if (_googleMap) {
      try {
        if (window.google && google.maps) {
          google.maps.event.trigger(_googleMap, "resize");
        }
      } catch (e) {
        /* ignore */
      }
      var la0 = parseFloat((qs("coverageLat") && qs("coverageLat").value) || "");
      var lo0 = parseFloat((qs("coverageLng") && qs("coverageLng").value) || "");
      var r0 = parseInt((qs("coverageRadius") && qs("coverageRadius").value) || "0", 10);
      if (!Number.isFinite(r0) || r0 < 1) {
        r0 = DEFAULT_COVERAGE_RADIUS;
      }
      if (isValidLatLng(la0, lo0) && _googleMarker && _googleCircle) {
        var p0 = { lat: la0, lng: lo0 };
        _googleMarker.setPosition(p0);
        _googleCircle.setCenter(p0);
        _googleCircle.setRadius(r0);
      }
      return;
    }
    var el = document.getElementById("coverageMap");
    if (!el) {
      onCoverageMapLoadFailed();
      return;
    }
    if (_googleMapLoadTimeout) {
      clearTimeout(_googleMapLoadTimeout);
      _googleMapLoadTimeout = null;
    }
    try {
      var center = { lat: DCNET_STORE_LAT, lng: DCNET_STORE_LNG };
      _googleMap = new google.maps.Map(el, {
        center: center,
        zoom: 16,
        mapTypeId: "roadmap",
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });
      if (qs("coverageMapFallback")) qs("coverageMapFallback").hidden = true;
      if (qs("coverageMap")) qs("coverageMap").classList.remove("is-hidden");
      if (_googleStoreMarker) {
        _googleStoreMarker.setMap(null);
        _googleStoreMarker = null;
      }
      _googleStoreMarker = new google.maps.Marker({
        position: center,
        map: _googleMap,
        title: "Loja DC NET",
      });
      _googleMap.addListener("click", function (event) {
        if (!event || !event.latLng) return;
        setCoveragePoint(event.latLng.lat(), event.latLng.lng());
      });
      setTimeout(function () {
        if (_googleMap && window.google) {
          google.maps.event.trigger(_googleMap, "resize");
        }
      }, 200);
      var la = parseFloat((qs("coverageLat") && qs("coverageLat").value) || "");
      var lo = parseFloat((qs("coverageLng") && qs("coverageLng").value) || "");
      if (isValidLatLng(la, lo)) {
        setCoveragePoint(la, lo);
      } else {
        setCoveragePoint(DCNET_STORE_LAT, DCNET_STORE_LNG);
      }
      setCoverageMapMessage("Mapa Google carregado com sucesso.", "ok");
    } catch (e) {
      onCoverageMapLoadFailed();
    }
  };

  function clearCoverageFormForNew() {
    if (qs("coverageEditId")) qs("coverageEditId").value = "";
    if (qs("coverageName")) qs("coverageName").value = "";
    if (qs("coverageNotes")) qs("coverageNotes").value = "";
    if (qs("coverageActive")) qs("coverageActive").checked = true;
  }

  function escapeHtmlCoverage(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function deactiveCoverageArea(id) {
    if (!id || !window.confirm("Desativar esta área de cobertura?")) return;
    var t = getCoverageTenant();
    api(
      "/api/chatbot-admin/coverage-areas/" + encodeURIComponent(id) + "?tenant=" + encodeURIComponent(t),
      { method: "DELETE" }
    )
      .then(function () {
        alert("Área desativada.");
        if (qs("coverageEditId") && qs("coverageEditId").value === id) {
          clearCoverageFormForNew();
        }
        loadCoverageAreas();
      })
      .catch(function (e) {
        alert("Erro: " + (e.message || e));
      });
  }

  function renderCoverageAreas(areas) {
    var box = qs("coverageAreasList");
    if (!box) return;
    if (!areas || !areas.length) {
      box.textContent = "Nenhuma área cadastrada ainda para este tenant.";
      return;
    }
    var html = "";
    for (var i = 0; i < areas.length; i++) {
      var a = areas[i];
      var id = a._id || a.id;
      var active = a.active !== false;
      html += '<div class="coverage-area-item" data-coverage-id="' + String(id) + '">';
      html += "<div><strong>" + escapeHtmlCoverage(a.name || "(sem nome)") + "</strong> ";
      html += active ? '<span class="ok">(ativo)</span>' : '<span class="err">(inativo)</span></div>';
      html +=
        "<div class=\"muted\" style=\"font-size:12px;margin-top:2px\">" +
        Number(a.centerLat).toFixed(5) +
        ", " +
        Number(a.centerLng).toFixed(5) +
        " — " +
        String(a.radiusMeters) +
        " m</div>";
      if (a.notes) {
        html += '<div class="muted" style="font-size:12px">' + escapeHtmlCoverage(a.notes) + "</div>";
      }
      html += '<div class="digital-flyer-actions" style="margin-top:6px">';
      html += '<button type="button" class="btn2 btn-cov-edit" data-cid="' + String(id) + '">Editar</button>';
      if (active) {
        html += '<button type="button" class="btn2 btn-cov-deact" data-cid="' + String(id) + '">Desativar</button>';
      }
      html += "</div></div>";
    }
    box.innerHTML = html;
    box.querySelectorAll(".btn-cov-edit").forEach(function (b) {
      b.addEventListener("click", function () {
        var cid = b.getAttribute("data-cid");
        for (var j = 0; j < areas.length; j++) {
          if (String(areas[j]._id) === String(cid)) {
            var a = areas[j];
            if (qs("coverageEditId")) qs("coverageEditId").value = String(a._id);
            if (qs("coverageName")) qs("coverageName").value = a.name || "";
            if (qs("coverageLat")) qs("coverageLat").value = String(a.centerLat);
            if (qs("coverageLng")) qs("coverageLng").value = String(a.centerLng);
            if (qs("coverageRadius")) qs("coverageRadius").value = String(a.radiusMeters);
            if (qs("coverageNotes")) qs("coverageNotes").value = a.notes || "";
            if (qs("coverageActive")) qs("coverageActive").checked = a.active !== false;
            if (_googleMap) {
              setCoveragePoint(a.centerLat, a.centerLng);
            }
            break;
          }
        }
      });
    });
    box.querySelectorAll(".btn-cov-deact").forEach(function (b) {
      b.addEventListener("click", function () {
        deactiveCoverageArea(b.getAttribute("data-cid"));
      });
    });
  }

  function loadCoverageAreas() {
    if (!getToken() || !qs("coverageAreasList")) return;
    var t = getCoverageTenant();
    qs("coverageAreasList").textContent = "Carregando…";
    api("/api/chatbot-admin/coverage-areas?tenant=" + encodeURIComponent(t))
      .then(function (d) {
        if (d && d.areas) renderCoverageAreas(d.areas);
        else if (d && d.ok) renderCoverageAreas([]);
      })
      .catch(function (e) {
        if (qs("coverageAreasList")) {
          qs("coverageAreasList").textContent = "Erro: " + (e.message || e);
        }
      });
  }

  function saveCoverageArea() {
    if (!getToken()) {
      alert("Faça login para salvar.");
      return;
    }
    var t = getCoverageTenant();
    var name = (qs("coverageName") && qs("coverageName").value.trim()) || "";
    var lat = parseFloat((qs("coverageLat") && qs("coverageLat").value) || "");
    var lng = parseFloat((qs("coverageLng") && qs("coverageLng").value) || "");
    var r = parseInt((qs("coverageRadius") && qs("coverageRadius").value) || "0", 10);
    var active = qs("coverageActive") && qs("coverageActive").checked;
    var notes = (qs("coverageNotes") && qs("coverageNotes").value) || "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      alert("Latitude e longitude inválidas.");
      return;
    }
    if (!Number.isFinite(r) || r < 1) {
      alert("Raio inválido (mín. 1 metro).");
      return;
    }
    var eid = (qs("coverageEditId") && String(qs("coverageEditId").value).trim()) || "";
    if (eid) {
      api("/api/chatbot-admin/coverage-areas/" + encodeURIComponent(eid), {
        method: "PATCH",
        body: {
          tenant: t,
          name: name,
          centerLat: lat,
          centerLng: lng,
          radiusMeters: r,
          active: active,
          notes: notes,
        },
      })
        .then(function () {
          alert("Área atualizada.");
          clearCoverageFormForNew();
          loadCoverageAreas();
        })
        .catch(function (e) {
          alert("Erro: " + (e.message || e));
        });
    } else {
      api("/api/chatbot-admin/coverage-areas", {
        method: "POST",
        body: {
          tenant: t,
          name: name,
          centerLat: lat,
          centerLng: lng,
          radiusMeters: r,
          active: active,
          notes: notes,
        },
      })
        .then(function () {
          alert("Área salva.");
          clearCoverageFormForNew();
          loadCoverageAreas();
        })
        .catch(function (e) {
          alert("Erro: " + (e.message || e));
        });
    }
  }


  function metaTenant() {
    return (qs("tenant") && qs("tenant").value.trim()) || "dcnet";
  }

  function metaEscape(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function metaDate(v) {
    if (!v) return "-";
    try { return new Date(v).toLocaleString("pt-BR"); } catch (e) { return "-"; }
  }

  function setMetaResult(obj) {
    var el = qs("metaSendResult");
    if (!el) return;
    try { el.textContent = JSON.stringify(obj, null, 2); }
    catch (e) { el.textContent = String(obj); }
  }

  function metaTemplatePreview(tpl) {
    var body = "";
    (tpl.components || []).forEach(function (c) {
      if (String(c.type || "").toUpperCase() === "BODY") body = c.text || body;
    });
    return body || "Sem prévia de texto no cache local.";
  }

  function renderMetaTemplates(list) {
    metaTemplates = Array.isArray(list) ? list : [];
    var fav = qs("metaFavorites");
    var table = qs("metaTemplatesTable");
    if (fav) {
      var favorites = metaTemplates.filter(function (t) { return t.isFavorite; }).slice(0, 8);
      fav.innerHTML = favorites.length ? favorites.map(function (t) {
        return '<button type="button" class="btn2" data-meta-send="' + metaEscape(t.id) + '">' + metaEscape(t.favoriteLabel || t.name) + '</button>';
      }).join("") : '<span class="muted">Nenhum favorito detectado ainda.</span>';
    }
    if (!table) return;
    if (!metaTemplates.length) {
      table.innerHTML = '<p class="muted">Nenhum template sincronizado. Clique em Sincronizar Templates.</p>';
      return;
    }
    table.innerHTML = '<div style="overflow:auto;border:1px solid #e5e7eb;border-radius:14px;background:#fff"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:980px"><thead><tr style="background:#f9fafb;color:#6b7280;text-align:left"><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Nome</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Categoria</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Idioma</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Status</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Qualidade</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Última atualização</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Último envio</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Ação</th></tr></thead><tbody>' +
      metaTemplates.map(function (t) {
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 12px;font-weight:800;color:#111827">' + metaEscape(t.name) + '</td><td style="padding:10px 12px;color:#374151">' + metaEscape(t.category || "-") + '</td><td style="padding:10px 12px;color:#374151">' + metaEscape(t.language || "-") + '</td><td style="padding:10px 12px;color:#374151">' + metaEscape(t.status || "-") + '</td><td style="padding:10px 12px;color:#374151">' + metaEscape(t.quality || "-") + '</td><td style="padding:10px 12px;color:#374151;white-space:nowrap">' + metaDate(t.updatedAt) + '</td><td style="padding:10px 12px;color:#374151;white-space:nowrap">' + metaDate(t.lastSentAt) + '</td><td style="padding:10px 12px"><button type="button" class="btn2" data-meta-send="' + metaEscape(t.id) + '">Enviar</button></td></tr>';
      }).join("") + '</tbody></table></div>';
  }

  function approvedMetaTemplates() {
    return (metaTemplates || []).filter(function (t) { return String(t.status || "").toUpperCase() === "APPROVED"; });
  }

  function renderMetaTemplateTests() {
    var root = qs("metaTemplateTestList");
    if (!root) return;
    var list = approvedMetaTemplates();
    if (!list.length) {
      root.innerHTML = '<p class="muted">Nenhum template APPROVED carregado. Clique em Sincronizar Templates.</p>';
      return;
    }
    root.innerHTML = list.map(function (tpl) {
      return '<div class="meta-template-test-row" data-template-test-row="' + metaEscape(tpl.id) + '">' +
        '<div><strong>' + metaEscape(getFriendlyTemplateName(tpl.name)) + '</strong><span>' + metaEscape(tpl.name) + ' · ' + metaEscape(tpl.language || 'pt_BR') + '</span></div>' +
        '<button type="button" class="btn2" data-meta-test-template="' + metaEscape(tpl.id) + '">Testar</button>' +
        '<pre id="metaTemplateTestResult_' + metaEscape(tpl.id) + '" aria-live="polite"></pre>' +
      '</div>';
    }).join("");
  }

  function defaultMetaTestVariables(tpl, phone) {
    var values = ["Teste DC NET", "Brasília", phone || "556199999999", "Cliente", "DC NET"];
    var out = {};
    (tpl.variableKeys || []).forEach(function (item, idx) { out[item.key] = values[idx] || ("Valor " + (idx + 1)); });
    return out;
  }

  async function testMetaTemplate(templateId) {
    var tpl = metaTemplates.find(function (t) { return String(t.id) === String(templateId); });
    if (!tpl) return;
    var phone = (qs("metaTemplateTestPhone") && qs("metaTemplateTestPhone").value.trim()) || "";
    if (!phone) return alert("Informe o número de teste.");
    var out = qs("metaTemplateTestResult_" + templateId);
    if (out) out.textContent = "Enviando teste...";
    try {
      var data = await api("/api/chatbot-admin/meta/templates/test", {
        method: "POST",
        body: {
          tenant: metaTenant(),
          to: phone,
          templateId: templateId,
          templateName: tpl.name,
          variables: defaultMetaTestVariables(tpl, phone),
          headerImageUrl: (qs("metaTemplateTestHeaderImage") && qs("metaTemplateTestHeaderImage").value.trim()) || ""
        }
      });
      if (out) out.textContent = "enviado\n" + (data.friendlyName || getFriendlyTemplateName(tpl.name)) + "\nwamid: " + (data.wamid || "-");
      loadMetaHistory();
      loadMetaStats();
    } catch (e) {
      var d = e.data || {};
      var err = d.error || {};
      if (out) out.textContent = "falhou\n" + (d.friendlyName || getFriendlyTemplateName(tpl.name)) + "\n" + (err.message || d.message || e.message || "Erro Meta") + (err.code ? "\ncode: " + err.code : "") + (err.details ? "\n" + err.details : "");
    }
  }

  async function loadMetaTemplates(sync) {
    var st = qs("metaTemplatesStatus");
    if (st) st.textContent = sync ? "Sincronizando templates na Meta..." : "Carregando templates...";
    try {
      var path = sync ? "/api/chatbot-admin/meta/templates/sync" : "/api/chatbot-admin/meta/templates?tenant=" + encodeURIComponent(metaTenant());
      var data = await api(path, sync ? { method: "POST", body: { tenant: metaTenant() } } : undefined);
      renderMetaTemplates(data.templates || []);
      if (qs("metaTemplateTestList") && qs("metaTemplateTestList").innerHTML.trim()) renderMetaTemplateTests();
      if (st) st.textContent = sync ? "Sincronização concluída: " + ((data.sync && data.sync.synced) || 0) + " templates." : "Templates carregados.";
    } catch (e) {
      if (st) st.textContent = "Erro: " + (e.data && e.data.message || e.message || e);
      renderMetaTemplates(metaTemplates);
    }
  }

  function selectMetaTemplate(id) {
    var tpl = metaTemplates.find(function (t) { return String(t.id) === String(id); });
    if (!tpl) return;
    metaSelectedTemplate = tpl;
    if (qs("metaSelectedTemplateName")) qs("metaSelectedTemplateName").textContent = tpl.name || "Template";
    if (qs("metaSelectedTemplateMeta")) qs("metaSelectedTemplateMeta").textContent = [tpl.category, tpl.language, tpl.status].filter(Boolean).join(" | ");
    if (qs("metaHeaderImageUrlWrap")) qs("metaHeaderImageUrlWrap").hidden = !tpl.needsHeaderImage;
    var vars = qs("metaTemplateVariables");
    if (vars) {
      var items = Array.isArray(tpl.variableKeys) ? tpl.variableKeys : [];
      vars.innerHTML = '<h3 class="subsection-title" style="margin-top:14px">Variáveis necessárias</h3>' +
        '<p class="muted" style="margin:0 0 8px">' + metaEscape(metaTemplatePreview(tpl)) + '</p>' +
        (items.length ? items.map(function (item) {
          var label = item.label || ("Variável " + (item.index || ""));
          return '<label for="metaVar_' + metaEscape(item.key) + '">' + metaEscape(label) + '</label>' +
            '<input id="metaVar_' + metaEscape(item.key) + '" data-meta-var="' + metaEscape(item.key) + '" type="text" autocomplete="off" placeholder="' + metaEscape(label) + '" />';
        }).join("") : '<p class="muted">Este template não possui variáveis no body.</p>');
    }
    switchTab("meta-campaigns");
  }

  function collectMetaTemplateVariables() {
    var out = {};
    document.querySelectorAll("[data-meta-var]").forEach(function (el) {
      out[el.getAttribute("data-meta-var")] = el.value || "";
    });
    return out;
  }

  async function sendMetaTemplateSmart() {
    if (!metaSelectedTemplate) {
      alert("Escolha um template na tela Templates.");
      return;
    }
    var phone = (qs("metaSendPhone") && qs("metaSendPhone").value.trim()) || "";
    if (!phone) {
      alert("Informe o número do cliente.");
      return;
    }
    setMetaResult({ status: "enviando" });
    try {
      var data = await api("/api/chatbot-admin/meta/templates/send", {
        method: "POST",
        body: {
          tenant: metaTenant(),
          to: phone,
          templateId: metaSelectedTemplate.id,
          variables: collectMetaTemplateVariables(),
          headerImageUrl: (qs("metaHeaderImageUrl") && qs("metaHeaderImageUrl").value.trim()) || "",
          freeMessage: (qs("metaFreeMessage") && qs("metaFreeMessage").value.trim()) || ""
        }
      });
      setMetaResult(data);
      loadMetaHistory();
      loadMetaStats();
    } catch (e) {
      setMetaResult({ ok: false, error: e.message || String(e), data: e.data || null });
    }
  }

  async function loadMetaHistory() {
    var el = qs("metaHistoryList");
    if (!el) return;
    el.innerHTML = '<p class="muted">Carregando histórico...</p>';
    try {
      var data = await api("/api/chatbot-admin/meta/history?tenant=" + encodeURIComponent(metaTenant()));
      var rows = data.rows || [];
      if (!rows.length) {
        el.innerHTML = '<p class="muted">Nenhum envio por template registrado ainda.</p>';
        return;
      }
      el.innerHTML = '<div style="overflow:auto;border:1px solid #e5e7eb;border-radius:14px;background:#fff"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:900px"><thead><tr style="background:#f9fafb;color:#6b7280;text-align:left"><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Template</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Idioma</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Status</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Fallback</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Destino</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Horário</th><th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">ID Meta</th></tr></thead><tbody>' + rows.map(function (r) {
        return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:10px 12px;font-weight:800">' + metaEscape(r.templateName || '-') + '</td><td style="padding:10px 12px">' + metaEscape(r.languageCode || '-') + '</td><td style="padding:10px 12px">' + metaEscape(r.status || r.metaStatus || '-') + '</td><td style="padding:10px 12px">' + (r.fallbackToTemplate ? 'Sim' : 'Não') + '</td><td style="padding:10px 12px">' + metaEscape(r.to || '-') + '</td><td style="padding:10px 12px;white-space:nowrap">' + metaDate(r.createdAt) + '</td><td style="padding:10px 12px">' + metaEscape(r.wamid || '-') + '</td></tr>';
      }).join("") + '</tbody></table></div>';
    } catch (e) {
      el.innerHTML = '<p class="muted">Erro ao carregar histórico: ' + metaEscape(e.message || e) + '</p>';
    }
  }

  async function loadMetaStats() {
    try {
      var data = await api("/api/chatbot-admin/meta/stats?tenant=" + encodeURIComponent(metaTenant()));
      var st = data.stats || {};
      var map = {
        metaStatApproved: st.templatesApproved,
        metaStatPending: st.templatesPending,
        metaStatRejected: st.templatesRejected,
        metaStatSent: st.sent,
        metaStatDelivered: st.delivered,
        metaStatRead: st.read,
        metaStatFailed: st.failed,
        metaStatDeliveryRate: (st.deliveryRate || 0) + "%",
        metaStatReadRate: (st.readRate || 0) + "%"
      };
      Object.keys(map).forEach(function (id) { if (qs(id)) qs(id).textContent = String(map[id] == null ? 0 : map[id]); });
    } catch (e) {
      ["metaStatApproved", "metaStatPending", "metaStatRejected", "metaStatSent", "metaStatDelivered", "metaStatRead", "metaStatFailed", "metaStatDeliveryRate", "metaStatReadRate"].forEach(function (id) {
        if (qs(id)) qs(id).textContent = "-";
      });
    }
  }


  function convTenant() {
    return (qs("tenant") && qs("tenant").value.trim()) || "dcnet";
  }

  function convEsc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function convDate(v) {
    if (!v) return "-";
    try { return new Date(v).toLocaleString("pt-BR"); } catch (e) { return "-"; }
  }

  function convDayLabel(v) {
    if (!v) return "";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "";
    var today = new Date();
    var startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    var startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var diff = Math.round((startToday - startDay) / 86400000);
    if (diff === 0) return "Hoje";
    if (diff === 1) return "Ontem";
    if (diff > 1 && diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "long" });
    return d.toLocaleDateString("pt-BR");
  }

  function convStatusColor(status) {
    var s = String(status || "").toLowerCase();
    if (s === "falhou" || s === "failed") return "#dc2626";
    if (s === "humano" || s === "handoff") return "#2563eb";
    if (s === "aguardando resposta") return "#ca8a04";
    if (s === "novo") return "#16a34a";
    return "#64748b";
  }

  function convMessageSummary(v) {
    return String(v || "").replace(/\s+/g, " ").trim() || "(sem texto)";
  }

  function getFriendlyTemplateName(templateName) {
    var key = String(templateName || "").trim();
    var map = {
      dcnet_billing_reminder_v2: "📅 Aviso D-3",
      dcnet_billing_overdue_d2_v2: "🔴 Cobrança D+2",
      dcnet_billing_overdue_d2: "🔴 Cobrança D+2",
      dcnet_billing_reactivation: "🟢 Reativação",
      dcnet_birthday_card: "🎂 Aniversário",
      dcnet_christmas_card: "🎄 Natal",
      dcnet_new_year_card: "🎆 Ano Novo",
      dcnet_easter_card: "✝️ Páscoa",
      dcnet_mothers_day_card: "🌷 Dia das Mães",
      dcnet_fathers_day_card: "👔 Dia dos Pais",
      dcnet_indique_ganhe_v1: "🎁 Indique e Ganhe",
      dcnet_promocao_fibra: "🚀 Promoção",
      dcnet_manutencao_programada: "🔧 Manutenção",
      dcnet_comunicado_oficial: "📢 Comunicado",
      dcnet_guardian_alert: "🛡️ Guardian",
      dcnet_parceria_banner: "🤝 Parceria"
    };
    return map[key] || key;
  }

  function convInitial(v) {
    var t = String(v || "").trim();
    if (!t) return "?";
    var letter = t.match(/[a-zA-ZÀ-ÿ]/);
    if (letter) return letter[0].toUpperCase();
    var clean = t.replace(/^55/, "");
    return (clean.match(/[0-9]/) || ["?"])[0].toUpperCase();
  }

  function convShortTime(v) {
    if (!v) return "";
    try { return new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
  }

  function convStatusLabel(c) {
    if (c.hasFailed || String(c.status || "").toLowerCase() === "falhou") return "falhou";
    if (c.lastDirection === "inbound") return "recebido";
    return c.status || "enviado";
  }

  function convPhotoUrl(obj) {
    return String((obj && (obj.profilePhotoUrl || obj.avatarUrl)) || "").trim();
  }

  function convAvatarHtml(name, obj, cls) {
    var photo = convPhotoUrl(obj);
    var initial = convEsc(convInitial(name));
    var klass = cls || "crm-avatar";
    if (photo) {
      return '<div class="' + klass + ' has-photo" data-avatar-initial="' + initial + '"><img src="' + convEsc(photo) + '" alt="" onerror="this.parentNode.classList.remove(&quot;has-photo&quot;);this.remove();" /><span>' + initial + '</span></div>';
    }
    return '<div class="' + klass + '"><span>' + initial + '</span></div>';
  }

  function conversationLoadErrorMessage(e) {
    var status = Number(e && e.status || 0);
    if (status === 401) return "Sessão expirada ou login ausente. Entre novamente no painel admin.";
    if (status === 403) return "Seu usuário não tem permissão para acessar Conversas.";
    if (status === 404) return "Endpoint de Conversas não encontrado. Verifique /api/chatbot-admin/conversations na porta do chatbot Express.";
    return (e && (e.message || e.data && e.data.error)) || String(e || "Erro desconhecido");
  }

  function conversationToast(message) {
    var old = qs("conversationToast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "conversationToast";
    el.className = "crm-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add("show"); }, 20);
    setTimeout(function () { el.classList.remove("show"); setTimeout(function () { if (el.parentNode) el.remove(); }, 250); }, 4200);
  }

  function conversationNotifyNewMessage(row) {
    var name = (row && (row.displayName || row.leadName || row.phone)) || "cliente";
    var message = "Nova mensagem de " + name;
    conversationToast(message);
    if (navigator.setAppBadge) navigator.setAppBadge(1).catch(function () {});
    if (conversationNotifyEnabled && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("DC NET WhatsApp", { body: message, tag: "dcnet-" + String(row && row.phone || "") }); } catch (e) { /* notificacao opcional */ }
    }
  }

  function conversationPlayNewSound() {
    if (!conversationSoundEnabled) return;
    try {
      var configured = localStorage.getItem("dcnet_conversation_sound_url") || "";
      if (configured) {
        var audio = new Audio(configured);
        audio.volume = 0.35;
        audio.play().catch(function () {});
        return;
      }
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.025;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(function () { osc.stop(); ctx.close(); }, 120);
    } catch (e) { /* som opcional */ }
  }

  function updateConversationAlertButtons() {
    var sound = qs("btnConversationSound");
    var notify = qs("btnConversationNotify");
    if (sound) {
      sound.textContent = conversationSoundEnabled ? "Som ligado" : "Som desligado";
      sound.classList.toggle("is-muted", !conversationSoundEnabled);
    }
    if (notify) {
      var granted = "Notification" in window ? Notification.permission : "indisponivel";
      notify.textContent = conversationNotifyEnabled && granted === "granted" ? "Notificações ligadas" : "Notificações";
      notify.classList.toggle("is-muted", !(conversationNotifyEnabled && granted === "granted"));
    }
  }

  async function toggleConversationNotifications() {
    if (!("Notification" in window)) return alert("Este navegador não suporta notificações.");
    if (Notification.permission !== "granted") {
      var perm = await Notification.requestPermission();
      if (perm !== "granted") {
        conversationNotifyEnabled = false;
        localStorage.setItem("dcnet_conversation_notify", "off");
        updateConversationAlertButtons();
        return;
      }
    }
    conversationNotifyEnabled = !conversationNotifyEnabled;
    localStorage.setItem("dcnet_conversation_notify", conversationNotifyEnabled ? "on" : "off");
    updateConversationAlertButtons();
  }

  function currentAdminMatchesConversation(c) {
    if (!currentAdmin || !c) return false;
    var id = String(currentAdmin.id || currentAdmin._id || "");
    var email = String(currentAdmin.email || "").toLowerCase();
    return (!!id && String(c.assignedTo || "") === id) || (!!email && String(c.assignedToEmail || "").toLowerCase() === email);
  }

  function conversationQueueStatus(c) {
    var q = String(c && c.queueStatus || "").toLowerCase();
    if (q) return q;
    var st = String(c && c.status || "").toLowerCase();
    if (st.indexOf("final") >= 0 || st === "resolved" || st === "resolvido") return "resolved";
    if ((c && (c.assignedTo || c.assignedToEmail)) || st.indexOf("humano") >= 0) return "assigned";
    return "waiting";
  }

  function conversationPriorityLabel(priority) {
    var p = String(priority || "normal").toLowerCase();
    if (p === "urgent") return "Urgente";
    if (p === "high") return "Alta";
    if (p === "low") return "Baixa";
    return "Normal";
  }

  function conversationDepartmentLabel(department) {
    var d = String(department || "comercial").toLowerCase();
    var map = { comercial: "Comercial", financeiro: "Financeiro", suporte: "Suporte", instalacao: "Instalacao", noc: "NOC" };
    return map[d] || d;
  }

  function formatQueueWait(ms) {
    ms = Number(ms || 0);
    if (!ms || ms < 0) return "0 min";
    var minutes = Math.round(ms / 60000);
    if (minutes < 60) return minutes + " min";
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return hours + "h" + (rest ? " " + rest + "m" : "");
  }

  function localConversationDashboardMetrics() {
    var count = function (fn) { return conversationRows.filter(fn).length; };
    return {
      waiting: count(function (c) { return conversationQueueStatus(c) === "waiting"; }),
      assigned: count(function (c) { return conversationQueueStatus(c) === "assigned"; }),
      mine: count(currentAdminMatchesConversation),
      urgent: count(function (c) { return String(c.priority || "").toLowerCase() === "urgent"; }),
      resolvedToday: count(function (c) { return conversationQueueStatus(c) === "resolved"; }),
      averageWaitMs: 0,
    };
  }

  function renderConversationCrmStats() {
    var root = qs("conversationCrmStats");
    if (!root) return;
    var metrics = (conversationDashboard && conversationDashboard.metrics) || localConversationDashboardMetrics();
    var stats = [
      ["Aguardando", metrics.waiting || 0],
      ["Em atendimento", metrics.assigned || 0],
      ["Minha fila", metrics.mine || 0],
      ["Urgentes", metrics.urgent || 0],
      ["Resolvidos hoje", metrics.resolvedToday || 0],
      ["Tempo médio de espera", formatQueueWait(metrics.averageWaitMs)],
    ];
    root.innerHTML = stats.map(function (s) { return '<div><b>' + convEsc(s[1]) + '</b><span>' + convEsc(s[0]) + '</span></div>'; }).join("");
  }

  function updateConversationRealtimeSignals(newRows) {
    var changed = [];
    newRows.forEach(function (c) {
      var phone = String(c.phone || "");
      var lastId = String(c.id || c.lastMessageAt || "");
      if (conversationKnownLastIds[phone] && lastId && conversationKnownLastIds[phone] !== lastId && c.lastDirection === "inbound") changed.push(c);
      if (lastId) conversationKnownLastIds[phone] = lastId;
    });
    if (changed.length) {
      changed.forEach(function (row) { conversationNewPhones.add(String(row.phone || "")); conversationNotifyNewMessage(row); });
      conversationPlayNewSound();
      setTimeout(function () { changed.forEach(function (row) { conversationNewPhones.delete(String(row.phone || "")); }); renderConversationList(); }, 6000);
    }
  }

  async function loadConversationOperators() {
    try {
      var data = await api("/api/chatbot-admin/operators?tenant=" + encodeURIComponent(convTenant()));
      conversationOperators = Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      conversationOperators = [];
    }
  }

  async function loadQueueDashboard() {
    try {
      var data = await api("/api/chatbot-admin/queue/dashboard?tenant=" + encodeURIComponent(convTenant()));
      conversationDashboard = data || null;
      renderConversationCrmStats();
    } catch (e) {
      conversationDashboard = null;
      renderConversationCrmStats();
    }
  }

  async function loadConversations() {
    var root = qs("conversationList");
    if (!root) return;
    if (!getToken()) {
      root.innerHTML = '<div style="border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px;font-weight:700">Sessão expirada ou login ausente. Entre novamente no painel admin.</div>';
      return;
    }
    root.innerHTML = '<span class="muted">Carregando conversas...</span>';
    try {
      var params = new URLSearchParams();
      params.set("tenant", convTenant());
      params.set("limit", "80");
      if (qs("conversationSearch") && qs("conversationSearch").value.trim()) params.set("q", qs("conversationSearch").value.trim());
      if (!conversationOperators.length) loadConversationOperators();
      var dashboardPromise = loadQueueDashboard();
      var data = await api("/api/chatbot-admin/conversations?" + params.toString());
      var nextRows = Array.isArray(data.items) ? data.items : (Array.isArray(data.rows) ? data.rows : []);
      updateConversationRealtimeSignals(nextRows);
      conversationRows = nextRows;
      conversationAvailableTags = data.tags || conversationAvailableTags;
      var visiblePhones = new Set(conversationRows.map(function (c) { return String(c.phone); }));
      renderConversationCrmStats();
      dashboardPromise.catch(function () {});
      renderConversationFilterCounts();
      renderConversationList();
      if (conversationUserOpened && conversationSelectedPhone && visiblePhones.has(String(conversationSelectedPhone))) loadConversationMessages(conversationSelectedPhone, true);
      if (conversationSelectedPhone && !visiblePhones.has(String(conversationSelectedPhone))) {
        resetConversationSelection();
      }
    } catch (e) {
      root.innerHTML = '<div style="border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px;font-weight:700">' + convEsc(conversationLoadErrorMessage(e)) + '</div>';
    }
  }

  function conversationMatchesFilter(c, filter) {
    var f = String(filter || "all").toLowerCase();
    var tags = (c.tags || []).map(function (x) { return String(x).toLowerCase(); });
    if (f === "all") return true;
    if (f === "mine") return currentAdminMatchesConversation(c);
    if (f === "waiting") return conversationQueueStatus(c) === "waiting";
    if (f === "assigned") return conversationQueueStatus(c) === "assigned";
    if (f === "resolved") return conversationQueueStatus(c) === "resolved";
    if (f === "urgent") return String(c.priority || "").toLowerCase() === "urgent";
    if (f === "unread") return Number(c.unreadCount || 0) > 0 || !!c.unreadManual;
    if (f === "failed") return !!c.hasFailed || String(c.status || "").toLowerCase() === "falhou";
    if (f === "favorite" || f === "favoritas") return !!c.isFavorite || tags.indexOf("favorito") >= 0;
    return tags.indexOf(f) >= 0 || String(c.lastIntent || "").toLowerCase().indexOf(f) >= 0;
  }

  function renderConversationFilterCounts() {
    var labels = { all: "Tudo", mine: "Minha fila", waiting: "Aguardando", assigned: "Em atendimento", resolved: "Resolvidos", urgent: "Urgentes", unread: "Não lidas", failed: "Falhas", favorite: "Favoritas", Comercial: "Comercial", Financeiro: "Financeiro", Suporte: "Suporte" };
    Object.keys(labels).forEach(function (key) {
      var btn = document.querySelector('[data-conv-filter="' + key + '"]');
      if (!btn) return;
      var count = conversationRows.filter(function (c) { return conversationMatchesFilter(c, key); }).length;
      btn.textContent = labels[key] + " (" + count + ")";
    });
  }

  function filteredConversationRows() {
    return conversationRows.filter(function (c) { return conversationMatchesFilter(c, conversationActiveFilter); });
  }

  function renderConversationList() {
    var root = qs("conversationList");
    if (!root) return;
    var rows = filteredConversationRows();
    if (!rows.length) {
      root.innerHTML = '<span class="muted" style="padding:12px">Nenhuma conversa encontrada.</span>';
      return;
    }
    root.innerHTML = rows.map(function (c) {
      var active = String(c.phone) === String(conversationSelectedPhone);
      var title = c.displayName || c.leadName || c.phone;
      var status = convStatusLabel(c);
      var tags = Array.isArray(c.tags) ? c.tags : [];
      var favorite = !!c.isFavorite || tags.indexOf("Favorito") >= 0;
      var tag = tags.filter(function (x) { return x !== "Favorito"; })[0] || "";
      var unread = Number(c.unreadCount || 0);
      var failedUi = !!c.hasFailed || String(status || "").toLowerCase() === "falhou";
      var indicator = failedUi ? null : (c.indicator || null);
      var statusText = "";
      var typing = c.typingUntil && new Date(c.typingUntil).getTime() > Date.now();
      var priority = String(c.priority || "normal").toLowerCase();
      var assigned = c.assignedToName || c.assignedToEmail || "Fila";
      var queueStatus = conversationQueueStatus(c);
      return '<div class="crm-chat-row priority-' + convEsc(priority) + ' queue-' + convEsc(queueStatus) + ' ' + (active ? 'is-active' : '') + (conversationNewPhones.has(String(c.phone)) ? ' is-new' : '') + '" data-conv-card="' + convEsc(c.phone) + '" data-conv-menu-phone="' + convEsc(c.phone) + '">' +
        convAvatarHtml(title, c, "crm-avatar") +
        '<button type="button" data-conv-phone="' + convEsc(c.phone) + '" class="crm-chat-main" style="border:none;background:transparent;text-align:left;padding:0;cursor:pointer">' +
          '<div class="crm-chat-top"><span class="crm-chat-name">' + (favorite ? '<span class="crm-star">★</span> ' : '') + convEsc(title) + '</span><span class="crm-chat-time">' + convEsc(convShortTime(c.lastMessageAt)) + '</span></div>' +
          '<div class="crm-chat-last">' + (typing ? '<span class="crm-typing">● ' + convEsc(title) + ' está digitando...</span>' : convEsc(convMessageSummary(c.lastMessage).slice(0, 78))) + '</div>' +
          '<div class="crm-chat-meta">' +
          (statusText ? '<span class="crm-mini-status" style="color:' + convStatusColor(status) + '">' + convEsc(statusText) + '</span>' : '') +
          (indicator ? '<span class="crm-conv-indicator tone-' + convEsc(indicator.tone || '') + '" title="' + convEsc(indicator.label || '') + '">' + convEsc(indicator.icon || '') + '</span>' : '') +
          '<span class="crm-mini-badge queue">' + convEsc(assigned) + '</span>' +
          '<span class="crm-mini-badge priority priority-' + convEsc(priority) + '">' + convEsc(conversationPriorityLabel(priority)) + '</span>' +
          '<span class="crm-mini-badge dept">' + convEsc(conversationDepartmentLabel(c.department)) + '</span>' +
          (tag ? '<span class="crm-mini-badge">' + convEsc(tag) + '</span>' : '') +
          (unread ? '<span class="crm-mini-badge unread">' + unread + '</span>' : '') +
          '</div>' +
        '</button>' +
      '</div>';
    }).join("");
  }


  async function loadConversationMessages(phone, silent) {
    if (!phone) return;
    if (!silent) conversationUserOpened = true;
    if (!getToken()) {
      var noAuthBox = qs("conversationMessages");
      if (noAuthBox) noAuthBox.innerHTML = '<span class="muted">Sessão expirada ou login ausente. Entre novamente no painel admin.</span>';
      return;
    }
    if (String(conversationSelectedPhone) !== String(phone)) { conversationReplyTarget = null; renderConversationReplyContext(); }
    conversationSelectedPhone = phone;
    renderConversationList();
    var box = qs("conversationMessages");
    if (box && !silent) box.innerHTML = '<span class="muted">Carregando timeline...</span>';
    try {
      var data = await api("/api/chatbot-admin/conversations/" + encodeURIComponent(phone) + "/messages?tenant=" + encodeURIComponent(convTenant()));
      conversationSelectedLead = data.lead || null;
      conversationAvailableTags = data.tags || conversationAvailableTags;
      if (!conversationOperators.length) await loadConversationOperators();
      renderConversationLead(data.lead, phone);
      renderConversationTimeline(data.messages || []);
      var displayName = (data.lead && (data.lead.displayName || data.lead.name || data.lead.whatsappProfileName)) || phone;
      var currentRow = conversationByPhone(phone) || {};
      if (qs("conversationTitle")) qs("conversationTitle").textContent = displayName;
      if (qs("conversationHeaderAvatar")) qs("conversationHeaderAvatar").outerHTML = convAvatarHtml(displayName, data.lead || currentRow || {}, "crm-avatar").replace('class="crm-avatar', 'id="conversationHeaderAvatar" class="crm-avatar');
      if (qs("conversationSubtitle")) qs("conversationSubtitle").innerHTML = '<span>' + convEsc(phone) + '</span><span>' + convEsc((data.lead && data.lead.status) || "novo") + '</span><span>Última interação ' + convEsc(convShortTime(currentRow.lastMessageAt || (data.messages && data.messages.length ? data.messages[data.messages.length - 1].createdAt : "")) || "-") + '</span>';
      if (conversationUserOpened) {
        if (qs("crmConversationGrid")) qs("crmConversationGrid").classList.add("is-chat-open");
        document.body.classList.add("mobile-chat-open");
      }
      document.body.classList.remove("mobile-lead-open");
    } catch (e) {
      if (box) box.innerHTML = '<span class="muted">Erro: ' + convEsc(e.message || e) + '</span>';
    }
  }

  function convTimelineStatus(m) {
    if (m.direction === "inbound") return "";
    var st = String(m.status || m.deliveryStatus || m.metaStatus || "").toLowerCase();
    if (st === "read") return "✓✓";
    if (st === "delivered") return "✓✓";
    if (st === "queued" || st === "pending") return "⏰";
    if (st === "failed") return "⚠️ não entregue";
    return "✓";
  }

  function convMediaLabel(type) {
    type = String(type || "text").toLowerCase();
    if (type === "image") return "📷 Imagem";
    if (type === "location") return "📍 Localização";
    if (type === "audio") return "🎤 Áudio";
    if (type === "video") return "🎬 Vídeo";
    if (type === "document") return "📄 Documento";
    if (type === "contacts" || type === "contact") return "👤 Contato";
    if (type === "system") return "Linha do tempo";
    if (type === "template") return "📄 Template enviado";
    return "";
  }

  function convTranslateMetaError(meta) {
    var err = meta && (meta.error || meta.metaError || meta) || {};
    var code = Number(err.code || err.error_code || err.errorCode || 0) || null;
    var map = {
      131000: { reason: "Erro temporário Meta.", title: "Mensagem não entregue.", details: "Tente enviar novamente em alguns minutos." },
      131009: { reason: "Template inexistente.", title: "Mensagem não entregue.", details: "Sincronize os templates Meta e escolha um template aprovado." },
      131026: { reason: "Número inválido.", title: "Mensagem não entregue.", details: "Confira o telefone do cliente antes de reenviar." },
      131047: { reason: "Janela de atendimento encerrada.", title: "Mensagem não entregue.", details: "O cliente não respondeu nas últimas 24 horas. Utilize um Template Meta aprovado para continuar.", needsTemplate: true },
      131051: { reason: "Cliente bloqueou a empresa.", title: "Mensagem não entregue.", details: "Aguarde o cliente desbloquear o contato para novas mensagens." }
    };
    var base = map[code] || { reason: "Mensagem recusada pela Meta.", title: "Mensagem não entregue.", details: "Verifique os detalhes técnicos." };
    return {
      code: code,
      title: base.title,
      reason: base.reason,
      details: base.details,
      needsTemplate: !!base.needsTemplate,
      rawTitle: err.error_user_title || err.title || err.type || "",
      rawDetails: err.error_user_msg || err.message || (err.error_data && err.error_data.details) || ""
    };
  }

  function convMetaTechnicalPayload(m, translated) {
    var raw = m.raw || null;
    return {
      code: translated && translated.code || null,
      title: translated && (translated.rawTitle || translated.title) || "",
      details: translated && (translated.rawDetails || translated.details || translated.reason) || "",
      templateTecnico: m.templateName || "",
      rawJson: m.metaError || raw || null,
      wamid: m.wamid || m.waMessageId || "",
      request: raw && (raw.request || raw.requestBody || raw.payload) || null,
      response: raw && (raw.response || raw.error || raw) || null,
      status: m.status || "",
      deliveryStatus: m.deliveryStatus || "",
      metaStatus: m.metaStatus || "",
      createdAt: m.createdAt || null,
      updatedAt: m.updatedAt || null
    };
  }

  function conversationMessageSummaryForReply(m) {
    if (!m) return "";
    return convMessageSummary(m.text || m.friendlyTemplateName || getFriendlyTemplateName(m.templateName) || m.mediaUrl || convMediaLabel(m.messageType) || "Mensagem").slice(0, 120);
  }

  function renderConversationReplyContext() {
    var root = qs("conversationReplyContext");
    if (!root) return;
    if (!conversationReplyTarget) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    root.hidden = false;
    root.innerHTML = '<div><b>Respondendo a:</b><span>' + convEsc(conversationReplyTarget.text || "Mensagem") + '</span></div><button type="button" data-clear-reply-context>×</button>';
  }

  function selectConversationMessage(messageId) {
    var msg = conversationLastMessages.find(function (m) { return String(m.id) === String(messageId); });
    if (!msg) return;
    conversationReplyTarget = { id: String(msg.id || ""), text: conversationMessageSummaryForReply(msg), wamid: msg.wamid || msg.waMessageId || "" };
    renderConversationReplyContext();
    document.querySelectorAll(".crm-msg-line.is-selected").forEach(function (el) { el.classList.remove("is-selected"); });
    var row = Array.from(document.querySelectorAll("[data-conv-message-id]")).find(function (el) { return String(el.getAttribute("data-conv-message-id")) === String(messageId); });
    if (row) row.classList.add("is-selected");
    if (qs("conversationReplyText")) qs("conversationReplyText").focus();
  }

  function convMessageBubble(m) {
    var inbound = m.direction === "inbound";
    var failed = String(m.status || "").toLowerCase() === "failed" || !!m.metaError || !!m.metaErrorTranslated;
    var type = String(m.messageType || "text").toLowerCase();
    var body = "";
    var translatedError = m.metaErrorTranslated || (failed ? convTranslateMetaError(m.metaError || m.raw || {}) : null);
    if (failed) conversationMetaDetailsById[String(m.id || "")] = convMetaTechnicalPayload(m, translatedError);
    if (m.hiddenFromInbox) body += '<div class="crm-mini-badge" style="margin-bottom:5px;display:inline-flex">ocultada da caixa</div>';
    if (m.replyToText) body += '<div class="crm-reply-quote"><b>Respondendo a:</b><span>' + convEsc(m.replyToText) + '</span></div>';
    if (m.templateName) body += '<div class="crm-template-chip crm-template-chip-friendly"><b>' + convEsc(m.friendlyTemplateName || getFriendlyTemplateName(m.templateName)) + '</b><span>Mensagem enviada por template Meta.</span></div>';
    var mediaLabel = convMediaLabel(type);
    if (mediaLabel && !m.templateName) body += '<div class="crm-location-card">' + convEsc(mediaLabel) + '</div>';
    if (type === "image" && m.mediaUrl) body += '<a href="' + convEsc(m.mediaUrl) + '" target="_blank" rel="noopener"><img src="' + convEsc(m.mediaUrl) + '" alt="" /></a>';
    if (type === "audio" && m.mediaUrl) body += '<audio controls src="' + convEsc(m.mediaUrl) + '"></audio>';
    if (type === "video" && m.mediaUrl) body += '<video controls src="' + convEsc(m.mediaUrl) + '"></video>';
    if (type === "document" && m.mediaUrl) body += '<a class="crm-doc-card" href="' + convEsc(m.mediaUrl) + '" target="_blank" rel="noopener">📄 Abrir documento</a>';
    if (failed) {
      var t = translatedError || {};
      if (Number(t.code || 0) === 131047) {
        t = Object.assign({}, t, {
          reason: "Janela de atendimento encerrada.",
          details: "O cliente não respondeu nas últimas 24 horas. Utilize um Template Meta aprovado para continuar.",
          needsTemplate: true
        });
        conversationMetaDetailsById[String(m.id || "")] = convMetaTechnicalPayload(m, t);
      }
      var result = conversationTemplateResults[m.id] || "";
      if (result === "success") body += '<div class="crm-meta-result ok">✅ Template enviado com sucesso</div>';
      if (result === "failed") body += '<div class="crm-meta-result bad">❌ Falha ao enviar template</div>';
      body += '<div class="crm-meta-error-card"><strong>⚠️ Mensagem não entregue</strong>' +
        '<p>' + convEsc(t.reason || "Mensagem recusada pela Meta.") + '</p>' +
        '<span>' + convEsc(t.details || "Utilize um Template Meta aprovado para continuar quando necessário.") + '</span>' +
        '<div class="crm-meta-actions">' +
          (t.needsTemplate || Number(t.code || 0) === 131047 ? '<button type="button" data-conv-template-message="' + convEsc(m.id) + '">Enviar Template</button>' : '') +
          '<button type="button" data-conv-meta-details-id="' + convEsc(m.id) + '">Ver detalhes</button>' +
        '</div></div>';
    } else {
      body += '<div class="crm-bubble-text">' + convEsc(m.text || (m.mediaUrl ? m.mediaUrl : "")) + '</div>';
    }
    var statusText = convTimelineStatus(m);
    var stForClass = String(m.status || m.deliveryStatus || m.metaStatus || "").toLowerCase();
    var statusClass = failed ? "bad" : (stForClass === "read" ? "read" : (stForClass === "delivered" ? "delivered" : "sent"));
    var tplClass = m.templateName ? ' template' : '';
    var author = "";
    if (!inbound) author = m.responseKind === "manual" || m.operatorName || m.operatorEmail ? ("Respondido por " + (m.operatorName || m.operatorEmail || "operador")) : "🤖 Bot DC NET";
    if (m.direction === "system") author = "Evento interno";
    var reaction = Array.isArray(m.reactions) && m.reactions.length ? m.reactions[0].emoji : "";
    var reactionHtml = '<div class="crm-reactions">' + (reaction ? '<span class="crm-reaction-pill">' + convEsc(reaction) + '</span>' : '') + '<button type="button" data-conv-react="👍" title="Reagir">👍</button><button type="button" data-conv-react="❤️" title="Reagir">❤️</button><button type="button" data-conv-react="✅" title="Reagir">✅</button></div>';
    return '<div class="crm-msg-line ' + (inbound ? 'in' : 'out') + (failed ? ' fail' : '') + tplClass + (m.direction === "system" ? ' system' : '') + '" data-conv-message-id="' + convEsc(m.id || '') + '"><div class="crm-bubble">' + body + '<div class="crm-bubble-meta">' + (author ? '<span>' + convEsc(author) + '</span>' : '') + '<span class="' + statusClass + '">' + convEsc(statusText) + '</span><span>' + convEsc(convShortTime(m.createdAt)) + '</span></div>' + reactionHtml + '</div></div>';
  }


  function renderConversationTimeline(messages) {
    var box = qs("conversationMessages");
    if (!box) return;
    conversationLastMessages = messages || [];
    var visibleMessages = conversationThreadSearch ? conversationLastMessages.filter(function (m) {
      var hay = [m.text, m.templateName, m.friendlyTemplateName, m.mediaUrl, m.replyToText].join(" ").toLowerCase();
      return hay.indexOf(conversationThreadSearch.toLowerCase()) >= 0;
    }) : conversationLastMessages;
    var lastDay = "";
    box.innerHTML = visibleMessages.length ? visibleMessages.map(function (m) {
      var day = convDayLabel(m.createdAt);
      var sep = day && day !== lastDay ? '<div class="crm-day-separator"><span>' + convEsc(day) + '</span></div>' : '';
      if (day) lastDay = day;
      return sep + convMessageBubble(m);
    }).join("") : '<span class="muted">' + (conversationThreadSearch ? 'Nenhuma mensagem encontrada nessa conversa.' : 'Sem mensagens nessa conversa.') + '</span>';
    renderConversationReplyContext();
    var tplCount = messages.filter(function (m) { return !!m.templateName; }).length;
    if (qs("conversationTemplateCount")) qs("conversationTemplateCount").textContent = String(tplCount);
    box.scrollTop = box.scrollHeight;
  }

  function conversationOperatorOptions(selected) {
    var current = String(selected || "");
    var opts = ['<option value="">Fila sem responsavel</option>'];
    conversationOperators.forEach(function (op) {
      var value = op.adminId || op.email || op.id || "";
      if (!value) return;
      var label = (op.name || op.email || "Operador") + (op.email && op.name !== op.email ? " (" + op.email + ")" : "");
      opts.push('<option value="' + convEsc(value) + '" ' + (String(value) === current || String(op.email || "") === current ? 'selected' : '') + '>' + convEsc(label) + '</option>');
    });
    return opts.join("");
  }

  function renderConversationLead(lead, phone) {
    var box = qs("conversationLeadBox");
    if (!box) return;
    var l = lead || { phone: phone, status: "novo", tags: [] };
    var name = l.displayName || l.name || l.whatsappProfileName || phone || l.phone || "Lead";
    box.className = "";
    var events = Array.isArray(l.timelineEvents) ? l.timelineEvents.slice(-8).reverse() : [];
    var photoUrl = convPhotoUrl(l);
    box.innerHTML = '<div class="crm-lead-card">' + convAvatarHtml(name, l, "crm-avatar") + '<div class="crm-lead-name">' + convEsc(name) + '</div><div class="crm-lead-phone">' + convEsc(phone || l.phone || '-') + '</div>' +
      '<div class="crm-avatar-upload">' +
        '<img id="conversationAvatarPreview" src="' + convEsc(photoUrl || '') + '" alt="" ' + (photoUrl ? '' : 'hidden') + ' />' +
        '<label>Upload da foto<input id="conversationAvatarFile" type="file" accept="image/png,image/jpeg,image/webp" /></label>' +
        '<button type="button" id="btnConversationSaveAvatar">Salvar foto</button>' +
        '<p id="conversationAvatarStatus" class="muted" aria-live="polite"></p>' +
      '</div></div>' +
      '<div class="crm-lead-grid">' +
      '<div><b>CPF</b><span>' + convEsc(l.cpf || '-') + '</span></div>' +
      '<div><b>Cidade</b><span>' + convEsc(l.city || '-') + '</span></div>' +
      '<div><b>Bairro</b><span>' + convEsc(l.neighborhood || '-') + '</span></div>' +
      '<div><b>CEP</b><span>' + convEsc(l.lastCep || '-') + '</span></div>' +
      '<div><b>Plano</b><span>' + convEsc(l.selectedPlan || '-') + '</span></div>' +
      '<div><b>Vencimento</b><span>' + convEsc(l.dueDate || '-') + '</span></div>' +
      '<div><b>Última fatura</b><span>' + convEsc(l.lastInvoice || '-') + '</span></div>' +
      '<div><b>Status financeiro</b><span>' + convEsc(l.financialStatus || '-') + '</span></div>' +
      '<div><b>Status conexão</b><span>' + convEsc(l.connectionStatus || '-') + '</span></div>' +
      '<div><b>Origem</b><span>' + convEsc(l.origin || '-') + '</span></div>' +
      '<div><b>Data cadastro</b><span>' + convEsc(l.customerSince ? convShortTime(l.customerSince) : (l.updatedAt ? new Date(l.updatedAt).toLocaleDateString("pt-BR") : '-')) + '</span></div>' +
      '<div><b>Último atendimento</b><span>' + convEsc(l.lastAttendanceAt ? new Date(l.lastAttendanceAt).toLocaleString("pt-BR") : '-') + '</span></div>' +
      '<div><b>Status</b><span>' + convEsc(l.status || '-') + '</span></div>' +
      '<div><b>Fila</b><span>' + convEsc(conversationQueueStatus(l)) + '</span></div>' +
      '<div><b>Responsavel</b><span>' + convEsc(l.assignedToName || l.assignedToEmail || 'Fila') + '</span></div>' +
      '<div><b>Prioridade</b><span class="crm-priority-text priority-' + convEsc(l.priority || 'normal') + '">' + convEsc(conversationPriorityLabel(l.priority)) + '</span></div>' +
      '<div><b>Setor</b><span>' + convEsc(conversationDepartmentLabel(l.department)) + '</span></div>' +
      '<div><b>Última campanha</b><span>' + convEsc(l.lastCampaign || '-') + '</span></div>' +
      '<div><b>Templates enviados</b><span id="conversationTemplateCount">-</span></div>' +
      '</div>' +
      '<div class="crm-queue-controls">' +
        '<label>Prioridade<select id="conversationPrioritySelect"><option value="low" ' + (l.priority === 'low' ? 'selected' : '') + '>Baixa</option><option value="normal" ' + (!l.priority || l.priority === 'normal' ? 'selected' : '') + '>Normal</option><option value="high" ' + (l.priority === 'high' ? 'selected' : '') + '>Alta</option><option value="urgent" ' + (l.priority === 'urgent' ? 'selected' : '') + '>Urgente</option></select></label>' +
        '<label>Setor<select id="conversationDepartmentSelect"><option value="comercial" ' + (l.department === 'comercial' ? 'selected' : '') + '>Comercial</option><option value="financeiro" ' + (l.department === 'financeiro' ? 'selected' : '') + '>Financeiro</option><option value="suporte" ' + (l.department === 'suporte' ? 'selected' : '') + '>Suporte</option><option value="instalacao" ' + (l.department === 'instalacao' ? 'selected' : '') + '>Instalacao</option><option value="noc" ' + (l.department === 'noc' ? 'selected' : '') + '>NOC</option></select></label>' +
        '<label>Transferir para<select id="conversationTransferSelect">' + conversationOperatorOptions(l.assignedTo || l.assignedToEmail) + '</select></label>' +
        '<button type="button" id="btnConversationTransfer">Transferir</button>' +
      '</div>' +
      '<div class="crm-lead-timeline"><h3>Linha do tempo</h3>' + (events.length ? events.map(function (ev) { return '<div><b>' + convEsc(ev.label || ev.type || 'Evento') + '</b><span>' + convEsc(ev.by || '') + ' ' + convEsc(ev.at ? new Date(ev.at).toLocaleString("pt-BR") : '') + '</span></div>'; }).join('') : '<p class="muted">Sem eventos registrados.</p>') + '</div>';
    renderConversationTags(l.tags || []);
    if (qs("conversationInternalNotes")) qs("conversationInternalNotes").value = l.internalNotes || "";
  }


  function renderConversationTags(activeTags) {
    var root = qs("conversationTags");
    if (!root) return;
    activeTags = Array.isArray(activeTags) ? activeTags : [];
    root.innerHTML = conversationAvailableTags.map(function (tag) {
      var on = activeTags.indexOf(tag) >= 0;
      return '<label class="' + (on ? 'is-on' : '') + '"><input type="checkbox" data-conv-tag="' + convEsc(tag) + '" ' + (on ? 'checked' : '') + ' />' + convEsc(tag) + '</label>';
    }).join("");
  }


  function selectedConversationTags() {
    return Array.from(document.querySelectorAll('[data-conv-tag]:checked')).map(function (el) { return el.getAttribute('data-conv-tag'); });
  }

  function previewConversationAvatarFile() {
    var input = qs("conversationAvatarFile");
    var img = qs("conversationAvatarPreview");
    if (!input || !img || !input.files || !input.files[0]) return;
    img.src = URL.createObjectURL(input.files[0]);
    img.hidden = false;
  }

  async function saveConversationAvatar() {
    if (!conversationSelectedPhone) return alert("Selecione uma conversa.");
    var input = qs("conversationAvatarFile");
    var status = qs("conversationAvatarStatus");
    if (!input || !input.files || !input.files[0]) return alert("Selecione uma foto primeiro.");
    if (status) status.textContent = "Salvando foto...";
    var form = new FormData();
    form.append("file", input.files[0]);
    form.append("tenant", convTenant());
    try {
      var token = getToken();
      var res = await fetch(API + "/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/avatar", {
        method: "POST",
        headers: token ? { Authorization: "Bearer " + token } : {},
        body: form,
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.url) throw new Error(data.error || "Erro ao salvar foto");
      conversationSelectedLead = data.lead || Object.assign({}, conversationSelectedLead || {}, { avatarUrl: data.url, profilePhotoUrl: data.url });
      renderConversationLead(conversationSelectedLead, conversationSelectedPhone);
      var displayName = (conversationSelectedLead && (conversationSelectedLead.displayName || conversationSelectedLead.name || conversationSelectedLead.whatsappProfileName)) || conversationSelectedPhone;
      if (qs("conversationHeaderAvatar")) qs("conversationHeaderAvatar").outerHTML = convAvatarHtml(displayName, conversationSelectedLead || {}, "crm-avatar").replace('class="crm-avatar', 'id="conversationHeaderAvatar" class="crm-avatar');
      if (status) status.textContent = "Foto salva.";
      loadConversations();
    } catch (e) {
      if (status) status.textContent = "Erro: " + (e.message || e);
      else alert("Erro: " + (e.message || e));
    }
  }

  var conversationQuickReplies = [
    ["Cobrança", "Olá! Posso te ajudar com informações de cobrança. Você prefere boleto ou PIX?"],
    ["2ª via", "Claro. Vou verificar a 2ª via para você e já retorno com as opções disponíveis."],
    ["PIX", "Segue orientação para pagamento via PIX. Após pagar, envie o comprovante para agilizar a baixa."],
    ["Suporte", "Entendi. Me informe, por favor, se o problema é lentidão, sem conexão ou oscilação."],
    ["Instalação", "Vamos acompanhar sua instalação. Pode confirmar o endereço e melhor horário para atendimento?"],
    ["Comercial", "Perfeito! Vou te ajudar com os planos disponíveis e verificar a cobertura no seu endereço."],
    ["Promoção", "Temos condições promocionais disponíveis. Me diga sua cidade/bairro para eu indicar a melhor opção."],
    ["Indique e Ganhe", "No Indique e Ganhe, você indica alguém e pode receber benefícios após a ativação."],
  ];

  function openQuickReplies() {
    var modal = qs("conversationQuickRepliesModal");
    var list = qs("conversationQuickReplyList");
    if (!modal || !list) return;
    list.innerHTML = conversationQuickReplies.map(function (r, i) { return '<button type="button" data-quick-reply="' + i + '"><strong>' + convEsc(r[0]) + '</strong><span>' + convEsc(r[1]) + '</span></button>'; }).join("");
    modal.hidden = false;
  }

  async function suggestConversationReply() {
    if (!conversationSelectedPhone || !conversationLastMessages.length) return alert("Abra uma conversa com histórico para sugerir resposta.");
    var st = qs("conversationSendStatus");
    if (st) st.textContent = "IA analisando conversa...";
    try {
      var data = await api("/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/ai/suggest-reply", { method: "POST", body: { tenant: convTenant() } });
      if (qs("conversationReplyText")) qs("conversationReplyText").value = data.reply || "";
      if (st) st.textContent = "IA sugeriu: " + (data.intent || "atendimento") + (data.hotLead ? " · lead quente" : "");
    } catch (e) {
      var lastInbound = conversationLastMessages.slice().reverse().find(function (m) { return m.direction === "inbound" && m.text; });
      var text = "Olá! Obrigado pelo contato. Vou verificar isso para você e já te retorno com a melhor orientação.";
      if (lastInbound) {
        var msg = String(lastInbound.text || "").toLowerCase();
        if (msg.indexOf("boleto") >= 0 || msg.indexOf("pix") >= 0 || msg.indexOf("fatura") >= 0) text = "Olá! Vou verificar sua situação financeira e te envio a melhor opção de pagamento.";
        else if (msg.indexOf("sem internet") >= 0 || msg.indexOf("lento") >= 0 || msg.indexOf("cai") >= 0) text = "Olá! Vamos verificar sua conexão. Pode me confirmar se as luzes do roteador estão acesas e se já reiniciou o equipamento?";
        else if (msg.indexOf("plano") >= 0 || msg.indexOf("cobertura") >= 0) text = "Olá! Vou verificar os planos e a cobertura para seu endereço. Pode me informar seu CEP ou localização?";
      }
      if (qs("conversationReplyText")) qs("conversationReplyText").value = text;
      if (st) st.textContent = "IA local usada como fallback.";
    }
  }

  async function saveConversationLead() {
    if (!conversationSelectedPhone) return alert("Selecione uma conversa.");
    var st = qs("conversationLeadStatus");
    if (st) st.textContent = "Salvando...";
    try {
      var data = await api("/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/lead", {
        method: "PATCH",
        body: { tenant: convTenant(), tags: selectedConversationTags(), internalNotes: (qs("conversationInternalNotes") && qs("conversationInternalNotes").value) || "", priority: (qs("conversationPrioritySelect") && qs("conversationPrioritySelect").value) || "normal", department: (qs("conversationDepartmentSelect") && qs("conversationDepartmentSelect").value) || "comercial" }
      });
      conversationSelectedLead = data.lead || null;
      renderConversationLead(conversationSelectedLead, conversationSelectedPhone);
      if (st) st.textContent = "Dados salvos.";
      loadConversations();
    } catch (e) {
      if (st) st.textContent = "Erro: " + (e.message || e);
    }
  }

  async function transferConversation() {
    if (!conversationSelectedPhone) return alert("Selecione uma conversa.");
    var st = qs("conversationLeadStatus");
    var select = qs("conversationTransferSelect");
    if (st) st.textContent = "Transferindo...";
    try {
      var data = await api("/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/transfer", { method: "POST", body: { tenant: convTenant(), operatorId: select ? select.value : "" } });
      conversationSelectedLead = data.lead || null;
      renderConversationLead(conversationSelectedLead, conversationSelectedPhone);
      loadConversationMessages(conversationSelectedPhone, true);
      loadConversations();
      if (st) st.textContent = "Atendimento transferido.";
    } catch (e) {
      if (st) st.textContent = "Erro: " + (e.message || e);
    }
  }

  async function conversationAction(action) {
    if (!conversationSelectedPhone) return alert("Selecione uma conversa.");
    var st = qs("conversationLeadStatus");
    if (st) st.textContent = "Processando...";
    try {
      var data = await api("/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/" + action, { method: "POST", body: { tenant: convTenant() } });
      conversationSelectedLead = data.lead || null;
      renderConversationLead(conversationSelectedLead, conversationSelectedPhone);
      loadConversationMessages(conversationSelectedPhone, true);
      loadConversations();
      if (st) st.textContent = action === "assume" ? "Atendimento assumido." : (action === "resolve" ? "Atendimento finalizado." : (action === "reopen" ? "Atendimento reaberto." : "Atendimento atualizado."));
    } catch (e) {
      if (st) st.textContent = "Erro: " + (e.message || e);
    }
  }

  function renderConversationAttachmentPreview() {
    var root = qs("conversationAttachmentPreview");
    if (!root) return;
    if (!conversationAttachment) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    var url = conversationAttachment.mediaUrl || conversationAttachment.url || "";
    var type = conversationAttachment.mediaType || "document";
    var name = conversationAttachment.filename || "anexo";
    var preview = "";
    if (type === "image") preview = '<img src="' + convEsc(url) + '" alt="" />';
    else if (type === "audio") preview = '<audio controls src="' + convEsc(url) + '"></audio>';
    else if (type === "video") preview = '<video controls src="' + convEsc(url) + '"></video>';
    else preview = '<span class="crm-doc-card">📄 ' + convEsc(name) + '</span>';
    root.hidden = false;
    root.innerHTML = '<div>' + preview + '<strong>' + convEsc(name) + '</strong></div><button type="button" data-clear-conv-attachment>×</button>';
  }

  function clearConversationAttachment() {
    conversationAttachment = null;
    ["conversationReplyMediaUrl", "conversationReplyMediaType", "conversationReplyFilename"].forEach(function (id) { if (qs(id)) qs(id).value = ""; });
    if (qs("conversationReplyFile")) qs("conversationReplyFile").value = "";
    renderConversationAttachmentPreview();
  }

  async function uploadConversationAttachment(file) {
    if (!conversationSelectedPhone) return alert("Selecione uma conversa antes de anexar.");
    if (!file) return;
    var st = qs("conversationSendStatus");
    if (st) st.textContent = "Enviando anexo...";
    var form = new FormData();
    form.append("file", file);
    form.append("tenant", convTenant());
    try {
      var data = await apiForm("/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/attachment", form, "POST");
      conversationAttachment = data;
      if (qs("conversationReplyMediaUrl")) qs("conversationReplyMediaUrl").value = data.mediaUrl || data.url || "";
      if (qs("conversationReplyMediaType")) qs("conversationReplyMediaType").value = data.mediaType || "document";
      if (qs("conversationReplyFilename")) qs("conversationReplyFilename").value = data.filename || file.name || "";
      renderConversationAttachmentPreview();
      if (st) st.textContent = "Anexo pronto para envio.";
    } catch (e) {
      clearConversationAttachment();
      if (st) st.textContent = "Falha ao anexar: " + (e.message || e);
    }
  }

  async function sendConversationReply() {
    if (!getToken()) return alert("Sessão expirada ou login ausente. Entre novamente no painel admin.");
    if (!conversationSelectedPhone) return alert("Selecione uma conversa.");
    var text = (qs("conversationReplyText") && qs("conversationReplyText").value.trim()) || "";
    var mediaUrl = (qs("conversationReplyMediaUrl") && qs("conversationReplyMediaUrl").value.trim()) || "";
    var mediaType = (qs("conversationReplyMediaType") && qs("conversationReplyMediaType").value.trim()) || (conversationAttachment && conversationAttachment.mediaType) || "image";
    var filename = (qs("conversationReplyFilename") && qs("conversationReplyFilename").value.trim()) || (conversationAttachment && conversationAttachment.filename) || "";
    if (!text && !mediaUrl) return alert("Digite uma mensagem ou anexe um arquivo.");
    var st = qs("conversationSendStatus");
    if (st) st.textContent = "Enviando...";
    try {
      await api("/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/send", { method: "POST", body: { tenant: convTenant(), text: text, mediaUrl: mediaUrl, mediaType: mediaType, filename: filename, replyToMessageId: conversationReplyTarget && conversationReplyTarget.id || "", replyToText: conversationReplyTarget && conversationReplyTarget.text || "", replyToWamid: conversationReplyTarget && conversationReplyTarget.wamid || "" } });
      conversationReplyTarget = null;
      renderConversationReplyContext();
      if (qs("conversationReplyText")) qs("conversationReplyText").value = "";
      clearConversationAttachment();
      if (st) st.textContent = "Mensagem enviada.";
      loadConversationMessages(conversationSelectedPhone, true);
      loadConversations();
    } catch (e) {
      var msg = (e.data && e.data.message) || e.message || String(e);
      if (st) st.textContent = msg;
    }
  }

  function confirmConversationHide(message) {
    return new Promise(function (resolve) {
      var old = document.getElementById("conversationHideConfirm");
      if (old) old.remove();
      var wrap = document.createElement("div");
      wrap.id = "conversationHideConfirm";
      wrap.className = "crm-confirm-overlay";
      wrap.innerHTML = '<div class="crm-confirm-box"><strong>' + convEsc(message || "Ocultar esta conversa da caixa de entrada?") + '</strong><p>O Histórico/Auditoria será preservado.</p><div><button type="button" data-confirm-cancel>Cancelar</button><button type="button" class="danger" data-confirm-hide>Ocultar</button></div></div>';
      document.body.appendChild(wrap);
      function finish(value) { wrap.remove(); resolve(value); }
      wrap.addEventListener("click", function (ev) {
        if (ev.target === wrap || ev.target.closest("[data-confirm-cancel]")) finish(false);
        if (ev.target.closest("[data-confirm-hide]")) finish(true);
      });
    });
  }

  async function clearConversation(phone, message) {
    if (!getToken()) return alert("Sessão expirada ou login ausente. Entre novamente no painel admin.");
    phone = phone || conversationSelectedPhone;
    if (!phone) return alert("Selecione uma conversa.");
    if (!(await confirmConversationHide(message || "Ocultar esta conversa da caixa de entrada?"))) return;
    await api("/api/chatbot-admin/conversations/" + encodeURIComponent(phone) + "/clear", { method: "POST", body: { tenant: convTenant() } });
    if (String(conversationSelectedPhone) === String(phone)) resetConversationSelection("Conversa ocultada da caixa. O Histórico continua preservado.");
    hideConversationContextMenu();
    loadConversations();
    if (qs("conversationMessages")) qs("conversationMessages").innerHTML = '<span class="muted">Conversa ocultada da caixa. O Histórico continua preservado.</span>';
  }

  function confirmConversationDeleteReal() {
    var phrase = prompt("Apagar definitivamente esta conversa?\nEssa ação remove as mensagens do painel. Digite APAGAR para confirmar.");
    return phrase === "APAGAR";
  }

  async function deleteConversationMessages(phone) {
    if (!getToken()) return alert("Sessão expirada ou login ausente. Entre novamente no painel admin.");
    phone = phone || conversationSelectedPhone;
    if (!phone) return alert("Selecione uma conversa.");
    if (!confirmConversationDeleteReal()) return;
    await api("/api/chatbot-admin/conversations/" + encodeURIComponent(phone) + "/messages", { method: "DELETE", body: { tenant: convTenant(), confirm: "APAGAR" } });
    hideConversationContextMenu();
    if (String(conversationSelectedPhone) === String(phone)) {
      resetConversationSelection("Conversa apagada definitivamente.");
    }
    loadConversations();
  }

  function resetConversationSelection(message) {
    conversationSelectedPhone = "";
    conversationUserOpened = false;
    conversationSelectedLead = null;
    conversationReplyTarget = null;
    renderConversationReplyContext();
    if (qs("crmConversationGrid")) qs("crmConversationGrid").classList.remove("is-chat-open");
    document.body.classList.remove("mobile-chat-open");
    document.body.classList.remove("mobile-lead-open");
    if (qs("conversationMessages")) qs("conversationMessages").innerHTML = '<span class="muted">' + convEsc(message || "Selecione uma conversa à esquerda.") + '</span>';
    renderConversationList();
  }

  function conversationByPhone(phone) {
    return conversationRows.find(function (c) { return String(c.phone) === String(phone); }) || null;
  }

  function hideConversationContextMenu() {
    var menu = qs("conversationContextMenu");
    if (menu) menu.hidden = true;
    conversationContextPhone = "";
  }

  function showConversationContextMenu(phone, x, y) {
    var menu = qs("conversationContextMenu");
    if (!menu || !phone) return;
    conversationContextPhone = String(phone);
    var row = conversationByPhone(phone);
    var favBtn = menu.querySelector('[data-conv-menu-action="favorite"]');
    if (favBtn) {
      var isFav = !!(row && (row.isFavorite || (row.tags || []).indexOf("Favorito") >= 0));
      favBtn.textContent = isFav ? "★ Remover favorito" : "☆ Favoritar";
    }
    menu.hidden = false;
    var width = menu.offsetWidth || 230;
    var height = menu.offsetHeight || 250;
    var left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8));
    var top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8));
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function conversationMenuPhoneFromEvent(ev) {
    var row = ev.target && ev.target.closest && ev.target.closest("[data-conv-menu-phone]");
    return row ? row.getAttribute("data-conv-menu-phone") : "";
  }

  async function replyFromConversationMenu(phone) {
    hideConversationContextMenu();
    if (phone && String(phone) !== String(conversationSelectedPhone)) await loadConversationMessages(phone);
    var input = qs("conversationReplyText");
    if (input) input.focus();
  }

  async function toggleConversationFavorite(phone) {
    var row = conversationByPhone(phone) || {};
    var tags = Array.isArray(row.tags) ? row.tags.slice() : [];
    var idx = tags.indexOf("Favorito");
    if (idx >= 0) tags.splice(idx, 1);
    else tags.push("Favorito");
    await api("/api/chatbot-admin/conversations/" + encodeURIComponent(phone) + "/lead", { method: "PATCH", body: { tenant: convTenant(), tags: tags } });
    hideConversationContextMenu();
    loadConversations();
    if (String(phone) === String(conversationSelectedPhone)) loadConversationMessages(phone, true);
  }

  async function reactConversationMessage(messageId, emoji) {
    if (!conversationSelectedPhone || !messageId) return;
    await api("/api/chatbot-admin/conversations/" + encodeURIComponent(conversationSelectedPhone) + "/messages/" + encodeURIComponent(messageId) + "/reaction", { method: "POST", body: { tenant: convTenant(), emoji: emoji } });
    loadConversationMessages(conversationSelectedPhone, true);
  }

  async function markConversationUnread(phone) {
    await api("/api/chatbot-admin/conversations/" + encodeURIComponent(phone) + "/lead", { method: "PATCH", body: { tenant: convTenant(), unreadManual: true } });
    hideConversationContextMenu();
    loadConversations();
  }

  function forwardConversationFromMenu() {
    hideConversationContextMenu();
    alert("Encaminhar está em preparação para esta Central.");
  }

  async function handleConversationMenuAction(action) {
    var phone = conversationContextPhone || conversationSelectedPhone;
    if (!phone) return;
    if (action === "reply") return replyFromConversationMenu(phone);
    if (action === "forward") return forwardConversationFromMenu(phone);
    if (action === "favorite") return toggleConversationFavorite(phone);
    if (action === "unread") return markConversationUnread(phone);
    if (action === "transfer") return alert("Transferência de atendimento em preparação.");
    if (action === "archive") return clearConversation(phone, "Ocultar esta conversa da caixa de entrada?");
    if (action === "delete") return deleteConversationMessages(phone);
  }

  function closeConversationModals() {
    ["conversationMetaDetailsModal", "conversationTemplateModal"].forEach(function (id) {
      var el = qs(id);
      if (el) el.hidden = true;
    });
  }

  function showConversationMetaDetails(messageId) {
    var modal = qs("conversationMetaDetailsModal");
    var pre = qs("conversationMetaDetailsJson");
    if (!modal || !pre) return;
    var payload = conversationMetaDetailsById[String(messageId || "")] || {};
    pre.textContent = JSON.stringify(payload, null, 2);
    modal.hidden = false;
  }

  function approvedConversationTemplates() {
    return (metaTemplates || []).filter(function (tpl) {
      return String(tpl.status || "").toUpperCase() === "APPROVED";
    });
  }

  function renderConversationTemplateList() {
    var root = qs("conversationTemplateList");
    if (!root) return;
    var list = approvedConversationTemplates();
    if (!list.length) {
      root.innerHTML = '<div class="muted">Nenhum template aprovado carregado. Use Sincronizar Templates em Meta WhatsApp.</div>';
      renderConversationTemplateVars(null);
      return;
    }
    if (!conversationSelectedTemplateId) conversationSelectedTemplateId = String(list[0].id || "");
    root.innerHTML = list.map(function (tpl) {
      var on = String(tpl.id) === String(conversationSelectedTemplateId);
      return '<button type="button" class="' + (on ? 'is-active' : '') + '" data-conv-template-id="' + convEsc(tpl.id) + '"><strong>' + convEsc(tpl.favoriteLabel || tpl.name) + '</strong><span>' + convEsc(tpl.name) + ' · ' + convEsc(tpl.language || 'pt_BR') + '</span></button>';
    }).join("");
    renderConversationTemplateVars(list.find(function (tpl) { return String(tpl.id) === String(conversationSelectedTemplateId); }) || list[0]);
  }

  function renderConversationTemplateVars(tpl) {
    var root = qs("conversationTemplateVars");
    if (!root) return;
    if (!tpl) { root.innerHTML = ""; return; }
    var fields = [];
    if (tpl.needsHeaderImage) fields.push('<label>Imagem do cabeçalho<input type="url" data-conv-template-header-image placeholder="https://..." /></label>');
    (tpl.variableKeys || []).forEach(function (v) {
      fields.push('<label>' + convEsc(v.label || ('Variável ' + v.index)) + '<input type="text" data-conv-template-var="' + convEsc(v.key) + '" placeholder="' + convEsc(v.scope || 'body') + '" /></label>');
    });
    root.innerHTML = fields.length ? fields.join("") : '<div class="muted">Este template não exige variáveis.</div>';
  }

  async function openConversationTemplateModal(messageId) {
    conversationTemplateTargetMessage = messageId || "";
    conversationSelectedTemplateId = "";
    var modal = qs("conversationTemplateModal");
    var st = qs("conversationTemplateStatus");
    if (st) st.textContent = "Carregando templates aprovados...";
    if (modal) modal.hidden = false;
    try {
      if (!metaTemplates.length) await loadMetaTemplates(false);
      renderConversationTemplateList();
      if (st) st.textContent = approvedConversationTemplates().length ? "" : "Nenhum template aprovado disponível no cache.";
    } catch (e) {
      if (st) st.textContent = "Erro ao carregar templates: " + (e.message || e);
    }
  }

  async function sendConversationTemplateFromModal() {
    if (!conversationSelectedPhone) return alert("Selecione uma conversa.");
    var tpl = approvedConversationTemplates().find(function (x) { return String(x.id) === String(conversationSelectedTemplateId); });
    if (!tpl) return alert("Escolha um template aprovado.");
    var variables = {};
    document.querySelectorAll('[data-conv-template-var]').forEach(function (el) { variables[el.getAttribute('data-conv-template-var')] = el.value || ""; });
    var image = document.querySelector('[data-conv-template-header-image]');
    var st = qs("conversationTemplateStatus");
    if (st) st.textContent = "Enviando template...";
    try {
      await api("/api/chatbot-admin/meta/templates/send", { method: "POST", body: { tenant: convTenant(), to: conversationSelectedPhone, templateId: tpl.id, variables: variables, headerImageUrl: image ? image.value.trim() : "" } });
      if (conversationTemplateTargetMessage) conversationTemplateResults[conversationTemplateTargetMessage] = "success";
      if (st) st.textContent = "✅ Template enviado com sucesso";
      loadConversationMessages(conversationSelectedPhone, true);
      loadConversations();
      setTimeout(closeConversationModals, 900);
    } catch (e) {
      if (conversationTemplateTargetMessage) conversationTemplateResults[conversationTemplateTargetMessage] = "failed";
      if (st) st.textContent = "❌ Falha ao enviar template: " + ((e.data && e.data.message) || e.message || e);
      loadConversationMessages(conversationSelectedPhone, true);
    }
  }

  async function restoreConversationFromHistory(phone) {
    if (!phone) return;
    await api("/api/chatbot-admin/conversations/" + encodeURIComponent(phone) + "/restore", { method: "POST", body: { tenant: convTenant() } });
    alert("Conversa restaurada para a caixa.");
    loadDeliveryHistoryReal(false);
    loadConversations();
  }

  function startConversationPolling() {
    if (conversationsPollTimer) clearInterval(conversationsPollTimer);
    conversationsPollTimer = setInterval(function () {
      var active = document.querySelector(".tab-panel.is-active");
      if (!active || active.id !== "tab-conversations") return;
      loadConversations();
      if (conversationUserOpened && conversationSelectedPhone) loadConversationMessages(conversationSelectedPhone, true);
    }, 10000);
  }

  function stopConversationPolling() {
    if (conversationsPollTimer) {
      clearInterval(conversationsPollTimer);
      conversationsPollTimer = null;
    }
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
    if (tabId === "history") {
      try {
        loadDeliveryHistoryReal(false);
        startWhatsappHistoryPolling();
      } catch (e) {
        console.error("history_load_error", e);
      }
    } else {
      try {
        stopWhatsappHistoryPolling();
      } catch (e) {
        console.error("history_poll_stop_error", e);
      }
    }

    if (tabId === "conversations") {
      try {
        resetConversationSelection();
        loadConversationOperators();
        loadConversations();
        startConversationPolling();
      } catch (e) {
        console.error("conversations_load_error", e);
      }
    } else {
      document.body.classList.remove("mobile-chat-open");
      document.body.classList.remove("mobile-lead-open");
      try {
        stopConversationPolling();
      } catch (e) {
        console.error("conversations_poll_stop_error", e);
      }
    }

    if (tabId === "meta-templates") {
      loadMetaTemplates(metaTemplates.length === 0);
    }
    if (tabId === "meta-history") {
      loadMetaHistory();
    }
    if (tabId === "meta-stats") {
      loadMetaStats();
    }

    if (tabId === "campaigns") {
      setTimeout(function () {
        try {
          if (_googleMap && window.google && google.maps) {
            google.maps.event.trigger(_googleMap, "resize");
            var tla = parseFloat((qs("coverageLat") && qs("coverageLat").value) || "");
            var tlo = parseFloat((qs("coverageLng") && qs("coverageLng").value) || "");
            var tr = parseInt((qs("coverageRadius") && qs("coverageRadius").value) || "0", 10);
            if (!Number.isFinite(tr) || tr < 1) {
              tr = DEFAULT_COVERAGE_RADIUS;
            }
            if (isValidLatLng(tla, tlo) && _googleMarker && _googleCircle) {
              var tp = { lat: tla, lng: tlo };
              _googleMarker.setPosition(tp);
              _googleCircle.setCenter(tp);
              _googleCircle.setRadius(tr);
            }
          }
        } catch (e) {
          /* ignore */
        }
      }, 300);
    }
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
    qs("t_pascoaText").value = t.pascoaText || "";
    qs("t_diaDasMaesText").value = t.diaDasMaesText || "";
    qs("t_diaDosPaisText").value = t.diaDosPaisText || "";
    qs("t_natalText").value = t.natalText || "";
    qs("t_anoNovoText").value = t.anoNovoText || "";

    var a = cfg.campaignActive || {};
    qs("a_aniversario").checked = a.aniversario !== false;

    var commercial = cfg.commercial || {};
    if (qs("commercialPlanFlyerEnabled")) qs("commercialPlanFlyerEnabled").checked = !!commercial.commercialPlanFlyerEnabled;
    if (qs("commercialPlanFlyerImageUrl")) qs("commercialPlanFlyerImageUrl").value = commercial.commercialPlanFlyerImageUrl || "";
    setCommercialPlanFlyerPreview(commercial.commercialPlanFlyerImageUrl || "");
    if (qs("commercialPlanFlyerCaption")) qs("commercialPlanFlyerCaption").value = commercial.commercialPlanFlyerCaption || "";

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

    
      var automation = cfg.automation || {};

      if (qs("billingLiveToggle")) {
        qs("billingLiveToggle").checked =
          automation.billingLive !== false;
      }

      if (qs("seasonalLiveToggle")) {
        qs("seasonalLiveToggle").checked =
          automation.seasonalLive !== false;
      }

      if (qs("campaignMaxInput")) {
        qs("campaignMaxInput").value =
          Number(automation.campaignMax || 10);
      }

      if (qs("billingMaxInput")) {
        qs("billingMaxInput").value =
          Number(automation.billingMax || 5);
      }

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
          pascoaText: qs("t_pascoaText").value.trim(),
          diaDasMaesText: qs("t_diaDasMaesText").value.trim(),
          diaDosPaisText: qs("t_diaDosPaisText").value.trim(),
          natalText: qs("t_natalText").value.trim(),
          anoNovoText: qs("t_anoNovoText").value.trim(),
      },
      campaignActive: {
        aniversario: qs("a_aniversario").checked,
      },
      commercialPlanFlyerEnabled: !!(qs("commercialPlanFlyerEnabled") && qs("commercialPlanFlyerEnabled").checked),
      commercialPlanFlyerImageUrl: qs("commercialPlanFlyerImageUrl") ? qs("commercialPlanFlyerImageUrl").value.trim() : "",
      commercialPlanFlyerCaption: qs("commercialPlanFlyerCaption") ? qs("commercialPlanFlyerCaption").value.trim() : "",
      commercial: {
        commercialPlanFlyerEnabled: !!(qs("commercialPlanFlyerEnabled") && qs("commercialPlanFlyerEnabled").checked),
        commercialPlanFlyerImageUrl: qs("commercialPlanFlyerImageUrl") ? qs("commercialPlanFlyerImageUrl").value.trim() : "",
        commercialPlanFlyerCaption: qs("commercialPlanFlyerCaption") ? qs("commercialPlanFlyerCaption").value.trim() : "",
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

      automation: {
        billingLive:
          !!(qs("billingLiveToggle") &&
             qs("billingLiveToggle").checked),

        seasonalLive:
          !!(qs("seasonalLiveToggle") &&
             qs("seasonalLiveToggle").checked),

        campaignMax:
          Number(
            (qs("campaignMaxInput") &&
             qs("campaignMaxInput").value) || 10
          ),

        billingMax:
          Number(
            (qs("billingMaxInput") &&
             qs("billingMaxInput").value) || 5
          ),
      },
    };
  }

  function getLoginErrorMessage(err) {
    var status = Number(err && err.status);
    var raw = (err && (err.message || (err.data && (err.data.message || err.data.error)))) || "";
    var msg = String(raw || "").toLowerCase();

    if (status === 401 || status === 403 || /senha|credenc|unauthoriz|invalid/.test(msg)) {
      return "Senha incorreta. Verifique e tente novamente.";
    }
    if (status >= 500 || status === 404 || status === 503) {
      return "Endpoint de login indisponível no momento.";
    }
    if (/failed to fetch|network|fetch|load failed|ecconnrefused|enotfound|timeout/.test(msg)) {
      return "Erro de conexão. Confira a internet e tente novamente.";
    }
    return "Falha no login. Tente novamente.";
  }

  async function handleLogin(ev) {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    if (loginInFlight) return;

    var emailEl = qs("email");
    var passwordEl = qs("password");
    var email = emailEl ? emailEl.value.trim() : "";
    var password = passwordEl ? passwordEl.value : "";

    if (!email || !password) {
      setText(qs("loginStatus"), "Informe e-mail e senha para entrar.", "err");
      return;
    }

    loginInFlight = true;
    setText(qs("loginStatus"), "Entrando...", "muted");
    try {
      var data = await api("/api/admin/login", {
        method: "POST",
        body: {
          email: email,
          password: password,
        },
      });
      if (!data.token) throw new Error("sem_token");
      setToken(data.token);
      var me = await api("/api/chatbot-admin/me");
      currentAdmin = me.admin || null;
      setText(qs("loginStatus"), "Login realizado, carregando painel...", "ok");
      if (passwordEl) passwordEl.value = "";
      if (qs("loginCard")) qs("loginCard").style.display = "none";
      if (qs("editorCard")) qs("editorCard").style.display = "block";
      setSidebarVisible(true);
      if (qs("btnLogout")) qs("btnLogout").style.display = "inline-block";
      document.body.classList.remove("mobile-chat-open");
      document.body.classList.remove("mobile-lead-open");

      try {
        loadAutomationStatus();
      } catch (e1) {
        console.error("loadAutomationStatus_after_login_error", e1);
      }
      await loadConfig();
    } catch (e) {
      setToken("");
      setText(qs("loginStatus"), getLoginErrorMessage(e), "err");
    } finally {
      loginInFlight = false;
    }
  }

  async function login(ev) {
    return handleLogin(ev);
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
    document.body.classList.remove("mobile-chat-open");
    document.body.classList.remove("mobile-lead-open");
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
      try {
        loadCoverageAreas();
      } catch (e0) {
        /* ignore */
      }
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

  function renderAutomationLogs(logs) {
    var box = qs("automationLogsList");
    if (!box) return;

    if (!Array.isArray(logs) || !logs.length) {
      box.innerHTML = '<div class="automation-log-row">Nenhum evento recente.</div>';
      return;
    }

    box.innerHTML = logs
      .map(function (log) {
        var level = String(log.level || "info").toLowerCase();
        var type = String(log.type || "system").toUpperCase();
        var msg = String(log.message || "");
        var time = log.time ? new Date(log.time).toLocaleString("pt-BR") : "";

        return (
          '<div class="automation-log-row automation-log-row--' + level + '">' +
            '<div class="automation-log-main">' +
              '<span class="automation-log-type">' + type + '</span>' +
              '<strong>' + msg.replace(/[<>&]/g, "") + '</strong>' +
            '</div>' +
            '<small>' + time + '</small>' +
          '</div>'
        );
      })
      .join("");
  }

  async function loadAutomationLogs() {
    try {
      const data = await api("/api/chatbot-admin/automation/logs-real");
      if (data && data.ok) renderAutomationLogs(data.logs || []);
    } catch (e) {
      console.error("automation_logs_error", e);
      renderAutomationLogs([
        {
          type: "system",
          level: "error",
          message: "Erro ao carregar logs operacionais",
          time: new Date().toISOString(),
        },
      ]);
    }
  }

  async function loadAutomationStatus() {
    try {
      const data = await api("/api/chatbot-admin/automation/status");

      if (!data || !data.ok) {
          if (qs("d_totalJobs")) qs("d_totalJobs").textContent = "0";
          if (qs("d_totalSent")) qs("d_totalSent").textContent = "0";
          if (qs("d_totalFailed")) qs("d_totalFailed").textContent = "0";
          if (qs("d_successRate")) qs("d_successRate").textContent = "0%";
          return;
        }

      // Billing
      if (qs("autoBillingStatus")) {
        qs("autoBillingStatus").textContent =
          data.billing?.enabled
            ? String(data.billing?.mode || "LIVE").toUpperCase()
            : "OFF";
      }

      // Campaign
      if (qs("autoCampaignStatus")) {
        qs("autoCampaignStatus").textContent =
          data.seasonalCampaign?.enabled
            ? String(data.seasonalCampaign?.mode || "LIVE").toUpperCase()
            : "OFF";
      }

      // Sync
      if (qs("autoSyncStatus")) {
        qs("autoSyncStatus").textContent =
          data.sync?.enabled ? "ONLINE" : "OFF";
      }

      // Limits
      if (qs("autoCampaignLimit")) {
        qs("autoCampaignLimit").textContent =
          String(data.seasonalCampaign?.maxSends || 0);
      }

      if (qs("autoBillingLimit")) {
        qs("autoBillingLimit").textContent =
          String(data.billing?.maxSends || 0);
      }

        // Indicadores reais
        let totalJobs = 0;
        let totalSent = 0;
        let totalFailed = 0;
        let successRate = 0;
        let campaignRows = [];

        try {
          const overview = await api("/api/chatbot-admin/broadcast/overview");

          if (overview && overview.ok) {
            totalJobs = Number(overview.stats?.totalJobs || 0);
            totalSent = Number(overview.stats?.totalSent || 0);
            totalFailed = Number(overview.stats?.totalFailed || 0);
            successRate = Number(overview.stats?.successRate || 0);
            campaignRows = Array.isArray(overview.jobs)
              ? overview.jobs
              : [];
          }
        } catch (e) {
          console.error("broadcast_overview_error", e);
        }

        if (qs("d_totalJobs")) {
          qs("d_totalJobs").textContent = String(totalJobs);
        }

        if (qs("d_totalSent")) {
          qs("d_totalSent").textContent = String(totalSent);
        }

        if (qs("d_totalFailed")) {
          qs("d_totalFailed").textContent = String(totalFailed);
        }

        if (qs("d_successRate")) {
          qs("d_successRate").textContent = String(successRate) + "%";
        }

        if (qs("d_history")) {
          if (!campaignRows.length) {
            qs("d_history").innerHTML =
              '<div class="muted">Nenhuma campanha registrada ainda.</div>';
          } else {
            qs("d_history").innerHTML = campaignRows.map(function (item) {
              const when =
                item.executedAt || item.createdAt
                  ? new Date(item.executedAt || item.createdAt).toLocaleString("pt-BR")
                  : "-";

              return [
                '<div class="history-row">',
                '<strong>' + String(item.campaignKey || item.type || "campanha") + '</strong>',
                '<span>Modo: ' + String(item.mode || "-").toUpperCase() + '</span>',
                '<span>Enviadas: ' + String(item.totalSent || 0) + '</span>',
                '<span>Falhas: ' + String(item.totalFailed || 0) + '</span>',
                '<span>Horário: ' + when + '</span>',
                '</div>'
              ].join("");
            }).join("");
          }
        }

      // Geral
      if (qs("autoGeneralStatus")) {
        qs("autoGeneralStatus").textContent = "OPERACIONAL";
      }

      loadAutomationLogs();

      // Leads extras
      if (!qs("automationLeadStats") && qs("autoGeneralStatus")) {
        const wrap = qs("autoGeneralStatus").closest(".automation-item");

        if (wrap) {
          const extra = document.createElement("small");
          extra.id = "automationLeadStats";

          extra.textContent =
            "Leads: " +
            (data.leads?.total || 0) +
            " • Ativos: " +
            (data.leads?.active || 0) +
            " • Inativos: " +
            (data.leads?.inactive || 0);

          wrap.appendChild(extra);
        }
      }
    } catch (e) {
      console.error("automation_status_error", e);
    }
  }


  function setCommercialPlanFlyerPreview(src) {
    var img = qs("commercialPlanFlyerPreview");
    if (!img) return;
    var url = String(src || "").trim();
    if (!url) {
      img.hidden = true;
      img.classList.remove("show");
      img.removeAttribute("src");
      return;
    }
    img.src = url;
    img.hidden = false;
    img.classList.add("show");
  }

  function wirePreviews() {
    var commercialUrlInput = qs("commercialPlanFlyerImageUrl");
    if (commercialUrlInput) {
      commercialUrlInput.addEventListener("blur", function () {
        setCommercialPlanFlyerPreview(commercialUrlInput.value);
      });
      commercialUrlInput.addEventListener("input", function () {
        if (!commercialUrlInput.value.trim()) setCommercialPlanFlyerPreview("");
      });
    }

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
    initMobileMenu();
    var loginForm = qs("loginForm");
    var loginBtn = qs("btnLogin");
    if (loginForm) {
      loginForm.addEventListener("submit", handleLogin);
    }
    if (loginBtn) {
      loginBtn.addEventListener("click", handleLogin);
      loginBtn.addEventListener("touchend", function (ev) {
        handleLogin(ev);
      }, { passive: false });
    }
    qs("btnLogout").addEventListener("click", logout);
    qs("btnLoad").addEventListener("click", loadConfig);
    
qs("btnSave").addEventListener("click", save);

      if (qs("btnSaveAutomationLive")) {
        qs("btnSaveAutomationLive")
          .addEventListener("click", save);
      }

    if (qs("btnSaveCommercialFlyer")) {
      qs("btnSaveCommercialFlyer").addEventListener("click", save);
    }

      if (qs("btnRunSeasonalNow")) {
        qs("btnRunSeasonalNow").addEventListener("click", async function () {
          const btn = qs("btnRunSeasonalNow");

          try {
            btn.disabled = true;
            btn.textContent = "Executando...";

            const data = await api(
              "/api/chatbot-admin/seasonal/run-now",
              {
                method: "POST",
              }
            );

            alert(
              data.message ||
                "Campanha sazonal iniciada com sucesso."
            );

            try {
              loadDashboard();
            } catch (e) {
              /* ignore */
            }
          } catch (e) {
            alert(
              "Erro ao iniciar campanha: " +
                (e.message || e)
            );
          } finally {
            btn.disabled = false;
            btn.textContent = "Executar campanha agora";
          }
        });
      }

    wirePreviews();
    initDigitalFlyerLinks();
    initCoverageMap();
    if (qs("btnSaveCoverageArea")) {
      qs("btnSaveCoverageArea").addEventListener("click", saveCoverageArea);
    }
    if (qs("btnReloadCoverageAreas")) {
      qs("btnReloadCoverageAreas").addEventListener("click", loadCoverageAreas);
    }
    if (qs("tenant")) {
      qs("tenant").addEventListener("change", function () {
        loadCoverageAreas();
      });
    }
    if (qs("coverageForm")) {
      qs("coverageForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        saveCoverageArea();
      });
    }
    if (getToken()) {
      try {
        loadCoverageAreas();
      } catch (e) {
        /* ignore */
      }
    }

    // Upload de imagem de campanha
    if (qs("commercialPlanFlyerFile")) {
      qs("commercialPlanFlyerFile").addEventListener("change", function () {
        const file = this.files && this.files[0];
        if (!file) {
          setCommercialPlanFlyerPreview(qs("commercialPlanFlyerImageUrl") ? qs("commercialPlanFlyerImageUrl").value : "");
          return;
        }
        setCommercialPlanFlyerPreview(URL.createObjectURL(file));
      });
    }

    if (qs("btnUploadCommercialPlanFlyer")) {
      qs("btnUploadCommercialPlanFlyer").addEventListener("click", async function () {
        try {
          const fileInput = qs("commercialPlanFlyerFile");
          const file = fileInput && fileInput.files && fileInput.files[0];

          if (!file) {
            alert("Selecione uma imagem primeiro.");
            return;
          }

          const status = qs("commercialFlyerUploadStatus");
          if (status) status.textContent = "Enviando imagem...";

          const formData = new FormData();
          formData.append("file", file);

          const token = getToken();
          const res = await fetch(API + "/api/chatbot-admin/uploads/campaign-image", {
            method: "POST",
            headers: token ? { Authorization: "Bearer " + token } : {},
            body: formData,
          });

          const data = await res.json();

          if (!res.ok || !data.url) {
            throw new Error(data.error || "Erro no upload");
          }

          if (qs("commercialPlanFlyerImageUrl")) {
            qs("commercialPlanFlyerImageUrl").value = data.url;
          }

          setCommercialPlanFlyerPreview(data.url);

          if (status) status.textContent = "Imagem enviada. Clique em Salvar.";
          console.log("Upload panfleto comercial OK:", data.url);
        } catch (e) {
          console.error(e);
          if (qs("commercialFlyerUploadStatus")) qs("commercialFlyerUploadStatus").textContent = "Erro no upload.";
          alert("Erro ao enviar imagem: " + (e.message || e));
        }
      });
    }

    if (qs("btnUploadCampaignImage")) {
      qs("btnUploadCampaignImage").addEventListener("click", async function () {
        try {
          const fileInput = qs("campaignImageFile");
          const file = fileInput && fileInput.files && fileInput.files[0];

          if (!file) {
            alert("Selecione uma imagem primeiro.");
            return;
          }

          const formData = new FormData();
          formData.append("file", file);

          const token = getToken();

          const res = await fetch(API + "/api/chatbot-admin/uploads/campaign-image", {
            method: "POST",
            headers: token ? { Authorization: "Bearer " + token } : {},
            body: formData,
          });

          const data = await res.json();

          if (!res.ok || !data.url) {
            throw new Error(data.error || "Erro no upload");
          }

          if (qs("campaignImageGeneratedUrl")) {
            qs("campaignImageGeneratedUrl").value = data.url;
          }

          if (qs("mb_imageUrl")) {
            qs("mb_imageUrl").value = data.url;
          }

          if (qs("campaignImagePreview")) {
            qs("campaignImagePreview").src = data.url;
            qs("campaignImagePreview").hidden = false;
          }

          console.log("Upload OK:", data.url);
        } catch (e) {
          console.error(e);
          alert("Erro ao enviar imagem: " + (e.message || e));
        }
      });
    }

    document.querySelectorAll(".sidebar-link[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-tab");
        if (id) switchTab(id);
      });
    });

    document.addEventListener("click", function (ev) {
      var tabBtn = ev.target && ev.target.closest && ev.target.closest("[data-tab]:not(.sidebar-link)");
      if (!tabBtn) return;
      var tabId = tabBtn.getAttribute("data-tab");
      if (tabId) {
        ev.preventDefault();
        switchTab(tabId);
      }
    });

    document.addEventListener("change", function (ev) {
      if (ev.target && ev.target.id === "conversationAvatarFile") previewConversationAvatarFile();
    });
    document.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest("#btnConversationSaveAvatar");
      if (!btn) return;
      ev.preventDefault();
      saveConversationAvatar();
    });
    document.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest("#btnConversationTransfer");
      if (!btn) return;
      ev.preventDefault();
      transferConversation();
    });

    if (qs("btnConversationsRefresh")) qs("btnConversationsRefresh").addEventListener("click", loadConversations);
    if (qs("btnConversationSound")) qs("btnConversationSound").addEventListener("click", function () {
      conversationSoundEnabled = !conversationSoundEnabled;
      localStorage.setItem("dcnet_conversation_sound", conversationSoundEnabled ? "on" : "off");
      updateConversationAlertButtons();
    });
    if (qs("btnConversationNotify")) qs("btnConversationNotify").addEventListener("click", toggleConversationNotifications);
    updateConversationAlertButtons();
    if (qs("conversationSearch")) qs("conversationSearch").addEventListener("input", function () { clearTimeout(window.__convSearchTimer); window.__convSearchTimer = setTimeout(loadConversations, 350); });
    if (qs("btnConversationBack")) qs("btnConversationBack").addEventListener("click", function () {
      resetConversationSelection();
    });
    if (qs("btnConversationSearch")) qs("btnConversationSearch").addEventListener("click", function () {
      conversationThreadSearch = prompt("Pesquisar nesta conversa", conversationThreadSearch || "") || "";
      renderConversationTimeline(conversationLastMessages);
    });
    if (qs("crmConversationGrid")) qs("crmConversationGrid").classList.add("lead-panel-open");
    if (qs("btnConversationToggleLead")) qs("btnConversationToggleLead").addEventListener("click", function () {
      var grid = qs("crmConversationGrid");
      var panel = qs("conversationLeadPanel");
      if (!grid || !panel) return;
      if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) {
        document.body.classList.add("mobile-chat-open");
        document.body.classList.add("mobile-lead-open");
        panel.classList.remove("is-hidden");
        return;
      }
      var closing = grid.classList.contains("lead-panel-open");
      grid.classList.toggle("lead-panel-open", !closing);
      grid.classList.toggle("lead-panel-closed", closing);
      panel.classList.toggle("is-hidden", closing);
    });
    if (qs("btnConversationCloseLead")) qs("btnConversationCloseLead").addEventListener("click", function () {
      document.body.classList.remove("mobile-lead-open");
    });
    document.addEventListener("click", function (ev) {
      var chip = ev.target && ev.target.closest && ev.target.closest("[data-conv-filter]");
      if (!chip) return;
      conversationActiveFilter = chip.getAttribute("data-conv-filter") || "all";
      document.querySelectorAll("[data-conv-filter]").forEach(function (el) { el.classList.toggle("is-active", el === chip); });
      renderConversationList();
    });
    function openConversationFilePicker() {
      var input = qs("conversationReplyFile");
      if (input) input.click();
    }
    if (qs("conversationReplyFile")) qs("conversationReplyFile").addEventListener("change", function () {
      uploadConversationAttachment(this.files && this.files[0]);
    });
    var cam = document.querySelector(".crm-camera");
    if (cam) cam.addEventListener("click", openConversationFilePicker);
    var mic = document.querySelector(".crm-mic");
    if (mic) mic.addEventListener("click", openConversationFilePicker);
    if (qs("btnConversationQuickReplies")) qs("btnConversationQuickReplies").addEventListener("click", openQuickReplies);
    if (qs("btnConversationSuggestReply")) qs("btnConversationSuggestReply").addEventListener("click", suggestConversationReply);
    if (qs("btnConversationSearch")) qs("btnConversationSearch").addEventListener("click", function () { if (qs("conversationSearch")) qs("conversationSearch").focus(); });
    if (qs("btnConversationMenu")) qs("btnConversationMenu").addEventListener("click", function (ev) {
      if (!conversationSelectedPhone) return alert("Selecione uma conversa.");
      showConversationContextMenu(conversationSelectedPhone, ev.clientX || (window.innerWidth - 260), ev.clientY || 72);
    });
    if (qs("btnConversationSend")) qs("btnConversationSend").addEventListener("click", sendConversationReply);
    if (qs("btnConversationAssume")) qs("btnConversationAssume").addEventListener("click", function () { conversationAction("assume"); });
    if (qs("btnConversationResolve")) qs("btnConversationResolve").addEventListener("click", function () { conversationAction("resolve"); });
    if (qs("btnConversationRelease")) qs("btnConversationRelease").addEventListener("click", function () { conversationAction("release"); });
    if (qs("btnConversationReopen")) qs("btnConversationReopen").addEventListener("click", function () { conversationAction("reopen"); });
    if (qs("btnConversationSaveLead")) qs("btnConversationSaveLead").addEventListener("click", saveConversationLead);
    if (qs("btnConversationOpenWhatsApp")) qs("btnConversationOpenWhatsApp").addEventListener("click", function () { if (conversationSelectedPhone) window.open("https://wa.me/" + conversationSelectedPhone, "_blank", "noopener"); });
    if (qs("btnConversationHeaderWhatsApp")) qs("btnConversationHeaderWhatsApp").addEventListener("click", function () { if (conversationSelectedPhone) window.open("https://wa.me/" + conversationSelectedPhone, "_blank", "noopener"); });
    if (qs("btnConversationCopyPhone")) qs("btnConversationCopyPhone").addEventListener("click", function () { if (conversationSelectedPhone && navigator.clipboard) navigator.clipboard.writeText(conversationSelectedPhone); });
    if (qs("btnConversationClear")) qs("btnConversationClear").addEventListener("click", function () { clearConversation(conversationSelectedPhone); });
    document.addEventListener("dblclick", function (ev) {
      var phone = conversationMenuPhoneFromEvent(ev);
      if (!phone) return;
      ev.preventDefault();
      showConversationContextMenu(phone, ev.clientX || 24, ev.clientY || 24);
    });
    document.addEventListener("contextmenu", function (ev) {
      var phone = conversationMenuPhoneFromEvent(ev);
      if (!phone) return;
      ev.preventDefault();
      showConversationContextMenu(phone, ev.clientX || 24, ev.clientY || 24);
    });
    document.addEventListener("pointerdown", function (ev) {
      var phone = conversationMenuPhoneFromEvent(ev);
      if (!phone || ev.pointerType === "mouse") return;
      clearTimeout(conversationLongPressTimer);
      conversationLongPressTimer = setTimeout(function () {
        showConversationContextMenu(phone, ev.clientX || 24, ev.clientY || 24);
      }, 650);
    });
    ["pointerup", "pointercancel", "scroll"].forEach(function (evtName) {
      document.addEventListener(evtName, function () { clearTimeout(conversationLongPressTimer); }, true);
    });
    document.addEventListener("click", function (ev) {
      var actionBtn = ev.target && ev.target.closest && ev.target.closest("[data-conv-menu-action]");
      if (actionBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        handleConversationMenuAction(actionBtn.getAttribute("data-conv-menu-action"));
        return;
      }
      var menu = qs("conversationContextMenu");
      if (menu && !menu.hidden && !ev.target.closest("#conversationContextMenu") && !ev.target.closest("[data-conv-menu-phone]")) hideConversationContextMenu();
    });

    document.addEventListener("click", function (ev) {
      var clearAttachment = ev.target && ev.target.closest && ev.target.closest("[data-clear-conv-attachment]");
      if (clearAttachment) {
        ev.preventDefault();
        clearConversationAttachment();
        return;
      }
      var clearReply = ev.target && ev.target.closest && ev.target.closest("[data-clear-reply-context]");
      if (clearReply) {
        ev.preventDefault();
        conversationReplyTarget = null;
        renderConversationReplyContext();
        document.querySelectorAll(".crm-msg-line.is-selected").forEach(function (el) { el.classList.remove("is-selected"); });
        return;
      }
      var react = ev.target && ev.target.closest && ev.target.closest("[data-conv-react]");
      if (react) {
        ev.preventDefault();
        var wrap = react.closest("[data-conv-message-id]");
        if (wrap) reactConversationMessage(wrap.getAttribute("data-conv-message-id"), react.getAttribute("data-conv-react"));
        return;
      }
      var msg = ev.target && ev.target.closest && ev.target.closest("[data-conv-message-id]");
      if (msg && !ev.target.closest("button") && !ev.target.closest("a") && !ev.target.closest("audio") && !ev.target.closest("video")) {
        selectConversationMessage(msg.getAttribute("data-conv-message-id"));
      }
    });

    document.addEventListener("click", function (ev) {
      var restore = ev.target && ev.target.closest && ev.target.closest("[data-wa-restore-phone]");
      if (restore) {
        ev.preventDefault();
        ev.stopPropagation();
        restoreConversationFromHistory(restore.getAttribute("data-wa-restore-phone"));
        return;
      }
      var btn = ev.target && ev.target.closest && ev.target.closest("[data-conv-phone]");
      if (!btn) return;
      ev.preventDefault();
      loadConversationMessages(btn.getAttribute("data-conv-phone"));
    });

    if (qs("btnWaHistoryRefresh")) qs("btnWaHistoryRefresh").addEventListener("click", function () { loadDeliveryHistoryReal(false); });
    if (qs("btnWaHistoryMore")) qs("btnWaHistoryMore").addEventListener("click", function () { waHistoryPage += 1; loadDeliveryHistoryReal(true); });
    if (qs("btnWaHistoryCloseDetails")) qs("btnWaHistoryCloseDetails").addEventListener("click", function () { if (qs("waHistoryDetails")) qs("waHistoryDetails").hidden = true; });
    ["waHistoryFilter", "waHistoryPhone", "waHistorySearch", "waHistoryDateFrom", "waHistoryDateTo"].forEach(function (id) {
      var el = qs(id);
      if (!el) return;
      el.addEventListener(id === "waHistoryFilter" || id.indexOf("Date") >= 0 ? "change" : "input", function () {
        clearTimeout(window.__waHistoryFilterTimer);
        window.__waHistoryFilterTimer = setTimeout(function () { loadDeliveryHistoryReal(false); }, id === "waHistorySearch" || id === "waHistoryPhone" ? 450 : 0);
      });
    });
    document.addEventListener("click", function (ev) {
      var row = ev.target && ev.target.closest && ev.target.closest("[data-wa-history-id]");
      if (!row) return;
      showWhatsappHistoryDetails(row.getAttribute("data-wa-history-id"));
    });

    document.addEventListener("click", function (ev) {
      var details = ev.target && ev.target.closest && ev.target.closest("[data-conv-meta-details-id]");
      if (details) {
        ev.preventDefault();
        showConversationMetaDetails(details.getAttribute("data-conv-meta-details-id") || "");
        return;
      }
      var tplBtn = ev.target && ev.target.closest && ev.target.closest("[data-conv-template-message]");
      if (tplBtn) {
        ev.preventDefault();
        openConversationTemplateModal(tplBtn.getAttribute("data-conv-template-message"));
        return;
      }
      var chooseTpl = ev.target && ev.target.closest && ev.target.closest("[data-conv-template-id]");
      if (chooseTpl) {
        ev.preventDefault();
        conversationSelectedTemplateId = chooseTpl.getAttribute("data-conv-template-id") || "";
        renderConversationTemplateList();
        return;
      }
      var quick = ev.target && ev.target.closest && ev.target.closest("[data-quick-reply]");
      if (quick) {
        ev.preventDefault();
        var item = conversationQuickReplies[Number(quick.getAttribute("data-quick-reply"))];
        if (item && qs("conversationReplyText")) qs("conversationReplyText").value = item[1];
        closeConversationModals();
        if (qs("conversationReplyText")) qs("conversationReplyText").focus();
        return;
      }
      if (ev.target && ev.target.closest && ev.target.closest("[data-close-conv-modal]")) {
        ev.preventDefault();
        closeConversationModals();
      }
    });
    if (qs("btnConversationSendTemplate")) qs("btnConversationSendTemplate").addEventListener("click", sendConversationTemplateFromModal);

    if (qs("btnMetaRenderTemplateTests")) qs("btnMetaRenderTemplateTests").addEventListener("click", function () {
      if (!metaTemplates.length) loadMetaTemplates(false).then(renderMetaTemplateTests);
      else renderMetaTemplateTests();
    });
    document.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest("[data-meta-test-template]");
      if (!btn) return;
      ev.preventDefault();
      testMetaTemplate(btn.getAttribute("data-meta-test-template"));
    });

    if (qs("btnMetaSyncTemplates")) qs("btnMetaSyncTemplates").addEventListener("click", function () { loadMetaTemplates(true); });
    if (qs("btnMetaSendTemplate")) qs("btnMetaSendTemplate").addEventListener("click", sendMetaTemplateSmart);
    if (qs("btnMetaReloadHistory")) qs("btnMetaReloadHistory").addEventListener("click", loadMetaHistory);
    if (qs("btnMetaReloadStats")) qs("btnMetaReloadStats").addEventListener("click", loadMetaStats);
    document.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest("[data-meta-send]");
      if (!btn) return;
      ev.preventDefault();
      selectMetaTemplate(btn.getAttribute("data-meta-send"));
    });

    if (qs("btnMbPreview")) qs("btnMbPreview").addEventListener("click", maintenanceBroadcastPreview);
    if (qs("btnMbTest")) qs("btnMbTest").addEventListener("click", maintenanceBroadcastTest);
    if (qs("btnMbTemplateTest")) qs("btnMbTemplateTest").addEventListener("click", maintenanceBroadcastTemplateTest);

      async function sendBillingTemplateTest(type) {

        try {

          const phone =
            (qs("mb_testPhone") && qs("mb_testPhone").value || "").trim();

          if (!phone) {
            alert("Informe telefone de teste");
            return;
          }

          const token = localStorage.getItem("dcinf_chatbot_content_token") || "";

          const res = await fetch(
            API + "/api/chatbot-admin/billing/test-template",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token,
              },
              body: JSON.stringify({
                phone,
                type
              }),
            }
          );

          const data = await res.json();

          if (!res.ok || !data.ok) {
            throw new Error(data.error || "Erro no teste");
          }

          alert("Template enviado com sucesso!");

          console.log(data);

        } catch (e) {

          console.error(e);

          alert("Erro: " + (e.message || e));
        }
      }

      if (qs("btnBillingD2Test")) {
        qs("btnBillingD2Test").addEventListener("click", function () {
          sendBillingTemplateTest("d2");
        });
      }

      if (qs("btnBillingReactivationTest")) {
        qs("btnBillingReactivationTest").addEventListener("click", function () {
          sendBillingTemplateTest("reactivation");
        });
      }
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
        .then(function (me) {
          currentAdmin = me.admin || null;
          qs("loginCard").style.display = "none";
          qs("editorCard").style.display = "block";
          setSidebarVisible(true);
          if (qs("btnLogout")) qs("btnLogout").style.display = "inline-block";

        try {
          loadAutomationStatus();
        } catch (e1) {
          console.error("loadAutomationStatus_after_login_error", e1);
        }
          setText(qs("loginStatus"), "Sessão restaurada.", "ok");
          return loadConfig();
        })
        .catch(function () {
          setToken("");
          if (qs("editorCard")) qs("editorCard").style.display = "none";
          if (qs("loginCard")) qs("loginCard").style.display = "block";
          setSidebarVisible(false);
          setText(qs("loginStatus"), "Sessão expirada. Faça login novamente.", "muted");
          document.body.classList.remove("mobile-chat-open");
          document.body.classList.remove("mobile-lead-open");
        });
    }
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker
          .register("/chatbot-admin/sw.js", { scope: "/chatbot-admin/" })
          .catch(function () {
            /* silencioso: painel continua sem PWA */
          });
      });
    }
  });
})();


async function loadDeliveryHistoryReal(append) {
  try {
    const root = document.getElementById("send_history");
    if (!root) return;
    if (!append) {
      waHistoryPage = 1;
      waHistoryRows = [];
      root.innerHTML = '<div class="muted">Carregando histórico WhatsApp...</div>';
    }

    const filter = (qs("waHistoryFilter") && qs("waHistoryFilter").value) || "all";
    const params = new URLSearchParams();
    params.set("tenant", (qs("tenant") && qs("tenant").value.trim()) || "dcnet");
    params.set("limit", "20");
    params.set("page", String(waHistoryPage));
    if (filter === "inbound" || filter === "outbound") params.set("direction", filter);
    else if (filter === "failed") params.set("status", "failed");
    else if (filter !== "all") params.set("origin", filter);
    if (qs("waHistoryPhone") && qs("waHistoryPhone").value.trim()) params.set("phone", qs("waHistoryPhone").value.trim());
    if (qs("waHistorySearch") && qs("waHistorySearch").value.trim()) params.set("q", qs("waHistorySearch").value.trim());
    if (qs("waHistoryDateFrom") && qs("waHistoryDateFrom").value) params.set("dateFrom", qs("waHistoryDateFrom").value);
    if (qs("waHistoryDateTo") && qs("waHistoryDateTo").value) params.set("dateTo", qs("waHistoryDateTo").value);

    const token = localStorage.getItem("dcinf_chatbot_content_token") || "";
    const resp = await fetch("/api/chatbot-admin/whatsapp-history?" + params.toString(), {
      headers: { Authorization: "Bearer " + token }
    });
    const out = await resp.json();
    if (!resp.ok || !out.ok) throw new Error(out.error || "Erro ao carregar histórico");

    const rows = Array.isArray(out.rows) ? out.rows : [];
    waHistoryRows = append ? waHistoryRows.concat(rows) : rows;
    waHistoryHasMore = !!out.hasMore;
    renderWhatsappHistory(out.total || waHistoryRows.length);
  } catch (e) {
    const root = document.getElementById("send_history");
    if (root) root.innerHTML = '<div class="muted">Erro ao carregar histórico: ' + waHistoryEsc(e.message || e) + '</div>';
    console.error(e);
  }
}

function waHistoryEsc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function waHistoryDate(v) {
  if (!v) return "-";
  try { return new Date(v).toLocaleString("pt-BR"); } catch (e) { return "-"; }
}

function waHistoryStatusStyle(status, direction) {
  const s = String(status || "").toLowerCase();
  if (direction === "inbound" || s === "received") return "background:#f3f4f6;color:#374151;border:1px solid #d1d5db";
  if (s === "failed") return "background:#fee2e2;color:#991b1b;border:1px solid #fecaca";
  if (s === "delivered" || s === "read") return "background:#dcfce7;color:#166534;border:1px solid #bbf7d0";
  return "background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe";
}

function waHistoryTypeLabel(row) {
  const type = String(row.messageType || "text").toLowerCase();
  if (type === "image") return "Imagem";
  if (type === "location") return "Localização";
  if (type === "document") return "Documento";
  if (type === "audio" || type === "voice") return "Áudio";
  if (type === "template") return "Template";
  if (type === "interactive") return "Interativo";
  return "Texto";
}

function waHistoryOriginLabel(row) {
  if (row.direction === "inbound") return "WhatsApp";
  if (row.templateName) return "Template";
  return row.originLabel || row.origin || "WhatsApp";
}

function waHistorySummary(row) {
  if (row.templateName) return getFriendlyTemplateName(row.templateName);
  const txt = String(row.text || "").replace(/\s+/g, " ").trim();
  if (txt) return txt;
  return "(" + waHistoryTypeLabel(row).toLowerCase() + ")";
}

function renderWhatsappHistory(total) {
  const root = document.getElementById("send_history");
  if (!root) return;
  const more = qs("btnWaHistoryMore");
  if (more) more.hidden = !waHistoryHasMore;

  if (!waHistoryRows.length) {
    root.innerHTML = '<div class="muted">Nenhuma mensagem encontrada para os filtros atuais.</div>';
    return;
  }

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:8px 0 14px">
      <div style="font-weight:800;color:#111827">Histórico real do WhatsApp</div>
      <div class="muted">Exibindo ${waHistoryRows.length} de ${Number(total || waHistoryRows.length)}</div>
    </div>
    <div style="overflow:auto;border:1px solid #e5e7eb;border-radius:14px;background:#fff">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:1120px">
        <thead>
          <tr style="background:#f9fafb;color:#6b7280;text-align:left">
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Data/Hora</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Direção</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Telefone</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Nome</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Tipo</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Origem</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Status</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Mensagem</th>
            <th style="padding:11px 12px;border-bottom:1px solid #e5e7eb">Mídia</th>
          </tr>
        </thead>
        <tbody>
          ${waHistoryRows.map(function (r) {
            const status = r.status || r.deliveryStatus || r.metaStatus || "";
            const direction = r.direction === "inbound" ? "Recebida" : "Enviada";
            const msg = waHistoryEsc(waHistorySummary(r).slice(0, 120)) + (waHistorySummary(r).length > 120 ? "..." : "");
            const thumb = r.mediaUrl && String(r.messageType).toLowerCase() === "image"
              ? '<img src="' + waHistoryEsc(r.mediaUrl) + '" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb" />'
              : (r.mediaUrl ? '<a href="' + waHistoryEsc(r.mediaUrl) + '" target="_blank" rel="noopener">Abrir</a>' : '-');
            const hiddenBadge = r.hiddenFromInbox ? '<span style="display:inline-flex;margin-left:6px;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800;background:#ffedd5;color:#9a3412">ocultada da caixa</span>' : '';
            const restoreBtn = r.hiddenFromInbox ? '<button type="button" class="btn2" data-wa-restore-phone="' + waHistoryEsc(r.phone || '') + '" style="padding:4px 8px;font-size:11px">Restaurar conversa</button>' : '';
            return `
              <tr data-wa-history-id="${waHistoryEsc(r.id)}" style="border-bottom:1px solid #f1f5f9;cursor:pointer">
                <td style="padding:10px 12px;color:#374151;white-space:nowrap">${waHistoryDate(r.createdAt)}</td>
                <td style="padding:10px 12px;color:#111827;font-weight:700">${direction}</td>
                <td style="padding:10px 12px;color:#374151;white-space:nowrap">${waHistoryEsc(r.phone || "-")}</td>
                <td style="padding:10px 12px;color:#374151">${waHistoryEsc(r.leadName || "-")}</td>
                <td style="padding:10px 12px;color:#374151">${waHistoryEsc(waHistoryTypeLabel(r))}</td>
                <td style="padding:10px 12px;color:#374151">${waHistoryEsc(waHistoryOriginLabel(r))}</td>
                <td style="padding:10px 12px"><span style="display:inline-flex;border-radius:999px;padding:4px 9px;font-weight:800;font-size:11px;${waHistoryStatusStyle(status, r.direction)}">${waHistoryEsc(String(status || "-").toUpperCase())}</span>${hiddenBadge}</td>
                <td style="padding:10px 12px;color:#4b5563;max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${msg}</td>
                <td style="padding:10px 12px;color:#374151">${thumb}${restoreBtn ? '<div style="margin-top:6px">' + restoreBtn + '</div>' : ''}</td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function startWhatsappHistoryPolling() {
  if (waHistoryPollTimer) clearInterval(waHistoryPollTimer);
  waHistoryPollTimer = setInterval(function () {
    var active = document.querySelector(".tab-panel.is-active");
    if (!active || active.id !== "tab-history") return;
    loadDeliveryHistoryReal(false);
  }, 20000);
}

function stopWhatsappHistoryPolling() {
  if (waHistoryPollTimer) {
    clearInterval(waHistoryPollTimer);
    waHistoryPollTimer = null;
  }
}

function showWhatsappHistoryDetails(id) {
  const row = waHistoryRows.find(function (r) { return String(r.id) === String(id); });
  if (!row) return;
  const box = qs("waHistoryDetails");
  const pre = qs("waHistoryDetailsJson");
  if (!box || !pre) return;
  box.hidden = false;
  pre.textContent = JSON.stringify({
    telefone: row.phone,
    nomeLead: row.leadName,
    direcao: row.direction,
    tipo: row.messageType,
    texto: row.text,
    template: row.templateName,
    origem: row.origin,
    status: row.status,
    deliveryStatus: row.deliveryStatus,
    metaStatus: row.metaStatus,
    wamid: row.wamid,
    waMessageId: row.waMessageId,
    erroMeta: row.metaError,
    lead: row.lead,
    ocultadaDaCaixa: row.hiddenFromInbox,
    hiddenAt: row.hiddenAt,
    hiddenBy: row.hiddenBy,
    variaveisTemplate: row.templateVariables,
    componentesTemplate: row.templateComponents,
    retornoMetaRaw: row.raw,
  }, null, 2);
  try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* ignore */ }
}


async function clearDeliveryHistoryReal() {
  const phrase = prompt("Para excluir o histórico de envios, digite: EXCLUIR HISTORICO");
  if (phrase !== "EXCLUIR HISTORICO") return;

  const token = localStorage.getItem("dcinf_chatbot_content_token") || "";

  const resp = await fetch("/api/chatbot-admin/delivery-history", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({ confirm: "EXCLUIR HISTORICO" })
  });

  const out = await resp.json();

  if (!out.ok) {
    alert("Erro ao excluir histórico: " + (out.error || "erro desconhecido"));
    return;
  }

  window.__dcnetHistoryVisibleCount = 15;
  alert("Histórico excluído: " + out.deleted + " registros.");
  loadDeliveryHistoryReal();
}


async function deleteSingleHistory(id) {
  if (!id) return;

  const ok = confirm("Excluir este registro?");
  if (!ok) return;

  const token = localStorage.getItem("dcinf_chatbot_content_token") || "";

  await fetch("/api/chatbot-admin/delivery-history/item/" + id, {
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + token
    }
  });

  loadDeliveryHistoryReal();
}

async function deleteSelectedHistory() {
  const checks = Array.from(document.querySelectorAll(".history-check:checked"));

  if (!checks.length) {
    alert("Nenhum item selecionado.");
    return;
  }

  const ids = checks.map(el => el.value).filter(Boolean);

  const ok = confirm("Excluir " + ids.length + " registros?");
  if (!ok) return;

  const token = localStorage.getItem("dcinf_chatbot_content_token") || "";

  await fetch("/api/chatbot-admin/delivery-history/items", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({ ids })
  });

  loadDeliveryHistoryReal();
}

document.addEventListener("change", function (e) {
  if (e.target && e.target.id === "historyCheckAll") {
    document.querySelectorAll(".history-check").forEach((el) => {
      el.checked = e.target.checked;
    });
  }
});


document.addEventListener("click", function (e) {
  const more = e.target.closest("#btnHistoryMoreInfo");
  if (more) {
    window.__dcnetHistoryVisibleCount = Number(window.__dcnetHistoryVisibleCount || 15) + 15;
    loadDeliveryHistoryReal();
    return;
  }

  const clearBtn = e.target.closest('[data-action="clear-history"]');
  if (clearBtn) {
    clearDeliveryHistoryReal();
    return;
  }

  const delOne = e.target.closest('[data-action="delete-one"]');
  if (delOne) {
    deleteSingleHistory(delOne.getAttribute("data-id"));
    return;
  }
});

// history_click_delegate_installed

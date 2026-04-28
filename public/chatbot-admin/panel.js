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
  var _googleMap = null;
  var _googleMarker = null;
  var _googleCircle = null;
  var _googleStoreMarker = null;
  var _coverageMapFormListenersBound = false;
  var _coverageMapButtonsBound = false;
  var _googleMapLoadTimeout = null;

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
        setMbResult({ ok: false, error: e.message || String(e) });
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
    initMobileMenu();
    qs("btnLogin").addEventListener("click", login);
    qs("btnLogout").addEventListener("click", logout);
    qs("btnLoad").addEventListener("click", loadConfig);
    qs("btnSave").addEventListener("click", save);
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

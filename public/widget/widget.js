// public/widget/dcnet/widget.js
(function () {
  const TENANT = "dcnet";
  const API = "https://chatbot.dcinfinity.net.br/api/chat";

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "style") Object.assign(e.style, v);
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    children.forEach((c) => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  }

  function addMsg(container, who, text) {
    const row = el("div", { class: `dcin-msg ${who}` }, [
      el("div", { class: "dcin-bubble" }, [text]),
    ]);
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  async function sendMessage(sessionId, message) {
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT,
      },
      body: JSON.stringify({ sessionId, message }),
    });
    return r.json();
  }

  // inject CSS
  const cssUrl = `https://chatbot.dcinfinity.net.br/widget/${TENANT}/widget.css`;
  const link = el("link", { rel: "stylesheet", href: cssUrl });
  document.head.appendChild(link);

  // UI
  const btn = el("button", {
    id: "dcinf-btn",
    style: { background: "#1f3cff", color: "#fff" },
  }, ["DC"]);

  const panel = el("div", { id: "dcinf-panel" }, [
    el("header", {}, [
      el("div", {}, ["Atendimento DC NET"]),
      el("button", { id: "dcinf-close" }, ["✕"]),
    ]),
    el("div", { id: "dcinf-messages" }, []),
    el("form", { id: "dcinf-form" }, [
      el("input", { id: "dcinf-input", placeholder: "Digite sua mensagem..." }, []),
      el("button", { id: "dcinf-send", type: "submit" }, ["Enviar"]),
    ]),
  ]);

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  const closeBtn = panel.querySelector("#dcinf-close");
  const messages = panel.querySelector("#dcinf-messages");
  const form = panel.querySelector("#dcinf-form");
  const input = panel.querySelector("#dcinf-input");

  const sessionId = `sess_${Math.random().toString(16).slice(2)}_${Date.now()}`;

  function open() {
    panel.style.display = "block";
    btn.style.display = "none";
    if (messages.childNodes.length === 0) {
      addMsg(messages, "bot", "Olá! 👋 Eu sou o assistente da DC NET. Como posso ajudar?");
    }
  }
  function close() {
    panel.style.display = "none";
    btn.style.display = "block";
  }

  btn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = (input.value || "").trim();
    if (!text) return;
    input.value = "";

    addMsg(messages, "user", text);

    try {
      const out = await sendMessage(sessionId, text);
      addMsg(messages, "bot", out.reply || "Sem resposta no momento.");
    } catch (e) {
      addMsg(messages, "bot", "Falha ao conectar. Tente novamente em instantes.");
    }
  });

  // debug
  window.DCINF_WIDGET = { open, close, sessionId };
})();
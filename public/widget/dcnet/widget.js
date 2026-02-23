(function () {
  const API = "https://chatbot.dcinfinity.net.br/api/chat";
  const TENANT = "dcnet";

  function getSessionId() {
    const key = "dcinf_session_id";
    let v = localStorage.getItem(key);
    if (!v) {
      v = "web_" + Math.random().toString(16).slice(2) + Date.now();
      localStorage.setItem(key, v);
    }
    return v;
  }

  function addMsg(container, text, who) {
    const div = document.createElement("div");
    div.className = "dcin-bubble " + (who === "me" ? "dcin-me" : "dcin-bot");
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async function send(message) {
    const sessionId = getSessionId();
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": TENANT
      },
      body: JSON.stringify({
        sessionId,
        origin: "widget",
        page: window.location.hostname,
        message
      })
    });
    return r.json();
  }

  function mount() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://chatbot.dcinfinity.net.br/widget/dcnet/widget.css";
    document.head.appendChild(link);

    const btn = document.createElement("button");
    btn.id = "dcinf-btn";
    btn.textContent = "💬";
    btn.setAttribute("aria-label", "Abrir chat");

    const box = document.createElement("div");
    box.id = "dcinf-box";
    box.innerHTML = `
      <div id="dcinf-head">
        <div id="dcinf-title">DC NET • Atendimento</div>
        <button id="dcinf-close" aria-label="Fechar">×</button>
      </div>
      <div id="dcinf-msgs"></div>
      <form id="dcinf-form">
        <input id="dcinf-input" placeholder="Digite sua mensagem..." autocomplete="off" />
        <button id="dcinf-send" type="submit">Enviar</button>
      </form>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(box);

    const msgs = box.querySelector("#dcinf-msgs");
    const form = box.querySelector("#dcinf-form");
    const input = box.querySelector("#dcinf-input");
    const close = box.querySelector("#dcinf-close");
    const sendBtn = box.querySelector("#dcinf-send");

    function open() { box.style.display = "block"; input.focus(); }
    function hide() { box.style.display = "none"; }

    btn.addEventListener("click", () => {
      box.style.display === "block" ? hide() : open();
    });
    close.addEventListener("click", hide);

    addMsg(msgs, "Olá! 👋 Como posso te ajudar?", "bot");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = (input.value || "").trim();
      if (!text) return;

      input.value = "";
      addMsg(msgs, text, "me");
      sendBtn.disabled = true;

      try {
        const data = await send(text);
        addMsg(msgs, data?.reply || "Ok.", "bot");
      } catch (e) {
        addMsg(msgs, "Erro ao enviar. Tente novamente.", "bot");
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  window.DCINF_SEND = send;
})();

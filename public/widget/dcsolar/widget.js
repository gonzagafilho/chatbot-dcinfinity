(function () {
  const API_CHAT = "https://chatbot.dcinfinity.net.br/api/chat";
  const API_HANDOFF = "https://chatbot.dcinfinity.net.br/api/handoff";
  const TENANT = "dcsolar";

  // ✅ SEU NÚMERO (handoff humano)
  const HUMAN_WA = "5561996088711"; // (61) 99608-8711

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

  async function sendChat(message) {
    const sessionId = getSessionId();
    const r = await fetch(API_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT },
      body: JSON.stringify({
        sessionId,
        origin: "widget",
        page: window.location.hostname,
        message
      }),
    });
    return r.json();
  }

  async function handoff(lastMessage) {
    const sessionId = getSessionId();
    const pageUrl = window.location.href;

    // chama API (não trava se falhar)
    try {
      await fetch(API_HANDOFF, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT },
        body: JSON.stringify({ sessionId, lastMessage: lastMessage || "", pageUrl }),
      });
    } catch (_) {}

    // abre WhatsApp com contexto
    const text =
      "Olá! Vim do site DC SOLAR e quero falar com um atendente.\n\n" +
      "Tenant: " + TENANT + "\n" +
      "Session: " + sessionId + "\n" +
      "Página: " + pageUrl;

    const url = "https://wa.me/" + HUMAN_WA + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
  }

  function mount() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://chatbot.dcinfinity.net.br/widget/dcsolar/widget.css";
    document.head.appendChild(link);

    const btn = document.createElement("button");
    btn.id = "dcinf-btn";
    btn.textContent = "💬";

    const box = document.createElement("div");
    box.id = "dcinf-box";
    box.innerHTML = `
      <div id="dcinf-head">
        <div id="dcinf-title">DC SOLAR • Atendimento</div>
        <button id="dcinf-close" aria-label="Fechar">×</button>
      </div>

      <div style="padding:10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:8px;">
        <button id="dcinf-handoff"
           style="flex:1;cursor:pointer;border:0;text-align:center;background:#22c55e;color:#04130a;padding:10px;border-radius:10px;font-family:Arial;font-weight:700;">
          👤 Falar com atendente (WhatsApp)
        </button>
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
    const handoffBtn = box.querySelector("#dcinf-handoff");

    function open() { box.style.display = "block"; input.focus(); }
    function hide() { box.style.display = "none"; }

    btn.addEventListener("click", () => box.style.display === "block" ? hide() : open());
    close.addEventListener("click", hide);

    addMsg(msgs, "Olá! 👋 Sou o atendimento da DC SOLAR.\n\n1) ☀️ Simulação / Orçamento\n2) 🛠️ Suporte / Manutenção\n3) 👤 Falar com atendente", "bot");

    handoffBtn.addEventListener("click", () => {
      addMsg(msgs, "Certo! Vou te direcionar para um atendente no WhatsApp. ✅", "bot");
      handoff("clicou em falar com atendente");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = (input.value || "").trim();
      if (!text) return;

      input.value = "";
      addMsg(msgs, text, "me");
      sendBtn.disabled = true;

      try {
        const data = await sendChat(text);
        addMsg(msgs, data?.reply || "Ok.", "bot");
      } catch (e) {
        addMsg(msgs, "Erro ao enviar. Tente novamente.", "bot");
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();

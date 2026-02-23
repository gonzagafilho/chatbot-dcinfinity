#!/usr/bin/env bash
set -euo pipefail

TENANT="${1:-}"
DOMAIN="${2:-}"

if [[ -z "$TENANT" || -z "$DOMAIN" ]]; then
  echo "Uso: $0 <tenant> <dominio>"
  echo "Ex:  $0 site2 site2.com.br"
  exit 1
fi

BASE="/home/servidor-dcnet/chatbot-dcinfinity"
ENV="$BASE/.env"
W="$BASE/public/widget/$TENANT"

mkdir -p "$W"

# Atualiza CORS_ORIGINS
if grep -q "^CORS_ORIGINS=" "$ENV"; then
  CUR="$(grep '^CORS_ORIGINS=' "$ENV" | cut -d= -f2-)"
  if echo "$CUR" | tr ',' '\n' | grep -qx "https://$DOMAIN"; then
    echo "CORS já contém https://$DOMAIN"
  else
    NEW="$CUR,https://$DOMAIN,https://www.$DOMAIN"
    sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=$NEW|" "$ENV"
    echo "CORS atualizado ✅"
  fi
else
  echo "CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN" >> "$ENV"
  echo "CORS criado ✅"
fi

# widget.css (padrão)
cat > "$W/widget.css" <<'CSS'
#dcinf-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;font-size:22px;box-shadow:0 10px 25px rgba(0,0,0,.25);background:#0b1b3a;color:#fff;z-index:999999}
#dcinf-box{position:fixed;right:20px;bottom:90px;width:320px;max-width:calc(100vw - 40px);height:420px;max-height:calc(100vh - 140px);border-radius:14px;background:#0b1220;color:#fff;box-shadow:0 15px 40px rgba(0,0,0,.35);overflow:hidden;display:none;z-index:999999;border:1px solid rgba(255,255,255,.08)}
#dcinf-head{padding:12px;background:linear-gradient(90deg,#0b1b3a,#0a2a5a);display:flex;align-items:center;justify-content:space-between;font-family:Arial,sans-serif}
#dcinf-title{font-size:14px;font-weight:700}
#dcinf-close{border:0;background:transparent;color:#fff;font-size:20px;cursor:pointer}
#dcinf-msgs{padding:10px;height:310px;overflow:auto;font-family:Arial,sans-serif;font-size:13px}
.dcin-bubble{padding:8px 10px;margin:6px 0;border-radius:10px;line-height:1.35;max-width:90%;white-space:pre-wrap}
.dcin-me{background:#163b77;margin-left:auto}
.dcin-bot{background:#111827;border:1px solid rgba(255,255,255,.08)}
#dcinf-form{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.08);background:#0b1220}
#dcinf-input{flex:1;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#0f172a;color:#fff;padding:10px;outline:none}
#dcinf-send{border:0;border-radius:10px;background:#2563eb;color:#fff;padding:10px 12px;cursor:pointer}
#dcinf-send:disabled{opacity:.6;cursor:not-allowed}
CSS

# widget.js (tenant fixo)
cat > "$W/widget.js" <<JS
(function () {
  const API = "https://chatbot.dcinfinity.net.br/api/chat";
  const TENANT = "${TENANT}";

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
      headers: { "Content-Type": "application/json", "X-Tenant-Id": TENANT },
      body: JSON.stringify({ sessionId, origin: "widget", page: window.location.hostname, message })
    });
    return r.json();
  }

  function mount() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://chatbot.dcinfinity.net.br/widget/${TENANT}/widget.css";
    document.head.appendChild(link);

    const btn = document.createElement("button");
    btn.id = "dcinf-btn";
    btn.textContent = "💬";

    const box = document.createElement("div");
    box.id = "dcinf-box";
    box.innerHTML = \`
      <div id="dcinf-head">
        <div id="dcinf-title">${TENANT} • Atendimento</div>
        <button id="dcinf-close" aria-label="Fechar">×</button>
      </div>
      <div id="dcinf-msgs"></div>
      <form id="dcinf-form">
        <input id="dcinf-input" placeholder="Digite sua mensagem..." autocomplete="off" />
        <button id="dcinf-send" type="submit">Enviar</button>
      </form>
    \`;

    document.body.appendChild(btn);
    document.body.appendChild(box);

    const msgs = box.querySelector("#dcinf-msgs");
    const form = box.querySelector("#dcinf-form");
    const input = box.querySelector("#dcinf-input");
    const close = box.querySelector("#dcinf-close");
    const sendBtn = box.querySelector("#dcinf-send");

    function open() { box.style.display = "block"; input.focus(); }
    function hide() { box.style.display = "none"; }

    btn.addEventListener("click", () => box.style.display === "block" ? hide() : open());
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
JS

# index.html (teste)
cat > "$W/index.html" <<HTML
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Teste Widget ${TENANT}</title>
</head>
<body>
  <h1>Teste Widget ${TENANT}</h1>
  <p>Se aparecer o botão 💬 no canto, está OK.</p>
  <script src="https://chatbot.dcinfinity.net.br/widget/${TENANT}/widget.js"></script>
</body>
</html>
HTML

echo "✅ Tenant criado: $TENANT"
echo "✅ Teste: https://chatbot.dcinfinity.net.br/widget/$TENANT/index.html"
echo "✅ Instalar no site: <script src=\"https://chatbot.dcinfinity.net.br/widget/$TENANT/widget.js\"></script>"

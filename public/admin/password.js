(() => {
  const btn = document.getElementById("btn");
  const msg = document.getElementById("msg");

  function getToken() {
    return (
      localStorage.getItem("ADMIN_TOKEN") ||
      localStorage.getItem("adminToken") ||
      localStorage.getItem("token") ||
      localStorage.getItem("jwt") ||
      ""
    );
  }

  btn.addEventListener("click", async () => {
    msg.textContent = "";

    const token = getToken();
    if (!token) {
      msg.textContent = "❌ Você não está logado (token não encontrado).";
      return;
    }

    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;

    try {
      const r = await fetch("/api/admin/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        msg.textContent = "❌ Erro: " + (data.error || ("HTTP_" + r.status));
        return;
      }

      msg.textContent = "✅ Senha alterada com sucesso!";
      document.getElementById("currentPassword").value = "";
      document.getElementById("newPassword").value = "";
    } catch (e) {
      msg.textContent = "❌ Falha de rede.";
    }
  });
})();

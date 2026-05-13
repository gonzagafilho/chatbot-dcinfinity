const { replyFromRules } = require("./src/services/rules");

(async () => {
  const result = await replyFromRules({
    message: "planos",
    origin: "whatsapp",
    page: "whatsapp",
    phone: "5561999999999",
  });
  console.log(result);
})();

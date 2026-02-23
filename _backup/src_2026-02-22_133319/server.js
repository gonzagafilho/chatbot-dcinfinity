require("dotenv").config({ override: true });
const app = require("./app");

const PORT = Number(process.env.PORT || 4010);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`🚀 Chatbot DCInfinity rodando em http://127.0.0.1:${PORT}`);
});

const { ruleDcnet } = require("../rules/tenants/dcnet");
const { ruleSite2 } = require("../rules/tenants/site2");
const { ruleDcsolar } = require("../rules/tenants/dcsolar");

function replyFromRules(ctx) {
  const tenant = (ctx?.tenant || "dcnet").toString().trim().toLowerCase();

  console.log("🧠 rules.js ACTIVE", {
    tenant,
    message: ctx?.message,
    origin: ctx?.origin,
    page: ctx?.page,
  });

  if (tenant === "dcsolar") return ruleDcsolar(ctx);
  if (tenant === "site2") return ruleSite2(ctx);
  return ruleDcnet(ctx);
}

module.exports = { replyFromRules };

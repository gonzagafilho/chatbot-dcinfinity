const WaMessage = require("../models/WaMessage");
const Lead = require("../models/Lead");

async function upsertLead({ tenant, channel, key, phone = "", name = "", lastText = "" }) {
  const now = new Date();

  return Lead.findOneAndUpdate(
    { tenant, phone: key },
    {
      $set: {
        channel,
        origin: channel,
        tenant,
        phone: key,
        name,
        lastMessage: lastText,
        updatedAt: now,
      },
      $setOnInsert: { status: "novo" },
    },
    { upsert: true, new: true }
  );
}

async function saveMessage({
  tenant,
  channel,
  direction,
  from = "",
  to = "",
  text = "",
  waMessageId = "",
  meta = {},
}) {
  return WaMessage.create({
    tenant,
    channel,
    origin: null,
    waMessageId,
    direction,
    from,
    to,
    text,
    raw: meta,
  });
}

module.exports = { upsertLead, saveMessage };
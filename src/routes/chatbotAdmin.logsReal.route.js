"use strict";

const express = require("express");
const fs = require("fs/promises");

const router = express.Router();

router.get("/chatbot-admin/automation/logs-real", async (req, res) => {
  try {
    const outLogPath =
      "/home/servidor-dcnet/.pm2/logs/chatbot-dcinfinity-out.log";

    const errLogPath =
      "/home/servidor-dcnet/.pm2/logs/chatbot-dcinfinity-error.log";

    async function readLastLines(filePath, limit = 80) {
      try {
        const raw = await fs.readFile(filePath, "utf8");

        return raw
          .split("\n")
          .filter(Boolean)
          .slice(-limit);
      } catch (e) {
        return [];
      }
    }

    function classify(line, source) {
      const text = String(line || "").trim();

      if (!text) return null;

      let type = "system";
      let level = source === "error" ? "error" : "info";

      if (text.includes("[billing_reminder]")) {
        type = "billing";
      } else if (
        text.includes("[seasonal_campaign]") ||
        text.includes("[campaigns]")
      ) {
        type = "campaign";
      } else if (text.includes("[beesweb_sync]")) {
        type = "sync";
      } else if (
        text.toLowerCase().includes("whatsapp")
      ) {
        type = "whatsapp";
      }

      if (
        text.toLowerCase().includes("error") ||
        text.toLowerCase().includes("failed") ||
        text.toLowerCase().includes("erro")
      ) {
        level = "error";
      }

      if (
        text.includes("scheduler_started") ||
        text.includes("MongoDB conectado") ||
        text.includes("ON:")
      ) {
        level = "success";
      }

      return {
        type,
        level,
        message: text.replace(/^\d+\|chatbot\s*\|\s*/, "").slice(0, 240),
        time: new Date().toISOString(),
      };
    }

    const outLines = await readLastLines(outLogPath, 80);
    const errLines = await readLastLines(errLogPath, 40);

    const logs = []
      .concat(outLines.map((l) => classify(l, "out")))
      .concat(errLines.map((l) => classify(l, "error")))
      .filter(Boolean)
      .slice(-80)
      .reverse();

    return res.json({
      ok: true,
      source: "pm2",
      logs,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
});

module.exports = router;

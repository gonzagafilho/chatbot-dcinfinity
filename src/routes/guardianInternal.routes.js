"use strict";

const express = require("express");

const router = express.Router();

const {
  sendGuardianAlert,
} = require("../services/guardian/guardianAlertService");

router.post("/internal-alert", async (req, res) => {
  try {
    const message = req.body?.message || "Evento Guardian";

    await sendGuardianAlert(message);

    return res.json({
      ok: true,
    });
  } catch (e) {
    console.error("[guardian_internal_alert]", e?.message || e);

    return res.status(500).json({
      ok: false,
    });
  }
});

module.exports = router;

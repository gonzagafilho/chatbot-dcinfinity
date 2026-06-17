"use strict";

const express = require("express");
const { execSync } = require("child_process");
const fs = require("fs");

const router = express.Router();

const EVENTS =
  "/home/servidor-dcnet/chatbot-dcinfinity/public/chatbot-admin/guardian/events.json";

router.post("/cleanup", async (req, res) => {

  try {

    const processName =
      String(req.body?.process || "").trim();

    if(!processName){
      return res.status(400).json({
        ok:false,
        error:"process required"
      });
    }

    try {
      execSync(`sudo pkill -f "${processName}"`, {
        stdio:"ignore"
      });
    } catch {}

    let events = [];

    try {
      events = JSON.parse(
        fs.readFileSync(EVENTS,"utf8")
      );
    } catch {}

    events.unshift({
      time: new Date().toISOString(),
      host: "servidor-dcnet",
      type: "MANUAL_CLEANUP",
      severity: "warning",
      action: "quarantine",
      detail: `Processo ${processName} finalizado manualmente pelo Guardian`
    });

    fs.writeFileSync(
      EVENTS,
      JSON.stringify(events.slice(0,100), null, 2)
    );

    return res.json({
      ok:true
    });

  } catch(e){

    console.error(e);

    return res.status(500).json({
      ok:false
    });
  }
});

module.exports = router;

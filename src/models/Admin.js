"use strict";

const mongoose = require("mongoose");

const AdminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    nome: { type: String, default: "Administrador" },

    passwordHash: { type: String, required: true },

    role: { type: String, default: "ADMIN" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Admin || mongoose.model("Admin", AdminSchema);

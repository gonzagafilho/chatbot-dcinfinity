// src/services/tenantResolverWhatsApp.js

function resolveTenantFromPhoneNumberId(phoneNumberId) {
  // Mapeie aqui seus PHONE_NUMBER_ID reais quando tiver mais de um número
  const map = {
    // "1037132692806711": "dcnet",
    // "SEU_PHONE_ID_SOLAR": "dcsolar",
  };

  return map[String(phoneNumberId)] || null;
}

function resolveTenantFromText(text = "") {
  const t = text.toLowerCase();

  if (t.includes("starlink") || t.includes("rural") || t.includes("fazenda")) {
    return "rural";
  }

  if (t.includes("solar") || t.includes("placa") || t.includes("fotovolta")) {
    return "dcsolar";
  }

  return "dcnet";
}

module.exports = {
  resolveTenantFromPhoneNumberId,
  resolveTenantFromText,
};

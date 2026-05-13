"use strict";

module.exports = {
  birthday: process.env.WA_TEMPLATE_BIRTHDAY || "dcnet_birthday_card",
  easter: process.env.WA_TEMPLATE_EASTER || "dcnet_easter_card",
  mothersDay: process.env.WA_TEMPLATE_MOTHERS_DAY || "dcnet_mothers_day_card",
  fathersDay: process.env.WA_TEMPLATE_FATHERS_DAY || "dcnet_fathers_day_card",
  christmas: process.env.WA_TEMPLATE_CHRISTMAS || "dcnet_christmas_card",
  newYear: process.env.WA_TEMPLATE_NEW_YEAR || "dcnet_new_year_card",
  billingReminder: process.env.WA_TEMPLATE_BILLING_REMINDER || "dcnet_billing_reminder_v2",
  languageCode: process.env.WA_TEMPLATE_LANGUAGE_CODE || "pt_BR",
};

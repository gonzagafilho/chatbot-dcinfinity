"use strict";

const CoverageArea = require("../models/CoverageArea");

function toRad(value) {
  return (value * Math.PI) / 180;
}

/**
 * @returns {number} distância em metros entre dois pontos WGS84
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getActiveCoverageAreas(tenant) {
  const t = String(tenant || "").trim();
  if (!t) return [];
  return CoverageArea.find({ tenant: t, active: true }).lean().exec();
}

/**
 * @param {{ tenant: string, lat: number, lng: number }} p
 * @returns {Promise<{
 *   ok: true,
 *   covered: boolean,
 *   area: object | null,
 *   distanceMeters: number | null,
 *   reason: "inside_area" | "outside_all_areas" | "no_active_areas" | "invalid_location"
 * }>}
 */
async function checkCoverageByGps(p) {
  const tenant = String(p?.tenant || "").trim();
  const lat = Number(p?.lat);
  const lng = Number(p?.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return {
      ok: true,
      covered: false,
      area: null,
      distanceMeters: null,
      reason: "invalid_location",
    };
  }

  if (!tenant) {
    return {
      ok: true,
      covered: false,
      area: null,
      distanceMeters: null,
      reason: "no_active_areas",
    };
  }

  const areas = await getActiveCoverageAreas(tenant);
  if (!areas || areas.length === 0) {
    return {
      ok: true,
      covered: false,
      area: null,
      distanceMeters: null,
      reason: "no_active_areas",
    };
  }

  let minDist = Infinity;
  for (const a of areas) {
    const cLat = Number(a.centerLat);
    const cLng = Number(a.centerLng);
    const rM = Number(a.radiusMeters);
    if (!Number.isFinite(cLat) || !Number.isFinite(cLng) || !Number.isFinite(rM) || rM < 0) {
      continue;
    }
    const d = haversineMeters(lat, lng, cLat, cLng);
    if (d < minDist) minDist = d;
    if (d <= rM) {
      return {
        ok: true,
        covered: true,
        area: a,
        distanceMeters: Math.round(d),
        reason: "inside_area",
      };
    }
  }

  return {
    ok: true,
    covered: false,
    area: null,
    distanceMeters: minDist === Infinity ? null : Math.round(minDist),
    reason: "outside_all_areas",
  };
}

module.exports = {
  toRad,
  haversineMeters,
  getActiveCoverageAreas,
  checkCoverageByGps,
};

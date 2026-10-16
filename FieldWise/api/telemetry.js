
import { db, json } from './_db.js';

const DEVICE_ID = 'fieldwise-esp32-01';

const crops = [
  'Not selected',
  'Rice',
  'Wheat',
  'Cotton',
  'Tomato',
];

const validNumber = (value, min, max) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, {
      error: 'POST required',
    });
  }

  if (
    !process.env.DEVICE_API_KEY ||
    req.headers['x-device-key'] !== process.env.DEVICE_API_KEY
  ) {
    return json(res, 401, {
      error: 'Invalid device key',
    });
  }

  const b = req.body;

  if (
    !b ||
    typeof b !== 'object' ||
    Array.isArray(b)
  ) {
    return json(res, 400, {
      error: 'JSON object required',
    });
  }

  if (
    !Number.isInteger(b.crop_code) ||
    b.crop_code < 0 ||
    b.crop_code > 4 ||
    b.crop_name !== crops[b.crop_code]
  ) {
    return json(res, 400, {
      error: 'Invalid crop data',
    });
  }

  if (!Number.isInteger(b.soil_raw) ||
      b.soil_raw < 0 ||
      b.soil_raw > 4095) {
    return json(res, 400, {
      error: 'Invalid soil raw reading',
    });
  }

  // ADC saturation is a sensor fault, not 0% moisture.
  const soilFault =
    b.soil_raw === 4095 ||
    b.soil_raw === 0 ||
    b.soil_moisture === null;

  // A valid sensor reading must have a valid percentage.
  if (
    !soilFault &&
    !validNumber(b.soil_moisture, 0, 100)
  ) {
    return json(res, 400, {
      error: 'Invalid soil moisture',
    });
  }

  if (!validNumber(b.wifi_rssi, -120, 0)) {
    return json(res, 400, {
      error: 'Invalid Wi-Fi signal',
    });
  }

  for (const [key, min, max] of [
    ['temperature_c', -40, 85],
    ['humidity_pct', 0, 100],
  ]) {
    if (
      b[key] !== null &&
      !validNumber(b[key], min, max)
    ) {
      return json(res, 400, {
        error: `Invalid ${key}`,
      });
    }
  }

  for (const key of [
    'pump_on',
    'irrigation_required',
    'safety_lockout',
    'human_motion',
  ]) {
    if (typeof b[key] !== 'boolean') {
      return json(res, 400, {
        error: `Invalid ${key}`,
      });
    }
  }

  // Never accept an ON pump command during a sensor fault.
  if (soilFault && b.pump_on) {
    return json(res, 400, {
      error: 'Pump must be OFF during soil sensor fault',
    });
  }

  const row = {
    device_id: DEVICE_ID,
    crop_code: b.crop_code,
    crop_name: b.crop_name,

    // Save NULL for a faulty sensor, never a misleading 0%.
    soil_moisture: soilFault
      ? null
      : b.soil_moisture,

    soil_raw: b.soil_raw,

    temperature_c: b.temperature_c,
    humidity_pct: b.humidity_pct,

    pump_on: b.pump_on,
    irrigation_required: soilFault
      ? false
      : b.irrigation_required,

    safety_lockout: b.safety_lockout,
    human_motion: b.human_motion,
    wifi_rssi: b.wifi_rssi,
  };

  try {
    const { data, error } = await db()
      .from('sensor_readings')
      .insert(row)
      .select('id,created_at')
      .single();

    if (error) {
      console.error('Telemetry database error:', error);

      return json(res, 500, {
        error: 'Database insert failed',
      });
    }

    return json(res, 201, {
      ok: true,
      ...data,
    });
  } catch (error) {
    console.error('Telemetry server error:', error);

    return json(res, 500, {
      error: 'Server error',
    });
  }
}

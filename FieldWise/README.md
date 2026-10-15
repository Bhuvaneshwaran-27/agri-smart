# FieldWise — Copy-and-replace project

## Files
- `src/App.jsx`: complete dashboard UI
- `src/style.css`: responsive green theme
- `src/main.jsx`: React entry point
- `api/telemetry.js`: authenticated ESP32 ingestion endpoint
- `api/latest.js`, `api/history.js`: dashboard endpoints
- `api/_db.js`: server-only Supabase connection
- `supabase/schema.sql`: database setup
- `firmware/FieldWise_ESP32.ino`: original uploaded scratch firmware (unchanged)

## Setup
1. Create a Supabase project and run `supabase/schema.sql` in SQL Editor.
2. Upload project to a GitHub repository with `package.json` at repository root.
3. Import repository into Vercel; use Vite framework, `npm run build`, output `dist`.
4. Set Vercel environment variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server-side secret), `DEVICE_API_KEY` (a long random value). Redeploy.
5. In firmware replace `WIFI_SSID`, `WIFI_PASSWORD`, `API_URL` (`https://YOUR-DEPLOYMENT.vercel.app/api/telemetry`) and `DEVICE_API_KEY` (same as Vercel).
6. Install Arduino DHT sensor library by Adafruit and Adafruit Unified Sensor, upload firmware and open Serial Monitor at 115200.
7. Send `1` Rice, `2` Wheat, `3` Cotton, `4` Tomato, `0` Reset. Check for HTTP 201 in Serial Monitor.
8. Open deployed website to view readings. Dashboard is read-only; it does not remotely operate the pump.

## Security and safety
- Never publish `SUPABASE_SECRET_KEY` or `DEVICE_API_KEY` in GitHub. The firmware copy has placeholders.
- Current firmware uses `client.setInsecure()` for HTTPS: this disables server certificate validation. Replace with certificate verification for deployment beyond a supervised demo.
- Test relay OFF behavior before attaching the pump; use a separate pump power supply and suitable driver. PIR senses motion, not continuous human presence.
- Crop thresholds and soil ADC values are demonstration values and require calibration.
- The API endpoints are publicly readable; avoid publishing personal or sensitive data in the telemetry. Add user authentication before making a private production dashboard.

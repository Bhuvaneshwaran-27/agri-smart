# FieldWise — Web crop selection edition

## Deployment
1. Run **the entire updated** `supabase/schema.sql` in Supabase SQL Editor (also safe for an existing readings table).
2. Upload this project to GitHub, import into Vercel as Vite (`npm run build`, output `dist`). Ensure deployment protection does not block ESP32.
3. Set Vercel environment variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DEVICE_API_KEY`, `DASHBOARD_ADMIN_KEY`. Use different long random values for the last two. Redeploy.
4. In `firmware/FieldWise_ESP32.ino` set `WIFI_SSID`, `WIFI_PASSWORD`, `API_URL`, `COMMAND_URL`, `DEVICE_API_KEY`. Both URLs must point to the same Vercel deployment.
5. Install Arduino libraries: **DHT sensor library** by Adafruit, **Adafruit Unified Sensor**, and **ArduinoJson v7**. Upload to ESP32; Serial Monitor 115200.
6. Open website, enter `DASHBOARD_ADMIN_KEY` in Remote crop selection and choose Rice/Wheat/Cotton/Tomato/Reset. ESP32 polls every ~10 seconds; telemetry uploads every ~20 seconds.

## Security / safety
- Never commit real keys or Wi-Fi passwords. The admin key is entered into the dashboard at runtime, not bundled in JavaScript or browser storage. Protect it as a password; for production, implement real user login, CSRF protection, rate limiting and per-device authorization.
- Supabase secret key stays only in Vercel. ESP32 uses its separate `DEVICE_API_KEY`.
- The uploaded sketch uses `client.setInsecure()` as a supervised demonstration shortcut. Use verified HTTPS CA certificate and reliable time synchronization for real deployments.
- Remote selection only changes crop; pump ON/OFF remains controlled locally with PIR motion and timeout lockout. Reset clears timeout lockout, so inspect pump before pressing Reset.
- No display or physical crop buttons required. ESP32 needs Wi-Fi to receive a new crop command; if offline, it retains its last selected crop until reboot (then starts with no crop).
- Do not expose telemetry publicly if it contains private data. Latest/history endpoints are public in this exhibition example.

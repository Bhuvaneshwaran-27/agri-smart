
import React, { useEffect, useState } from 'react';

const CROP_NAMES = {
  0: 'Not selected',
  1: 'Rice',
  2: 'Wheat',
  3: 'Cotton',
  4: 'Tomato',
};

const format = (v, unit = '', digits = 1) => {
  if (v === null || v === undefined || v === '') {
    return 'Unavailable';
  }

  const n = Number(v);

  return Number.isFinite(n)
    ? `${n.toFixed(digits)}${unit}`
    : 'Unavailable';
};

const clock = v => {
  if (!v) return 'No readings yet';

  const d = new Date(v);

  return Number.isNaN(d.getTime())
    ? 'Unknown time'
    : d.toLocaleString();
};

function isSoilFault(reading) {
  if (!reading) return false;

  const raw = Number(reading.soil_raw);

  return (
    reading.soil_moisture === null ||
    reading.soil_moisture === undefined ||
    !Number.isFinite(Number(reading.soil_moisture)) ||
    (
      reading.soil_raw !== null &&
      reading.soil_raw !== undefined &&
      (
        !Number.isFinite(raw) ||
        raw >= 4095 ||
        raw <= 0
      )
    )
  );
}

function getIrrigationStatus(reading, online) {
  if (!reading) return 'WAITING FOR SENSOR DATA';

  if (!online) return 'DEVICE OFFLINE — STATUS UNKNOWN';

  if (isSoilFault(reading)) {
    return 'SENSOR FAULT — PUMP DISABLED';
  }

  if (reading.safety_lockout) {
    return 'SAFETY LOCKOUT — INSPECT PUMP';
  }

  if (reading.human_motion) {
    return 'MOTION DETECTED — PUMP INHIBITED';
  }

  if (Number(reading.crop_code) === 0) {
    return 'SELECT A CROP';
  }

  if (reading.irrigation_required) {
    return reading.pump_on
      ? 'WATERING IN PROGRESS'
      : 'WATER REQUIRED — WAITING / INHIBITED';
  }

  return 'NO WATER REQUIRED';
}

function MiniChart({ rows, field, label, unit }) {
  const points = [...rows]
    .reverse()
    .filter(x => {
      if (x[field] === null || x[field] === undefined) {
        return false;
      }

      if (field === 'soil_moisture' && isSoilFault(x)) {
        return false;
      }

      return Number.isFinite(Number(x[field]));
    });

  const vals = points.map(x => Number(x[field]));

  const lo = points.length ? Math.min(...vals) : 0;
  const hi = points.length ? Math.max(...vals) : 0;
  const range = hi - lo || 1;

  const path = points.map((x, i) => {
    const px = points.length === 1
      ? 50
      : 5 + i * 90 / (points.length - 1);

    const py = 85 - (Number(x[field]) - lo) / range * 65;

    return `${px},${py}`;
  }).join(' ');

  return (
    <article className="panel">
      <div className="charthead">
        <h3>{label}</h3>
        <b>
          {points.length
            ? format(points.at(-1)[field], unit)
            : '—'}
        </b>
      </div>

      {points.length ? (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="chart"
          role="img"
          aria-label={label + ' history'}
        >
          <path
            d="M5 20H95 M5 50H95 M5 85H95"
            stroke="#e5eee7"
            fill="none"
            strokeWidth=".5"
          />

          <polyline
            points={path}
            fill="none"
            stroke="#39a36b"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <p className="empty">Waiting for valid sensor readings</p>
      )}

      <small>Oldest → Latest</small>
    </article>
  );
}

export default function App() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(Date.now());
  const [loading, setLoading] = useState(true);

  const [adminKey, setAdminKey] = useState('');
  const [sending, setSending] = useState(false);
  const [commandMessage, setCommandMessage] = useState('');

  // Crop requested by this browser session.
  // The ESP32-reported crop remains separate.
  const [requestedCrop, setRequestedCrop] = useState(null);
  const [requestedAt, setRequestedAt] = useState(null);

  async function refresh() {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/latest', { cache: 'no-store' }),
        fetch('/api/history', { cache: 'no-store' }),
      ]);

      if (!a.ok || !b.ok) {
        throw Error(
          'Cloud API unavailable. Check your Vercel environment variables.'
        );
      }

      const [x, y] = await Promise.all([
        a.json(),
        b.json(),
      ]);

      setLatest(x.reading || null);
      setHistory(
        Array.isArray(y.readings) ? y.readings : []
      );

      setError('');
    } catch (e) {
      setError(e.message || 'Unable to load cloud readings.');
    } finally {
      setLoading(false);
    }
  }

  async function chooseCrop(code) {
    if (!adminKey.trim()) {
      setCommandMessage(
        'Enter the dashboard admin key first.'
      );
      return;
    }

    setSending(true);
    setCommandMessage('Sending crop command...');

    try {
      const r = await fetch('/api/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey,
        },
        body: JSON.stringify({
          crop_code: code,
        }),
      });

      const data = await r.json();

      if (!r.ok) {
        throw Error(data.error || 'Command failed');
      }

      // Only show a new request after the server confirms
      // that it successfully saved the command.
      setRequestedCrop(code);
      setRequestedAt(Date.now());

      setCommandMessage(
        `${CROP_NAMES[code]} command saved. ` +
        'Waiting for the ESP32 to confirm it through telemetry.'
      );

      await refresh();
    } catch (e) {
      setCommandMessage(
        e.message || 'Unable to save crop command.'
      );
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    refresh();

    const poll = setInterval(refresh, 10000);

    const timer = setInterval(() => {
      setTick(Date.now());
    }, 1000);

    return () => {
      clearInterval(poll);
      clearInterval(timer);
    };
  }, []);

  const latestTime = latest?.created_at
    ? new Date(latest.created_at).getTime()
    : NaN;

  const online =
    Number.isFinite(latestTime) &&
    tick - latestTime >= 0 &&
    tick - latestTime < 60000;

  const soilFault = isSoilFault(latest);

  const reportedCropCode =
    latest?.crop_code === null ||
    latest?.crop_code === undefined
      ? null
      : Number(latest.crop_code);

  const reportedCrop =
    latest?.crop_name ||
    CROP_NAMES[reportedCropCode] ||
    'Not selected';

  // Confirmation requires a fresh telemetry record
  // uploaded AFTER the crop button was pressed.
  const cropConfirmed =
    requestedCrop !== null &&
    online &&
    Number.isFinite(latestTime) &&
    latestTime >= requestedAt &&
    reportedCropCode === requestedCrop;

  const requestedCropName =
    requestedCrop === null
      ? null
      : CROP_NAMES[requestedCrop];

  const cropConfirmationText =
    requestedCrop === null
      ? 'Select a crop using the buttons below.'
      : cropConfirmed
        ? 'Confirmed by the ESP32.'
        : 'Waiting for ESP32 confirmation.';

  const soilDisplay = !latest
    ? 'Unavailable'
    : soilFault
      ? 'Sensor fault'
      : format(latest.soil_moisture, '%', 0);

  const soilNote = !latest
    ? 'Waiting for sensor data'
    : soilFault
      ? `Invalid soil reading (raw: ${latest.soil_raw ?? 'unknown'})`
      : 'Calibrated estimate';

  const cards = [
    [
      '💧',
      'Soil moisture',
      soilDisplay,
      soilNote,
    ],
    [
      '🌡️',
      'Temperature',
      format(latest?.temperature_c, '°C'),
      'DHT22 sensor',
    ],
    [
      '💨',
      'Air humidity',
      format(latest?.humidity_pct, '%'),
      'DHT22 sensor',
    ],
    [
      '📶',
      'Wi-Fi signal',
      format(latest?.wifi_rssi, ' dBm', 0),
      'ESP32 signal strength',
    ],
  ];

  const statuses = [
    [
      '🚿',
      'Pump command',
      !latest
        ? '—'
        : !online
          ? 'OFFLINE — UNKNOWN'
          : latest.pump_on
            ? 'ON'
            : 'OFF',
    ],
    [
      '🌱',
      'Irrigation',
      getIrrigationStatus(latest, online),
    ],
    [
      '🚶',
      'PIR motion',
      !latest
        ? '—'
        : !online
          ? 'OFFLINE — UNKNOWN'
          : latest.human_motion
            ? 'MOTION DETECTED'
            : 'NO MOTION',
    ],
    [
      '⚠️',
      'Pump lockout',
      !latest
        ? '—'
        : !online
          ? 'OFFLINE — UNKNOWN'
          : latest.safety_lockout
            ? 'LOCKED — INSPECT'
            : 'CLEAR',
    ],
  ];

  return (
    <div className="layout">
      <aside>
        <div className="logo">
          🌿
          <span>
            FieldWise
            <small>SMART AGRICULTURE</small>
          </span>
        </div>

        <div className="nav">
          ◉ &nbsp; Overview
        </div>

        <div className="sidefoot">
          ESP32 Field Node
          <br />

          <span>
            {online
              ? '● Online'
              : '○ Awaiting recent data'}
          </span>

          <p>
            Choose crops securely from the dashboard.
          </p>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="eyebrow">
              AGRICULTURE / LIVE MONITORING
            </div>

            <h1>Smart Farm Dashboard</h1>

            <p>
              ESP32 sensor readings, crop monitoring
              and automatic irrigation.
            </p>
          </div>

          <button onClick={refresh}>
            ↻ Refresh
          </button>
        </header>

        {error && (
          <div className="error">
            ⚠ {error}
          </div>
        )}

        <section className="hero">
          <div>
            <div className="pill">
              ● FIELD STATUS
            </div>

            <h2>
              Grow smarter.
              <br />
              <em>Water efficiently.</em>
            </h2>

            <p>
              Your farm information, connected
              through the cloud.
            </p>
          </div>

          <div className="crop">
            <span>🌱</span>

            <small>ESP32-REPORTED CROP</small>

            <strong>{reportedCrop}</strong>

            <small>
              {online
                ? 'Latest device report'
                : 'Last known report — device offline'}
            </small>
          </div>

          <div className="device">
            <b>
              {online
                ? '● DEVICE ONLINE'
                : '○ DEVICE OFFLINE / WAITING'}
            </b>

            <small>Last update</small>

            <strong>
              {clock(latest?.created_at)}
            </strong>
          </div>
        </section>

        <div className="section">
          <h2>Remote crop selection</h2>
          <span>Website → cloud → ESP32</span>
        </div>

        <section className="panel remote-panel">
          <p>
            Enter the dashboard admin key configured
            in Vercel. It stays in this page and is
            not saved to browser storage.
          </p>

          <input
            type="password"
            autoComplete="off"
            value={adminKey}
            onChange={e => setAdminKey(e.target.value)}
            placeholder="Dashboard admin key"
            aria-label="Dashboard admin key"
          />

          <div className="crop-buttons">
            {[
              ['Rice', 1],
              ['Wheat', 2],
              ['Cotton', 3],
              ['Tomato', 4],
              ['Reset / clear lockout', 0],
            ].map(([name, code]) => (
              <button
                key={code}
                disabled={sending}
                onClick={() => chooseCrop(code)}
              >
                {name}
              </button>
            ))}
          </div>

          <p role="status">
            {commandMessage ||
              'Choose a crop to send it to the ESP32.'}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              marginTop: '16px',
            }}
          >
            <div className="panel" style={{ padding: '14px' }}>
              <small>REQUESTED FROM THIS PAGE</small>

              <h3>
                {requestedCropName || 'None yet'}
              </h3>

              <small>{cropConfirmationText}</small>
            </div>

            <div className="panel" style={{ padding: '14px' }}>
              <small>CONFIRMED DEVICE REPORT</small>

              <h3>{reportedCrop}</h3>

              <small>
                {online
                  ? 'ESP32 telemetry is current'
                  : 'Waiting for a fresh ESP32 report'}
              </small>
            </div>
          </div>

          <p style={{ marginTop: '12px' }}>
            Note: The requested crop above is tracked
            in this browser session. The ESP32-reported
            crop comes from the cloud database.
          </p>
        </section>

        <div className="section">
          <h2>Live sensor readings</h2>
          <span>Refreshes every 10 seconds</span>
        </div>

        <section className="metrics">
          {cards.map(([icon, label, value, note]) => (
            <article
              className="panel metric"
              key={label}
            >
              <div className="metriclabel">
                {label}
                <span>{icon}</span>
              </div>

              <strong>{value}</strong>
              <small>{note}</small>
            </article>
          ))}
        </section>

        {latest && soilFault && (
          <div className="error" role="alert">
            ⚠ SOIL SENSOR FAULT: Raw reading is{' '}
            {latest.soil_raw ?? 'unavailable'}.
            The ESP32 must keep automatic irrigation
            disabled until a valid soil reading is available.
            A raw value of 4095 indicates ADC saturation.
          </div>
        )}

        <div className="section">
          <h2>System status</h2>
          <span>Latest ESP32 report</span>
        </div>

        <section className="statuses">
          {statuses.map(([icon, label, value]) => (
            <article
              className="panel state"
              key={label}
            >
              <span>{icon}</span>

              <div>
                <small>{label}</small>
                <b>{value}</b>
              </div>
            </article>
          ))}
        </section>

        <div className="section">
          <h2>Sensor history</h2>
          <span>Most recent 40 readings</span>
        </div>

        <section className="charts">
          <MiniChart
            rows={history}
            field="soil_moisture"
            label="Soil moisture"
            unit="%"
          />

          <MiniChart
            rows={history}
            field="temperature_c"
            label="Temperature"
            unit="°C"
          />

          <MiniChart
            rows={history}
            field="humidity_pct"
            label="Humidity"
            unit="%"
          />
        </section>

        <div className="section">
          <h2>Recent records</h2>
          <span>{history.length} entries</span>
        </div>

        <section className="panel tablewrap">
          <table>
            <thead>
              <tr>
                {[
                  'Time',
                  'Crop',
                  'Soil',
                  'Temp',
                  'Humidity',
                  'Pump',
                  'PIR',
                  'Lockout',
                ].map(x => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {history.length ? (
                history.slice(0, 12).map(x => (
                  <tr key={x.id}>
                    <td>{clock(x.created_at)}</td>

                    <td>
                      {x.crop_name ||
                        CROP_NAMES[x.crop_code] ||
                        'Not selected'}
                    </td>

                    <td>
                      {isSoilFault(x)
                        ? 'Sensor fault'
                        : format(x.soil_moisture, '%', 0)}
                    </td>

                    <td>
                      {format(x.temperature_c, '°C')}
                    </td>

                    <td>
                      {format(x.humidity_pct, '%')}
                    </td>

                    <td>
                      {x.pump_on ? 'ON' : 'OFF'}
                    </td>

                    <td>
                      {x.human_motion
                        ? 'Motion'
                        : 'Clear'}
                    </td>

                    <td>
                      {x.safety_lockout
                        ? 'Locked'
                        : 'Clear'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8">
                    {loading
                      ? 'Loading…'
                      : 'No data yet. Upload ESP32 readings first.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <footer>
          FieldWise · Smart Agriculture · PIR detects
          motion, not guaranteed human presence.
          Pump status represents the ESP32 command,
          not independently measured pump current.
        </footer>
      </main>
    </div>
  );
}

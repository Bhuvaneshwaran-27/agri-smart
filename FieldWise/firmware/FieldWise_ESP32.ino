/*
  SMART AGRICULTURE MANAGEMENT SYSTEM
  ESP32 + DHT11 + Soil Sensor + PIR + Relay + Buzzer

  Crop selection through Serial Monitor:
  1 = Rice
  2 = Wheat
  3 = Cotton
  4 = Tomato
  0 = Reset / clear pump safety lockout

  Cloud upload is optional and requires a configured API.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>

// ================ WIFI / CLOUD =================

// Replace these with your actual credentials.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* API_URL =
  "https://YOUR-VERCEL-PROJECT.vercel.app/api/telemetry";

const char* DEVICE_API_KEY = "YOUR_DEVICE_API_KEY";

// ================ PIN CONFIGURATION ================

#define SOIL_PIN    34
#define DHT_PIN     4
#define DHT_TYPE    DHT11
#define PIR_PIN     32
#define RELAY_PIN   27
#define BUZZER_PIN  33

DHT dht(DHT_PIN, DHT_TYPE);

// Most relay modules are active LOW.
// Set to true only if your relay activates with HIGH.
const bool RELAY_ACTIVE_HIGH = false;

// Set false if your buzzer activates with LOW.
const bool BUZZER_ACTIVE_HIGH = true;

// ================ SOIL CALIBRATION =================

// Example values only: calibrate your own sensor.
const int SOIL_DRY_RAW = 3000;
const int SOIL_WET_RAW = 1300;

// ================ CROP TARGETS =====================

// Demonstration values, NOT universal crop recommendations.
// Calibrate using your sensor, soil and irrigation method.

const float RICE_START = 45.0;
const float RICE_STOP  = 65.0;

const float WHEAT_START = 35.0;
const float WHEAT_STOP  = 55.0;

const float COTTON_START = 30.0;
const float COTTON_STOP  = 50.0;

const float TOMATO_START = 40.0;
const float TOMATO_STOP  = 60.0;

// ================ TIMING ===========================

const unsigned long SENSOR_INTERVAL = 2000;
const unsigned long CLOUD_INTERVAL = 20000;
const unsigned long MAX_PUMP_RUNTIME = 15000;
const unsigned long MIN_PUMP_OFFTIME = 60000;
const unsigned long WIFI_RETRY_INTERVAL = 10000;

// ================ CROP SELECTION ===================

enum Crop {
  NO_CROP = 0,
  RICE = 1,
  WHEAT = 2,
  COTTON = 3,
  TOMATO = 4
};

Crop selectedCrop = NO_CROP;

// ================ SYSTEM VARIABLES =================

int soilRaw = 0;
float soilMoisture = 0.0;
float temperatureC = NAN;
float humidityPct = NAN;

bool dhtValid = false;
bool humanMotion = false;
bool pumpOn = false;
bool irrigationRequired = false;

// Stays locked after pump timeout until reset command 0.
bool pumpTimeoutLockout = false;

unsigned long lastSensorTime = 0;
unsigned long lastCloudTime = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long pumpStartedTime = 0;
unsigned long lastPumpOffTime = 0;

// ================ CROP INFORMATION =================

const char* getCropName() {
  switch (selectedCrop) {
    case RICE:   return "Rice";
    case WHEAT:  return "Wheat";
    case COTTON: return "Cotton";
    case TOMATO: return "Tomato";
    default:     return "Not selected";
  }
}

float getStartThreshold() {
  switch (selectedCrop) {
    case RICE:   return RICE_START;
    case WHEAT:  return WHEAT_START;
    case COTTON: return COTTON_START;
    case TOMATO: return TOMATO_START;
    default:     return 101.0;
  }
}

float getStopThreshold() {
  switch (selectedCrop) {
    case RICE:   return RICE_STOP;
    case WHEAT:  return WHEAT_STOP;
    case COTTON: return COTTON_STOP;
    case TOMATO: return TOMATO_STOP;
    default:     return 101.0;
  }
}

// ================ OUTPUT CONTROL ===================

void setPump(bool state) {
  if (state == pumpOn) return;

  bool outputHigh =
    state ? RELAY_ACTIVE_HIGH : !RELAY_ACTIVE_HIGH;

  digitalWrite(RELAY_PIN, outputHigh ? HIGH : LOW);
  pumpOn = state;

  if (state) {
    pumpStartedTime = millis();
    Serial.println("PUMP: ON");
  } else {
    lastPumpOffTime = millis();
    Serial.println("PUMP: OFF");
  }
}

void setBuzzer(bool state) {
  bool outputHigh =
    state ? BUZZER_ACTIVE_HIGH : !BUZZER_ACTIVE_HIGH;

  digitalWrite(BUZZER_PIN, outputHigh ? HIGH : LOW);
}

// ================ SELECT / RESET CROP ===============

void selectCrop(Crop crop) {
  setPump(false);

  selectedCrop = crop;
  irrigationRequired = false;

  Serial.println();
  Serial.print("Selected crop: ");
  Serial.println(getCropName());

  if (pumpTimeoutLockout) {
    Serial.println(
      "Pump safety lockout active. Send 0 to reset."
    );
  }
}

void resetSystem() {
  setPump(false);

  selectedCrop = NO_CROP;
  irrigationRequired = false;
  pumpTimeoutLockout = false;

  // Enforce the normal minimum OFF time after reset.
  lastPumpOffTime = millis();

  Serial.println("SYSTEM RESET");
  Serial.println("Crop cleared; pump safety lockout cleared.");
  Serial.println("Select a crop using 1, 2, 3 or 4.");
}

// ================ SERIAL CROP SELECTION =============

void readSerialCommands() {
  while (Serial.available() > 0) {
    char command = Serial.read();

    if (command == '1') {
      selectCrop(RICE);
    } else if (command == '2') {
      selectCrop(WHEAT);
    } else if (command == '3') {
      selectCrop(COTTON);
    } else if (command == '4') {
      selectCrop(TOMATO);
    } else if (command == '0') {
      resetSystem();
    }
  }
}

// ================ SOIL MOISTURE =====================

float calculateSoilMoisture(int raw) {
  if (SOIL_DRY_RAW == SOIL_WET_RAW) return 0.0;

  float value =
    (float)(SOIL_DRY_RAW - raw) * 100.0 /
    (float)(SOIL_DRY_RAW - SOIL_WET_RAW);

  if (value < 0.0) value = 0.0;
  if (value > 100.0) value = 100.0;

  return value;
}

// ================ SENSOR READING ===================

void readSensors() {
  soilRaw = analogRead(SOIL_PIN);
  soilMoisture = calculateSoilMoisture(soilRaw);

  float t = dht.readTemperature();
  float h = dht.readHumidity();

  dhtValid = !isnan(t) && !isnan(h);

  if (dhtValid) {
    temperatureC = t;
    humidityPct = h;
  }

  humanMotion = digitalRead(PIR_PIN) == HIGH;

  Serial.println("\n------ SENSOR DATA ------");

  Serial.print("Crop: ");
  Serial.println(getCropName());

  Serial.print("Soil raw: ");
  Serial.println(soilRaw);

  Serial.print("Estimated soil moisture: ");
  Serial.print(soilMoisture, 1);
  Serial.println("%");

  if (dhtValid) {
    Serial.print("Temperature: ");
    Serial.print(temperatureC, 1);
    Serial.println(" C");

    Serial.print("Humidity: ");
    Serial.print(humidityPct, 1);
    Serial.println("%");
  } else {
    Serial.println("DHT11 reading invalid.");
  }

  Serial.print("Motion: ");
  Serial.println(humanMotion ? "DETECTED" : "CLEAR");

  Serial.print("Pump: ");
  Serial.println(pumpOn ? "ON" : "OFF");

  Serial.print("Pump timeout lockout: ");
  Serial.println(pumpTimeoutLockout ? "YES" : "NO");
}

// ================ IRRIGATION CONTROL ================

void manageIrrigation() {
  // Recheck PIR before making irrigation decisions.
  humanMotion = digitalRead(PIR_PIN) == HIGH;

  // Motion safety: stop the pump and alert.
  if (humanMotion) {
    irrigationRequired =
      selectedCrop != NO_CROP &&
      soilMoisture <= getStartThreshold();

    setPump(false);
    setBuzzer(true);
    return;
  }

  setBuzzer(false);

  // Soil irrigation does not depend on DHT11 validity.
  // DHT11 is used for monitoring only.

  if (selectedCrop == NO_CROP || pumpTimeoutLockout) {
    irrigationRequired = false;
    setPump(false);
    return;
  }

  float startLevel = getStartThreshold();
  float stopLevel = getStopThreshold();

  // Hysteresis prevents rapid ON/OFF switching.
  if (soilMoisture <= startLevel) {
    irrigationRequired = true;
  } else if (soilMoisture >= stopLevel) {
    irrigationRequired = false;
  }

  unsigned long now = millis();

  // Stop if the pump has run too long.
  if (pumpOn &&
      now - pumpStartedTime >= MAX_PUMP_RUNTIME) {
    setPump(false);
    pumpTimeoutLockout = true;

    Serial.println("SAFETY: Pump timeout!");
    Serial.println("Send 0 to reset after inspection.");
    return;
  }

  // Start only when minimum OFF time has elapsed.
  if (!pumpOn &&
      irrigationRequired &&
      now - lastPumpOffTime >= MIN_PUMP_OFFTIME) {
    setPump(true);
  }

  // Stop when the crop's stop threshold is reached.
  if (pumpOn && !irrigationRequired) {
    setPump(false);
  }
}

// ================ WIFI MANAGEMENT ==================

bool cloudConfigured() {
  return String(WIFI_SSID) != "YOUR_WIFI_NAME" &&
         String(API_URL).indexOf("YOUR-VERCEL-PROJECT") < 0 &&
         String(DEVICE_API_KEY) != "YOUR_DEVICE_API_KEY";
}

void maintainWiFi() {
  if (String(WIFI_SSID) == "YOUR_WIFI_NAME") return;
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();

  if (now - lastWiFiAttempt < WIFI_RETRY_INTERVAL) return;

  lastWiFiAttempt = now;
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println("Wi-Fi reconnect attempt.");
}

// ================ CLOUD TELEMETRY ==================

void uploadToCloud() {
  if (!cloudConfigured()) {
    Serial.println("Cloud not configured; upload skipped.");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi offline; upload skipped.");
    return;
  }

  WiFiClientSecure client;

  // Demo convenience only. Production should validate
  // the server certificate instead of disabling verification.
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(8000);

  if (!http.begin(client, API_URL)) {
    Serial.println("HTTP initialization failed.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_API_KEY);

  String payload = "{";

  payload += "\"device_id\":\"fieldwise-esp32-01\",";
  payload += "\"crop_code\":" + String((int)selectedCrop) + ",";
  payload += "\"crop_name\":\"" + String(getCropName()) + "\",";
  payload += "\"soil_moisture\":" + String(soilMoisture, 2) + ",";
  payload += "\"soil_raw\":" + String(soilRaw) + ",";

  payload += "\"temperature_c\":";
  payload += dhtValid ? String(temperatureC, 2) : "null";
  payload += ",";

  payload += "\"humidity_pct\":";
  payload += dhtValid ? String(humidityPct, 2) : "null";
  payload += ",";

  payload += "\"pump_on\":";
  payload += pumpOn ? "true" : "false";
  payload += ",";

  payload += "\"irrigation_required\":";
  payload += irrigationRequired ? "true" : "false";
  payload += ",";

  payload += "\"safety_lockout\":";
  payload += pumpTimeoutLockout ? "true" : "false";
  payload += ",";

  payload += "\"human_motion\":";
  payload += humanMotion ? "true" : "false";
  payload += ",";

  payload += "\"wifi_rssi\":" + String(WiFi.RSSI());
  payload += "}";

  int status = http.POST(payload);

  Serial.print("Cloud HTTP status: ");
  Serial.println(status);

  if (status < 200 || status >= 300) {
    Serial.println(http.getString());
  }

  http.end();
}

// ================ SETUP =============================

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(SOIL_PIN, INPUT);
  pinMode(PIR_PIN, INPUT);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  // Establish relay OFF level immediately.
  digitalWrite(
    RELAY_PIN,
    RELAY_ACTIVE_HIGH ? LOW : HIGH
  );

  pumpOn = false;
  setBuzzer(false);

  analogReadResolution(12);
  dht.begin();

  WiFi.mode(WIFI_STA);

  if (String(WIFI_SSID) != "YOUR_WIFI_NAME") {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWiFiAttempt = millis();
  }

  lastPumpOffTime = millis();

  Serial.println("\nSMART AGRICULTURE SYSTEM READY");
  Serial.println("1 = Rice");
  Serial.println("2 = Wheat");
  Serial.println("3 = Cotton");
  Serial.println("4 = Tomato");
  Serial.println("0 = Reset / clear pump lockout");
  Serial.println("Pump starts OFF.");
}

// ================ MAIN LOOP =========================

void loop() {
  readSerialCommands();

  // Check motion continuously.
  humanMotion = digitalRead(PIR_PIN) == HIGH;
  setBuzzer(humanMotion);

  if (humanMotion && pumpOn) {
    setPump(false);
    Serial.println("Motion detected: pump stopped.");
  }

  unsigned long now = millis();

  // Independent pump timeout check.
  if (pumpOn &&
      now - pumpStartedTime >= MAX_PUMP_RUNTIME) {
    setPump(false);
    pumpTimeoutLockout = true;

    Serial.println("SAFETY: Maximum pump runtime reached.");
    Serial.println("Send 0 after inspection to reset.");
  }

  maintainWiFi();

  if (now - lastSensorTime >= SENSOR_INTERVAL) {
    lastSensorTime = now;
    readSensors();
    manageIrrigation();
  }

  if (now - lastCloudTime >= CLOUD_INTERVAL) {
    lastCloudTime = now;
    uploadToCloud();
  }

  delay(5);
}
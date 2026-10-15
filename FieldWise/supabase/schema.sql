create table if not exists public.sensor_readings (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 device_id text not null,
 crop_code integer not null check(crop_code between 0 and 4),
 crop_name text not null,
 soil_moisture numeric(5,2) not null check(soil_moisture between 0 and 100),
 soil_raw integer not null,
 temperature_c numeric(5,2),
 humidity_pct numeric(5,2) check(humidity_pct between 0 and 100),
 pump_on boolean not null,
 irrigation_required boolean not null,
 safety_lockout boolean not null,
 human_motion boolean not null,
 wifi_rssi integer not null
);
create index if not exists sensor_readings_time_idx on public.sensor_readings(created_at desc);
alter table public.sensor_readings enable row level security;
revoke all on public.sensor_readings from anon,authenticated;

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

-- One desired crop per ESP32. Command revision increases on every website selection.
create table if not exists public.device_commands (
 device_id text primary key, crop_code integer not null default 0 check(crop_code between 0 and 4),
 revision bigint not null default 0, updated_at timestamptz not null default now()
);
insert into public.device_commands(device_id,crop_code) values ('fieldwise-esp32-01',0) on conflict(device_id) do nothing;
alter table public.device_commands enable row level security;
revoke all on public.device_commands from anon,authenticated;

-- Atomic increment prevents two concurrent browser requests from losing a revision.
create or replace function public.set_device_crop(p_device_id text,p_crop_code integer) returns bigint
language plpgsql security definer set search_path = public as $$
declare new_revision bigint;
begin
 if p_crop_code < 0 or p_crop_code > 4 then raise exception 'Invalid crop'; end if;
 insert into public.device_commands(device_id,crop_code,revision,updated_at)
 values(p_device_id,p_crop_code,1,now())
 on conflict(device_id) do update set crop_code=excluded.crop_code, revision=device_commands.revision+1,updated_at=now()
 returning revision into new_revision;
 return new_revision;
end $$;
revoke all on function public.set_device_crop(text,integer) from public,anon,authenticated;
grant execute on function public.set_device_crop(text,integer) to service_role;

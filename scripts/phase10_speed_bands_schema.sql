create table if not exists vehicle_speed_bands (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  bands jsonb not null,
  inherited_from_vehicle_id uuid references vehicles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists vehicle_status_card_preferences (
  vehicle_id uuid primary key references vehicles(id) on delete cascade,
  fields jsonb not null,
  updated_at timestamptz not null default now()
);

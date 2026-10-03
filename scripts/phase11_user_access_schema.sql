-- Phase 11 user, group, and access-control foundation.
-- Additive and safe to rerun. Authentication bootstrap is handled by the API.

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text,
  first_name text,
  last_name text,
  email text,
  role text not null default 'regular' check (role in ('admin', 'regular')),
  active boolean not null default true,
  auto_access_new_devices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  auto_access_new_devices boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_group_memberships (
  user_id uuid not null references app_users(id) on delete cascade,
  group_id uuid not null references app_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create table if not exists app_user_vehicle_access (
  user_id uuid not null references app_users(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

create table if not exists app_group_vehicle_access (
  group_id uuid not null references app_groups(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, vehicle_id)
);

create table if not exists app_user_device_access (
  user_id uuid not null references app_users(id) on delete cascade,
  traccar_device_id integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, traccar_device_id)
);

create table if not exists app_group_device_access (
  group_id uuid not null references app_groups(id) on delete cascade,
  traccar_device_id integer not null,
  created_at timestamptz not null default now(),
  primary key (group_id, traccar_device_id)
);

create index if not exists ix_app_group_memberships_group
  on app_group_memberships (group_id, user_id);
create index if not exists ix_app_user_vehicle_access_vehicle
  on app_user_vehicle_access (vehicle_id, user_id);
create index if not exists ix_app_group_vehicle_access_vehicle
  on app_group_vehicle_access (vehicle_id, group_id);
create index if not exists ix_app_user_device_access_device
  on app_user_device_access (traccar_device_id, user_id);
create index if not exists ix_app_group_device_access_device
  on app_group_device_access (traccar_device_id, group_id);

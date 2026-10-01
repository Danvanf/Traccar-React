-- Phase 9: encrypted Bouncie OAuth credential envelope.
-- The ciphertext is produced by the API with VEHICLE_APP_BOUNCIE_ENCRYPTION_KEY.
-- Never put the encryption key, client secret, refresh token, or authorization
-- code in this file or in source control.

create table if not exists bouncie_credentials (
    id smallint primary key check (id = 1),
    client_id text not null,
    client_secret_ciphertext text not null,
    refresh_token_ciphertext text not null,
    redirect_uri text not null,
    user_label text,
    updated_at timestamptz not null default now()
);

create table if not exists bouncie_import_checkpoints (
    vehicle_imei text not null,
    window_from timestamptz not null,
    window_through timestamptz not null,
    completed_at timestamptz not null default now(),
    imported_count integer not null default 0,
    skipped_count integer not null default 0,
    imported_events integer not null default 0,
    primary key (vehicle_imei, window_from, window_through)
);

create index if not exists ix_bouncie_import_checkpoints_completed
on bouncie_import_checkpoints (completed_at desc);

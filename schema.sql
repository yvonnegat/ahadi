-- AHADI — Supabase schema
-- Run this in the Supabase SQL editor before starting the backend.

create extension if not exists "pgcrypto";

-- Citizens who report or follow projects. Optional/anonymous per spec (section 10),
-- so phone is the only required field and reports don't strictly need a user_id.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  name text,
  location text,
  created_at timestamptz default now()
);

create table if not exists promises (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  promised_by text,
  sector text,
  county text,
  constituency text,
  ward text,
  deadline text,
  source_url text,
  source_text text,
  created_at timestamptz default now()
);

-- A short, USSD-typeable code (e.g. "P001") — citizens can't reliably type a UUID
-- on a feature phone, so this is what they enter/report against.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  promise_id uuid references promises(id) on delete cascade,
  title text not null,
  budget numeric,
  official_status text default 'ongoing' check (
    official_status in ('not_started', 'ongoing', 'delayed', 'completed')
  ),
  start_date date,
  expected_completion date,
  latitude double precision,
  longitude double precision,
  county text,
  constituency text,
  ward text,
  created_at timestamptz default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id),
  phone text,
  category text check (
    category in ('not_started', 'ongoing', 'stalled', 'complete', 'mismatch')
  ),
  description text,
  photo_url text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz default now()
);

create table if not exists project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  status text,
  source text,
  description text,
  date timestamptz default now()
);

-- SMS subscriptions (spec section 17 — "citizen following a project")
create table if not exists follows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  phone text not null,
  created_at timestamptz default now(),
  unique (project_id, phone)
);

create index if not exists idx_projects_ward on projects (county, constituency, ward);
create index if not exists idx_projects_code on projects (code);
create index if not exists idx_reports_project on reports (project_id);
create index if not exists idx_follows_project on follows (project_id);

-- Seed data note: for the hackathon MVP (spec section 20), populate one
-- constituency with 3-5 wards and 15-25 promises/projects, each with
-- 5-20 simulated citizen reports. Label it clearly as demonstration data.

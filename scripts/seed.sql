-- Seed data for rr_auto
-- Safe to run multiple times (upserts + targeted deletes).
--
-- Usage:
--   psql $DATABASE_URL -f scripts/seed.sql
--   or
--   npm run seed

CREATE TABLE IF NOT EXISTS driver_map (
  unit_id VARCHAR(20)  PRIMARY KEY,
  rr_id   VARCHAR(100) NOT NULL DEFAULT '',
  name    VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS transponder_map (
  transponder VARCHAR(50) PRIMARY KEY,
  unit_id     VARCHAR(20) NOT NULL
);

-- ─── Reset tables ─────────────────────────────────────────────────────────────

DELETE FROM transponder_map;
DELETE FROM driver_map;

-- ─── Drivers ─────────────────────────────────────────────────────────────────

INSERT INTO driver_map (unit_id, rr_id, name) VALUES
  ('1542', '', 'OPEN'),
  ('9671', 'c7a5dfe8-ffbe-484c-a770-b73da648661c', 'Kazimierz Dziurdzik'),
  ('9673', '5b696c14-e5a4-495d-be8d-5b3d3088d7b0', 'Tamas Rati'),
  ('9681', '7c0876b2-7d71-47f5-80a5-94161153a3ee', 'Michael Lumley'),
  ('9682', '18ce4f11-8bd7-4fc1-8221-84c8847ef766', 'Jeffrey Gill'),
  ('9687', '6aa54d33-061e-4f43-b05e-1f26758a84bb', 'Adam Karpinski'),
  ('9688', 'b2ced056-59e4-44c0-9e3e-b064991e36a6', 'Miroslaw Kopylec'),
  ('9689', 'b3ef1f68-628d-4a6d-80bc-ca8e094c89d2', 'Pawel Trocha'),
  ('9690', 'b8d62974-d97c-441d-a2c7-e88943fe6e9d', 'Janusz Kukielka'),
  ('9691', 'ec2d7db9-cbc7-43e6-8703-7fb18ffcbf61', 'Miroslaw Krzyzanowski'),
  ('9692', '3e90c2aa-c9ad-4bcc-81d2-9ac5b00f752b', 'Slawomir Wojcik'),
  ('9693', '821b4455-707c-43d4-947c-fc99c3591aae', 'Robert Bronowicki')
ON CONFLICT (unit_id) DO UPDATE
  SET rr_id = EXCLUDED.rr_id,
      name  = EXCLUDED.name;

-- ─── Transponders ────────────────────────────────────────────────────────────

INSERT INTO transponder_map (transponder, unit_id) VALUES
  ('19E100054E1',    '9681'),
  ('19E100054E3',    '9671'),
  ('19E100054E6',    '9676'),
  ('25290001059389', '9687'),
  ('25290001067937', '1542'),
  ('25290001067938', '9673'),
  ('25290001067939', '9688'),
  ('25290001071808', '9689'),
  ('25290001076380', '1543'),
  ('25290001076381', '1544'),
  ('25290001076382', '9690'),
  ('25290001079836', '9692'),
  ('25290001079837', '9691'),
  ('25300000009876', '9682'),
  ('25300000013682', '9683'),
  ('25300000015666', '1529')
ON CONFLICT (transponder) DO UPDATE
  SET unit_id = EXCLUDED.unit_id;

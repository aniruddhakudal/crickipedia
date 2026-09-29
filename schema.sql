-- Phase 2 PostgreSQL schema. One platform, many tournaments.
-- Full reset (destructive). Run this file manually in SQL editor to recreate from scratch.
-- App startup migrate() skips DROP statements so live data is not cleared on deploy.
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS player_preferences;
DROP TABLE IF EXISTS sponsors;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS tournaments;

CREATE TABLE IF NOT EXISTS tournaments (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(64) UNIQUE NOT NULL,
  tournament_slug VARCHAR(48) NOT NULL DEFAULT 'tournament',
  season_slug VARCHAR(48) NOT NULL DEFAULT 'season',
  name VARCHAR(150) NOT NULL,
  short_name VARCHAR(20),
  logo_url TEXT,
  description TEXT,
  registration_start DATE NOT NULL,
  registration_end DATE NOT NULL,
  entry_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  date_of_birth DATE,
  flat_number VARCHAR(30),
  whatsapp_number VARCHAR(20) NOT NULL UNIQUE,
  photo_url TEXT,
  cricheroes_url TEXT,
  instagram_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_preferences (
  player_id BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  skill VARCHAR(50) NOT NULL,
  suggested_jersey_number INT,
  jersey_size VARCHAR(10),
  sleeve_type VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS registrations (
  id BIGSERIAL PRIMARY KEY,
  registration_number VARCHAR(50) UNIQUE NOT NULL,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(id),
  category VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING_PAYMENT',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  registration_id BIGINT UNIQUE NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  payment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  gateway VARCHAR(50),
  gateway_order_id VARCHAR(150),
  gateway_transaction_id VARCHAR(150),
  receipt_url TEXT,
  receipt_upi_ref VARCHAR(120),
  verification_status VARCHAR(40),
  reject_reason TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsors (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  sponsor_name VARCHAR(150) NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  display_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_players_whatsapp ON players(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_registrations_tournament ON registrations(tournament_id);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_tournaments_slug ON tournaments(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_tournament_season ON tournaments(tournament_slug, season_slug);

-- Future phases can add:
-- auction_players / auctions / bids
-- teams / team_players
-- matches / innings / deliveries / scorecards
-- prize_categories / prize_winners

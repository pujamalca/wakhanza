-- 001_init.sql
-- Skema awal wakhanza. Lihat ARCHITECTURE.md §3 untuk penjelasan tiap tabel.
-- HANYA untuk database `wakhanza` — TIDAK PERNAH dijalankan terhadap `sik`.

CREATE TABLE poll_cursor (
  trigger_code   VARCHAR(32)  NOT NULL PRIMARY KEY,
  cursor_ts      DATETIME     NOT NULL,
  last_run_at    DATETIME     NULL,
  last_error     TEXT         NULL,
  rows_seen      INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE outbox (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  idempotency_key  VARCHAR(64)  NOT NULL,
  trigger_code     VARCHAR(32)  NOT NULL,
  no_rkm_medis     VARCHAR(15)  NULL,
  phone_e164       VARCHAR(20)  NULL,
  body             TEXT         NOT NULL,
  status           ENUM('pending','sending','sent','failed','failed_permanent',
                        'skipped_no_contact','skipped_opt_out','expired') NOT NULL DEFAULT 'pending',
  attempts         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  event_at         DATETIME     NOT NULL,
  scheduled_at     DATETIME     NOT NULL,
  sent_at          DATETIME     NULL,
  last_error       TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem (idempotency_key),
  KEY ix_dispatch (status, scheduled_at),
  KEY ix_rm (no_rkm_medis)
) ENGINE=InnoDB;

CREATE TABLE template (
  trigger_code  VARCHAR(32)  NOT NULL PRIMARY KEY,
  label         VARCHAR(80)  NOT NULL,
  body          TEXT         NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    VARCHAR(64)  NULL
) ENGINE=InnoDB;

CREATE TABLE patient_contact (
  no_rkm_medis  VARCHAR(15)  NOT NULL PRIMARY KEY,
  raw_value     VARCHAR(40)  NULL,
  phone_e164    VARCHAR(20)  NULL,
  source        ENUM('auto','manual') NOT NULL DEFAULT 'auto',
  reason        VARCHAR(64)  NULL,
  checked_at    DATETIME     NOT NULL,
  updated_by    VARCHAR(64)  NULL,
  KEY ix_phone (phone_e164),
  KEY ix_invalid (phone_e164, source)
) ENGINE=InnoDB;

CREATE TABLE opt_out (
  phone_e164  VARCHAR(20) NOT NULL PRIMARY KEY,
  source      ENUM('reply','manual') NOT NULL,
  note        VARCHAR(200) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE wa_session (
  id            TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  status        ENUM('disconnected','qr_pending','authenticating','ready','failed')
                NOT NULL DEFAULT 'disconnected',
  qr_data       TEXT     NULL,
  qr_issued_at  DATETIME NULL,
  phone_number  VARCHAR(20) NULL,
  heartbeat_at  DATETIME NULL,
  command       ENUM('none','reconnect','logout') NOT NULL DEFAULT 'none',
  last_error    TEXT NULL
) ENGINE=InnoDB;

CREATE TABLE send_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  outbox_id     BIGINT UNSIGNED NOT NULL,
  attempt       TINYINT UNSIGNED NOT NULL,
  outcome       ENUM('sent','error') NOT NULL,
  detail        TEXT NULL,
  duration_ms   INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_outbox (outbox_id)
) ENGINE=InnoDB;

CREATE TABLE app_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50) NOT NULL UNIQUE,
  name          VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','operator') NOT NULL DEFAULT 'operator',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor       VARCHAR(64) NOT NULL,
  action      VARCHAR(64) NOT NULL,
  target      VARCHAR(120) NULL,
  detail      TEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_actor (actor, created_at)
) ENGINE=InnoDB;

CREATE TABLE app_setting (
  k  VARCHAR(64) NOT NULL PRIMARY KEY,
  v  TEXT NOT NULL
) ENGINE=InnoDB;

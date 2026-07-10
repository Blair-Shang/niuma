-- 000002_connection.up.sql
-- 连接配置与凭据引用（无明文密码）

CREATE TABLE IF NOT EXISTS nm_connection_profile (
    profile_id          TEXT NOT NULL PRIMARY KEY,
    workspace_id        TEXT NOT NULL,
    profile_name        TEXT NOT NULL,
    connection_kind     TEXT NOT NULL,
    host_address        TEXT,
    port_number         INTEGER,
    login_account       TEXT,
    connection_options  TEXT NOT NULL DEFAULT '{}',
    record_status       TEXT NOT NULL DEFAULT 'active',
    row_version         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nm_conn_profile_ws ON nm_connection_profile (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_conn_profile_name ON nm_connection_profile (workspace_id, profile_name);

CREATE TABLE IF NOT EXISTS nm_credential_ref (
    credential_id     TEXT NOT NULL PRIMARY KEY,
    credential_label  TEXT NOT NULL,
    credential_kind   TEXT NOT NULL,
    cipher_text       TEXT NOT NULL DEFAULT '',  -- AES-256-GCM 密文；主密钥存 OS Keychain 单条目
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nm_cred_ref_label ON nm_credential_ref (credential_label);

CREATE TABLE IF NOT EXISTS nm_profile_credential (
    profile_id      TEXT NOT NULL,
    credential_id   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (profile_id, credential_id)
);

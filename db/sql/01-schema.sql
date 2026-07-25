-- ============================================================================
-- Mantenedor de Vehículos autos.cmdspa.com — Esquema de base de datos
-- PostgreSQL 17
-- ============================================================================

-- Tipos enumerados
CREATE TYPE usuario_rol AS ENUM ('super_admin', 'admin', 'usuario');
CREATE TYPE vehiculo_tipo AS ENUM ('calle', 'deportivo');
CREATE TYPE documento_tipo AS ENUM ('soap', 'permiso_circulacion', 'revision_tecnica', 'seguro', 'registro', 'otro');
CREATE TYPE gasto_categoria AS ENUM ('combustible', 'seguro', 'patente', 'mantencion', 'peaje', 'repuestos', 'accesorios', 'otro');

-- ----------------------------------------------------------------------------
-- Empresas (multi-tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE empresas (
    id          BIGSERIAL PRIMARY KEY,
    nombre      TEXT NOT NULL,
    rut         TEXT,
    logo_path   TEXT,
    plan        TEXT NOT NULL DEFAULT 'basico',
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    creada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Usuarios
-- ----------------------------------------------------------------------------
CREATE TABLE usuarios (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    nombre        TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    rol           usuario_rol NOT NULL DEFAULT 'usuario',
    empresa_id    BIGINT REFERENCES empresas(id),
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Vehículos
-- ----------------------------------------------------------------------------
CREATE TABLE vehiculos (
    id         BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT REFERENCES empresas(id),
    nombre     TEXT NOT NULL,
    patente    TEXT UNIQUE,                       -- puede ser NULL (en trámite)
    titular    TEXT,
    tipo       vehiculo_tipo NOT NULL DEFAULT 'calle',
    marca      TEXT,
    modelo     TEXT,
    anio       INTEGER,
    vin        TEXT,
    motor      TEXT,
    color      TEXT,
    notas      TEXT,
    -- GPS / Tracking
    gps_tipo       TEXT,                          -- 'airtag' | 'prepago' | 'suscripcion' | NULL
    gps_empresa    TEXT,                          -- Apple, SuiGPS, Movistar, etc.
    gps_device_id  TEXT,                          -- n° de serie / ID / teléfono
    gps_vence      DATE,                          -- vencimiento suscripción/recarga
    datos_api  JSONB,                             -- respuesta cruda de Boostr
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Acceso selectivo vehículo ↔ usuario (usuarios no-admin ven solo los asignados)
-- ----------------------------------------------------------------------------
CREATE TABLE acceso_vehiculo (
    usuario_id  BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    vehiculo_id BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, vehiculo_id)
);

-- ----------------------------------------------------------------------------
-- Documentos (con vencimiento y archivo adjunto)
-- ----------------------------------------------------------------------------
CREATE TABLE documentos (
    id           BIGSERIAL PRIMARY KEY,
    vehiculo_id  BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
    tipo         documento_tipo NOT NULL,
    descripcion  TEXT,
    vence        DATE,
    archivo_path TEXT,                            -- ruta relativa en el volumen de storage
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Versionado: agrupa versiones del mismo tipo + vehículo
    grupo_id     BIGINT,                          -- ID del documento original (raíz del grupo)
    es_vigente   BOOLEAN NOT NULL DEFAULT TRUE    -- TRUE = versión más reciente del grupo
);

-- ----------------------------------------------------------------------------
-- Mantenciones
-- ----------------------------------------------------------------------------
CREATE TABLE mantenciones (
    id           BIGSERIAL PRIMARY KEY,
    vehiculo_id  BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
    fecha        DATE NOT NULL,
    tipo         TEXT,
    kilometraje  INTEGER,
    costo        NUMERIC(12,0),
    descripcion  TEXT,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Gastos
-- ----------------------------------------------------------------------------
CREATE TABLE gastos (
    id           BIGSERIAL PRIMARY KEY,
    vehiculo_id  BIGINT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
    fecha        DATE NOT NULL,
    categoria    gasto_categoria NOT NULL DEFAULT 'otro',
    monto        NUMERIC(12,0) NOT NULL,
    descripcion  TEXT,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Refresh tokens (rotación de sesiones JWT)
-- ----------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revocado    BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- API Keys — acceso para agentes IA / automatizaciones
-- ----------------------------------------------------------------------------
CREATE TABLE api_keys (
    id           BIGSERIAL PRIMARY KEY,
    nombre       TEXT NOT NULL,                       -- "Agente IA producción"
    key_hash     TEXT NOT NULL UNIQUE,                -- SHA-256 de la key real
    key_prefix   TEXT NOT NULL,                       -- primeros 12 chars para ID
    usuario_id   BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    scopes       TEXT[] NOT NULL DEFAULT '{read,write}',
    activa       BOOLEAN NOT NULL DEFAULT TRUE,
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_uso   TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ                          -- NULL = sin expiración
);

-- ----------------------------------------------------------------------------
-- Alerta envíos — dedupe de notificaciones (anti-spam)
-- ----------------------------------------------------------------------------
CREATE TABLE alerta_envios (
    id            BIGSERIAL PRIMARY KEY,
    documento_id  BIGINT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    tipo_aviso    TEXT NOT NULL,                      -- '30d', '14d', '7d', 'vencido'
    enviado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (documento_id, tipo_aviso)                -- no reenviar el mismo tipo
);

-- ----------------------------------------------------------------------------
-- Configuración por empresa — API keys propias (OpenAI, Resend)
-- ----------------------------------------------------------------------------
CREATE TABLE empresa_config (
    empresa_id     BIGINT PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
    openai_api_key TEXT,
    openai_model   TEXT DEFAULT 'gpt-4o',
    resend_api_key TEXT,
    resend_from    TEXT,
    resend_to      TEXT,
    actualizado_en TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_vehiculos_patente        ON vehiculos (patente);
CREATE INDEX idx_documentos_vehiculo_vence ON documentos (vehiculo_id, vence);
CREATE INDEX idx_mantenciones_vehiculo     ON mantenciones (vehiculo_id, fecha DESC);
CREATE INDEX idx_gastos_vehiculo_fecha     ON gastos (vehiculo_id, fecha DESC);
CREATE INDEX idx_acceso_vehiculo_usuario   ON acceso_vehiculo (usuario_id);
CREATE INDEX idx_refresh_tokens_usuario    ON refresh_tokens (usuario_id); -- L14
CREATE INDEX idx_refresh_tokens_expires    ON refresh_tokens (expires_at); -- L14 purga

-- Trigger para mantener actualizado_en en vehiculos
CREATE OR REPLACE FUNCTION trg_vehiculos_actualizado()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehiculos_actualizado
    BEFORE UPDATE ON vehiculos
    FOR EACH ROW
    EXECUTE FUNCTION trg_vehiculos_actualizado();

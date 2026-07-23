#!/bin/bash
# Init script para PostgreSQL: crea base de datos y usuario, luego carga esquema y seed.
# Ejecutado automáticamente por la imagen oficial de postgres en el primer arranque.
set -e

# Crear rol y base de datos (idempotente)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'autos') THEN
            CREATE ROLE autos WITH LOGIN PASSWORD '${AUTOS_DB_PASSWORD}';
        ELSE
            ALTER ROLE autos WITH LOGIN PASSWORD '${AUTOS_DB_PASSWORD}';
        END IF;
    END \$\$;

    SELECT 'CREATE DATABASE autos OWNER autos'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'autos')\gexec
EOSQL

# Cargar esquema y seed como superusuario (por los tipos ENUM y triggers)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname autos -f /docker-entrypoint-initdb.d/sql/01-schema.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname autos -f /docker-entrypoint-initdb.d/sql/02-seed.sql

# Otorgar permisos al rol de aplicación sobre todo lo creado (schema fue creado por superuser)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname autos <<-EOSQL
    GRANT USAGE ON SCHEMA public TO autos;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autos;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO autos;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autos;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO autos;
EOSQL

echo "[init] Base de datos 'autos' inicializada con esquema, seed y permisos."

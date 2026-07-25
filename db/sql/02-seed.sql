-- ============================================================================
-- Seed: datos de demostración. Modifica los valores antes de usar en producción.
-- ============================================================================

-- Empresa inicial
INSERT INTO empresas (nombre, rut, plan)
VALUES ('Empresa Demo SpA', '76.000.000-0', 'basico')
ON CONFLICT DO NOTHING;

-- Usuario admin inicial. La app actualizará el hash desde ADMIN_PASSWORD.
INSERT INTO usuarios (email, nombre, password_hash, rol, empresa_id, activo)
VALUES ('admin@demo.cl', 'Administrador', '__ADMIN_HASH_PLACEHOLDER__', 'super_admin', 1, TRUE)
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- Vehículos de demostración
-- ============================================================================
INSERT INTO vehiculos (empresa_id, nombre, patente, titular, tipo, notas) VALUES
(1, 'Auto Ejemplo 1', 'AAAA11', 'Titular Demo', 'calle', 'Vehículo de demostración.'),
(1, 'Auto Ejemplo 2', 'BBBB22', 'Titular Demo', 'calle', 'Vehículo de demostración.')
ON CONFLICT (patente) DO NOTHING;

-- ============================================================================
-- Documentos de demostración
-- ============================================================================
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='AAAA11'), 'soap', 'SOAP vigente', '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='AAAA11'), 'permiso_circulacion', 'Permiso de Circulación vigente', '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='BBBB22'), 'soap', 'SOAP vigente', '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='BBBB22'), 'permiso_circulacion', 'Permiso de Circulación vigente', '2027-03-31');

-- Migrar datos de vehiculos creados por el seed: empresa_id = 1, grupo_id = id
UPDATE vehiculos SET empresa_id = 1 WHERE empresa_id IS NULL;
UPDATE documentos SET grupo_id = id WHERE grupo_id IS NULL;

-- ============================================================================
-- Acceso: el admin inicial ve TODOS los vehículos
-- ============================================================================
INSERT INTO acceso_vehiculo (usuario_id, vehiculo_id)
SELECT u.id, v.id
FROM usuarios u CROSS JOIN vehiculos v
WHERE u.email = 'admin@demo.cl'
ON CONFLICT DO NOTHING;

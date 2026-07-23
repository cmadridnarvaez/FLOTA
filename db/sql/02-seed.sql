-- ============================================================================
-- Seed: 11 vehículos + documentos + usuario admin inicial
-- El password_hash del admin se inyecta desde la app (ver api/src/seed.js),
-- porque bcrypt no está disponible en SQL puro. Aquí se crea con hash temporal
-- que la app reemplaza en el primer arranque.
-- ============================================================================

-- Usuario admin inicial (email en minúsculas). La app actualizará el hash.
INSERT INTO usuarios (email, nombre, password_hash, rol, activo)
VALUES ('cmadrid@cmdspa.com', 'Cristian Madrid', '__ADMIN_HASH_PLACEHOLDER__', 'admin', TRUE)
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- Vehículos (extraídos de Levantamiento_Vehiculos.xlsx al 06-07-2026)
-- ============================================================================
INSERT INTO vehiculos (nombre, patente, titular, tipo, notas) VALUES
('Fiat 500',           'HSSZ38', 'Cristian Madrid Narváez',         'calle',      'Revisión técnica/emisiones VENCIDA desde noviembre 2025. Renovar antes de fiscalización; sin ella no puede circular legalmente.'),
('Audi A3',            'DPFZ72', 'Cristian Madrid Narváez',         'calle',      'Revisión técnica y emisiones renovadas el 18/04/2026, al día.'),
('Ford F-150',         'KHXB86', 'Cristian Madrid Narváez',         'calle',      'Confirmar si tiene revisión técnica vigente; no hay registro en los archivos.'),
('Honda HR-V',         'PCSC92', 'Yenny Badilla Araneda',           'calle',      'Revisión técnica y emisiones al día.'),
('RAM 700 Bighorn',    'PRWB85', 'CMD Servicios Tecnológicos SpA',  'calle',      'Emisiones vence ~agosto 2026. Agendar revisión técnica/emisiones antes de agosto.'),
('Voge 300 Rally',     'ZYY028', 'Cristian Madrid Narváez',         'calle',      'Permiso trasladado Petorca → Providencia. Confirmar si motos 300cc requieren revisión técnica en su comuna.'),
('Voge DS625X',        'MFC098', 'CMD Servicios Tecnológicos SpA',  'calle',      'Inscripción Registro Civil completada 03/06/2026. Vehículo 2026.'),
('Cuatrimoto Loncin GA200', NULL, 'Cristian Madrid Narváez',        'deportivo',  'Vehículo deportivo: solo requiere padrón y patente. Comprada 19/06/2026. Cita Registro Civil 08/07/2026 para obtener patente.'),
('KTM 450 EXC (2018)', 'HWB067', 'Cristian Madrid Narváez',         'deportivo',  'Vehículo deportivo. Ya cuenta con padrón/patente (inscrita 2018).'),
('KTM XC-W 125 (2017)', NULL,    'Cristian Madrid Narváez',         'deportivo',  'Vehículo deportivo en proceso de compra; gestionar padrón y patente.'),
('Honda CRF 150F (2012)', NULL,  'Cristian Madrid Narváez',         'deportivo',  'Sin patente ni documentación. Ubicar N° de chasis para iniciar inscripción.')
ON CONFLICT (patente) DO NOTHING;

-- ============================================================================
-- Documentos con vencimientos (parseados del Excel)
-- ============================================================================
-- Fiat 500 HSSZ38
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='HSSZ38'), 'soap',                  'SOAP vigente',                                '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='HSSZ38'), 'permiso_circulacion',  'Permiso de Circulación vigente',              '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='HSSZ38'), 'revision_tecnica',     'Revisión técnica/emisiones VENCIDA desde noviembre 2025 (última 10/03/2025)', '2025-11-30');

-- Audi A3 DPFZ72
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='DPFZ72'), 'soap',                  'SOAP vigente',                                '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='DPFZ72'), 'permiso_circulacion',  'Permiso de Circulación vigente',              '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='DPFZ72'), 'revision_tecnica',     'Revisión técnica/emisiones renovada 18/04/2026', '2027-05-31'),
((SELECT id FROM vehiculos WHERE patente='DPFZ72'), 'seguro',               'Seguro voluntario Reale/Santander (renov. automática)', '2028-03-24');

-- Ford F-150 KHXB86
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='KHXB86'), 'soap',                  'SOAP vigente',                    '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='KHXB86'), 'permiso_circulacion',  'Permiso de Circulación vigente',  '2027-03-31');

-- Honda HR-V PCSC92
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='PCSC92'), 'soap',                  'SOAP vigente',                                '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='PCSC92'), 'permiso_circulacion',  'Permiso de Circulación vigente',              '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='PCSC92'), 'revision_tecnica',     'Revisión técnica/emisiones aprobada 13/04/2026 (TÜV Rheinland)', '2027-05-31');

-- RAM 700 PRWB85
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='PRWB85'), 'soap',                  'SOAP vigente',                    '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='PRWB85'), 'permiso_circulacion',  'Permiso de Circulación vigente',  '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='PRWB85'), 'revision_tecnica',     'Certificado de emisiones — vence ~agosto 2026', '2026-08-31');

-- Voge 300 Rally ZYY028
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='ZYY028'), 'soap',                  'SOAP vigente',                    '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='ZYY028'), 'permiso_circulacion',  'Permiso de Circulación vigente (Providencia)', '2027-03-31');

-- Voge DS625X MFC098
INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence) VALUES
((SELECT id FROM vehiculos WHERE patente='MFC098'), 'soap',                  'SOAP vigente desde 03/06/2026',  '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='MFC098'), 'permiso_circulacion',  'Permiso de Circulación vigente (Lo Barnechea)', '2027-03-31'),
((SELECT id FROM vehiculos WHERE patente='MFC098'), 'seguro',               'Seguro Moto Básico Sura/Falabella (renov. automática)', '2027-06-05');

-- ============================================================================
-- Acceso: el admin inicial ve TODOS los vehículos
-- ============================================================================
INSERT INTO acceso_vehiculo (usuario_id, vehiculo_id)
SELECT u.id, v.id
FROM usuarios u CROSS JOIN vehiculos v
WHERE u.email = 'cmadrid@cmdspa.com'
ON CONFLICT DO NOTHING;

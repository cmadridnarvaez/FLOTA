# Política de Seguridad

## Reportar vulnerabilidades

Si descubres una vulnerabilidad de seguridad, por favor **NO abras un issue público**.

Envía un email a: **seguridad@cmdspa.com**

Incluye:
- Descripción del problema
- Pasos para reproducirlo
- Impacto potencial
- Sugerencia de fix (opcional)

## Tiempo de respuesta

- Confirmación de recepción: 48 horas
- Evaluación inicial: 7 días
- Fix o mitigación: según severidad

## Alcance

Esta política aplica al código de este repositorio. No aplica a:
- Vulnerabilidades de dependencias de terceros (reportar al upstream)
- Ataques de fuerza bruta o DoS
- Issues de configuración del deployment (responsabilidad del operador)

## Medidas de seguridad implementadas

- Autenticación JWT con refresh tokens de rotación atómica
- API Keys hasheadas con SHA-256
- Rate limiting en login y API de agentes
- Validación de archivos por magic numbers
- Queries SQL parametrizadas ($N) en toda la aplicación
- Control de acceso multi-tenant por empresa
- Aislamiento de datos entre empresas

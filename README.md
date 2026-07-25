# 🚗 FLOTA

### Sistema de gestión vehicular empresarial

**Desarrollado por [CMD Servicios Tecnológicos SpA](https://www.cmdspa.com)**

FLOTA es una plataforma completa para administrar flotas vehiculares: documentos, mantenciones, gastos, GPS, vencimientos, alertas automáticas y análisis de documentos con inteligencia artificial.

---

## ✨ Funcionalidades

### Gestión de flota
- **CRUD completo** de vehículos con ficha técnica (marca, modelo, año, VIN, motor, color, titular)
- **Ciclo de vida por vehículo** — timeline cronológico con documentos, mantenciones y gastos
- **GPS / Tracking** — AirTag, GPS prepago o suscripción, con empresa y vencimiento
- **Búsqueda de patentes** vía AutoRiesgo (API gratuita chilena)

### Documentos con IA
- **Versionado automático** — cada renovación archiva la versión anterior, siempre vigente disponible
- **Análisis con GPT-4o Vision** — sube una foto del SOAP, permiso o revisión y la IA extrae tipo, vencimiento, patente y titular automáticamente
- **Almacenamiento de archivos** — PDF e imágenes hasta 25MB con validación de seguridad
- **Historial de versiones** — acceso a copias anteriores de cada documento

### Alertas automáticas
- **Email de vencimientos** vía Resend — avisos a 30, 14 y 7 días antes + día de vencimiento
- **Anti-spam** con dedupe en base de datos
- **Template HTML** profesional con branding

### Gestión financiera
- **Mantenciones** con kilometraje, tipo, costo y descripción
- **Gastos** con categorías (combustible, seguro, patente, repuestos, etc.)
- **KPIs de inversión total** por vehículo

### Multi-usuario con control de acceso
- **Roles**: admin (ve toda la flota) y usuario (ve solo vehículos asignados)
- **API Keys** para agentes IA y automatizaciones (scopes read/write)
- **JWT + refresh tokens** con rotación atómica

### APIs públicas chilenas integradas
- **Indicadores económicos** (UF, UTM, dólar, euro) vía mindicador.cl
- **Sismos** en tiempo real vía api.gael.cloud
- **Feriados** nacionales vía date.nager.at

### API para agentes IA
- **11 endpoints** de lectura/escritura bajo `/api/agent/*`
- **Discovery automático** — `GET /api/agent` devuelve documentación legible por LLMs
- **Rate limiting** por API key (60 req/min)

### Diseño y UX
- **PWA instalable** — manifest, service worker, iconos, funciona offline
- **Dark / Light mode** con toggle persistente (Auto / Oscuro / Claro)
- **Neural background** animado adaptativo (efecto brand CMD)
- **Responsive móvil** — header de 2 filas, tabs scrollables
- **Accesibilidad** WCAG AA — labels, aria-live, focus-trap en modales, reduced motion

---

## 🏗️ Stack técnico

| Capa | Tecnología |
|------|-----------|
| **Frontend** | SPA vanilla (HTML+CSS+JS), sin framework, ~100KB |
| **Backend** | Node.js 22 + Express 4 |
| **Base de datos** | PostgreSQL 17 |
| **Reverse proxy** | nginx |
| **Deploy** | Docker Compose + Cloudflare Tunnel |
| **IA** | OpenAI GPT-4o Vision |
| **Email** | Resend API |
| **DNS/SSL** | Cloudflare |

### Sin dependencias externas en runtime
- No usa React, Vue ni Angular
- No usa SDK de OpenAI (fetch nativo)
- No usa Supabase ni Firebase
- 100% PostgreSQL open source

---

## 📁 Estructura del proyecto

```
FLOTA/
├── api/                      Backend Node.js
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js         Entry point + Express patch
│       ├── expressPatch.js   Async error handler global
│       ├── config.js         Variables de entorno (fail-fast)
│       ├── db.js             Pool PostgreSQL + type parsers
│       ├── auth.js           JWT + bcrypt + refresh tokens
│       ├── seed.js           Bootstrap del admin
│       ├── aiVision.js       GPT-4o Vision (PDF→imagen→análisis)
│       ├── boostr.js         AutoRiesgo/Boostr (lookup patentes)
│       ├── notifier.js       Alertas de email (Resend)
│       ├── middleware/
│       │   ├── auth.js           JWT auth + control de acceso
│       │   ├── apiKeyAuth.js    API key para agentes IA
│       │   ├── rateLimit.js      Rate limit login
│       │   ├── rateLimitAgent.js Rate limit agente
│       │   ├── validate.js       Validadores + buildUpdate
│       │   └── asyncHandler.js   Wrapper async errors
│       └── routes/
│           ├── auth.js           Login/logout/refresh/password
│           ├── vehiculos.js      CRUD vehículos + lookup patente
│           ├── documentos.js     CRUD + versionado + análisis IA
│           ├── mantenciones.js   CRUD mantenciones
│           ├── gastos.js         CRUD gastos
│           ├── usuarios.js       CRUD usuarios + API keys
│           ├── resumen.js        KPIs globales
│           ├── chile.js          APIs públicas (UF/sismos/feriados)
│           └── agent.js          API completa para agentes IA
├── db/
│   ├── init.sh               Script de inicialización PostgreSQL
│   └── sql/
│       ├── 01-schema.sql     Esquema completo (8 tablas)
│       └── 02-seed.sql       Datos iniciales (vehículos demo)
├── web/
│   ├── Dockerfile            nginx:alpine
│   ├── nginx.conf            Proxy + headers de seguridad
│   └── public/
│       ├── index.html        SPA completa (~2500 líneas)
│       ├── manifest.json     PWA manifest
│       ├── sw.js             Service Worker
│       ├── cmd-logo.png      Logo CMD
│       └── icon-*.png        Iconos PWA
├── docker-compose.yml        Stack: db + api + web (red aislada)
└── .gitignore
```

---

## 🚀 Deploy

### Requisitos
- Servidor con Docker + Docker Compose
- Dominio con DNS en Cloudflare

### Variables de entorno (.env)
```bash
# PostgreSQL
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERPASS=<secreto>
DB_PASSWORD=<secreto>

# JWT
JWT_SECRET=<64-chars-hex>

# Admin inicial
ADMIN_EMAIL=admin@empresa.com
ADMIN_PASSWORD=<password-inicial>
ADMIN_NOMBRE=Administrador

# OpenAI (GPT-4o Vision para análisis de documentos)
OPENAI_API_KEY=sk-...

# Resend (alertas de email)
RESEND_API_KEY=re_...
ALERTA_FROM=flota@empresa.com
ALERTA_TO=pagos@empresa.com

# Lookup de patentes (opcional, AutoRiesgo es gratis)
BOOSTR_API_KEY=
```

### Comandos
```bash
# Clonar
git clone https://github.com/cmadridnarvaez/FLOTA.git
cd FLOTA

# Configurar
cp .env.example .env  # editar con tus valores

# Levantar
docker compose up -d --build

# Verificar
curl http://localhost:8090/api/health
```

### Cloudflare Tunnel
```bash
cloudflared tunnel create flota
# Configurar ingress: flota.tudominio.com → http://localhost:8090
# Crear DNS CNAME flota.tudominio.com → <tunnel>.cfargotunnel.com
```

---

## 🔒 Seguridad

- **JWT** con refresh tokens de rotación atómica
- **API Keys** hasheadas con SHA-256
- **Rate limiting** en login (10/15min) y agentes IA (60/min)
- **Validación de archivos** por magic numbers (no MIME del cliente)
- **Path traversal** cerrado en uploads
- **SVG bloqueado** (previene XSS almacenado)
- **Content-Disposition: attachment** en descargas
- **Cookies httpOnly + sameSite + secure**
- **Fail-fast** si faltan secretos obligatorios
- **Parámetros $N** en todas las queries SQL (sin inyección)
- **Control de acceso** por vehículo en cada endpoint
- **UNIQUE parcial** en documentos vigentes
- **Transacciones** en versionado de documentos

---

## 📊 Modelo de datos

```
usuarios ──┬── acceso_vehiculo ──── vehiculos
           │                         ├── documentos (versionado: grupo_id + es_vigente)
           │                         ├── mantenciones
           │                         ├── gastos
           │                         └── gps (4 campos: tipo, empresa, device_id, vence)
           │
           ├── refresh_tokens
           ├── api_keys
           └── alerta_envios (dedupe de notificaciones)
```

---

## 📜 Licencia

Propiedad de **CMD Servicios Tecnológicos SpA**. Todos los derechos reservados.

---

## 🏢 Sobre

**FLOTA** es un producto de [CMD Servicios Tecnológicos SpA](https://www.cmdspa.com), empresa chilena de tecnología y servicios cloud.

- 🌐 [www.cmdspa.com](https://www.cmdspa.com)
- 📧 autos@cmdspa.com

---

> Aplicación desarrollada por CMD Servicios Tecnológicos SpA

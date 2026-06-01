# CONSTRUCONTROL — Sitema de control de costos de construccion
> Base de datos: **Supabase** (PostgreSQL en la nube, gratis)

---

## 🗄 PASO 1 — CREAR BASE DE DATOS EN SUPABASE

### 1.1 Crear proyecto gratuito
1. Regístrate en [supabase.com](https://supabase.com)
2. Clic en **New Project** → elige nombre y contraseña → **Create project**
3. Espera ~1 minuto mientras se aprovisiona

### 1.2 Ejecutar el script SQL (crear tablas)
1. Ve a **SQL Editor** (ícono de base de datos en el sidebar)
2. Clic en **New query**
3. Pega y ejecuta este script completo:

```sql
-- ═══════════════════════════════════════════════════
-- CONSTRUCONTROL — Script de creación de tablas
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- TABLA: CRONOGRAMA DE PAGOS
CREATE TABLE IF NOT EXISTS cronograma (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa       TEXT NOT NULL,
  fecha       DATE NOT NULL,
  monto       NUMERIC(12,2) NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PAGADO','PENDIENTE','PARCIAL')),
  obs         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- TABLA: GASTOS ADICIONALES
CREATE TABLE IF NOT EXISTS gastos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha       DATE NOT NULL,
  descrp        TEXT NOT NULL,
  costo       NUMERIC(12,2) NOT NULL,
  fecha_pago  DATE,
  pagado      NUMERIC(12,2) DEFAULT 0,
  pendiente   NUMERIC(12,2) DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- TABLA: DESPACHO DE MATERIALES
CREATE TABLE IF NOT EXISTS despacho (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha       DATE NOT NULL,
  guia        TEXT NOT NULL,
  material    TEXT NOT NULL,
  unidad      TEXT NOT NULL,
  cantidad    NUMERIC(14,4) NOT NULL,
  cunit       NUMERIC(12,4) NOT NULL,
  ctotal      NUMERIC(14,2) NOT NULL,
  resp        TEXT,
  obs         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- TABLA: PRESUPUESTO DE MATERIALES
CREATE TABLE IF NOT EXISTS presupuesto (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  piso        TEXT NOT NULL,
  etapa       TEXT NOT NULL,
  categoria   TEXT NOT NULL,
  material    TEXT NOT NULL,
  unidad      TEXT NOT NULL,
  cantidad    NUMERIC(14,4) NOT NULL,
  cunit       NUMERIC(12,4) NOT NULL,
  valor       NUMERIC(14,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ HABILITAR ROW LEVEL SECURITY (lectura/escritura pública) ═══
-- Solo necesario si usas acceso público (anon key sin auth)
ALTER TABLE cronograma  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE despacho    ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuesto ENABLE ROW LEVEL SECURITY;

-- Políticas: permitir todo al rol anon (acceso desde el sistema web)
CREATE POLICY "Allow all cronograma"  ON cronograma  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all gastos"      ON gastos      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all despacho"    ON despacho    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all presupuesto" ON presupuesto FOR ALL TO anon USING (true) WITH CHECK (true);
```

4. Clic en **Run** — deberías ver "Success. No rows returned"

### 1.3 Obtener credenciales
1. Ve a **Settings → API** (engranaje en el sidebar)
2. Copia:
   - **Project URL**: `https://xxxxxxxxxxx.supabase.co`
   - **anon / public key**: `eyJhbGciOiJIUzI1NiIs...` (NO el service_role key)

---

## 🚀 PASO 2 — DESPLIEGUE EN GITHUB PAGES

1. Crea un nuevo repositorio en [github.com/new](https://github.com/new)
2. Sube los 3 archivos: `index.html`, `style.css`, `app.js`
3. Ve a **Settings → Pages → Branch: main → /root → Save**
4. Tu sistema estará disponible en: `https://tu-usuario.github.io/tu-repositorio`

---

## ⚙ PASO 3 — CONFIGURAR EL SISTEMA

1. Abre el sistema en el navegador
2. Se abrirá automáticamente el modal **"CONFIGURAR BASE DE DATOS"**
3. Ingresa:
   - **Project URL**: la URL de tu proyecto Supabase
   - **Anon Key**: la clave pública
   - **Nombre de Obra**: nombre del proyecto (opcional)
4. Clic en **GUARDAR Y CONECTAR**

✅ ¡Listo! Los datos se guardan directamente en PostgreSQL y se sincronizan entre dispositivos.

---

## 📋 MÓDULOS DEL SISTEMA

| Módulo | Descripción |
|--------|-------------|
| **Dashboard General** | KPIs, gráficos, alertas automáticas en tiempo real |
| **Cronograma de Pagos** | Registro y seguimiento de pagos por etapa |
| **Gastos Adicionales** | Control de gastos extras y pagos parciales |
| **Despacho de Materiales** | Registro de todos los materiales utilizados |
| **Balance de Materiales** | Resumen automático agrupado por material |
| **Presupuesto de Materiales** | Estándar presupuestado por piso/etapa/categoría |
| **Análisis de Desviaciones** | Comparación estándar vs real con % de desviación |
| **Control Sobre/Sub Estándar** | Indicadores de eficiencia con semáforos |

---

## 🛠 TECNOLOGÍAS

- **HTML5 / CSS3 / JavaScript ES6+** — Sin frameworks
- **Supabase** — PostgreSQL REST API gratuita y persistente
- **Chart.js 4.4** — Gráficos interactivos
- **SheetJS (xlsx)** — Exportación a Excel
- **IBM Plex Sans + IBM Plex Mono** — Tipografía industrial

---

## 📁 ARCHIVOS

```
construcontrol/
├── index.html    ← Estructura HTML con todos los módulos y modales
├── style.css     ← Diseño industrial (SAP/Power BI inspired)
├── app.js        ← Lógica CRUD + Supabase REST API + charts
└── README.md     ← Este archivo con script SQL
```

---

## ⚠ NOTAS IMPORTANTES

- La **anon key** es segura para uso público gracias a las políticas RLS
- Si quieres restringir acceso, implementa autenticación Supabase Auth
- El plan gratuito de Supabase soporta 500 MB de base de datos y 2 GB de transferencia/mes
- Los datos **nunca se eliminan solos** — solo mediante botones del sistema

---

*CONSTRUCONTROL v3.0 — Sistema Industrial de Control de Obras con Supabase*

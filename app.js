/**
 * CONSTRUCONTROL — Sistema Industrial de Control de Obras
 * Base de datos: Supabase (PostgreSQL REST API)
 * Versión: 3.0
 *
 * Tablas Supabase requeridas:
 *   cronograma, gastos, despacho, presupuesto
 * Ver script SQL completo en README.md
 */

'use strict';

/* ═══════════════════════════════════════════════════════
   CONFIG & ESTADO GLOBAL
═══════════════════════════════════════════════════════ */
let CFG = { supabaseUrl: '', supabaseKey: '', nombreObra: '' };
let DB  = { cronograma: [], gastos: [], despacho: [], presupuesto: [] };
let syncTimer    = null;
let isSyncing    = false;
let pendingDelete = null;
let charts       = {};

/* ═══════════════════════════════════════════════════════
   INICIALIZACIÓN
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  updateDate();
  setInterval(updateDate, 60000);
  loadConfig();
  if (CFG.supabaseUrl && CFG.supabaseKey) {
    fetchAll();
  } else {
    showConfigModal();
    setStatus('offline', 'Sin configurar');
  }
});

function updateDate() {
  const d = new Date();
  const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
  document.getElementById('topbarDate').textContent =
    d.toLocaleDateString('es-PE', opts).toUpperCase();
}

/* ═══════════════════════════════════════════════════════
   CONFIG EN SESSION STORAGE
═══════════════════════════════════════════════════════ */
function loadConfig() {
  try {
    const raw = sessionStorage.getItem('cc_cfg_v3');
    if (raw) CFG = JSON.parse(raw);
  } catch(e) {}
}

function persistConfig() {
  try {
    sessionStorage.setItem('cc_cfg_v3', JSON.stringify(CFG));
  } catch(e) {}
}

/* ═══════════════════════════════════════════════════════
   SUPABASE REST HELPERS
   Documentación: https://supabase.com/docs/guides/api
═══════════════════════════════════════════════════════ */

/** Headers estándar para todas las peticiones */
function sbHeaders(extra = {}) {
  return {
    'Content-Type':  'application/json',
    'apikey':        CFG.supabaseKey,
    'Authorization': `Bearer ${CFG.supabaseKey}`,
    'Prefer':        'return=representation',
    ...extra
  };
}

/** GET — traer todos los registros de una tabla ordenados por created_at */
async function sbSelect(table) {
  const res = await fetch(
    `${CFG.supabaseUrl}/rest/v1/${table}?order=created_at.asc`,
    { headers: sbHeaders() }
  );
  if (!res.ok) throw new Error(`${table} GET: ${res.status} ${await res.text()}`);
  return res.json();
}

/** POST — insertar un registro */
async function sbInsert(table, record) {
  const res = await fetch(
    `${CFG.supabaseUrl}/rest/v1/${table}`,
    { method: 'POST', headers: sbHeaders(), body: JSON.stringify(record) }
  );
  if (!res.ok) throw new Error(`${table} INSERT: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return Array.isArray(json) ? json[0] : json;
}

/** PATCH — actualizar un registro por id */
async function sbUpdate(table, id, patch) {
  const res = await fetch(
    `${CFG.supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(patch) }
  );
  if (!res.ok) throw new Error(`${table} UPDATE: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return Array.isArray(json) ? json[0] : json;
}

/** DELETE — eliminar un registro por id */
async function sbDelete(table, id) {
  const res = await fetch(
    `${CFG.supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: sbHeaders({ 'Prefer': 'return=minimal' }) }
  );
  if (!res.ok) throw new Error(`${table} DELETE: ${res.status} ${await res.text()}`);
}

/* ═══════════════════════════════════════════════════════
   CARGA INICIAL — trae las 4 tablas en paralelo
═══════════════════════════════════════════════════════ */
async function fetchAll() {
  if (!CFG.supabaseUrl || !CFG.supabaseKey) return;
  setStatus('syncing', 'Cargando...');
  showLoading('Conectando a Supabase...');
  try {
    const [cron, gast, desp, pres] = await Promise.all([
      sbSelect('cronograma'),
      sbSelect('gastos'),
      sbSelect('despacho'),
      sbSelect('presupuesto')
    ]);
    DB.cronograma  = cron  || [];
    DB.gastos      = gast  || [];
    DB.despacho    = desp  || [];
    DB.presupuesto = pres  || [];
    setStatus('online', CFG.nombreObra || 'Conectado ✓');
    renderAll();
    toast('success', 'CONECTADO', 'Datos cargados desde Supabase');
  } catch(err) {
    setStatus('offline', 'Error de conexión');
    toast('error', 'ERROR SUPABASE', err.message);
    console.error(err);
  } finally {
    hideLoading();
  }
}

/* ═══════════════════════════════════════════════════════
   CONFIG MODAL
═══════════════════════════════════════════════════════ */
function showConfigModal() {
  document.getElementById('cfgSupabaseUrl').value = CFG.supabaseUrl || '';
  document.getElementById('cfgSupabaseKey').value = CFG.supabaseKey || '';
  document.getElementById('cfgNombreObra').value  = CFG.nombreObra  || '';
  openModal('modal-config');
}

function saveConfig() {
  const url  = document.getElementById('cfgSupabaseUrl').value.trim().replace(/\/$/, '');
  const key  = document.getElementById('cfgSupabaseKey').value.trim();
  const obra = document.getElementById('cfgNombreObra').value.trim();
  if (!url || !key) {
    toast('warn', 'ATENCIÓN', 'Project URL y Anon Key son obligatorios');
    return;
  }
  CFG = { supabaseUrl: url, supabaseKey: key, nombreObra: obra };
  persistConfig();
  closeModal('modal-config');
  fetchAll();
}

/* ═══════════════════════════════════════════════════════
   MÓDULO: CRONOGRAMA DE PAGOS
═══════════════════════════════════════════════════════ */
async function saveCronograma() {
  const etapa  = v('cro-etapa');
  const fecha  = v('cro-fecha');
  const monto  = parseFloat(v('cro-monto'));
  const estado = v('cro-estado');
  const obs    = v('cro-obs');
  const editId = v('cro-edit-id');

  if (!etapa || !fecha || isNaN(monto) || monto <= 0) {
    toast('warn', 'CAMPOS VACÍOS', 'Etapa, fecha y monto son obligatorios'); return;
  }

  setSyncIndicator('active');
  try {
    if (editId) {
      const updated = await sbUpdate('cronograma', editId, { etapa, fecha, monto, estado, obs });
      const idx = DB.cronograma.findIndex(r => r.id === editId);
      if (idx >= 0) DB.cronograma[idx] = updated || { ...DB.cronograma[idx], etapa, fecha, monto, estado, obs };
      toast('info', 'ACTUALIZADO', 'Pago modificado');
    } else {
      const rec = await sbInsert('cronograma', { etapa, fecha, monto, estado, obs });
      DB.cronograma.push(rec);
      toast('success', 'GUARDADO', 'Pago registrado');
    }
  } catch(err) {
    toast('error', 'ERROR', err.message); return;
  } finally { setSyncIndicator(''); }

  closeModal('modal-cronograma');
  renderCronograma();
  renderDashboard();
}

function renderCronograma() {
  const tbody       = document.getElementById('tbodyCronograma');
  const filterEst   = document.getElementById('filterCronogramaEstado')?.value || '';
  const q           = (document.getElementById('filterCronograma')?.value || '').toLowerCase();

  let rows = DB.cronograma.filter(r => {
    const mQ = !q || r.etapa.toLowerCase().includes(q) || (r.obs||'').toLowerCase().includes(q);
    const mE = !filterEst || r.estado === filterEst;
    return mQ && mE;
  });

  if (!rows.length) {
    tbody.innerHTML = empty('📋', 'Sin registros de pago');
    renderCronogramaSummary(); return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="row-num">${i+1}</td>
      <td>${r.etapa}</td>
      <td class="num">${fmtDate(r.fecha)}</td>
      <td class="num">${fmtMoney(r.monto)}</td>
      <td>${badgeEstado(r.estado)}</td>
      <td>${r.obs || '—'}</td>
      <td>
        <button class="tbl-btn tbl-btn-edit" onclick="editCronograma('${r.id}')">EDITAR</button>
        <button class="tbl-btn tbl-btn-del"  onclick="confirmDelete('cronograma','${r.id}')">ELIMINAR</button>
      </td>
    </tr>`).join('');

  renderCronogramaSummary();
}

function renderCronogramaSummary() {
  const total     = DB.cronograma.reduce((s, r) => s + +r.monto, 0);
  const pagado    = DB.cronograma.filter(r => r.estado === 'PAGADO').reduce((s, r) => s + +r.monto, 0);
  const pendiente = total - pagado;
  document.getElementById('cronogramaSummary').innerHTML = `
    <div class="sum-chip"><span class="sum-chip-label">Total Programado</span><span class="sum-chip-val">${fmtMoney(total)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">Total Pagado</span><span class="sum-chip-val positive">${fmtMoney(pagado)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">Pendiente</span><span class="sum-chip-val ${pendiente>0?'negative':''}">${fmtMoney(pendiente)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">N° Pagos</span><span class="sum-chip-val">${DB.cronograma.length}</span></div>`;
}

function editCronograma(id) {
  const r = DB.cronograma.find(x => x.id === id); if (!r) return;
  sv('cro-etapa', r.etapa); sv('cro-fecha', r.fecha); sv('cro-monto', r.monto);
  sv('cro-estado', r.estado); sv('cro-obs', r.obs || ''); sv('cro-edit-id', r.id);
  document.getElementById('modalCronogramaTitle').textContent = '✏ EDITAR PAGO';
  openModal('modal-cronograma');
}

/* ═══════════════════════════════════════════════════════
   MÓDULO: GASTOS ADICIONALES
═══════════════════════════════════════════════════════ */
function calcPendienteGasto() {
  const costo  = parseFloat(v('gas-costo'))  || 0;
  const pagado = parseFloat(v('gas-pagado')) || 0;
  document.getElementById('gas-pendiente').value = (costo - pagado).toFixed(2);
}

async function saveGasto() {
  const fecha     = v('gas-fecha');
  const descrp      = v('gas-desc');
  const costo     = parseFloat(v('gas-costo'));
  const fecha_pago = v('gas-fechapago') || null;
  const pagado    = parseFloat(v('gas-pagado')) || 0;
  const pendiente = costo - pagado;
  const editId    = v('gas-edit-id');

  if (!fecha || !descrp || isNaN(costo) || costo <= 0) {
    toast('warn', 'CAMPOS VACÍOS', 'Fecha, descripción y costo son obligatorios'); return;
  }

  setSyncIndicator('active');
  try {
    if (editId) {
      const updated = await sbUpdate('gastos', editId, { fecha, descrp, costo, fecha_pago, pagado, pendiente });
      const idx = DB.gastos.findIndex(r => r.id === editId);
      if (idx >= 0) DB.gastos[idx] = updated || { ...DB.gastos[idx], fecha, descrp, costo, fecha_pago, pagado, pendiente };
      toast('info', 'ACTUALIZADO', 'Gasto modificado');
    } else {
      const rec = await sbInsert('gastos', { fecha, descrp, costo, fecha_pago, pagado, pendiente });
      DB.gastos.push(rec);
      toast('success', 'GUARDADO', 'Gasto registrado');
    }
  } catch(err) {
    toast('error', 'ERROR', err.message); return;
  } finally { setSyncIndicator(''); }

  closeModal('modal-gastos');
  renderGastos();
  renderDashboard();
}

function renderGastos() {
  const tbody = document.getElementById('tbodyGastos');
  const q = (document.getElementById('filterGastos')?.value || '').toLowerCase();
  let rows = DB.gastos.filter(r => !q || r.descrp.toLowerCase().includes(q));

  if (!rows.length) {
    tbody.innerHTML = empty('💰', 'Sin gastos registrados');
    renderGastosSummary(); return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="row-num">${i+1}</td>
      <td class="num">${fmtDate(r.fecha)}</td>
      <td>${r.descrp}</td>
      <td class="num">${fmtMoney(r.costo)}</td>
      <td class="num">${r.fecha_pago ? fmtDate(r.fecha_pago) : '—'}</td>
      <td class="num">${fmtMoney(r.pagado)}</td>
      <td class="num ${+r.pendiente>0?'over-cost':'under-cost'}">${fmtMoney(r.pendiente)}</td>
      <td>
        <button class="tbl-btn tbl-btn-edit" onclick="editGasto('${r.id}')">EDITAR</button>
        <button class="tbl-btn tbl-btn-del"  onclick="confirmDelete('gastos','${r.id}')">ELIMINAR</button>
      </td>
    </tr>`).join('');

  renderGastosSummary();
}

function renderGastosSummary() {
  const total    = DB.gastos.reduce((s, r) => s + +r.costo, 0);
  const pagado   = DB.gastos.reduce((s, r) => s + +(r.pagado||0), 0);
  const pendiente = total - pagado;
  document.getElementById('gastosSummary').innerHTML = `
    <div class="sum-chip"><span class="sum-chip-label">Total Gastos</span><span class="sum-chip-val">${fmtMoney(total)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">Pagado</span><span class="sum-chip-val positive">${fmtMoney(pagado)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">Pendiente</span><span class="sum-chip-val ${pendiente>0?'negative':''}">${fmtMoney(pendiente)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">N° Gastos</span><span class="sum-chip-val">${DB.gastos.length}</span></div>`;
}

function editGasto(id) {
  const r = DB.gastos.find(x => x.id === id); if (!r) return;
  sv('gas-fecha', r.fecha); sv('gas-desc', r.descrp); sv('gas-costo', r.costo);
  sv('gas-fechapago', r.fecha_pago || ''); sv('gas-pagado', r.pagado || 0);
  sv('gas-pendiente', r.pendiente || 0); sv('gas-edit-id', r.id);
  document.getElementById('modalGastosTitle').textContent = '✏ EDITAR GASTO';
  openModal('modal-gastos');
}

/* ═══════════════════════════════════════════════════════
   MÓDULO: DESPACHO DE MATERIALES
═══════════════════════════════════════════════════════ */
function calcTotalDespacho() {
  const cant  = parseFloat(v('des-cantidad')) || 0;
  const cunit = parseFloat(v('des-cunit'))    || 0;
  document.getElementById('des-ctotal').value = (cant * cunit).toFixed(2);
}

async function saveDespacho() {
  const fecha    = v('des-fecha');
  const guia     = v('des-guia');
  const material = v('des-material');
  const unidad   = v('des-unidad');
  const cantidad = parseFloat(v('des-cantidad'));
  const cunit    = parseFloat(v('des-cunit'));
  const ctotal   = cantidad * cunit;
  const resp     = v('des-resp');
  const obs      = v('des-obs');
  const editId   = v('des-edit-id');

  if (!fecha || !guia || !material || isNaN(cantidad) || isNaN(cunit)) {
    toast('warn', 'CAMPOS VACÍOS', 'Fecha, guía, material, cantidad y costo son obligatorios'); return;
  }

  setSyncIndicator('active');
  try {
    if (editId) {
      const updated = await sbUpdate('despacho', editId, { fecha, guia, material, unidad, cantidad, cunit, ctotal, resp, obs });
      const idx = DB.despacho.findIndex(r => r.id === editId);
      if (idx >= 0) DB.despacho[idx] = updated || { ...DB.despacho[idx], fecha, guia, material, unidad, cantidad, cunit, ctotal, resp, obs };
      toast('info', 'ACTUALIZADO', 'Despacho modificado');
    } else {
      const rec = await sbInsert('despacho', { fecha, guia, material, unidad, cantidad, cunit, ctotal, resp, obs });
      DB.despacho.push(rec);
      toast('success', 'GUARDADO', 'Despacho registrado');
    }
  } catch(err) {
    toast('error', 'ERROR', err.message); return;
  } finally { setSyncIndicator(''); }

  closeModal('modal-despacho');
  renderDespacho();
  renderBalance();
  renderDesviaciones();
  renderEstandar();
  renderDashboard();
}

function renderDespacho() {
  const tbody = document.getElementById('tbodyDespacho');
  const q    = (document.getElementById('filterDespacho')?.value || '').toLowerCase();
  const fIni = document.getElementById('filterDespachoFechaIni')?.value || '';
  const fFin = document.getElementById('filterDespachoFechaFin')?.value || '';

  let rows = DB.despacho.filter(r => {
    const mQ = !q || r.material.toLowerCase().includes(q) || r.guia.toLowerCase().includes(q) || (r.resp||'').toLowerCase().includes(q);
    const mI = !fIni || r.fecha >= fIni;
    const mF = !fFin || r.fecha <= fFin;
    return mQ && mI && mF;
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));

  if (!rows.length) {
    tbody.innerHTML = empty('🏗', 'Sin despachos registrados');
    renderDespachoSummary(); return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="row-num">${i+1}</td>
      <td class="num">${fmtDate(r.fecha)}</td>
      <td><span style="font-family:var(--mono);font-size:11px">${r.guia}</span></td>
      <td><strong>${r.material}</strong></td>
      <td>${r.unidad}</td>
      <td class="num">${fmtNum(r.cantidad)}</td>
      <td class="num">${fmtMoney(r.cunit)}</td>
      <td class="num"><strong>${fmtMoney(r.ctotal)}</strong></td>
      <td>${r.resp || '—'}</td>
      <td>${r.obs  || '—'}</td>
      <td>
        <button class="tbl-btn tbl-btn-edit" onclick="editDespacho('${r.id}')">EDITAR</button>
        <button class="tbl-btn tbl-btn-del"  onclick="confirmDelete('despacho','${r.id}')">ELIMINAR</button>
      </td>
    </tr>`).join('');

  renderDespachoSummary();
}

function renderDespachoSummary() {
  const total     = DB.despacho.reduce((s, r) => s + +r.ctotal, 0);
  const guias     = new Set(DB.despacho.map(r => r.guia)).size;
  const materiales = new Set(DB.despacho.map(r => r.material.toLowerCase())).size;
  document.getElementById('despachoSummary').innerHTML = `
    <div class="sum-chip"><span class="sum-chip-label">Costo Total</span><span class="sum-chip-val">${fmtMoney(total)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">N° Despachos</span><span class="sum-chip-val">${DB.despacho.length}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">N° Guías</span><span class="sum-chip-val">${guias}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">Materiales Distintos</span><span class="sum-chip-val">${materiales}</span></div>`;
}

function editDespacho(id) {
  const r = DB.despacho.find(x => x.id === id); if (!r) return;
  sv('des-fecha', r.fecha); sv('des-guia', r.guia); sv('des-material', r.material);
  sv('des-unidad', r.unidad); sv('des-cantidad', r.cantidad); sv('des-cunit', r.cunit);
  sv('des-ctotal', r.ctotal); sv('des-resp', r.resp || ''); sv('des-obs', r.obs || '');
  sv('des-edit-id', r.id);
  document.getElementById('modalDespachoTitle').textContent = '✏ EDITAR DESPACHO';
  openModal('modal-despacho');
}

/* ═══════════════════════════════════════════════════════
   MÓDULO: BALANCE DE MATERIALES (auto-generado)
═══════════════════════════════════════════════════════ */
function renderBalance() {
  const tbody = document.getElementById('tbodyBalance');
  const q = (document.getElementById('filterBalance')?.value || '').toLowerCase();

  const map = {};
  DB.despacho.forEach(r => {
    const key = r.material.toLowerCase().trim();
    if (!map[key]) map[key] = { material: r.material, unidad: r.unidad, cantidad: 0, costo: 0, count: 0 };
    map[key].cantidad += +r.cantidad;
    map[key].costo    += +r.ctotal;
    map[key].count    += 1;
  });

  let rows = Object.values(map);
  if (q) rows = rows.filter(r => r.material.toLowerCase().includes(q));
  rows.sort((a, b) => b.costo - a.costo);

  if (!rows.length) {
    tbody.innerHTML = empty('📦', 'Sin datos de despacho'); return;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const cunitProm = r.costo / r.cantidad;
    return `<tr>
      <td class="row-num">${i+1}</td>
      <td><strong>${r.material}</strong></td>
      <td>${r.unidad}</td>
      <td class="num">${fmtNum(r.cantidad)}</td>
      <td class="num">${fmtMoney(cunitProm)}</td>
      <td class="num"><strong>${fmtMoney(r.costo)}</strong></td>
      <td class="num">${r.count}</td>
    </tr>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   MÓDULO: PRESUPUESTO DE MATERIALES
═══════════════════════════════════════════════════════ */
function calcValorStd() {
  const cant  = parseFloat(v('pre-cantidad')) || 0;
  const cunit = parseFloat(v('pre-cunit'))    || 0;
  document.getElementById('pre-valor').value = (cant * cunit).toFixed(2);
}

async function savePresupuesto() {
  const piso      = v('pre-piso');
  const etapa     = v('pre-etapa');
  const categoria = v('pre-categoria');
  const material  = v('pre-material');
  const unidad    = v('pre-unidad');
  const cantidad  = parseFloat(v('pre-cantidad'));
  const cunit     = parseFloat(v('pre-cunit'));
  const valor     = cantidad * cunit;
  const editId    = v('pre-edit-id');

  if (!piso || !etapa || !material || isNaN(cantidad) || isNaN(cunit)) {
    toast('warn', 'CAMPOS VACÍOS', 'Todos los campos con * son obligatorios'); return;
  }

  setSyncIndicator('active');
  try {
    if (editId) {
      const updated = await sbUpdate('presupuesto', editId, { piso, etapa, categoria, material, unidad, cantidad, cunit, valor });
      const idx = DB.presupuesto.findIndex(r => r.id === editId);
      if (idx >= 0) DB.presupuesto[idx] = updated || { ...DB.presupuesto[idx], piso, etapa, categoria, material, unidad, cantidad, cunit, valor };
      toast('info', 'ACTUALIZADO', 'Ítem modificado');
    } else {
      const rec = await sbInsert('presupuesto', { piso, etapa, categoria, material, unidad, cantidad, cunit, valor });
      DB.presupuesto.push(rec);
      toast('success', 'GUARDADO', 'Ítem presupuesto registrado');
    }
  } catch(err) {
    toast('error', 'ERROR', err.message); return;
  } finally { setSyncIndicator(''); }

  closeModal('modal-presupuesto');
  renderPresupuesto();
  renderDesviaciones();
  renderEstandar();
  renderDashboard();
  updatePisoFilter();
}

function renderPresupuesto() {
  const tbody = document.getElementById('tbodyPresupuesto');
  const q    = (document.getElementById('filterPresupuesto')?.value || '').toLowerCase();
  const piso = document.getElementById('filterPresupuestoPiso')?.value || '';

  let rows = DB.presupuesto.filter(r => {
    const mQ = !q || r.material.toLowerCase().includes(q) || r.etapa.toLowerCase().includes(q) || r.piso.toLowerCase().includes(q);
    const mP = !piso || r.piso === piso;
    return mQ && mP;
  });

  if (!rows.length) {
    tbody.innerHTML = empty('📊', 'Sin ítems presupuestados');
    renderPresupuestoSummary(); return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="row-num">${i+1}</td>
      <td><span class="badge badge-blue">${r.piso}</span></td>
      <td>${r.etapa}</td>
      <td>${r.categoria}</td>
      <td><strong>${r.material}</strong></td>
      <td>${r.unidad}</td>
      <td class="num">${fmtNum(r.cantidad)}</td>
      <td class="num">${fmtMoney(r.cunit)}</td>
      <td class="num"><strong>${fmtMoney(r.valor)}</strong></td>
      <td>
        <button class="tbl-btn tbl-btn-edit" onclick="editPresupuesto('${r.id}')">EDITAR</button>
        <button class="tbl-btn tbl-btn-del"  onclick="confirmDelete('presupuesto','${r.id}')">ELIMINAR</button>
      </td>
    </tr>`).join('');

  renderPresupuestoSummary();
}

function renderPresupuestoSummary() {
  const total  = DB.presupuesto.reduce((s, r) => s + +r.valor, 0);
  const pisos  = new Set(DB.presupuesto.map(r => r.piso)).size;
  const etapas = new Set(DB.presupuesto.map(r => r.etapa)).size;
  document.getElementById('presupuestoSummary').innerHTML = `
    <div class="sum-chip"><span class="sum-chip-label">Valor Total STD</span><span class="sum-chip-val">${fmtMoney(total)}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">N° Ítems</span><span class="sum-chip-val">${DB.presupuesto.length}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">Pisos</span><span class="sum-chip-val">${pisos}</span></div>
    <div class="sum-chip"><span class="sum-chip-label">Etapas</span><span class="sum-chip-val">${etapas}</span></div>`;
}

function updatePisoFilter() {
  const sel = document.getElementById('filterPresupuestoPiso'); if (!sel) return;
  const pisos = [...new Set(DB.presupuesto.map(r => r.piso))].sort();
  const cur = sel.value;
  sel.innerHTML = `<option value="">Todos los pisos</option>` + pisos.map(p => `<option value="${p}">${p}</option>`).join('');
  sel.value = cur;
}

function editPresupuesto(id) {
  const r = DB.presupuesto.find(x => x.id === id); if (!r) return;
  sv('pre-piso', r.piso); sv('pre-etapa', r.etapa); sv('pre-categoria', r.categoria);
  sv('pre-material', r.material); sv('pre-unidad', r.unidad); sv('pre-cantidad', r.cantidad);
  sv('pre-cunit', r.cunit); sv('pre-valor', r.valor); sv('pre-edit-id', r.id);
  document.getElementById('modalPresupuestoTitle').textContent = '✏ EDITAR ÍTEM PRESUPUESTO';
  openModal('modal-presupuesto');
}

/* ═══════════════════════════════════════════════════════
   MÓDULO: ANÁLISIS DE DESVIACIONES
═══════════════════════════════════════════════════════ */
function renderDesviaciones() {
  const tbody = document.getElementById('tbodyDesviaciones');
  const q = (document.getElementById('filterDesviaciones')?.value || '').toLowerCase();

  const realMap = buildRealMap();
  const stdMap  = buildStdMap();
  const allMats = new Set([...Object.keys(stdMap), ...Object.keys(realMap)]);

  let rows = [];
  allMats.forEach(key => {
    const std  = stdMap[key]  || { material: key, unidad: '—', cantidad: 0, valor: 0 };
    const real = realMap[key] || { cantidad: 0, costo: 0 };
    const desvCant = real.cantidad - std.cantidad;
    const pctDesv  = std.cantidad ? (desvCant / std.cantidad * 100) : (real.cantidad ? 100 : 0);
    const desvEcon = real.costo - std.valor;
    rows.push({ material: std.material, unidad: std.unidad, cantStd: std.cantidad, cantReal: real.cantidad, desvCant, pctDesv, valorStd: std.valor, valorReal: real.costo, desvEcon });
  });

  if (q) rows = rows.filter(r => r.material.toLowerCase().includes(q));
  rows.sort((a, b) => b.desvEcon - a.desvEcon);

  if (!rows.length) {
    tbody.innerHTML = empty('📈', 'Registra presupuesto y despachos para ver desviaciones'); return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><strong>${r.material}</strong></td>
      <td>${r.unidad}</td>
      <td class="num">${fmtNum(r.cantStd)}</td>
      <td class="num">${fmtNum(r.cantReal)}</td>
      <td class="num ${r.desvCant>0?'over-cost':r.desvCant<0?'under-cost':''}">${fmtNum(r.desvCant)}</td>
      <td class="num ${r.pctDesv>0?'over-cost':r.pctDesv<0?'under-cost':''}">${r.pctDesv.toFixed(1)}%</td>
      <td class="num">${fmtMoney(r.valorStd)}</td>
      <td class="num">${fmtMoney(r.valorReal)}</td>
      <td class="num ${r.desvEcon>0?'over-cost':r.desvEcon<0?'under-cost':''}">${fmtMoney(r.desvEcon)}</td>
      <td>${desvEstado(r.pctDesv)}</td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════════════════
   MÓDULO: CONTROL SOBRE/SUB ESTÁNDAR
═══════════════════════════════════════════════════════ */
function renderEstandar() {
  const tbody = document.getElementById('tbodyEstandar');
  const realMap = buildRealMap();
  const stdMap  = buildStdMap();
  const allMats = new Set([...Object.keys(stdMap), ...Object.keys(realMap)]);

  let sobre = 0, bajo = 0, sobreEcon = 0, bajoEcon = 0;
  let rows = [];

  allMats.forEach(key => {
    const std  = stdMap[key]  || { material: key, unidad: '—', cantidad: 0, valor: 0 };
    const real = realMap[key] || { cantidad: 0, costo: 0 };
    const diff     = real.cantidad - std.cantidad;
    const diffEcon = real.costo - std.valor;
    const pct      = std.cantidad ? (diff / std.cantidad * 100) : (real.cantidad ? 100 : 0);
    const tipo     = diff > 0 ? 'SOBRECONSUMO' : diff < 0 ? 'SUBCONSUMO' : 'ESTÁNDAR';
    if (diff > 0) { sobre++; sobreEcon += diffEcon; }
    else if (diff < 0) { bajo++; bajoEcon += Math.abs(diffEcon); }
    rows.push({ material: std.material, tipo, cantStd: std.cantidad, cantReal: real.cantidad, diff, diffEcon, pct });
  });

  document.getElementById('estandarSummary').innerHTML = `
    <div class="est-card over">
      <div class="est-card-label">MATERIALES CON SOBRECONSUMO</div>
      <div class="est-card-val">${sobre}</div>
    </div>
    <div class="est-card under">
      <div class="est-card-label">MATERIALES CON SUBCONSUMO</div>
      <div class="est-card-val">${bajo}</div>
    </div>
    <div class="est-card ${sobreEcon>0?'over':'ok'}">
      <div class="est-card-label">IMPACTO ECONÓMICO TOTAL</div>
      <div class="est-card-val">${fmtMoney(sobreEcon - bajoEcon)}</div>
    </div>`;

  if (!rows.length) {
    tbody.innerHTML = empty('⚖', 'Sin datos para analizar'); return;
  }

  rows.sort((a, b) => b.diffEcon - a.diffEcon);
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><strong>${r.material}</strong></td>
      <td>${tipoBadge(r.tipo)}</td>
      <td class="num">${fmtNum(r.cantStd)}</td>
      <td class="num">${fmtNum(r.cantReal)}</td>
      <td class="num ${r.diff>0?'over-cost':r.diff<0?'under-cost':''}">${fmtNum(r.diff)}</td>
      <td class="num ${r.diffEcon>0?'over-cost':r.diffEcon<0?'under-cost':''}">${fmtMoney(r.diffEcon)}</td>
      <td class="num">${r.pct.toFixed(1)}%</td>
      <td>${eficiencia(r.pct)}</td>
    </tr>`).join('');
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════ */
function renderDashboard() {
  const totalEstimado   = DB.presupuesto.reduce((s, r) => s + +r.valor,  0);
  const totalMateriales = DB.despacho.reduce((s, r) => s + +r.ctotal,    0);
  const totalGastos     = DB.gastos.reduce((s, r) => s + +r.costo,       0);
  const totalReal       = totalMateriales + totalGastos;
  const totalPagos      = DB.cronograma.reduce((s, r) => s + +r.monto,   0);
  const pagado          = DB.cronograma.filter(r => r.estado==='PAGADO').reduce((s, r) => s + +r.monto, 0);
  const pendiente       = DB.cronograma.filter(r => r.estado!=='PAGADO').reduce((s, r) => s + +r.monto, 0)
                        + DB.gastos.reduce((s, r) => s + +(r.pendiente||0), 0);
  const desviacion      = totalReal - totalEstimado;
  const avance          = totalPagos > 0 ? Math.round(pagado / totalPagos * 100) : 0;

  setText('kpi-estimado',   fmtMoney(totalEstimado));
  setText('kpi-real',       fmtMoney(totalReal));
  setText('kpi-pendiente',  fmtMoney(pendiente));
  setText('kpi-avance',     avance + '%');
  setText('kpi-materiales', fmtMoney(totalMateriales));
  setText('kpi-desviacion', fmtMoney(desviacion));

  const dvEl = document.querySelector('#kpi-desviacion');
  if (dvEl) dvEl.style.color = desviacion > 0 ? 'var(--red)' : desviacion < 0 ? 'var(--green)' : '';

  renderAlerts(pendiente, desviacion, totalEstimado);
  renderCharts(totalEstimado, totalMateriales, totalGastos);
  renderDashPagos();
  renderDashDespachos();
}

function renderAlerts(pendiente, desviacion, totalEstimado) {
  const sec = document.getElementById('alertsSection');
  const alerts = [];
  if (!CFG.supabaseUrl || !CFG.supabaseKey) {
    alerts.push({ type:'error', msg:'⚠ Base de datos no configurada. Haz clic en "CONFIGURAR BD" para comenzar.' });
  }
  if (pendiente > 0)
    alerts.push({ type:'warn', msg:`💳 Hay ${fmtMoney(pendiente)} pendientes de pago.` });
  if (totalEstimado > 0 && desviacion / totalEstimado > 0.10)
    alerts.push({ type:'error', msg:`🔴 Sobrecoste del ${(desviacion/totalEstimado*100).toFixed(1)}% vs presupuesto (${fmtMoney(desviacion)}).` });
  else if (totalEstimado > 0 && desviacion / totalEstimado > 0.05)
    alerts.push({ type:'warn', msg:`🟡 Desviación moderada: ${(desviacion/totalEstimado*100).toFixed(1)}% sobre presupuesto.` });
  else if (totalEstimado > 0)
    alerts.push({ type:'ok', msg:`✅ Costos dentro del estándar presupuestado.` });
  if (!DB.cronograma.length && !DB.presupuesto.length)
    alerts.push({ type:'ok', msg:'ℹ Comienza registrando el presupuesto y el cronograma de pagos.' });
  sec.innerHTML = alerts.map(a => `<div class="alert-item alert-${a.type==='info'?'ok':a.type}">${a.msg}</div>`).join('');
}

function renderCharts(totalEstimado, totalMateriales, totalGastos) {
  const totalReal = totalMateriales + totalGastos;

  const ctx1 = document.getElementById('chartCostos');
  if (charts.costos) charts.costos.destroy();
  charts.costos = new Chart(ctx1, {
    type: 'doughnut',
    data: {
      labels: ['Materiales', 'Gastos Adicionales', 'Presupuesto Base'],
      datasets: [{ data: [totalMateriales, totalGastos, Math.max(0, totalEstimado-totalReal)],
        backgroundColor: ['#0052cc','#e06800','#e2e8f0'], borderWidth: 0, hoverOffset: 6 }]
    },
    options: { plugins: { legend: { position:'bottom', labels:{ font:{family:'IBM Plex Mono',size:10}, padding:10 } } }, cutout:'65%' }
  });

  const pagado  = DB.cronograma.filter(r=>r.estado==='PAGADO').reduce((s,r)=>s+ +r.monto,0);
  const parcial = DB.cronograma.filter(r=>r.estado==='PARCIAL').reduce((s,r)=>s+ +r.monto,0);
  const pendCro = DB.cronograma.filter(r=>r.estado==='PENDIENTE').reduce((s,r)=>s+ +r.monto,0);
  const ctx2 = document.getElementById('chartPagos');
  if (charts.pagos) charts.pagos.destroy();
  charts.pagos = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: ['Pagado','Parcial','Pendiente'],
      datasets: [{ data: [pagado, parcial, pendCro],
        backgroundColor: ['#1a7f37','#b45309','#c0392b'], borderWidth: 0, hoverOffset: 6 }]
    },
    options: { plugins: { legend: { position:'bottom', labels:{ font:{family:'IBM Plex Mono',size:10}, padding:10 } } }, cutout:'65%' }
  });

  const matMap = {};
  DB.despacho.forEach(r => { matMap[r.material] = (matMap[r.material]||0) + +r.ctotal; });
  const sorted = Object.entries(matMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const ctx3 = document.getElementById('chartMateriales');
  if (charts.materiales) charts.materiales.destroy();
  charts.materiales = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: sorted.map(e=>e[0]),
      datasets: [{ label:'Costo Total', data: sorted.map(e=>e[1]), backgroundColor:'#0052cc', borderRadius:2 }]
    },
    options: {
      plugins: { legend:{ display:false } },
      scales: {
        y: { ticks:{ font:{family:'IBM Plex Mono',size:9}, callback: v=>'S/ '+fmtK(v) }, grid:{ color:'#e4e7ec' } },
        x: { ticks:{ font:{family:'IBM Plex Mono',size:9} }, grid:{ display:false } }
      }
    }
  });
}

function renderDashPagos() {
  const tbody = document.getElementById('dashPagosTbody');
  const rows = [...DB.cronograma].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,6);
  if (!rows.length) { tbody.innerHTML=`<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:12px;font-size:11px">Sin pagos</td></tr>`; return; }
  tbody.innerHTML = rows.map(r=>`<tr><td>${r.etapa}</td><td class="num">${fmtMoney(r.monto)}</td><td>${badgeEstado(r.estado)}</td></tr>`).join('');
}

function renderDashDespachos() {
  const tbody = document.getElementById('dashDespachosTbody');
  const rows = [...DB.despacho].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,6);
  if (!rows.length) { tbody.innerHTML=`<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:12px;font-size:11px">Sin despachos</td></tr>`; return; }
  tbody.innerHTML = rows.map(r=>`<tr><td>${r.material}</td><td class="num">${fmtNum(r.cantidad)} ${r.unidad}</td><td class="num">${fmtMoney(r.ctotal)}</td></tr>`).join('');
}

/* ═══════════════════════════════════════════════════════
   RENDER ALL
═══════════════════════════════════════════════════════ */
function renderAll() {
  renderDashboard();
  renderCronograma();
  renderGastos();
  renderDespacho();
  renderBalance();
  renderPresupuesto();
  renderDesviaciones();
  renderEstandar();
  updatePisoFilter();
}

/* ═══════════════════════════════════════════════════════
   DELETE / CONFIRM
═══════════════════════════════════════════════════════ */
function confirmDelete(collection, id) {
  pendingDelete = { collection, id };
  document.getElementById('confirmMsg').textContent =
    `¿Seguro que deseas eliminar este registro de "${collection}"? Esta acción no se puede deshacer.`;
  document.getElementById('confirmBtn').onclick = executeDelete;
  openModal('modal-confirm');
}

async function executeDelete() {
  if (!pendingDelete) return;
  const { collection, id } = pendingDelete;
  pendingDelete = null;
  closeModal('modal-confirm');
  setSyncIndicator('active');
  try {
    await sbDelete(collection, id);
    DB[collection] = DB[collection].filter(r => r.id !== id);
    toast('info', 'ELIMINADO', 'Registro eliminado correctamente');
    renderAll();
  } catch(err) {
    toast('error', 'ERROR', 'No se pudo eliminar: ' + err.message);
  } finally { setSyncIndicator(''); }
}

/* ═══════════════════════════════════════════════════════
   FILTROS
═══════════════════════════════════════════════════════ */
function filterTable(mod) {
  switch(mod) {
    case 'cronograma':  renderCronograma();  break;
    case 'gastos':      renderGastos();      break;
    case 'despacho':    renderDespacho();    break;
    case 'presupuesto': renderPresupuesto(); break;
  }
}

/* ═══════════════════════════════════════════════════════
   EXPORTAR A EXCEL
═══════════════════════════════════════════════════════ */
function exportToExcel(mod) {
  let data = [];
  switch(mod) {
    case 'cronograma':
      data = DB.cronograma.map(r => ({ Etapa: r.etapa, Fecha: r.fecha, Monto: r.monto, Estado: r.estado, Observaciones: r.obs }));
      break;
    case 'gastos':
      data = DB.gastos.map(r => ({ Fecha: r.fecha, Descripcion: r.descrp, Costo: r.costo, FechaPago: r.fecha_pago, Pagado: r.pagado, Pendiente: r.pendiente }));
      break;
    case 'despacho':
      data = DB.despacho.map(r => ({ Fecha: r.fecha, Guia: r.guia, Material: r.material, Unidad: r.unidad, Cantidad: r.cantidad, CostoUnit: r.cunit, CostoTotal: r.ctotal, Responsable: r.resp, Observaciones: r.obs }));
      break;
    case 'balance': {
      const map = {};
      DB.despacho.forEach(r => {
        const k = r.material.toLowerCase();
        if (!map[k]) map[k] = { Material: r.material, Unidad: r.unidad, Cantidad: 0, Costo: 0, Despachos: 0 };
        map[k].Cantidad += +r.cantidad; map[k].Costo += +r.ctotal; map[k].Despachos++;
      });
      data = Object.values(map).sort((a,b)=>b.Costo-a.Costo);
      break;
    }
    case 'presupuesto':
      data = DB.presupuesto.map(r => ({ Piso: r.piso, Etapa: r.etapa, Categoria: r.categoria, Material: r.material, Unidad: r.unidad, CantSTD: r.cantidad, CostoUnit: r.cunit, ValorSTD: r.valor }));
      break;
    case 'desviaciones':
    case 'estandar': {
      const rm = buildRealMap(), sm = buildStdMap();
      const all = new Set([...Object.keys(sm), ...Object.keys(rm)]);
      all.forEach(k => {
        const s = sm[k]||{material:k,cantidad:0,valor:0};
        const r = rm[k]||{cantidad:0,costo:0};
        data.push({ Material:s.material, CantSTD:s.cantidad, CantReal:r.cantidad, DesvCant:r.cantidad-s.cantidad, PctDesv:s.cantidad?((r.cantidad-s.cantidad)/s.cantidad*100).toFixed(1)+'%':'—', ValorSTD:s.valor, ValorReal:r.costo, DesvEcon:r.costo-s.valor });
      });
      break;
    }
  }
  if (!data.length) { toast('warn','SIN DATOS','No hay datos para exportar'); return; }
  try {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mod.toUpperCase());
    XLSX.writeFile(wb, `CONSTRUCONTROL_${mod.toUpperCase()}_${dateFn()}.xlsx`);
    toast('success','EXPORTADO','Archivo Excel descargado');
  } catch(e) { toast('error','ERROR','No se pudo exportar: '+e.message); }
}

/* ═══════════════════════════════════════════════════════
   HELPERS: BUILD MAPS
═══════════════════════════════════════════════════════ */
function buildRealMap() {
  const map = {};
  DB.despacho.forEach(r => {
    const k = r.material.toLowerCase().trim();
    if (!map[k]) map[k] = { cantidad: 0, costo: 0 };
    map[k].cantidad += +r.cantidad;
    map[k].costo    += +r.ctotal;
  });
  return map;
}

function buildStdMap() {
  const map = {};
  DB.presupuesto.forEach(r => {
    const k = r.material.toLowerCase().trim();
    if (!map[k]) map[k] = { material: r.material, unidad: r.unidad, cantidad: 0, valor: 0 };
    map[k].cantidad += +r.cantidad;
    map[k].valor    += +r.valor;
  });
  return map;
}

/* ═══════════════════════════════════════════════════════
   NAVEGACIÓN
═══════════════════════════════════════════════════════ */
function showModule(name) {
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const mod = document.getElementById('mod-'+name);
  const nav = document.querySelector(`[data-module="${name}"]`);
  if (mod) mod.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = {
    dashboard:'Dashboard General', cronograma:'Cronograma de Pagos', gastos:'Gastos Adicionales',
    despacho:'Despacho de Materiales', balance:'Balance de Materiales', presupuesto:'Presupuesto de Materiales',
    desviaciones:'Análisis de Desviaciones', estandar:'Control Sobre/Sub Estándar'
  };
  document.getElementById('topbarTitle').textContent = titles[name] || name;
  window.scrollTo(0, 0);
}

/* ═══════════════════════════════════════════════════════
   MODALS
═══════════════════════════════════════════════════════ */
function openModal(id) {
  const el = document.getElementById(id); if (!el) return;
  const isNew = !{
    'modal-cronograma': v('cro-edit-id'),
    'modal-gastos':     v('gas-edit-id'),
    'modal-despacho':   v('des-edit-id'),
    'modal-presupuesto':v('pre-edit-id')
  }[id];
  if (isNew) {
    if (id==='modal-cronograma') { clearForm(['cro-etapa','cro-fecha','cro-monto','cro-obs','cro-edit-id']); sv('cro-estado','PENDIENTE'); document.getElementById('modalCronogramaTitle').textContent='+ NUEVO PAGO'; }
    if (id==='modal-gastos')     { clearForm(['gas-fecha','gas-desc','gas-costo','gas-fechapago','gas-pagado','gas-pendiente','gas-edit-id']); document.getElementById('modalGastosTitle').textContent='+ NUEVO GASTO ADICIONAL'; }
    if (id==='modal-despacho')   { clearForm(['des-fecha','des-guia','des-material','des-cantidad','des-cunit','des-ctotal','des-resp','des-obs','des-edit-id']); document.getElementById('modalDespachoTitle').textContent='+ NUEVO DESPACHO DE MATERIAL'; }
    if (id==='modal-presupuesto'){ clearForm(['pre-piso','pre-etapa','pre-categoria','pre-material','pre-cantidad','pre-cunit','pre-valor','pre-edit-id']); document.getElementById('modalPresupuestoTitle').textContent='+ NUEVO ÍTEM PRESUPUESTO'; }
  }
  el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  // Clear edit id after close so next open is "new"
  const editMap = { 'modal-cronograma':'cro-edit-id','modal-gastos':'gas-edit-id','modal-despacho':'des-edit-id','modal-presupuesto':'pre-edit-id' };
  if (editMap[id]) sv(editMap[id], '');
}

/* ═══════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════ */
function setStatus(state, text) {
  document.getElementById('statusDot').className  = 'status-dot ' + state;
  document.getElementById('statusText').textContent = text;
}

function setSyncIndicator(state) {
  const el = document.getElementById('syncIndicator');
  el.className = 'sync-indicator' + (state ? ' '+state : '');
  el.textContent = state==='active' ? '● SYNC OK' : state==='error' ? '● SYNC ERR' : '● SYNC';
}

function showLoading(text='') {
  document.getElementById('loadingText').textContent = text || 'CARGANDO...';
  document.getElementById('loadingOverlay').classList.add('show');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

function toast(type, title, msg) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<div class="toast-title">${title}</div><div class="toast-msg">${msg}</div>`;
  c.appendChild(t);
  setTimeout(() => { t.style.cssText='opacity:0;transform:translateX(20px);transition:.3s'; setTimeout(()=>t.remove(),300); }, 3500);
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 800) sb.classList.toggle('mobile-open');
  else sb.classList.toggle('hidden');
}

function empty(icon, msg) {
  return `<tr><td colspan="20"><div class="empty-state"><div class="empty-state-icon">${icon}</div>${msg}</div></td></tr>`;
}

/* ═══════════════════════════════════════════════════════
   FORMATEO
═══════════════════════════════════════════════════════ */
function fmtMoney(n)  { return isNaN(n)?'S/ 0.00':'S/ '+Number(n).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtNum(n)    { return isNaN(n)?'0':Number(n).toLocaleString('es-PE',{maximumFractionDigits:3}); }
function fmtDate(d)   { if(!d)return'—'; const[y,m,dy]=d.split('-'); return `${dy}/${m}/${y}`; }
function fmtK(n)      { return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'K':n; }
function dateFn()     { const d=new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; }
function now()        { return new Date().toISOString(); }
function v(id)        { const e=document.getElementById(id); return e?e.value:''; }
function sv(id,val)   { const e=document.getElementById(id); if(e)e.value=val; }
function setText(id,t){ const e=document.getElementById(id); if(e)e.textContent=t; }
function clearForm(ids){ ids.forEach(id=>{ const e=document.getElementById(id); if(e)e.value=''; }); }

function badgeEstado(e) { const m={PAGADO:'badge-green',PENDIENTE:'badge-red',PARCIAL:'badge-yellow'}; return `<span class="badge ${m[e]||'badge-gray'}">${e}</span>`; }
function desvEstado(p)  { if(p<=5)return`<span class="badge badge-green">NORMAL</span>`; if(p<=15)return`<span class="badge badge-yellow">MODERADO</span>`; return`<span class="badge badge-red">CRÍTICO</span>`; }
function tipoBadge(t)   { const m={SOBRECONSUMO:'badge-red',SUBCONSUMO:'badge-green','ESTÁNDAR':'badge-blue'}; return `<span class="badge ${m[t]||'badge-gray'}">${t}</span>`; }
function eficiencia(p)  { if(Math.abs(p)<=5)return`<span class="badge badge-green">● ÓPTIMO</span>`; if(Math.abs(p)<=15)return`<span class="badge badge-yellow">● MODERADO</span>`; return`<span class="badge badge-red">● CRÍTICO</span>`; }

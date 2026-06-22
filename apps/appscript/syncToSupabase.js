// =============================================================================
// syncToSupabase.js
// Migración Bancos - Ofertas Recibidas
//
// Lee todas las pestañas de banco del Google Sheet y hace upsert a Supabase:
//   - sheet_rows         (datos de cada fila)
//   - red_flag_events    (red flags individuales para clustering)
//   - event_log          (registro de cada sync)
//
// SEGURIDAD:
//   El service_role key NUNCA se hardcodea aquí.
//   Se guarda en Script Properties con la clave SUPABASE_SERVICE_ROLE_KEY.
//   Para configurarlo: ejecuta setSupabaseKey() una vez manualmente.
//
// USO:
//   - Manual:   ejecuta syncAllBanksToSupabase() desde el editor
//   - Automático: ejecuta setupSyncTrigger() una vez para crear trigger de 5 min
// =============================================================================

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

var SUPABASE_URL  = 'https://vkhoirdieoiojsqatuva.supabase.co';
var SUPABASE_REST = SUPABASE_URL + '/rest/v1';
var BATCH_SIZE    = 100; // filas por lote en cada upsert

// Tab names mirror BANCOS_CONFIG in "Pasar datos a pestañas.js" (source of truth)
// UCI appears twice in the original (as 'Hipotecas.com' and 'UCI') — synced once with slug 'uci'
var BANK_CONFIG = [
  { slug: 'unicaja',        sheetName: 'Unicaja Test'                  },
  { slug: 'santander',      sheetName: 'Santander'                     },
  { slug: 'laboral_kutxa',  sheetName: 'Laboral Kutxa Test'            },
  { slug: 'kutxabank',      sheetName: 'Kutxabank'                     },
  { slug: 'uci',            sheetName: 'UCI'                           },
  { slug: 'myinvestor',     sheetName: 'MyInvestor Test'               },
  { slug: 'cr_del_sur',     sheetName: 'CR del Sur Test'               },
  { slug: 'cr_teruel',      sheetName: 'CR Teruel Test'                },
  { slug: 'cr_granada',     sheetName: 'CR Granada Test'               },
  { slug: 'eurocajarural',  sheetName: 'EuroCajaRural Test'            },
  { slug: 'globalcaja',     sheetName: 'Globalcaja Test'               },
  { slug: 'cr_extremadura', sheetName: 'CR Extremadura'                },
  { slug: 'sabadell',       sheetName: 'Sabadell no residentes'        },
  { slug: 'banca_360',      sheetName: 'MSF 360 - Sabadell Residentes' },
  { slug: 'ing',            sheetName: 'ING'                           },
  { slug: 'bankinter',      sheetName: 'Bankinter'                     },
  { slug: 'no_bank_fee',    sheetName: 'No Bank Fee Test'              },
  { slug: 'cr_asturias',    sheetName: 'CR Asturias Test'              },
  { slug: 'ibercaja',       sheetName: 'Ibercaja Test'                 },
  { slug: 'deutsche_bank',  sheetName: 'Deutsche Bank Test'            },
  { slug: 'cajamar',        sheetName: 'Cajamar Test'                  },
  { slug: 'caixa_popular',  sheetName: 'Caixa Popular Test'            },
  { slug: 'cr_aragon',      sheetName: 'CR Aragon Test'                },
  { slug: 'ruralnostra',    sheetName: 'RURALNOSTRA'                   },
];


// =============================================================================
// FUNCIONES PÚBLICAS
// =============================================================================

/**
 * Función principal de sincronización.
 * Itera todos los bancos y sincroniza sus filas a Supabase.
 * Puede ejecutarse manualmente o desde un trigger de tiempo.
 */
function syncAllBanksToSupabase() {
  var key = getServiceRoleKey_();
  if (!key) {
    Logger.log('[syncToSupabase] ERROR: SUPABASE_SERVICE_ROLE_KEY no configurado. Ejecuta setSupabaseKey() primero.');
    return;
  }

  var bankIdMap;
  try {
    bankIdMap = fetchBankIdMap_(key);
  } catch (e) {
    Logger.log('[syncToSupabase] ERROR al obtener mapa de bancos: ' + e.message);
    return;
  }

  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var total   = { synced: 0, skipped: 0, errors: [] };
  var started = new Date().toISOString();

  BANK_CONFIG.forEach(function (bank) {
    var sheet = ss.getSheetByName(bank.sheetName);
    if (!sheet) {
      Logger.log('[syncToSupabase] Pestaña no encontrada: ' + bank.sheetName);
      return;
    }

    var bankId = bankIdMap[bank.slug];
    if (!bankId) {
      Logger.log('[syncToSupabase] bank_id no encontrado para slug: ' + bank.slug);
      return;
    }

    try {
      var result = syncBankSheet_(sheet, bank.slug, bankId, key);
      total.synced  += result.synced;
      total.skipped += result.skipped;
      if (result.errors.length) {
        total.errors = total.errors.concat(result.errors);
      }
      Logger.log('[syncToSupabase] ' + bank.slug + ': synced=' + result.synced + ' skipped=' + result.skipped);
    } catch (e) {
      var msg = bank.slug + ': ' + e.message;
      total.errors.push(msg);
      Logger.log('[syncToSupabase] ERROR ' + msg);
    }
  });

  Logger.log('[syncToSupabase] COMPLETO — synced=' + total.synced +
             ' skipped=' + total.skipped + ' errors=' + total.errors.length);

  // Mostrar los primeros 3 errores reales para diagnóstico
  if (total.errors.length > 0) {
    Logger.log('[syncToSupabase] MUESTRA DE ERRORES: ' + total.errors.slice(0, 3).join(' || '));
  }

  // Registrar el sync global en event_log
  try {
    logEvent_(key, {
      event_type:     'sync',
      actor:          'apps_script',
      payload: {
        started_at:   started,
        finished_at:  new Date().toISOString(),
        total_synced: total.synced,
        total_skipped: total.skipped,
        error_count:  total.errors.length,
        errors:       total.errors.slice(0, 10), // máximo 10 en el log
      }
    });
  } catch (e) {
    Logger.log('[syncToSupabase] No se pudo registrar en event_log: ' + e.message);
  }
}

/**
 * Crea un trigger de tiempo que ejecuta syncAllBanksToSupabase cada 5 minutos.
 * Ejecutar manualmente UNA SOLA VEZ al configurar el proyecto.
 */
function setupSyncTrigger() {
  // Evitar duplicar triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncAllBanksToSupabase') {
      Logger.log('[setupSyncTrigger] El trigger ya existe. No se creó duplicado.');
      return;
    }
  }
  ScriptApp.newTrigger('syncAllBanksToSupabase')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('[setupSyncTrigger] Trigger creado: syncAllBanksToSupabase cada 5 min.');
}

/**
 * Guarda el service_role key de Supabase en Script Properties.
 *
 * CÓMO USAR:
 *   1. En el editor de Apps Script, abre este archivo.
 *   2. Reemplaza 'PEGA_TU_KEY_AQUI' con tu service_role key real.
 *   3. Ejecuta esta función UNA VEZ.
 *   4. Borra el valor hardcodeado del código inmediatamente después.
 *
 * El valor queda guardado de forma segura en las propiedades del proyecto
 * y no aparece en el código fuente.
 */
function setSupabaseKey() {
  var key = 'PEGA_TU_KEY_AQUI';
  if (key === 'PEGA_TU_KEY_AQUI') {
    Logger.log('ERROR: Reemplaza PEGA_TU_KEY_AQUI con tu service_role key antes de ejecutar.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SUPABASE_SERVICE_ROLE_KEY', key);
  Logger.log('service_role key guardado correctamente en Script Properties.');
}


// =============================================================================
// FUNCIONES PRIVADAS
// =============================================================================

/**
 * Sincroniza una pestaña de banco completa a Supabase.
 * @return {{ synced: number, skipped: number, errors: string[] }}
 */
function syncBankSheet_(sheet, bankSlug, bankId, key) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { synced: 0, skipped: 0, errors: [] };

  var headers  = data[0].map(function (h) { return h ? String(h).trim() : ''; });
  var rows     = [];
  var redFlags = [];
  var skipped  = 0;
  var now      = new Date().toISOString();

  // Cajamar tiene headers duplicados — detectar hasta dónde va el primer bloque
  var firstOpportunityIdx = headers.indexOf('Opportunity ID');
  var secondOpportunityIdx = headers.indexOf('Opportunity ID', firstOpportunityIdx + 1);
  var maxCol = secondOpportunityIdx > 0 ? secondOpportunityIdx : headers.length;
  var effectiveHeaders = headers.slice(0, maxCol);

  for (var i = 1; i < data.length; i++) {
    var rowValues = data[i].slice(0, maxCol);

    var oppId = rowValues[findColIdx_(effectiveHeaders, ['Opportunity ID'])];
    if (!oppId || oppId === '') { skipped++; continue; }
    var opportunityId = parseInt(oppId, 10);
    if (isNaN(opportunityId) || opportunityId <= 0) { skipped++; continue; }

    var mapped = mapRow_(effectiveHeaders, rowValues, bankId, opportunityId, i + 1, now);
    rows.push(mapped);

    // Extraer red flags individuales
    if (mapped.red_flags && mapped.red_flags.length > 0) {
      mapped.red_flags.forEach(function (rf) {
        redFlags.push({
          bank_id:        bankId,
          opportunity_id: opportunityId,
          raw_text:       rf,
        });
      });
    }
  }

  var errors = [];

  // Deduplicar sheet_rows por (bank_id, opportunity_id) antes del upsert.
  // Si un mismo cliente aparece dos veces en el tab, el segundo sobreescribe al primero
  // (tomamos la última fila encontrada, que suele ser la más reciente).
  var rowMap = {};
  rows.forEach(function (r) {
    rowMap[r.bank_id + '|' + r.opportunity_id] = r;
  });
  var rowsUnique = Object.keys(rowMap).map(function (k) { return rowMap[k]; });

  // Upsert sheet_rows en lotes
  if (rowsUnique.length > 0) {
    var rowErrors = batchUpsert_(
      SUPABASE_REST + '/sheet_rows?on_conflict=bank_id,opportunity_id',
      rowsUnique,
      key
    );
    errors = errors.concat(rowErrors);
  }

  // Deduplicar red flags dentro del mismo banco antes del upsert.
  // Sin esto, dos filas con el mismo (bank_id, opportunity_id, raw_text) en el
  // mismo lote provocan el error "ON CONFLICT DO UPDATE cannot affect row".
  var rfSeen = {};
  var redFlagsUnique = [];
  redFlags.forEach(function (rf) {
    var key_ = rf.bank_id + '|' + rf.opportunity_id + '|' + rf.raw_text;
    if (!rfSeen[key_]) { rfSeen[key_] = true; redFlagsUnique.push(rf); }
  });

  // Upsert red_flag_events en lotes (insert-if-not-exists por unique constraint)
  if (redFlagsUnique.length > 0) {
    var rfErrors = batchUpsert_(
      SUPABASE_REST + '/red_flag_events?on_conflict=bank_id,opportunity_id,raw_text',
      redFlagsUnique,
      key
    );
    // Los errores de red flags no bloquean el sync principal
    if (rfErrors.length > 0) {
      Logger.log('[syncToSupabase] red_flag_events warnings (' + bankSlug + '): ' + rfErrors.join('; '));
    }
  }

  return { synced: rows.length, skipped: skipped, errors: errors };
}

/**
 * Mapea una fila del sheet al objeto que espera sheet_rows en Supabase.
 */
function mapRow_(headers, rowValues, bankId, opportunityId, rowNumber, syncedAt) {
  var get = function (names) {
    var idx = findColIdx_(headers, names);
    if (idx < 0 || idx >= rowValues.length) return null;
    var v = rowValues[idx];
    return (v === '' || v === null || v === undefined) ? null : v;
  };

  // send_trigger: 'Yes' → true, 'No' → false, resto → null
  var sendRaw = get(['Enviar', 'Enviado']);
  var sendTrigger = null;
  if (sendRaw !== null) {
    var sendStr = String(sendRaw).trim().toLowerCase();
    if (sendStr === 'yes') sendTrigger = true;
    else if (sendStr === 'no') sendTrigger = false;
  }

  // Status
  var statusRaw = get(['Status']);
  var statusNorm = normalizeStatus_(statusRaw ? String(statusRaw) : null);

  // Override: Enviar=Yes + no Timestamp Sent + no estado de destino explícito → pending_ready
  // Antes solo capturaba statusNorm==='unknown' (status vacío). Ahora también captura
  // filas con texto no reconocido (statusNorm todavía 'unknown') Y filas con status
  // que aún no indican envío/bloqueo/oferta. Esto resuelve el pendientes=0 crónico.
  var timestampSentRaw = get(['Timestamp Sent']);
  var FINAL_STATUSES = ['sent', 'sending', 'blocked_red_flag', 'blocked_missing_docs',
                        'blocked_validation', 'offer_received', 'rejected', 'relaunch_requested'];
  if (sendTrigger === true && !timestampSentRaw &&
      FINAL_STATUSES.indexOf(statusNorm) === -1) {
    statusNorm = 'pending_ready';
  }

  // Red flags
  var rfRaw = get(['Red Flag']);
  var rfArray = null;
  if (rfRaw !== null) {
    rfArray = String(rfRaw).split('|')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (rfArray.length === 0) rfArray = null;
  }

  // Owner: primera columna 'Owner' (puede aparecer duplicada)
  var ownerIdx = findColIdx_(headers, ['Owner']);
  var owner = (ownerIdx >= 0 && ownerIdx < rowValues.length && rowValues[ownerIdx] !== '')
    ? String(rowValues[ownerIdx]).trim() : null;

  // PostgREST (PGRST102) requiere que TODOS los objetos del batch tengan
  // exactamente las mismas claves. Por eso incluimos siempre todos los campos,
  // incluso con valor null. El sheet es la fuente de verdad: si una celda
  // está vacía, el DB debe reflejarlo.
  return {
    bank_id:               bankId,
    opportunity_id:        opportunityId,
    synced_at:             syncedAt,
    uid:                   get(['ITEM ID']),
    bank_deal_id:          toIntOrNull_(get(['Bank Deal ID'])),
    nombre_cliente:        get(['Nombre Cliente']),
    importe:               toNumOrNull_(get(['Importe'])),
    link_dossier:          get(['Link Dossier']),
    timestamp_entry:       toIsoOrNull_(get(['Timestamp'])),
    test_time:             toIsoOrNull_(get(['Test time', 'Test Time'])),
    send_trigger:          sendTrigger,
    timestamp_sent:        toIsoOrNull_(get(['Timestamp Sent'])),
    status_raw:            statusRaw !== null ? String(statusRaw) : null,
    status:                statusNorm,
    red_flags_raw:         rfRaw !== null ? String(rfRaw) : null,
    red_flags:             rfArray,
    clasificacion:         get(['Clasificación', 'Clasificacion']),
    dossier:               get(['Dossier']),
    auto_bayteca:          get(['Auto Bayteca']),
    auto_banco:            get(['Auto Banco']),
    autorizacion:          get(['Autorización', 'Autorizacion']),
    autorizacion_link:     get(['Autorización Link', 'Autorizacion Link']),
    autorizacion_red_flag: get(['Autorización Red Flag', 'Autorizacion Red Flag']),
    process_status:        get(['Process Status']),
    notas:                 get(['NOTAS']),
    fecha_respuesta:       toDateStrOrNull_(get(['Fecha respuesta', 'Fecha Respuesta'])),
    dias_sin_respuesta:    toIntOrNull_(get(['Días sin respuesta', 'Dias sin respuesta'])),
    owner:                 owner,
    sheet_row_number:      rowNumber,
  };
}

/**
 * Obtiene el mapa slug → bank_id desde Supabase.
 */
function fetchBankIdMap_(key) {
  var response = UrlFetchApp.fetch(
    SUPABASE_REST + '/banks?select=id,slug',
    { headers: buildHeaders_(key), muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('fetchBankIdMap_ HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
  }
  var banks = JSON.parse(response.getContentText());
  var map = {};
  banks.forEach(function (b) { map[b.slug] = b.id; });
  return map;
}

/**
 * Hace upsert en lotes de BATCH_SIZE.
 * @return {string[]} errores encontrados
 */
function batchUpsert_(endpoint, rows, key) {
  var errors = [];
  for (var i = 0; i < rows.length; i += BATCH_SIZE) {
    var batch = rows.slice(i, i + BATCH_SIZE);
    try {
      var response = UrlFetchApp.fetch(endpoint, {
        method:             'POST',
        headers:            buildHeaders_(key, true),
        payload:            JSON.stringify(batch),
        muteHttpExceptions: true,
      });
      var code = response.getResponseCode();
      if (code !== 200 && code !== 201 && code !== 204) {
        errors.push('HTTP ' + code + ' en lote ' + i + ': ' + response.getContentText().substring(0, 200));
      }
    } catch (e) {
      errors.push('Error de red en lote ' + i + ': ' + e.message);
    }
  }
  return errors;
}

/**
 * Registra un evento en event_log.
 */
function logEvent_(key, eventData) {
  UrlFetchApp.fetch(SUPABASE_REST + '/event_log', {
    method:             'POST',
    headers:            buildHeaders_(key, false),
    payload:            JSON.stringify(eventData),
    muteHttpExceptions: true,
  });
}

/**
 * Construye los headers HTTP para las peticiones a Supabase.
 */
function buildHeaders_(key, preferMerge) {
  var h = {
    'apikey':        key,
    'Authorization': 'Bearer ' + key,
    'Content-Type':  'application/json',
  };
  if (preferMerge) {
    h['Prefer'] = 'resolution=merge-duplicates,return=minimal';
  }
  return h;
}

/**
 * Busca el índice de una columna en los headers por múltiples nombres posibles.
 * Case-insensitive. Retorna -1 si no encuentra.
 */
function findColIdx_(headers, names) {
  var lowerNames = names.map(function (n) { return n.toLowerCase(); });
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    if (lowerNames.indexOf(h) >= 0) return i;
  }
  return -1;
}

/**
 * Recupera el service_role key de Script Properties.
 */
function getServiceRoleKey_() {
  return PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
}

// ---------------------------------------------------------------------------
// Helpers de conversión de tipos
// ---------------------------------------------------------------------------

function toNumOrNull_(v) {
  if (v === null || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function toIntOrNull_(v) {
  if (v === null || v === '') return null;
  var n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

/** Convierte un valor Date de Google Sheets a ISO 8601 string, o null. */
function toIsoOrNull_(v) {
  if (v === null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString();
  }
  // A veces llega como string
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Convierte un valor Date de Google Sheets a 'YYYY-MM-DD', o null. */
function toDateStrOrNull_(v) {
  if (v === null || v === '') return null;
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

// ---------------------------------------------------------------------------
// Normalización de status (mirrors normalize_status() SQL function)
// ---------------------------------------------------------------------------

/**
 * Mapea el string raw de Status al enum normalizado de Supabase.
 * Debe mantenerse sincronizado con normalize_status() en 001_init.sql.
 */
function normalizeStatus_(raw) {
  if (!raw || String(raw).trim() === '') return 'unknown';

  var s = String(raw).trim().toLowerCase();

  // Enviado (variantes: con emoji, mayúsculas, espacios, 'sent', 'completado')
  if (s.indexOf('enviado') === 0 || s === 'sent' || s === 'completado') return 'sent';

  // En proceso
  if (s === 'procesando' || s === 'sending') return 'sending';

  // Listo para enviar
  if (s.indexOf('listo para enviar') >= 0 || s.indexOf('ready') >= 0) return 'pending_ready';

  // Bloqueado por validación (> 3 bancos simultáneos, etc.)
  if (s.indexOf('banks detected') >= 0 && s.indexOf('blocked') >= 0) return 'blocked_validation';
  if (s.indexOf('blocked') >= 0) return 'blocked_validation';

  // Fallido: borrador generado, no enviado
  if (s.indexOf('borrador') >= 0 || s.indexOf('no se ha enviado') >= 0) return 'failed';

  // Fallido: errores de sistema
  if (s.indexOf('error') >= 0 || s.indexOf('no existe') >= 0 || s.indexOf('no tenemos correo') >= 0) return 'failed';

  // Oferta recibida
  if (s.indexOf('oferta') >= 0 || s.indexOf('offer received') >= 0) return 'offer_received';

  // Denegado / rechazado
  if (s.indexOf('denegad') >= 0 || s.indexOf('rechazad') >= 0 || s.indexOf('rejected') >= 0) return 'rejected';

  // Más información solicitada
  if (s.indexOf('más información') >= 0 || s.indexOf('mas informacion') >= 0 || s.indexOf('more info') >= 0) return 'more_info_requested';

  // Relanzamiento
  if (s.indexOf('relanzar') >= 0 || s.indexOf('relaunch') >= 0) return 'relaunch_requested';

  // Bloqueado por red flag explícita
  if (s.indexOf('red flag') >= 0) return 'blocked_red_flag';

  // Bloqueado por documentos faltantes
  if (s.indexOf('documentos') >= 0 || s.indexOf('missing doc') >= 0) return 'blocked_missing_docs';

  return 'unknown';
}

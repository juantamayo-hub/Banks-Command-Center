"""
Conecta los flujos de n8n a la configuración de bancos del Command Center y deja de depender de la Google Sheet
"Red_Flags_Bancos_Config" (1rOwsgO5…) y de los correos escritos a mano en los nodos (20-oct-2026).

Cada flujo se modifica con n8n_safe_put.safe_patch (copia de seguridad + verificación de publicado y activo).
Los nodos que leían la hoja se convierten en Code nodes CON EL MISMO NOMBRE que llaman a
GET {COMMAND_CENTER_URL}/api/bank-config/{recipients|redflags} (cabecera x-offers-secret), y los nodos que usaban
esos datos se adaptan para producir exactamente las mismas salidas que antes.
Si el Command Center no responde, el nodo falla y el flujo NO envía (mismo criterio que el anti-duplicado).

Uso:
    export N8N_API_KEY=...
    python3 scripts/n8n_link_bank_config.py --check          # solo genera y valida el JS (node --check)
    python3 scripts/n8n_link_bank_config.py --apply [ids…]   # publica (todos o los indicados)
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n8n_safe_put import safe_patch  # noqa: E402

BACKUPS = os.environ.get('BACKUP_DIR', '/private/tmp/claude-503/f4/backups')
PROV = '15edcbc34620af8067c2413c2d9793b2a6bba3ba'
MAIL = '498dd83b5c5e1f1181c232131933717ceadfda34'

HELPER = r"""// Destinatarios desde el Command Center (Configuración de bancos). Sustituye a la hoja Red_Flags_Bancos_Config.
// Si el Command Center no responde, este nodo falla y el dossier NO se envía.
const __node = (n) => { try { return $(n).first().json || {}; } catch (e) { return {}; } };
const __prov = (v) => (v && typeof v === 'object') ? (v.id ?? v.value ?? '') : (v ?? '');
async function ccRecipients(ctx, bank, provinceRaw, dealEmail, ownerEmail) {
  return await ctx.helpers.httpRequest({
    method: 'GET',
    url: `${$vars.COMMAND_CENTER_URL}/api/bank-config/recipients`,
    qs: { bank, province: String(__prov(provinceRaw)), dealEmail: String(dealEmail || ''), ownerEmail: String(ownerEmail || '') },
    headers: { 'x-offers-secret': $vars.OFFERS_API_SECRET },
    json: true,
    timeout: 15000,
  });
}
"""


def code_node(old: dict, js: str) -> dict:
    """Convierte un nodo (Sheets/HTTP) en Code node con el mismo nombre y posición."""
    return {
        'id': old.get('id'),
        'name': old['name'],
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': old['position'],
        'parameters': {'jsCode': js},
    }


def replace_node(wf: dict, name: str, js: str) -> None:
    for i, n in enumerate(wf['nodes']):
        if n['name'] == name:
            wf['nodes'][i] = code_node(n, js)
            return
    raise RuntimeError(f'{wf["name"]}: no encuentro el nodo {name}')


def set_code(wf: dict, name: str, js: str) -> None:
    n = next(x for x in wf['nodes'] if x['name'] == name)
    n['parameters']['jsCode'] = js


def get_code(wf: dict, name: str) -> str:
    return next(x for x in wf['nodes'] if x['name'] == name)['parameters']['jsCode']


def sub_once(text: str, old: str, new: str, wf: dict, where: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f'{wf["name"]} · {where}: patrón encontrado {text.count(old)} veces')
    return text.replace(old, new)


# ── Lectores: devuelven el resultado de la API (o el formato antiguo de la hoja) ─────────────────

def reader_api(bank: str, deal_node='GetDeal1', bank_node='FindBankDeal1') -> str:
    return HELPER + f"""
const deal = __node('{deal_node}');
const bankDeal = __node('{bank_node}');
const r = await ccRecipients(this, '{bank}', deal['{PROV}'], bankDeal['{MAIL}'], deal.user_id?.email);
return [{{ json: r }}];
"""


def reader_legacy_row(bank: str, deal_node='GetDeal1', bank_node='FindBankDeal1', per_input=False) -> str:
    """Formato de fila de la hoja ('Email TO') para nodos que solo leían esa columna."""
    out = ("return $input.all().map(() => ({ json: row }));" if per_input else "return [{ json: row }];")
    return HELPER + f"""
const deal = __node('{deal_node}');
const bankDeal = __node('{bank_node}');
const r = await ccRecipients(this, '{bank}', deal['{PROV}'], bankDeal['{MAIL}'], deal.user_id?.email);
if (!r.toEmail) throw new Error('Command Center: {bank} sin destinatario configurado (' + (r.reason || r.route) + ')');
const row = {{ 'Email TO': r.toEmail, Banco: '{bank}', ...r }};
{out}
"""


def reader_blocked(bank: str, extra_cc: bool) -> str:
    """Lista de correos bloqueados en el formato de la pestaña 'Correos excluidos' (columna única)."""
    extra = (",\n  __ccExtra: (r.ccEmails || []).filter((e) => e.toLowerCase() !== String(pe.ownerEmail || '').toLowerCase())"
             if extra_cc else '')
    return HELPER + f"""
const pe = __node('PrepareEmail1');
const r = await ccRecipients(this, '{bank}', '', pe.toEmail, pe.ownerEmail);
return [{{ json: {{
  'CORREOS A LOS QUE NO SE PUEDE ENVIAR': (r.blocked || []).join(', '){extra}
}} }}];
"""


# ── Parches por flujo ───────────────────────────────────────────────────────────────────────────

def p_hipotecas(wf):
    replace_node(wf, 'GetBankEmailRows', reader_api('hipotecas_com'))
    set_code(wf, 'ResolveEmail', """// Destinatario: Command Center (Email bancario del deal o correo por provincia, según la prioridad configurada)
const rd = $('RouterDecision1').first().json;
const r  = $('GetBankEmailRows').first().json;
const toEmail = r.toEmail || '';
const provincia = r.province || '';
const emailSource = r.matchedBy === 'deal_field' ? 'pipedrive_field' : (toEmail ? 'command_center' : '');
const hasEmail = !!toEmail;
return [{ json: {
  ...rd,
  toEmail,
  emailSource,
  hasEmail,
  provincia,
  route: hasEmail ? rd.route : 'falta_email',
  missingNote: hasEmail ? rd.missingNote : `🚫 No se encontró email para Hipotecas.com (provincia: '${provincia}'). Ni campo bancario en Pipedrive ni correo configurado en el Command Center.`
}}];""")


def _prov_resolve(bank_label, not_found_route, not_found_note, cc_expr, extra=''):
    return f"""// Destinatario por provincia: Command Center (Configuración → {bank_label})
const deal = $('GetDeal1').first().json;
const rd   = $('RouterDecision1').first().json;
const r    = $('GetBankEmailRows').first().json;
const provincia = r.province || '';
{extra}
if (!r.toEmail) {{
  return [{{ json: {{ ...rd, toEmail: null, ccEmail: '', provincia, route: '{not_found_route}', missingNote: {not_found_note} }} }}];
}}
const toEmail = r.toEmail;
const ccEmail = {cc_expr};
return [{{ json: {{ ...rd, toEmail, ccEmail, provincia, route: rd.route }} }}];"""


def p_craragon(wf):
    replace_node(wf, 'GetBankEmailRows', reader_api('cr_aragon'))
    set_code(wf, 'ResolveProvinciaEmail', """// Destinatario por provincia: Command Center (Configuración → CR Aragón)
const rd = $('RouterDecision1').first().json;
const r  = $('GetBankEmailRows').first().json;
const provincia = r.province || '';
if (!r.toEmail) {
  return [{ json: { ...rd, toEmail: null, provincia, route: 'provincia_fuera_rango',
    missingNote: `🚫 Provincia '${provincia}' fuera del rango permitido para CR Aragón` } }];
}
return [{ json: { ...rd, toEmail: r.toEmail, provincia, route: rd.route } }];""")


def p_cajamar(wf):
    replace_node(wf, 'GetBankEmailRows', reader_api('cajamar'))
    set_code(wf, 'ResolveProvinciaEmail', _prov_resolve(
        'Cajamar', 'provincia_fuera_rango', "`🚫 Provincia '${provincia}' fuera del rango permitido para Cajamar`",
        "r.ccEmail || ''   // owner solo donde está configurado (Madrid)",
        extra="const esMadrid = provincia.toLowerCase() === 'madrid';").replace(
        "return [{ json: { ...rd, toEmail, ccEmail, provincia, route: rd.route } }];",
        "return [{ json: { ...rd, toEmail, ccEmail, provincia, esMadrid, route: rd.route } }];"))


def p_crasturias(wf):
    replace_node(wf, 'GetBankEmailRows', reader_api('cr_asturias'))
    set_code(wf, 'ResolveProvinciaEmail', _prov_resolve(
        'CR Asturias', 'provincia_fuera_rango', "`🚫 Sin configuración de email para CR Asturias`",
        "deal.user_id?.email || ''   // siempre CC el owner para CR Asturias"))


def p_globalcaja(wf):
    replace_node(wf, 'GetBankEmailRows', reader_api('globalcaja'))
    set_code(wf, 'ResolveProvinciaEmail', """// Destinatario por provincia: Command Center (Configuración → Globalcaja)
const deal = $('GetDeal1').first().json;
const rd   = $('RouterDecision1').first().json;
const r    = $('GetBankEmailRows').first().json;
const provinciaNombre = r.province || null;
if (!r.toEmail) {
  const missingNote = provinciaNombre
    ? `🚫 Sin configuración de email para provincia: ${provinciaNombre}`
    : '🚫 Provincia no informada en el deal';
  return [{ json: { ...rd, toEmail: null, ccEmail: deal.user_id?.email || '', route: 'sin_configuracion', missingNote } }];
}
// CC = copia configurada para la provincia + owner del deal
return [{ json: { ...rd, toEmail: r.toEmail, ccEmail: r.ccEmail || deal.user_id?.email || '', route: rd.route, missingNote: '' } }];""")


def p_crsur(wf):
    replace_node(wf, 'GetBankEmailRows', reader_api('cr_del_sur'))
    set_code(wf, 'ResolveProvinciaEmail', """// Destinatario por provincia: Command Center (Configuración → CR del Sur)
const deal = $('GetDeal1').first().json;
const rd   = $('RouterDecision1').first().json;
const r    = $('GetBankEmailRows').first().json;
const ANDALUCIA = ['Sevilla','Huelva','Cádiz','Málaga','Granada','Almería','Jaén','Córdoba'];
const provincia = r.province || '';
const isAndalucia = ANDALUCIA.some(p => provincia.toLowerCase().includes(p.toLowerCase()));
if (!r.toEmail) {
  return [{ json: { ...rd, toEmail: null, ccEmail: '', provincia, isAndalucia, route: 'provincia_fuera_rango',
    missingNote: `🚫 Sin configuración de email para CR del Sur (${provincia})` } }];
}
const ccEmail = deal.user_id?.email || '';
return [{ json: { ...rd, toEmail: r.toEmail, ccEmail, provincia, isAndalucia, route: rd.route } }];""")


def p_laboralkutxa(wf):
    replace_node(wf, 'GetContactosSheet', HELPER + f"""
const dealRaw = __node('FindDealGeneral');
const bankRaw = __node('FindBankDeal');
const ownerRaw = __node('FindOwner');
const deal = dealRaw.data || dealRaw || {{}};
const bankDeal = bankRaw.data || bankRaw || {{}};
const owner = ownerRaw.data || ownerRaw || {{}};
const cf = deal.custom_fields || deal;
const bcf = bankDeal.custom_fields || bankDeal;
const ownerEmail = owner?.email?.[0]?.value || owner?.email || '';
const r = await ccRecipients(this, 'laboral_kutxa', cf['{PROV}'], bcf['{MAIL}'], ownerEmail);
return [{{ json: r }}];
""")
    c = get_code(wf, 'PrepareEmail')
    start = c.index('// ── Read email from Contactos Banco GSheet')
    end = c.index("const toEmail    = contactRow?.['Email TO'] || '';")
    c = c[:start] + ("// ── Destinatario: Command Center (Configuración → Laboral Kutxa: Madrid / Valladolid y Palencia / resto)\n"
                     "const toEmail    = $('GetContactosSheet').first().json.toEmail || '';") + \
        c[end + len("const toEmail    = contactRow?.['Email TO'] || '';"):]
    set_code(wf, 'PrepareEmail', c)


def p_ruralnostra(wf):
    replace_node(wf, 'GET EMAILS', reader_legacy_row('ruralnostra', deal_node='Find Bank Deal', bank_node='Find Bank Deal'))


def p_crteruel(wf):
    replace_node(wf, 'GetBankEmail', reader_legacy_row('cr_teruel'))


def p_crgranada(wf):
    replace_node(wf, 'GetBankEmail', reader_legacy_row('cr_granada'))


def p_unicaja(wf):
    replace_node(wf, 'GetnotAllowedEmails', reader_blocked('unicaja', extra_cc=True))
    c = get_code(wf, 'CheckValidEmail')
    c = sub_once(c, "const emailCC = normalizedEmail === 'mclopezr@unicaja.es' ? 'lpenalver@unicaja.es' : '';",
                 "// CC condicional según el destinatario: Command Center (Configuración → Unicaja → copia condicional)\n"
                 "const emailCC = ($('GetnotAllowedEmails').first().json.__ccExtra || []).join(', ');", wf, 'CheckValidEmail')
    set_code(wf, 'CheckValidEmail', c)


def p_nobankfee(wf):
    replace_node(wf, 'ReadEmailNoPermitidos_Unicaja', reader_blocked('no_bank_fee', extra_cc=False))


def p_ibercaja(wf):
    replace_node(wf, 'GET EMAILS', reader_legacy_row('ibercaja', deal_node='Find Bank Deal', bank_node='Find Bank Deal',
                                                     per_input=True))
    for n in wf['nodes']:
        if n['type'].endswith('gmail') and n['parameters'].get('sendTo') == 'solicitudesici@ibercajaconnect.es':
            n['parameters']['sendTo'] = "={{ $('GET EMAILS').first().json['Email TO'] }}"


def p_deutsche(wf):
    c = get_code(wf, 'RouterDecision1')
    c = re.sub(r"// Province -> Deutsche Bank email\nconst provinceEmailMap = \{.*?\};\n",
               "// Province -> Deutsche Bank email: Command Center (Configuración → Deutsche Bank)\n", c, count=1, flags=re.S)
    c = sub_once(c, "const toEmail     = provinceEmailMap[province] || null;",
                 "const __dest       = await ccRecipients(this, 'deutsche_bank', provinceRaw, '', deal.user_id?.email);\n"
                 "const toEmail     = __dest.toEmail || null;", wf, 'RouterDecision1')
    set_code(wf, 'RouterDecision1', HELPER + '\n' + c)


def p_caixapopular(wf):
    c = get_code(wf, 'ResolveProvinciaEmail')
    c = sub_once(c, "// Email fijo para Caixa Popular\nconst toEmail = 'mbotana@caixapopular.es';",
                 "// Destinatario: Command Center (Configuración → Caixa Popular)\n"
                 f"const __dest = await ccRecipients(this, 'caixa_popular', deal['{PROV}'], '', deal.user_id?.email);\n"
                 "if (!__dest.toEmail) throw new Error('Command Center: Caixa Popular sin destinatario configurado');\n"
                 "const toEmail = __dest.toEmail;", wf, 'ResolveProvinciaEmail')
    set_code(wf, 'ResolveProvinciaEmail', HELPER + '\n' + c)


def p_myinvestor(wf):
    c = get_code(wf, 'Router')
    i = c.rindex('return [{ json: {')
    c = c[:i] + ("// Destinatario: Command Center (Configuración → MyInvestor)\n"
                 "const __dest = await ccRecipients(this, 'myinvestor', '', '', '');\n"
                 "const bankEmailTo = __dest.toEmail || '';\n") + c[i:].replace('return [{ json: {', 'return [{ json: {\n  bankEmailTo,', 1)
    set_code(wf, 'Router', HELPER + '\n' + c)
    for n in wf['nodes']:
        if n['type'].endswith('gmail') and n['parameters'].get('sendTo') == '=hipotecas100@myinvestor.es':
            n['parameters']['sendTo'] = "={{ $('Router').first().json.bankEmailTo }}"


def p_redflags(wf):
    replace_node(wf, 'Read Bank Config', """// Reglas de red flags: Command Center (Configuración de bancos). Sustituye a la hoja "Reglas Red Flag".
const bd0 = $('Get Deal Banco').first().json;
const bd = bd0.data || bd0;
const raw = bd['c3a445b9bf0422b9db09abc776cf2dc281b7e975'];
const bank = (raw && typeof raw === 'object') ? (raw.name || raw.value || '') : String(raw || '');
const ctx = $('Extract Deal Fields').first().json;
const tc = String(ctx.tipoCompra || '').toLowerCase();
const op = (ctx.esCambioHipoteca || tc === '2550' || tc.includes('cambio') || tc.includes('subrog')) ? 'cambio_hipoteca'
  : (tc === '2548' || tc.includes('segunda')) ? 'segunda_residencia' : 'primera_residencia';
const cfg = await this.helpers.httpRequest({
  method: 'GET',
  url: `${$vars.COMMAND_CENTER_URL}/api/bank-config/redflags`,
  qs: { bank, op },
  headers: { 'x-offers-secret': $vars.OFFERS_API_SECRET },
  json: true,
  timeout: 15000,
});
return [{ json: { __bankConfig: cfg } }];""")
    c = get_code(wf, 'Validate All Rules')
    start = c.index('// === READ CONFIG FROM SHEET ===')
    end = c.index('// === CHECK DOCUMENT EXISTENCE')
    new_cfg = """// === CONFIG DEL COMMAND CENTER (regla del banco por tipo de operación, o regla general) ===
const cfg = $('Read Bank Config').first().json.__bankConfig || {};
const rule = cfg.configFound ? (cfg.rule || null) : null;
const config = rule;

const bankDealResp = $('Get Deal Banco').first().json;
const bankDeal = bankDealResp.data || bankDealResp;
const bankNameRaw = bankDeal['c3a445b9bf0422b9db09abc776cf2dc281b7e975'];
const targetBank = (
  typeof bankNameRaw === 'object'
    ? (bankNameRaw.name || bankNameRaw.value || '')
    : String(bankNameRaw || '')
).toLowerCase();

if (!targetBank) {
  flags.push('No se encontró nombre de banco en el deal');
}

// Valores: los del Command Center; si el banco no existe, los valores por defecto de siempre
const num = (v, d) => (v === null || v === undefined || v === '') ? d : Number(v);
const minImporte = rule ? num(rule.minImporte, 80000) : 80000;
const maxPlazo = rule ? num(rule.maxPlazoAnos, 30) : 30;
const maxFinanciacion = rule ? num(rule.maxFinanciacionPct, 100) : 100;
const maxEdadPlazo = rule ? num(rule.maxEdadPlazo, 75) : 75;
const minIngresos1T = rule ? num(rule.minIngresos1T, 1200) : 1200;
const maxDTI = rule ? num(rule.maxDtiPct, 35) : 35;
const minIngresos2T = rule ? num(rule.minIngresos2T, 0) : 0;
const maxBancos = rule ? num(rule.maxBancos, 1) : 1;
const minAntiguedad = rule ? num(rule.minAntiguedadAnos, 0) : 0;
const validateDti = !!(rule && rule.validateDti);
const requiredDocs = (cfg.requiredDocuments || []).filter((d) => d.required).map((d) => String(d.code).toUpperCase());
const isRuralnostra = targetBank.includes('ruralnostra');   // solo para el texto de la nota

"""
    c = c[:start] + new_cfg + c[end:]
    c = sub_once(c, "if (isRuralnostra) {\n  try {\n    const c008",
                 "if (requiredDocs.length) {\n  try {\n    const c008", wf, 'docs existence')
    c = sub_once(c, "// 5c. ANTIGÜEDAD LABORAL — SOLO UNICAJA\nif (targetBank.includes('unicaja')) {",
                 "// 5c. ANTIGÜEDAD LABORAL — si el banco tiene mínimo configurado\nif (minAntiguedad > 0) {", wf, 'antiguedad if')
    c = sub_once(c, "  if (antiguedad1T < 2) {", "  if (antiguedad1T < minAntiguedad) {", wf, 'antiguedad cmp')
    c = sub_once(c, "      ' años < mínimo 2 año (Unicaja)'", "      ' años < mínimo ' + minAntiguedad + ' años'", wf, 'antiguedad msg')
    c = sub_once(c, "// 6. DTI — SOLO RURALNOSTRA\nif (isRuralnostra) {",
                 "// 6. DTI — si el banco lo tiene activado (Validar DTI)\nif (validateDti) {", wf, 'dti')
    c = sub_once(c, """// 7. DOCUMENTOS — SOLO RURALNOSTRA
if (isRuralnostra) {
  if (!ctx.c007Processed) flags.push('Falta documento C007 (IRPF)');
  if (!hasC008) flags.push('Falta documento C008');
  if (!hasD008) flags.push('Falta documento D008');
  if (!hasF001) flags.push('Falta documento F001');
}""", """// 7. DOCUMENTOS OBLIGATORIOS — los configurados en el Command Center (códigos que este flujo busca en Drive)
if (requiredDocs.includes('C007') && !ctx.c007Processed) flags.push('Falta documento C007 (IRPF)');
if (requiredDocs.includes('C008') && !hasC008) flags.push('Falta documento C008');
if (requiredDocs.includes('D008') && !hasD008) flags.push('Falta documento D008');
if (requiredDocs.includes('F001') && !hasF001) flags.push('Falta documento F001');""", wf, 'docs flags')
    c = sub_once(c, "      //hasRedFlags,\n      hasRedFlags: false,",
                 "      // Bloquea solo si el banco tiene activado \"Bloquear envío si hay red flags\" en el Command Center\n"
                 "      hasRedFlags: !!cfg.blockOnRedFlags && hasRedFlags,", wf, 'hasRedFlags')
    c = c.replace("      configFound: !!config,", "      configFound: !!config,\n      ruleSource: cfg.ruleSource || null,")
    set_code(wf, 'Validate All Rules', c)


def p_pichincha(wf):
    replace_node(wf, 'GetBankEmail', reader_legacy_row('pichincha'))
    for n in wf['nodes']:
        if n['type'].endswith('gmail') and 'johanna.carrion@bancopichincha.es' in str(n['parameters'].get('sendTo')):
            n['parameters']['sendTo'] = "={{ $('GetBankEmail').first().json['Email TO'] }}"


PATCHES = {
    '4gnfEIxrG7IdsdNF': p_hipotecas,
    '7tABOhyg3kYrYiNj': p_craragon,
    'Eiy2MF44OLBJB0vs': p_cajamar,
    'Q7r7v3WJxgeFmiv2': p_crasturias,
    'RsKO50rlqVt0UofL': p_globalcaja,
    'zgLT2IOJqTidzDXv': p_crsur,
    'uFgyDQGHWBVFdycN': p_laboralkutxa,
    '9JuywN0nb81ERoK9': p_ruralnostra,
    'eUntnpw1FAhx5Ups': p_crteruel,
    'wwSZcaYdWb9nje60': p_crgranada,
    'TfJTADGBt9xEJn3h': p_unicaja,
    'A6MiU53vWvyACevy': p_nobankfee,
    'p9WkjPl75vFBvrAW': p_ibercaja,
    'vl1Ui6gm0RV6a3uO': p_deutsche,
    'ghrabIQkmYHPCXFA': p_caixapopular,
    'cxHH2ylDZz0AzjNm': p_myinvestor,
    '7uUqWPCqDB7QQWeb': p_redflags,
    'o9Sm5hWc1t0nDccE': p_pichincha,
}


def js_syntax_ok(js: str) -> str | None:
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write('async function __n8n() {\n' + js + '\n}\n')
        path = f.name
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    os.unlink(path)
    return None if r.returncode == 0 else r.stderr.strip().splitlines()[-1]


def check_all(src_dir: str) -> bool:
    ok = True
    for wid, fn in PATCHES.items():
        wf = json.load(open(os.path.join(src_dir, f'{wid}.json')))
        before = {n['name']: json.dumps(n) for n in wf['nodes']}
        try:
            fn(wf)
        except Exception as e:  # noqa: BLE001
            print(f'✗ {wid}: {e}')
            ok = False
            continue
        changed = [n for n in wf['nodes'] if json.dumps(n) != before.get(n['name'])]
        errs = [(n['name'], js_syntax_ok(n['parameters']['jsCode'])) for n in changed if 'jsCode' in n['parameters']]
        errs = [e for e in errs if e[1]]
        still = [n['name'] for n in wf['nodes'] if '1rOwsgO5E41i8WH5e-2kYMZJTEtW_mi88GsWnrKrJqM4' in json.dumps(n.get('parameters', {}))
                 and n['type'].split('.')[-1] in ('googleSheets', 'httpRequest', 'code')]
        flag = '✓' if not errs else '✗'
        ok &= not errs
        print(f"{flag} {wf['name'][:40]:40} cambiados: {[n['name'] for n in changed]}"
              + (f" | ERRORES JS: {errs}" if errs else '') + (f" | aún referencia la hoja: {still}" if still else ''))
    return ok


if __name__ == '__main__':
    if '--check' in sys.argv:
        sys.exit(0 if check_all(os.environ.get('SRC_DIR', '/private/tmp/claude-503/f4')) else 1)
    if '--apply-over-draft' in sys.argv:
        # Autorizado por el owner (Juanjo, 20-oct-2026): publicar sobre el borrador ajeno partiendo de la versión
        # PUBLICADA (activeVersion), no del borrador. Solo para flujos cuyo borrador no tiene cambios de lógica.
        from n8n_safe_put import _req  # noqa: E402
        for wid in [a for a in sys.argv[sys.argv.index('--apply-over-draft') + 1:] if not a.startswith('-')]:
            wf = _req('GET', f'/workflows/{wid}')
            os.makedirs(BACKUPS, exist_ok=True)
            json.dump(wf, open(os.path.join(BACKUPS, f'draft_backup_{wid}.json'), 'w'))
            av = wf['activeVersion']
            wf['nodes'], wf['connections'] = av['nodes'], av['connections']
            PATCHES[wid](wf)
            _req('PUT', f'/workflows/{wid}', {k: wf[k] for k in ('name', 'nodes', 'connections', 'settings')})
            after = _req('GET', f'/workflows/{wid}')
            if not after.get('active'):
                _req('POST', f'/workflows/{wid}/activate')
                after = _req('GET', f'/workflows/{wid}')
            assert after.get('active'), f'{wid} quedó inactivo'
            assert after.get('versionId') == after.get('activeVersionId'), f'{wid} no quedó publicado'
            print('publicado sobre borrador', wid, after['name'])
        sys.exit(0)
    if '--apply' in sys.argv:
        ids = [a for a in sys.argv[sys.argv.index('--apply') + 1:] if not a.startswith('-')] or list(PATCHES)
        for wid in ids:
            safe_patch(wid, PATCHES[wid], backup_dir=BACKUPS)
            print('publicado', wid)

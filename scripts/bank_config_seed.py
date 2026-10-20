"""
Genera supabase/migrations/029_bank_config_seed.sql (carga inicial de la configuración de bancos).

Fuentes:
  · scripts/data/red_flags_bancos_config_snapshot.json  → copia de la Google Sheet "Red_Flags_Bancos_Config"
  · n8n (API, solo lectura)                             → mapas escritos a mano en los flujos:
        Deutsche Bank   RouterDecision1   provinceEmailMap / provinceEnumMap
        Ibercaja        Build Email Data  pMap (oficina por provincia, va en CC)
  · Constantes de este fichero                          → correos fijos escritos en nodos (Caixa Popular, MyInvestor,
                                                          Pichincha, Ibercaja TO, CC condicional de Unicaja)

La carga reproduce lo que RESUELVE HOY cada flujo, no lo que pone la hoja: filas de la hoja que el flujo nunca
encuentra (p. ej. "Palmas Las" en Hipotecas.com) NO se cargan como contacto; se listan en REVISAR al final del SQL.

Uso:
    export N8N_API_KEY=...
    python3 scripts/bank_config_seed.py > supabase/migrations/029_bank_config_seed.sql
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT = os.path.join(ROOT, 'scripts', 'data', 'red_flags_bancos_config_snapshot.json')
N8N = os.environ.get('N8N_API_URL', 'https://huspy.app.n8n.cloud/api/v1')

WF_DEUTSCHE = 'vl1Ui6gm0RV6a3uO'
WF_IBERCAJA = 'p9WkjPl75vFBvrAW'

# Nombre en la hoja → slug
SHEET_TO_SLUG = {
    'Ruralnostra': 'ruralnostra', 'CaixaBank': 'caixabank', 'Ibercaja': 'ibercaja', 'Laboral Kutxa': 'laboral_kutxa',
    'Unicaja': 'unicaja', 'EuroCajaRural': 'eurocajarural', 'EurocajaRural': 'eurocajarural', 'MyInvestor': 'myinvestor',
    'Deutsche Bank': 'deutsche_bank', 'CR Teruel': 'cr_teruel', 'CR Aragón': 'cr_aragon', 'UCI': 'uci',
    'Hipotecas.com': 'hipotecas_com', 'Cajamar': 'cajamar', 'CR Asturias': 'cr_asturias', 'CR Granada': 'cr_granada',
    'CR del Sur': 'cr_del_sur', 'Globalcaja': 'globalcaja', 'No Bank Fee': 'no_bank_fee', 'Caixa Popular': 'caixa_popular',
}

# Bancos con flujo de envío por correo (o reglas en la hoja). display_name = nombre del deal bancario (campo c3a445…)
BANKS = {
    'ruralnostra':   ('Ruralnostra',   ['Ruralnostra']),
    'caixabank':     ('CaixaBank',     ['CaixaBank']),
    'ibercaja':      ('Ibercaja',      ['Ibercaja']),
    'laboral_kutxa': ('Laboral Kutxa', ['Laboral Kutxa']),
    'unicaja':       ('Unicaja',       ['Unicaja']),
    'eurocajarural': ('EuroCajaRural', ['EuroCajaRural']),
    'myinvestor':    ('MyInvestor',    ['MyInvestor']),
    'deutsche_bank': ('Deutsche Bank', ['Deutsche Bank']),
    'cr_teruel':     ('CR Teruel',     ['CR Teruel']),
    'cr_aragon':     ('CR Aragón',     ['CR Aragón']),
    'uci':           ('UCI',           ['UCI']),
    'hipotecas_com': ('Hipotecas.com', ['Hipotecas.com']),
    'cajamar':       ('Cajamar',       ['Cajamar']),
    'cr_asturias':   ('CR Asturias',   ['CR Asturias']),
    'cr_granada':    ('CR Granada',    ['CR Granada']),
    'cr_del_sur':    ('CR del Sur',    ['CR del Sur']),
    'globalcaja':    ('Globalcaja',    ['Globalcaja']),
    'no_bank_fee':   ('No Bank Fee',   ['No Bank Fee']),
    'caixa_popular': ('Caixa Popular', ['Caixa Popular']),
    'pichincha':     ('Pichincha',     ['Pichincha']),
}

# Origen del TO (ver bank_config.to_source)
TO_SOURCE = {
    'unicaja': 'deal_field', 'eurocajarural': 'deal_field', 'no_bank_fee': 'deal_field',
    'hipotecas_com': 'deal_field_then_contacts', 'deutsche_bank': 'deal_field_then_contacts',
    'ibercaja': 'contacts_cc_deal_field',
}

# Bancos cuyo correo NO lleva al owner en copia (Cajamar: solo la fila Madrid lo lleva → cc_owner por contacto)
NO_CC_OWNER = {'cajamar'}

OP = {'primera residencia': 'primera_residencia', 'segunda residencia': 'segunda_residencia',
      'cambio de hipoteca': 'cambio_hipoteca'}

ANDALUCIA = ['Sevilla', 'Huelva', 'Cádiz', 'Málaga', 'Granada', 'Almería', 'Jaén', 'Córdoba']


def q(v) -> str:
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(xs) -> str:
    return "array[" + ','.join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"


def num(s):
    s = str(s or '').strip().replace('%', '').replace(',', '')
    if s == '':
        return None
    f = float(s)
    return int(f) if f.is_integer() else f


def emails(s) -> list[str]:
    return [e.strip() for e in re.split(r'[,;]', s or '') if '@' in e]


def n8n_wf(wid: str) -> dict:
    key = os.environ['N8N_API_KEY']
    req = urllib.request.Request(f'{N8N}/workflows/{wid}', headers={'X-N8N-API-KEY': key})
    return json.load(urllib.request.urlopen(req, timeout=60))


def js_object(code: str, var: str) -> dict:
    """Extrae `const <var> = {...};` de un Code node y lo evalúa con node (son literales planos)."""
    m = re.search(r'const\s+' + var + r'\s*=\s*(\{.*?\});', code, re.S)
    if not m:
        raise RuntimeError(f'No encuentro {var}')
    out = subprocess.run(['node', '-e', f'process.stdout.write(JSON.stringify({m.group(1)}))'],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def node_code(wf: dict, name: str) -> str:
    return next(n for n in wf['nodes'] if n['name'] == name)['parameters']['jsCode']


def main() -> None:
    snap = json.load(open(SNAPSHOT))
    review: list[str] = []

    deutsche = n8n_wf(WF_DEUTSCHE)
    dcode = node_code(deutsche, 'RouterDecision1')
    enum_map = {int(k): v for k, v in js_object(dcode, 'provinceEnumMap').items()}   # id → nombre usado por los flujos
    deutsche_map = js_object(dcode, 'provinceEmailMap')
    iber = n8n_wf(WF_IBERCAJA)
    icode = node_code(iber, 'Build Email Data')
    iber_prov = js_object(icode, 'provinciaMap')
    iber_pmap = js_object(icode, 'pMap')

    names = sorted(set(enum_map.values()))
    lower_names = {n.lower(): n for n in names}

    out: list[str] = ['-- 029: Carga inicial de la configuración de bancos (generado por scripts/bank_config_seed.py)',
                      '-- Reproduce lo que resuelven HOY los flujos de n8n. Revisar la sección REVISAR al final.', '']

    # ── provinces ────────────────────────────────────────────────────────────
    out.append('insert into provinces (pipedrive_option_id, name) values')
    out.append(',\n'.join(f'  ({k}, {q(v)})' for k, v in sorted(enum_map.items())))
    out.append('on conflict (pipedrive_option_id) do update set name = excluded.name;\n')

    # ── bank_config ──────────────────────────────────────────────────────────
    contacts_rows = snap['contactos_banco']
    first_row = {}
    for r in contacts_rows:
        slug = SHEET_TO_SLUG.get(r[0])
        if slug and slug not in first_row:
            first_row[slug] = r
    vals = []
    for slug, (name, pd_names) in BANKS.items():
        r = first_row.get(slug, [])
        subject = r[5] if len(r) > 5 and r[5] else None
        tab = r[4] if len(r) > 4 and r[4] else None
        notes = None
        if slug == 'unicaja':
            notes = 'Contactos Unicaja que figuraban en la hoja (el flujo no los usa; el TO sale del deal): ' + \
                    ', '.join(snap['unicaja_contactos_hoja'])
        vals.append(f"  ({q(slug)}, {q(name)}, {arr(pd_names)}, false, {q(TO_SOURCE.get(slug, 'contacts'))}, "
                    f"{q(subject)}, 'hipotecas@bayteca.com', {q(slug not in NO_CC_OWNER)}, {q(tab)}, {q(notes)}, 'seed')")
    out.append('insert into bank_config (bank_slug, display_name, pipedrive_names, block_on_red_flags, to_source, '
               'subject_template, email_from, cc_owner, sheet_tab, notes, updated_by) values')
    out.append(',\n'.join(vals))
    out.append('on conflict (bank_slug) do nothing;\n')
    review.append('Unicaja: el asunto en la hoja dice "Laboral Kutxa - Nuevo Expediente…" (se ha copiado tal cual).')

    # ── bank_redflag_rules ───────────────────────────────────────────────────
    vals = []
    for r in snap['reglas_red_flag']:
        slug = SHEET_TO_SLUG[r[0]]
        op = OP[r[1].strip().lower()]
        min_ant = 2 if slug == 'unicaja' else None          # antes escrito en el subflujo
        val_dti = slug == 'ruralnostra'                      # antes escrito en el subflujo
        vals.append(f"  ({q(slug)}, {q(op)}, {q(num(r[2]))}, {q(num(r[3]))}, {q(num(r[4]))}, {q(num(r[5]))}, "
                    f"{q(num(r[6]))}, {q(num(r[7]))}, {q(num(r[8]))}, {q(num(r[9]))}, {q(min_ant)}, {q(val_dti)}, "
                    f"{q(r[10] if len(r) > 10 and r[10] else None)}, 'seed')")
    out.append('insert into bank_redflag_rules (bank_slug, operation_type, min_importe, max_plazo_anos, '
               'max_financiacion_pct, max_edad_plazo, min_ingresos_1t, max_dti_pct, min_ingresos_2t, max_bancos, '
               'min_antiguedad_anos, validate_dti, notes, updated_by) values')
    out.append(',\n'.join(vals))
    out.append('on conflict (bank_slug, operation_type) do nothing;\n')

    # ── bank_required_documents ──────────────────────────────────────────────
    vals = []
    for r in snap['documentos_requeridos']:
        slug = SHEET_TO_SLUG[r[0]]
        vals.append(f"  ({q(slug)}, {q(r[1])}, {q(r[2])}, {q(r[3].upper().startswith('S'))}, "
                    f"{q(r[4].upper().startswith('S'))}, {q(r[5] or None)}, 'seed')")
    out.append('insert into bank_required_documents (bank_slug, drive_code, label, required, ocr, extract_field, '
               'updated_by) values')
    out.append(',\n'.join(vals))
    out.append('on conflict (bank_slug, drive_code) do nothing;\n')

    # ── bank_contacts (lo que resuelve hoy cada flujo) ───────────────────────
    contacts: list[tuple] = []   # (slug, scope, scope_value, to[], cc[], cc_owner, notes)

    def sheet(bank):
        return [r for r in contacts_rows if r[0] == bank]

    def prov_of(r):
        return r[6].strip() if len(r) > 6 else ''

    # Filas únicas (default)
    contacts.append(('ruralnostra', 'default', None, emails(sheet('Ruralnostra')[0][1]), [], None,
                     'Hoja: Contactos Banco / Ruralnostra'))
    contacts.append(('cr_teruel', 'default', None, emails(sheet('CR Teruel')[0][1]), [], None,
                     'Hoja: Contactos Banco / CR Teruel (primera fila)'))
    contacts.append(('cr_granada', 'default', None, emails(sheet('CR Granada')[0][1]), [], None,
                     'Hoja: Contactos Banco / CR Granada'))
    contacts.append(('cr_asturias', 'default', None, emails(sheet('CR Asturias')[0][1]), [], None,
                     'Hoja: Contactos Banco / CR Asturias (Todas)'))
    contacts.append(('caixa_popular', 'default', None, ['mbotana@caixapopular.es'], [], None,
                     'Antes fijo en n8n (ResolveProvinciaEmail)'))
    contacts.append(('myinvestor', 'default', None, ['hipotecas100@myinvestor.es'], [], None,
                     'Antes fijo en n8n (SendEmail_1T / SendEmail_1&2T)'))
    contacts.append(('pichincha', 'default', None,
                     ['johanna.carrion@bancopichincha.es', 'laura.albuja@bancopichincha.es'], [], None,
                     'Antes fijo en n8n (SendEmail1)'))
    contacts.append(('ibercaja', 'default', None, ['solicitudesici@ibercajaconnect.es'], [], None,
                     'Antes fijo en n8n (Email Sin CC Banco). Sin Email bancario en el deal, va en CC la oficina de la provincia'))
    contacts.append(('unicaja', 'when_to', 'mclopezr@unicaja.es', [], ['lpenalver@unicaja.es'], None,
                     'Antes fijo en n8n (CheckValidEmail): si el TO es Carmen, copia a lpenalver'))

    # Laboral Kutxa: Madrid / Valladolid+Palencia / resto
    lk = {prov_of(r).lower(): emails(r[1]) for r in sheet('Laboral Kutxa')}
    contacts.append(('laboral_kutxa', 'province', 'Madrid', lk['madrid'], [], None, 'Hoja: Madrid'))
    for p in ('Valladolid', 'Palencia'):
        contacts.append(('laboral_kutxa', 'province', p, lk['valladolid y palencia'], [], None,
                         'Hoja: "Valladolid y Palencia"'))
    contacts.append(('laboral_kutxa', 'default', None, lk['resto de españa'], [], None, 'Hoja: Resto de España'))

    # CR del Sur: Andalucía (8 provincias) / resto
    sur = {prov_of(r).lower(): emails(r[1]) for r in sheet('CR del Sur')}
    for p in ANDALUCIA:
        contacts.append(('cr_del_sur', 'province', p, sur['andalucía'], [], None, 'Hoja: Andalucía'))
    contacts.append(('cr_del_sur', 'default', None, sur['resto de españa'], [], None, 'Hoja: Resto de España'))

    # Cajamar: Madrid (owner en CC) / resto (sin owner)
    caj = {prov_of(r).lower(): emails(r[1]) for r in sheet('Cajamar')}
    contacts.append(('cajamar', 'province', 'Madrid', caj['madrid'], [], True, 'Hoja: Madrid (owner en CC)'))
    contacts.append(('cajamar', 'default', None, caj['resto de españa'], [], False, 'Hoja: Resto de España (sin owner)'))
    review.append(f"Cajamar: Madrid va a {caj['madrid']} (gmail) y el resto a {caj['resto de españa']} (Bayteca). "
                  'Es lo que hace hoy el flujo; confirmar que es intencionado.')

    # CR Aragón: comparación solo letras (sin tildes ni comas)
    def letters(s):
        import unicodedata
        s = unicodedata.normalize('NFD', s.lower())
        return re.sub(r'[^a-z]', '', ''.join(c for c in s if unicodedata.category(c) != 'Mn'))
    for r in sheet('CR Aragón'):
        p = prov_of(r)
        canon = next((n for n in names if letters(n) == letters(p)), None)
        if canon:
            contacts.append(('cr_aragon', 'province', canon, emails(r[1]), [], None, f'Hoja: {p}'))
        else:
            review.append(f'CR Aragón: la fila de la hoja "{p}" no corresponde a ninguna provincia de Pipedrive.')

    # Globalcaja: provincia exacta (minúsculas), TO + CC de la hoja
    for r in sheet('Globalcaja'):
        p = prov_of(r)
        canon = lower_names.get(p.lower())
        if canon:
            contacts.append(('globalcaja', 'province', canon, emails(r[1]), emails(r[2]), None, f'Hoja: {p}'))
        else:
            review.append(f'Globalcaja: la fila "{p}" no la encuentra el flujo (no se carga).')

    # Hipotecas.com: provincia exacta (minúsculas); primera fila que coincide
    seen = set()
    for r in sheet('Hipotecas.com'):
        p = prov_of(r)
        canon = lower_names.get(p.lower())
        if not canon:
            review.append(f'Hipotecas.com: la fila "{p}" → {emails(r[1])} nunca se usa (no coincide con Pipedrive).')
            continue
        if canon in seen:
            review.append(f'Hipotecas.com: fila duplicada "{p}" → {emails(r[1])} ignorada (gana la primera).')
            continue
        seen.add(canon)
        contacts.append(('hipotecas_com', 'province', canon, emails(r[1]), [], None, f'Hoja: {p}'))

    # Deutsche: mapa del flujo (claves = nombres que usan los flujos)
    for p, to in deutsche_map.items():
        if p not in names:
            review.append(f'Deutsche Bank: provincia "{p}" del mapa no existe en Pipedrive (no se carga).')
            continue
        contacts.append(('deutsche_bank', 'province', p, emails(to), [], None, 'Antes fijo en n8n (RouterDecision1)'))

    # Ibercaja: oficina por provincia (CC cuando no hay Email bancario). Resolución real: id → provinciaMap → pMap
    for pid, canon in sorted(enum_map.items()):
        prov = iber_prov.get(str(pid), str(pid))
        of = iber_pmap.get(prov)
        if of and not any(c[0] == 'ibercaja' and c[2] == canon for c in contacts):
            contacts.append(('ibercaja', 'province', canon, [], [of], None,
                             'Antes fijo en n8n (Build Email Data, oficina en CC)'))
    for k, v in iber_pmap.items():
        if 'bayteca.es' in v:
            review.append(f'Ibercaja: la oficina de "{k}" es {v} (dominio bayteca.es, ¿errata de ibercaja.es?).')

    vals = [f"  ({q(s)}, {q(sc)}, {q(sv)}, {arr(to)}, {arr(cc)}, {q(cco)}, {q(nt)}, 'seed')"
            for s, sc, sv, to, cc, cco, nt in contacts]
    out.append('insert into bank_contacts (bank_slug, scope, scope_value, to_emails, cc_emails, cc_owner, notes, '
               'updated_by) values')
    out.append(',\n'.join(vals))
    out.append(';\n')

    # ── blocked_emails ───────────────────────────────────────────────────────
    # La pestaña "Correos excluidos No Bank fee" solo la consultan hoy Unicaja y No Bank Fee
    vals = [f"  ({q(e)}, {q(slug)}, 'Hoja: Correos excluidos No Bank fee', 'seed')"
            for e in snap['correos_excluidos'] for slug in ('unicaja', 'no_bank_fee')]
    out.append('insert into blocked_emails (email, bank_slug, reason, updated_by) values')
    out.append(',\n'.join(vals))
    out.append('on conflict do nothing;\n')

    # ── editores ─────────────────────────────────────────────────────────────
    out.append("insert into bank_config_editors (email, added_by) values ('juan.tamayo@huspy.io', 'seed') "
               'on conflict do nothing;\n')

    if '--json' in sys.argv:
        # Mismos datos en JSON (para scripts/bank-config-parity.ts antes de aplicar la migración)
        json.dump({
            'provinces': [{'pipedrive_option_id': k, 'name': v, 'aliases': []} for k, v in sorted(enum_map.items())],
            'configs': [{'bank_slug': s_, 'display_name': n_, 'pipedrive_names': pn, 'block_on_red_flags': False,
                         'to_source': TO_SOURCE.get(s_, 'contacts'), 'cc_owner': s_ not in NO_CC_OWNER}
                        for s_, (n_, pn) in BANKS.items()],
            'contacts': [{'id': str(i), 'bank_slug': s_, 'scope': sc, 'scope_value': sv, 'to_emails': to, 'cc_emails': cc,
                          'cc_owner': cco, 'active': True} for i, (s_, sc, sv, to, cc, cco, nt) in enumerate(contacts)],
            'blocked': [{'id': f'b{i}', 'email': e, 'bank_slug': slug, 'reason': None}
                        for i, (e, slug) in enumerate((e, slug) for e in snap['correos_excluidos']
                                                      for slug in ('unicaja', 'no_bank_fee'))],
        }, sys.stdout, ensure_ascii=False)
        return

    out.append('-- ── REVISAR (no se ha corregido nada de esto automáticamente) ──')
    out += [f'--   · {r}' for r in review]
    print('\n'.join(out))
    print(f'{len(contacts)} contactos, {len(snap["reglas_red_flag"])} reglas, {len(review)} avisos', file=sys.stderr)


if __name__ == '__main__':
    main()

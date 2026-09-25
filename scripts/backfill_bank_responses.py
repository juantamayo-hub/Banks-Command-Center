#!/usr/bin/env python3
"""
Backfill de bank_responses con el histórico de Pipedrive.

Fuente: deals bancarios del pipeline 7 (Bayteca_Bank_Area).
  - Oferta   → deal con algún campo de oferta relleno (TIN fijo, TIN mixto, años tramo fijo,
               diferencial, vinculaciones). Fecha = primera entrada en la etapa 71 (flow del deal).
  - Rechazo  → deal perdido con motivo 30x DENEGADO. Fecha = lost_time.

Idempotente: source='backfill', external_id = pd-offer-<deal> / pd-denial-<deal>.
Se envía a POST /api/bank-responses (misma validación que n8n).

Uso:
  python3 scripts/backfill_bank_responses.py --dry-run
  python3 scripts/backfill_bank_responses.py [--api https://banks-command-center.vercel.app]

Lee PIPEDRIVE_API_TOKEN y OFFERS_API_SECRET de apps/web/.env.local.
"""

import argparse
import concurrent.futures as cf
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPELINE_BANK = 7
STAGE_OFFER = 71
OFFER_FIELDS = {
    'tin_fijo': '853b1fd58cef159817868f9199981e4c5178da84',
    'tin_mixto': '88145ad91cce2467d4889462ec1739c6fa16035e',
    'anios_fijo': '81a6c3bb7ce9d394f0b9f9361b69f2462bae8f20',
    'diferencial': 'b9ac2279b82d1e64af06788658f021cff9da3164',
    'vinculaciones': 'ea4fe934fa98f573d5d738ca0bdf51852307920a',
}
BANK_LOST_REASON_FIELD = '5af7c8a4d8341bfe53526b6a7b4e2fc793503a90'
DENIAL_OPTIONS = {'3137': '302- DENEGADO - LTV (FASE BANCARIA)',
                  '3138': '303- DENEGADO - ENDEUDAMIENTO (FASE BANCARIA)',
                  '3139': '304- DENEGADO - PERFIL DEL CLIENTE (FASE BANCARIA)',
                  '3140': '305- DENEGADO - ASNEF (FASE BANCARIA)'}

# Prefijo del título del deal bancario → slug (RESPONSE_BANKS en apps/web/src/lib/bankResponses.ts)
BANK_SLUGS = {
    'santander': 'santander', 'unicaja': 'unicaja', 'caixabank': 'caixabank', 'caixabank ofi': 'caixabank',
    'caixa': 'caixabank', 'cr teruel': 'cr_teruel', 'ibercaja': 'ibercaja', 'ing': 'ing', 'abanca': 'abanca',
    'eurocajarural': 'eurocajarural', 'bankinter': 'bankinter', 'laboral kutxa': 'laboral_kutxa',
    'myinvestor': 'myinvestor', 'deutsche bank': 'deutsche_bank', 'uci': 'uci', 'cr aragon': 'cr_aragon',
    'cr granada': 'cr_granada', 'cr asturias': 'cr_asturias', 'hipotecas.com': 'hipotecas_com',
    'sabadell': 'sabadell', 'sabadell no residente': 'sabadell', 'no bank fee': 'no_bank_fee',
    'globalcaja': 'globalcaja', 'ruralnostra': 'ruralnostra', 'cr del sur': 'cr_del_sur', 'evo': 'evo',
    'pichincha': 'pichincha', 'caixa popular': 'caixa_popular', 'cajamar': 'cajamar', 'kutxabank': 'kutxabank',
    'cr extremadura': 'cr_extremadura',
}


def env():
    lines = (ROOT / 'apps/web/.env.local').read_text().splitlines()
    return dict(l.split('=', 1) for l in lines if '=' in l and not l.startswith('#'))


def norm(s):
    s = unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s).strip().lower()


def bank_slug(title):
    m = re.match(r'\s*([^\-\[]+?)\s*-', title or '')
    if m and norm(m.group(1)) in BANK_SLUGS:
        return BANK_SLUGS[norm(m.group(1))]
    # Sin guion tras el banco ("CaixaBank🏠 ..."): el nombre más largo que encaje al inicio
    t = norm(title).lstrip('[')
    for key in sorted(BANK_SLUGS, key=len, reverse=True):
        if t.startswith(key) and (len(t) == len(key) or not t[len(key)].isalnum()):
            return BANK_SLUGS[key]
    return None


def num(v):
    if v in (None, ''):
        return None
    m = re.search(r'-?\d+(?:[.,]\d+)?', str(v))
    return float(m.group(0).replace(',', '.')) if m else None


class Pipedrive:
    def __init__(self, token):
        self.token = token

    def get(self, path):
        sep = '&' if '?' in path else '?'
        url = f'https://api.pipedrive.com/v1/{path}{sep}api_token={self.token}'
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=90) as r:
                    if r.headers.get('x-ratelimit-remaining') == '0':
                        time.sleep(2)
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(3 * (attempt + 1))
                    continue
                raise
            except Exception:
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f'Pipedrive GET falló: {path}')

    def bank_deals(self):
        deals = []
        for status in ('open', 'won', 'lost'):
            start = 0
            while True:
                d = self.get(f'deals?status={status}&start={start}&limit=500')
                deals += [x for x in (d.get('data') or []) if x.get('pipeline_id') == PIPELINE_BANK]
                pg = (d.get('additional_data') or {}).get('pagination', {})
                if not pg.get('more_items_in_collection'):
                    break
                start = pg['next_start']
        return deals

    def offer_date(self, deal):
        """Primera entrada en la etapa 71 según el flow del deal."""
        if deal['status'] == 'open' and deal['stage_id'] == STAGE_OFFER and deal.get('stage_change_time'):
            return deal['stage_change_time'], 'stage_change_time'
        first = None
        start = 0
        while start is not None and start < 2000:
            d = self.get(f"deals/{deal['id']}/flow?start={start}&limit=100")
            for it in d.get('data') or []:
                ch = it.get('data') or {}
                if it.get('object') == 'dealChange' and ch.get('field_key') == 'stage_id' \
                        and str(ch.get('new_value')) == str(STAGE_OFFER):
                    t = ch.get('log_time')
                    if t and (first is None or t < first):
                        first = t
            pg = (d.get('additional_data') or {}).get('pagination', {})
            start = pg.get('next_start') if pg.get('more_items_in_collection') else None
        if first:
            return first, 'flow'
        return deal.get('stage_change_time') or deal.get('add_time'), 'approx'


def utc(t):
    return t.replace(' ', 'T') + 'Z' if t and 'T' not in t else t


def build_offer(deal, received_at, date_source, slug):
    f = {k: deal.get(v) for k, v in OFFER_FIELDS.items()}
    anios = num(f['anios_fijo'])
    offer = {}
    if num(f['tin_fijo']) is not None:
        offer['fija'] = {'tin_bonificado': num(f['tin_fijo'])}
    if num(f['tin_mixto']) is not None or anios or num(f['diferencial']) is not None:
        offer['mixta'] = {'tin_fijo_bonificado': num(f['tin_mixto']),
                          'tramo_fijo_meses': int(anios * 12) if anios else None,
                          'euribor_diferencial_bonificado': num(f['diferencial'])}
    if f['vinculaciones']:
        offer['vinculaciones'] = [v.strip() for v in re.split(r'[,;\n]', str(f['vinculaciones'])) if v.strip()]
    return {
        'bank_slug': slug, 'source': 'backfill', 'external_id': f"pd-offer-{deal['id']}",
        'received_at': utc(received_at), 'bank_deal_id': deal['id'], 'client_name': deal.get('person_name'),
        'subject': deal.get('title'), 'resolved_by': 'backfill_pipedrive', 'match_status': 'matched',
        'classification': 'offer', 'summary': 'Histórico importado de Pipedrive (campos de oferta del deal bancario)',
        'offer': offer, 'raw_extraction': {'pipedrive_fields': f, 'date_source': date_source},
        'status': 'processed',
    }


def build_denial(deal, slug):
    reason = deal.get('lost_reason') or DENIAL_OPTIONS.get(str(deal.get(BANK_LOST_REASON_FIELD) or ''))
    return {
        'bank_slug': slug, 'source': 'backfill', 'external_id': f"pd-denial-{deal['id']}",
        'received_at': utc(deal.get('lost_time') or deal.get('update_time')), 'bank_deal_id': deal['id'],
        'client_name': deal.get('person_name'), 'subject': deal.get('title'), 'resolved_by': 'backfill_pipedrive',
        'match_status': 'matched', 'classification': 'rejection', 'lost_reason': reason,
        'summary': 'Histórico importado de Pipedrive (deal bancario perdido por denegación)',
        'raw_extraction': {'date_source': 'lost_time'}, 'status': 'processed',
    }


def post(api, secret, rows):
    req = urllib.request.Request(f'{api}/api/bank-responses', data=json.dumps({'responses': rows}).encode(),
                                 headers={'Content-Type': 'application/json', 'x-offers-secret': secret})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', default='https://banks-command-center.vercel.app')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--workers', type=int, default=4)
    args = ap.parse_args()

    e = env()
    pd = Pipedrive(e['PIPEDRIVE_API_TOKEN'].strip())
    deals = pd.bank_deals()
    print(f'Deals bancarios pipeline {PIPELINE_BANK}: {len(deals)}', flush=True)

    offers = [d for d in deals if any(str(d.get(k) or '').strip() for k in OFFER_FIELDS.values())]
    denials = [d for d in deals if d['status'] == 'lost' and (
        'DENEGADO' in (d.get('lost_reason') or '') or str(d.get(BANK_LOST_REASON_FIELD) or '') in DENIAL_OPTIONS)]
    skipped = [d['title'] for d in offers + denials if not bank_slug(d['title'])]
    print(f'Ofertas: {len(offers)} · Denegaciones: {len(denials)} · Sin banco reconocible: {len(skipped)}', flush=True)
    if args.dry_run:
        print('Ejemplos sin banco:', skipped[:10])
        return

    rows = [build_denial(d, bank_slug(d['title'])) for d in denials if bank_slug(d['title'])]
    todo = [d for d in offers if bank_slug(d['title'])]
    done = 0
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futures = {ex.submit(pd.offer_date, d): d for d in todo}
        for fut in cf.as_completed(futures):
            d = futures[fut]
            try:
                received_at, src = fut.result()
            except Exception as err:  # noqa: BLE001
                print('flow error', d['id'], err, file=sys.stderr)
                received_at, src = d.get('stage_change_time') or d.get('add_time'), 'approx'
            rows.append(build_offer(d, received_at, src, bank_slug(d['title'])))
            done += 1
            if done % 500 == 0:
                print(f'  fechas de oferta: {done}/{len(todo)}', flush=True)

    saved, errors = 0, []
    for i in range(0, len(rows), 200):
        res = post(args.api, e['OFFERS_API_SECRET'].strip(), rows[i:i + 200])
        saved += res.get('saved', 0)
        errors += res.get('errors') or []
    print(f'Guardadas: {saved}/{len(rows)} · errores: {len(errors)}', errors[:5])


if __name__ == '__main__':
    main()

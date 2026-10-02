"""
Evaluación de Alma contra el entorno de staging (preguntas reales, una conversación nueva por pregunta).

Uso:
  export ALMA_STAGING_URL=https://staging-banks-command-center.vercel.app
  export ALMA_SHARED_SECRET=...            # mismo valor que en Vercel
  export VERCEL_BYPASS=...                 # Protection Bypass for Automation del Command Center
  python3 scripts/alma-eval.py [ids separados por coma]

Comprueba por pregunta: herramientas usadas (al menos una de las esperadas, o ninguna), textos obligatorios
(all), al menos uno de (any), prohibidos (none), y que no empiece en inglés. Guarda el detalle en
scripts/alma-eval-results.json para revisión manual.
"""

import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ['ALMA_STAGING_URL'].rstrip('/')
SECRET = os.environ['ALMA_SHARED_SECRET']
BYPASS = os.environ.get('VERCEL_BYPASS', '')
EMAIL = os.environ.get('ALMA_EVAL_EMAIL', 'juan.tamayo@huspy.io')
HERE = os.path.dirname(__file__)
CASES = json.load(open(os.path.join(HERE, 'alma-evals.json')))
only = set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None


def ask(q):
    req = urllib.request.Request(
        BASE + '/api/alma/chat', method='POST', data=json.dumps({'message': q}).encode(),
        headers={'Content-Type': 'application/json', 'x-alma-secret': SECRET, 'x-alma-user-email': EMAIL,
                 'x-vercel-protection-bypass': BYPASS})
    text, tools, technical, err = '', [], None, None
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=300) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if not line.startswith('data:'):
                continue
            ev = json.loads(line[5:])
            if ev['type'] == 'text': text += ev['delta']
            elif ev['type'] == 'tool': tools.append(ev['name'])
            elif ev['type'] == 'technical': technical = ev['resumen']
            elif ev['type'] == 'error': err = ev['message']
    return {'text': text, 'tools': tools, 'technical': technical, 'error': err, 'secs': round(time.time() - t0, 1)}


def grade(c, r):
    t = r['text'].lower()
    fails = []
    if r['error']: fails.append('error: ' + r['error'])
    if c.get('tools') and not any(x in r['tools'] for x in c['tools']): fails.append(f"herramienta esperada {c['tools']} y usó {r['tools']}")
    if c.get('tools_none') and r['tools']: fails.append(f"no debía usar herramientas y usó {r['tools']}")
    for w in c.get('all', []):
        if w.lower() not in t: fails.append(f'falta "{w}"')
    if c.get('any') and not any(w.lower() in t for w in c['any']): fails.append(f"no contiene ninguno de {c['any']}")
    for w in c.get('none', []):
        if w.lower() in t: fails.append(f'contiene "{w}"')
    first = t.strip().split('\n')[0][:60]
    if any(first.startswith(p) for p in ("i'll", 'i will', 'let me', 'sure', 'the ')): fails.append('empieza en inglés')
    return fails


def run(c):
    try:
        r = ask(c['q'])
    except Exception as e:
        r = {'text': '', 'tools': [], 'technical': None, 'error': str(e), 'secs': 0}
    return c, r, grade(c, r)


todo = [c for c in CASES if not only or c['id'] in only]
results = []
with ThreadPoolExecutor(max_workers=4) as ex:
    for c, r, fails in ex.map(run, todo):
        results.append({**c, **r, 'fails': fails})
        print(f"{'✅' if not fails else '❌'} [{c['cat']}] {c['id']} ({r['secs']} s, {', '.join(r['tools']) or 'sin herramientas'}){'' if not fails else ' → ' + '; '.join(fails)}")

ok = sum(1 for r in results if not r['fails'])
print(f'\n{ok}/{len(results)} correctas ({round(100 * ok / max(len(results), 1))} %)')
json.dump(results, open(os.path.join(HERE, 'alma-eval-results.json'), 'w'), ensure_ascii=False, indent=1)

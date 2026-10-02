"""
Publicar cambios en workflows de n8n de forma segura.

Por qué: el 1-oct-2026 un PUT por API dejó "Send Dossier No Bank Fee" DESACTIVADO (su webhook dio 404 durante
~9 h) y el script de parche solo comprobaba que el contenido se había guardado. Este módulo hace siempre:
  1. GET y comprobar que no hay un borrador sin publicar de otra persona (versionId == activeVersionId).
  2. Copia de seguridad del workflow en disco.
  3. PUT con name/nodes/connections/settings.
  4. GET de verificación: publicado (versionId == activeVersionId) y ACTIVO; si estaba activo antes y ya no,
     lo reactiva (POST /activate) y vuelve a comprobar. Si no se puede, lanza error.

Uso (la clave NUNCA en el código):
    export N8N_API_KEY=...            # Settings → n8n API
    from n8n_safe_put import safe_patch
    def cambio(wf):                   # modifica wf['nodes'] / wf['connections'] in situ
        ...
    safe_patch('p9WkjPl75vFBvrAW', cambio, backup_dir='backups')
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from typing import Callable

BASE = os.environ.get('N8N_API_URL', 'https://huspy.app.n8n.cloud/api/v1')


def _req(method: str, path: str, body: dict | None = None) -> dict:
    key = os.environ.get('N8N_API_KEY')
    if not key:
        raise RuntimeError('Falta la variable de entorno N8N_API_KEY')
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'X-N8N-API-KEY': key, 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}


def safe_patch(workflow_id: str, change: Callable[[dict], None], backup_dir: str = '.', dry_run: bool = False) -> dict:
    """Aplica `change(wf)` y publica verificando que el workflow sigue publicado y activo."""
    wf = _req('GET', f'/workflows/{workflow_id}')
    if wf.get('versionId') != wf.get('activeVersionId'):
        raise RuntimeError(f'{wf["name"]}: hay un borrador sin publicar de otra persona; no se toca')
    was_active = bool(wf.get('active'))

    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, f'backup_{workflow_id}_{int(time.time())}.json')
    with open(backup, 'w') as f:
        json.dump(wf, f)

    change(wf)
    if dry_run:
        return {'name': wf['name'], 'dry_run': True, 'backup': backup}

    _req('PUT', f'/workflows/{workflow_id}', {k: wf[k] for k in ('name', 'nodes', 'connections', 'settings')})
    after = _req('GET', f'/workflows/{workflow_id}')
    if was_active and not after.get('active'):
        _req('POST', f'/workflows/{workflow_id}/activate')
        after = _req('GET', f'/workflows/{workflow_id}')
    published = after.get('versionId') == after.get('activeVersionId')
    if was_active and not after.get('active'):
        raise RuntimeError(f'{wf["name"]}: quedó DESACTIVADO tras el PUT y no se pudo reactivar (backup: {backup})')
    if not published:
        raise RuntimeError(f'{wf["name"]}: el cambio no quedó publicado (backup: {backup})')
    return {'name': after['name'], 'active': after.get('active'), 'published': published, 'backup': backup}

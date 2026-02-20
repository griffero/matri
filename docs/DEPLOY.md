# Deploy en Render

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `8080` | Puerto del servidor |
| `SPREADSHEET_ID` | (hardcoded) | ID de la hoja de Google Sheets |
| `SHEET_NAME` | `Invitados` | Nombre de la pestaña de la hoja |
| `CACHE_TTL_MS` | `15000` | TTL del cache de datos (ms) |
| `FETCH_TIMEOUT_MS` | `10000` | Timeout para fetch a Google Sheets (ms) |
| `NODE_VERSION` | `20` | Version de Node.js en Render |

## Health checks

| Endpoint | Descripción |
|----------|-------------|
| `GET /healthz` | Liveness: retorna `{ ok: true, uptime }` siempre |
| `GET /readyz` | Readiness: retorna 200 si hay cache caliente, 503 si no |

`render.yaml` configura `/healthz` como health check path.

## Filesystem efímero

Render usa filesystem efímero: los archivos escritos en disco se pierden en cada redeploy.

**Importante:** Si usas el modo editor para calibrar coordenadas (`?editor`), debes commitear `data/coords.json` antes de hacer redeploy:

```bash
git add data/coords.json
git commit -m "update: mesa coordinates"
git push
```

Si no lo haces, las coordenadas se resetean al último commit.

## Comandos

```bash
# Build
npm install

# Start
npm start

# Dev local
npm run dev

# Tests
npm test
```

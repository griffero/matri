# Google Sheets - Reglas

La app lee datos en vivo desde una hoja de Google Sheets publicada. Para que funcione correctamente, la hoja debe cumplir estas reglas.

## Columnas requeridas

| Columna | Nombre esperado | Descripción |
|---------|----------------|-------------|
| Nombre | `Nombre` | Nombre del invitado |
| +1 | `Con +1` o cualquier header con `+1` | Si trae acompañante: `Sí` o `No` |
| Mesa | `Mesa` | Mesa asignada: `Mesa 1`..`Mesa 35` o `Mesa Novios` |

La detección es flexible: primero busca por nombre de columna, luego por contenido. Pero es mejor mantener los headers exactos.

## Valores válidos

### Mesa
- `Mesa 1` a `Mesa 35`
- `Mesa Novios`
- También acepta solo el número: `1`, `5`, `35`
- Case-insensitive

### Con +1
- `Sí` (con o sin tilde) = cuenta 2 personas
- `No` o vacío = cuenta 1 persona

## Capacidades por mesa

| Tipo | Mesas | Capacidad |
|------|-------|-----------|
| Media Luna | 14, 15, 16, 17 | 20 PAX |
| Redonda | 1-5, 26-35 | 10 PAX |
| Rectangular | 6-13, 18-25 | 8 PAX |
| Novios | Mesa Novios | 15 PAX |

## Cosas que NO hacer

- No renombrar las columnas Nombre, +1, Mesa
- No reordenar columnas arbitrariamente (la detección automática puede fallar)
- No usar valores fuera de rango para Mesa (0, 36+, texto libre)
- No dejar filas con nombre vacío y mesa asignada

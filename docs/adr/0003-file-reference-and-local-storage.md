# ADR 0003 — Referencias a fuentes y persistencia local

- **Estado:** aprobado en Etapa 0; implementación/validación pendiente.
- **Fecha:** 2026-11-25.

## Contexto

En Chromium local se detectaron File System Access API y OPFS. Para una transferencia de 500 MiB, OPFS escribió y verificó 524,288,428 bytes en 4,792 ms. IndexedDB, escribiendo 32 ArrayBuffers, tardó 451 ms en el commit después de una lectura de 3,004 ms. La cuota reportada por ese perfil fue 2,669,217,365 bytes. Estas mediciones no demuestran persistencia tras reinicio ni se generalizan a otros discos/perfiles.

## Alternativas

1. Guardar solo el `File` en memoria: sin copia, pero se pierde al recargar.
2. Persistir un FileSystemHandle: no duplica el PDF; requiere Chromium, persistencia del handle y renovar permiso. El archivo puede moverse o desaparecer.
3. Copiar todo a OPFS: reabertura local y acceso por Worker, pero duplica datos, usa cuota y requiere gestionar borrado/espacio.
4. Guardar bytes completos en IndexedDB: duplica contenido; los límites de cuota y memoria son variables. No recomendado para PDFs grandes.

## Decisión propuesta

Guardar metadatos, historial delta y referencias en IndexedDB. Preferir un handle de File System Access API si se selecciona mediante el picker; verificar permiso, nombre, tamaño, fecha y disponibilidad al reabrir. No conservar contraseñas. Para una importación mediante selector HTML o arrastre, usar el `File` durante la sesión y pedir re-selección si no sobrevive a una recarga. Ofrecer una copia OPFS explícita solo si `navigator.storage.estimate()` indica margen suficiente y el usuario consiente. Nunca copiar a IndexedDB de forma predeterminada.

## Consecuencias

- Documentar claramente cuándo el usuario debe relocalizar el original.
- Detectar cuota y manejar rechazos; la estimación no garantiza la reserva.
- File System Access es una decisión de plataforma Chromium, documentada como tal.

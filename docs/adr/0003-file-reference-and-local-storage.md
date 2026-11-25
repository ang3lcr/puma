# ADR 0003 — Referencias a fuentes y persistencia local

- **Estado:** aprobado en Etapa 0; persistencia del proyecto e historial implementada en Etapa 12.
- **Fecha:** 2026-11-25.

## Contexto

En Chromium local se detectaron File System Access API y OPFS. Para una transferencia de 500 MiB, OPFS escribió y verificó 524,288,428 bytes en 4,792 ms. IndexedDB, escribiendo 32 ArrayBuffers, tardó 451 ms en el commit después de una lectura de 3,004 ms. La cuota reportada por ese perfil fue 2,669,217,365 bytes. Estas mediciones no demuestran persistencia tras reinicio ni se generalizan a otros discos/perfiles.

## Alternativas

1. Guardar solo el `File` en memoria: sin copia, pero se pierde al recargar.
2. Persistir un FileSystemHandle: no duplica el PDF; requiere Chromium, persistencia del handle y renovar permiso. El archivo puede moverse o desaparecer.
3. Copiar todo a OPFS: reabertura local y acceso por Worker, pero duplica datos, usa cuota y requiere gestionar borrado/espacio.
4. Guardar bytes completos en IndexedDB: duplica contenido; los límites de cuota y memoria son variables. No recomendado para PDFs grandes.

## Decisión

Guardar metadatos e historial delta en IndexedDB, sin bytes PDF ni handles persistentes. Para la importación actual mediante selector HTML o arrastre, usar el `File` durante la sesión y pedir que se vuelva a seleccionar tras una recarga; comprobar nombre, tamaño, huella PDF y número de páginas antes de enlazarlo. No conservar contraseñas. OPFS y handles persistentes requieren una decisión futura y consentimiento explícito; nunca copiar archivos silenciosamente.

## Implementación de Etapa 12

Se persiste un proyecto local activo en IndexedDB con una versión de esquema propia, orden, páginas, análisis y pilas de undo/redo. Los mapas se serializan como entradas y se eliminan todas las referencias `File` de documentos y comandos antes de escribir. Se autoguarda 500 ms después de un cambio y se ofrece guardado inmediato. El registro versionado incluye migración de la versión 0 a la 1; esquemas desconocidos o datos inconsistentes se rechazan sin sobrescribir el registro existente.

Esta versión no persiste `FileSystemHandle` ni bytes PDF. Tras recargar, el usuario vuelve a seleccionar los PDFs; solo se enlazan si coinciden nombre, tamaño, huella PDF y número de páginas. No se almacenan contraseñas. Se muestra la estimación de cuota del navegador y se informan explícitamente fallos de escritura y cuota agotada.

## Consecuencias

- Documentar claramente cuándo el usuario debe relocalizar el original.
- La aplicación retiene los objetos `File` solo en memoria. Tras leer metadatos conserva abierta la sesión PDF del documento activo para renderizar miniaturas; al cambiar de documento destruye la sesión anterior y vuelve a abrir el seleccionado desde el mismo `File`. No se guardan handles ni bytes en IndexedDB.
- Detectar cuota y manejar rechazos; la estimación no garantiza la reserva.
- File System Access y OPFS siguen siendo opciones futuras; no se guardan silenciosamente copias duplicadas de las fuentes.

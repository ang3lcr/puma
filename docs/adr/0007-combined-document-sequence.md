# ADR 0007 — Secuencia combinada y preservación

- **Estado:** implementado en Etapas 11 y 13, pendiente de aprobación de la Etapa 13.
- **Fecha:** 2026-11-25.

## Contexto

El proyecto importa varios PDFs y mantiene un orden global de páginas, pero hasta ahora restringía los cambios de orden a las páginas de un mismo archivo. La aplicación conserva una sola sesión PDF abierta y cada página debe seguir identificando su PDF y página fuente para renderizarse correctamente. La combinación física del contenido pertenece a una etapa posterior.

## Decisión

- La secuencia combinada es el `pageOrder` global del proyecto. Las páginas pueden intercalarse entre documentos mediante movimientos reversibles, sin reasignar `documentId` ni `sourcePageNumber`.
- El visor indica la posición global y los controles arriba/abajo mueven la página una posición en la secuencia completa. La navegación por número y las miniaturas siguen limitadas al PDF fuente activo.
- Importar añade las páginas al final del orden global. Un movimiento cambia solamente la secuencia del proyecto; no copia ni modifica archivos fuente.
- Cuando hay varios PDFs, la interfaz advierte que las firmas digitales perderán validez al exportar y que no se garantiza preservar formularios interactivos, anotaciones, marcadores, capas, adjuntos ni metadatos. Si PDF.js detectó firmas o formularios, se señalan además esos elementos.
- La exportación crea el PDF siguiendo el orden global, aplica giros y CropBox, y reabre la salida con PDF.js antes de descargarla.

## Consecuencias

- Se puede preparar y deshacer una composición intercalada manteniendo la procedencia de cada página.
- Las miniaturas permanecen agrupadas por archivo fuente; la posición combinada se muestra en el visor para no confundirla con la navegación local del PDF.
- No se afirma que las estructuras de documentos fuente se preserven en la exportación. Las firmas se invalidan; formularios, anotaciones, marcadores, capas, adjuntos y metadatos pueden no conservarse. La salida solo se descarga después de validar todas las páginas.

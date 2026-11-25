# ADR 0005 — Lectura local por rangos con PDF.js

- **Estado:** propuesta de Etapa 0; pendiente de aprobación.
- **Fecha:** 2026-11-25.

## Contexto

PDF.js 6.5.438 abrió un fixture PDF sintético de 500 MiB usando `PDFDataRangeTransport` respaldado por lecturas acotadas, obtuvo el conteo de páginas en 120 ms y pidió 131,500 bytes en dos rangos. El mismo build abrió una muestra vacía de 1,000 páginas y renderizó la primera miniatura de 153×198 px en 23 ms. En Node, lectura completa del fixture de 500 MiB tardó 225 ms y PDF.js alcanzó 565.5 MiB RSS sin una copia extra del `ArrayBuffer`.

## Alternativas

1. Leer siempre todo el `File` a `ArrayBuffer`: simple, pero eleva el pico de memoria con documentos grandes.
2. Implementar `PDFDataRangeTransport` sobre `Blob.slice()`: entrega solo rangos solicitados y mantiene la fuente local; exige atender reintentos, cancelación, longitud y errores.
3. Abrir vía URL blob sin transport personalizado: depende de los mecanismos de carga/rango que proporcione PDF.js y el navegador; no se da por hecho que `Blob` soporte rangos como servidor HTTP.

## Decisión propuesta

Adaptar `PDFDataRangeTransport` a la fuente `Blob`/`File`; toda petición se resuelve con `slice(begin,end)` y se entrega a PDF.js. Usar `isEvalSupported: false`. Mantener un fallback explícito: si el parser requiere lectura completa, estimar memoria y avisar; no leer silenciosamente un PDF de 500 MiB al hilo principal.

## Consecuencias

- El conteo y el renderizado inicial pueden evitar materializar el archivo completo, aunque el número y tamaño de rangos depende del PDF.
- Probar PDF linealizados/no linealizados, xref streams, archivos dañados, contraseña y cancelación.
- Las cifras del fixture sintético no son una garantía de latencia o rango para documentos arbitrarios.

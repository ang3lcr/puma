# ADR 0005 — Lectura local por rangos con PDF.js

- **Estado:** aprobado en Etapa 0; implementado y probado en Etapa 2 con PDF.js 6.5.438.
- **Fecha:** 2026-11-25.

## Contexto

PDF.js 6.5.438 abrió un fixture PDF sintético de 500 MiB usando `PDFDataRangeTransport` respaldado por lecturas acotadas, obtuvo el conteo de páginas en 120 ms y pidió 131,500 bytes en dos rangos. El mismo build abrió una muestra vacía de 1,000 páginas y renderizó la primera miniatura de 153×198 px en 23 ms. En Node, lectura completa del fixture de 500 MiB tardó 225 ms y PDF.js alcanzó 565.5 MiB RSS sin una copia extra del `ArrayBuffer`.

## Alternativas

1. Leer siempre todo el `File` a `ArrayBuffer`: simple, pero eleva el pico de memoria con documentos grandes.
2. Implementar `PDFDataRangeTransport` sobre `Blob.slice()`: entrega solo rangos solicitados y mantiene la fuente local; exige atender reintentos, cancelación, longitud y errores.
3. Abrir vía URL blob sin transport personalizado: depende de los mecanismos de carga/rango que proporcione PDF.js y el navegador; no se da por hecho que `Blob` soporte rangos como servidor HTTP.

## Decisión

Adaptar `PDFDataRangeTransport` a la fuente `Blob`/`File`; cada petición se resuelve con `slice(begin,end)` y se entrega a PDF.js desde el Worker local. Configurar `disableAutoFetch: true` y `disableStream: true`; usar rangos de 64 KiB. No leer silenciosamente una porción casi completa de un PDF grande.

PDF.js 6.5.438 no declara `isEvalSupported` en sus tipos ni en el bundle distribuido; no se pasa mediante un cast. El bundle fijado no contiene llamadas a `eval()` o `new Function()`, y la aplicación no inicializa Viewer ni scripting manager.

Para archivos de al menos 400 MiB, antes de leer una petición que eleve la cobertura de rangos únicos al 95 % o más, la interfaz pide confirmación; si se rechaza, cancela la carga y conserva el original. El umbral de 400 MiB redondea hacia abajo la heurística compartida de memoria (`(1.5 GiB - 300 MiB) / 3 ≈ 412 MiB`); no es garantía de memoria disponible. La referencia `File` permanece solo durante la sesión, y la contraseña no se conserva.

## Consecuencias

- El conteo y el renderizado inicial pueden evitar materializar el archivo completo, aunque el número y tamaño de rangos depende del PDF.
- La suite E2E valida PDF básico, metadatos, PDF cifrado, contraseña incorrecta/correcta, cancelación, CSP y cero solicitudes externas en el flujo de importación.
- Probar en futuras etapas PDF linealizados/no linealizados, xref streams, casos dañados complejos y rangos reales de 500 MiB en Chrome/Edge nativos.
- Las cifras del fixture sintético no son una garantía de latencia o rango para documentos arbitrarios.

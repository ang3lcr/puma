# ADR 0001 — Presupuesto y plan B para PDF grandes

- **Estado:** decisión aprobada en Etapa 0; exportación normal implementada en Etapa 13, pendiente de aprobación.
- **Fecha:** 2026-11-25.

## Contexto

pdf-lib no ofrece carga/guardado incremental. En PDFs sintéticos de 200 MiB y 500 MiB, el guardado de una página dio puntos RSS de 450.8 MiB y 1,050.8 MiB, respectivamente. El archivo de 500 MiB se copió y guardó en 751 ms; el resultado fue otro buffer de 500 MiB. El fixture contiene un stream de espacios, no imágenes escaneadas decodificadas, por lo que no representa el peor caso.

PDF.js 6.5.438 pudo leer por rangos un PDF de 500 MiB en el navegador integrado: 131,500 bytes en dos solicitudes para obtener el conteo. En Node, abrir todos los bytes de ese fixture alcanzó 565.5 MiB RSS. Las mediciones no son una garantía para PDFs arbitrarios.

## Alternativas

1. Usar pdf-lib para todas las salidas. Ventaja: manipulación directa, texto e imágenes sin rasterizar. Desventaja: buffers completos; riesgo de memoria y salida parcial.
2. Dividir la salida en varios PDFs independientes cuando una salida única exceda el presupuesto. Ventaja: mantiene cada parte verificable y reduce el pico. Desventaja: no entrega un único archivo.
3. Investigar un motor WASM incremental. Ventaja potencial: menor pico. Desventaja: costo, compatibilidad y licencia aún no validados. MuPDF está sujeto a AGPL; no se adopta sin una decisión explícita.

## Decisión propuesta

Mantener pdf-lib únicamente para exportaciones dentro del presupuesto y preservar el contenido digital. Estimar `300 MiB + 3 × max(bytes de las fuentes únicas, salida estimada por página)` y comparar con un presupuesto heurístico de 1.5 GiB por pestaña. La salida estimada suma el tamaño de cada fuente dividido por su número de páginas para cada página activa (incluidos duplicados). Rechazar si falta una fuente, hay páginas cifradas o el presupuesto se supera; exportaciones por partes corresponden a Etapa 14.

La Etapa 13 carga cada fuente única, copia páginas activas en el orden global, aplica giro y CropBox y serializa el resultado en memoria. Antes de crear la descarga, reabre el buffer completo con PDF.js y valida cantidad, geometría visible y rotación de cada página. El usuario puede cancelar entre fases; pdf-lib no expone abortabilidad de sus operaciones internas, por lo que la interfaz espera a que termine la operación en curso y descarta el resultado antes de iniciar cualquier descarga. La estimación es heurística y no sustituye las mediciones de memoria con documentos realistas en Chrome/Edge.

## Consecuencias

- Importar un archivo de 500 MiB no implica prometer exportarlo como un solo PDF.
- Los tamaños de salida se estiman con incertidumbre; imágenes y decodificación pueden aumentar memoria.
- La exportación no preserva de forma garantizada formularios, anotaciones, marcadores, capas, adjuntos ni metadatos; cualquier firma digital deja de ser válida.
- La validación funcional confirma relectura y geometría; aún falta medir el pico real con PDFs grandes/escaneados y navegadores nativos de referencia.
- Medir en Chrome/Edge de referencia antes de aprobar el límite definitivo.
- Investigar PDFium/WASM solo si el spike adicional documenta compatibilidad, licencias y una mejora medida.

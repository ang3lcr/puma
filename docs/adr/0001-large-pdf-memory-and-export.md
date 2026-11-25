# ADR 0001 — Presupuesto y plan B para PDF grandes

- **Estado:** aprobado en Etapa 0; implementación/validación pendiente.
- **Fecha:** 2026-11-25.

## Contexto

pdf-lib no ofrece carga/guardado incremental. En PDFs sintéticos de 200 MiB y 500 MiB, el guardado de una página dio puntos RSS de 450.8 MiB y 1,050.8 MiB, respectivamente. El archivo de 500 MiB se copió y guardó en 751 ms; el resultado fue otro buffer de 500 MiB. El fixture contiene un stream de espacios, no imágenes escaneadas decodificadas, por lo que no representa el peor caso.

PDF.js 6.5.438 pudo leer por rangos un PDF de 500 MiB en el navegador integrado: 131,500 bytes en dos solicitudes para obtener el conteo. En Node, abrir todos los bytes de ese fixture alcanzó 565.5 MiB RSS. Las mediciones no son una garantía para PDFs arbitrarios.

## Alternativas

1. Usar pdf-lib para todas las salidas. Ventaja: manipulación directa, texto e imágenes sin rasterizar. Desventaja: buffers completos; riesgo de memoria y salida parcial.
2. Dividir la salida en varios PDFs independientes cuando una salida única exceda el presupuesto. Ventaja: mantiene cada parte verificable y reduce el pico. Desventaja: no entrega un único archivo.
3. Investigar un motor WASM incremental. Ventaja potencial: menor pico. Desventaja: costo, compatibilidad y licencia aún no validados. MuPDF está sujeto a AGPL; no se adopta sin una decisión explícita.

## Decisión propuesta

Mantener pdf-lib únicamente para exportaciones dentro del presupuesto y preservar el contenido digital. Estimar de forma conservadora `300 MiB + 3 × max(bytes fuente, bytes de salida estimados)` y comparar con el presupuesto de 1.5 GiB por pestaña. Advertir y ofrecer exportaciones por rangos/partes cuando se exceda; rechazar una exportación única si no es segura. Nunca completar ni mostrar como válido un archivo parcial. Validar el buffer íntegro con PDF.js antes de escribirlo al destino.

## Consecuencias

- Importar un archivo de 500 MiB no implica prometer exportarlo como un solo PDF.
- Los tamaños de salida se estiman con incertidumbre; imágenes y decodificación pueden aumentar memoria.
- Medir en Chrome/Edge de referencia antes de aprobar el límite definitivo.
- Investigar PDFium/WASM solo si el spike adicional documenta compatibilidad, licencias y una mejora medida.

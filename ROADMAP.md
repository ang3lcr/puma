# Roadmap

**Estado actual:** Etapas 0–2 aprobadas; Etapa 3 completada y pendiente de aprobación. Cada etapa se desarrolla en una interacción, se valida y documenta, se crea su commit/tag y luego se detiene hasta recibir aprobación. No avanzar automáticamente.

| Etapa | Alcance | Estado |
|---|---|---|
| 0 | Análisis, arquitectura, criterios, licencias y spikes de riesgo | Completada y aprobada; commit `30071a9` |
| 1 | Vite, React, TypeScript estricto, herramientas, i18n, CSP y layout inicial | Completada y aprobada; commit `6828f3b` |
| 2 | Importación y lectura PDF, referencias a fuentes, casos cifrados y metadatos | Completada y aprobada |
| 3 | Miniaturas, virtualización, renderizado bajo demanda y caché LRU | Completada; pendiente de aprobación |
| 4 | Visor, zoom, navegación, selección, propiedades y accesibilidad | Pendiente |
| 5 | Workers, cola priorizada, cancelación, progreso y ciclo de vida | Pendiente |
| 6 | Modelo de proyecto, comandos delta y deshacer/rehacer | Pendiente |
| 7 | Reordenar, eliminar/restaurar, duplicar, rotar y mover páginas | Pendiente |
| 8 | Detección conservadora de páginas en blanco y revisión | Pendiente |
| 9 | Sugerencias y corrección de orientación, manual y masiva | Pendiente |
| 10 | Editor de márgenes, CropBox y recorte físico explícito | Pendiente |
| 11 | Combinación de documentos y limitaciones de preservación | Pendiente |
| 12 | Guardado, autoguardado, recuperación, cuotas y migraciones | Pendiente |
| 13 | Exportación normal, estimación, validación y cancelación segura | Pendiente |
| 14 | Exportación grande, división por partes y recuperación de fallos | Pendiente |
| 15 | Estrés, rendimiento, seguridad local y regresión en Chrome/Edge | Pendiente |
| 16 | Guías finales, limitaciones, instalación y distribución | Pendiente |

## Condición de salida por etapa

Ejecutar los scripts disponibles de TypeScript, lint, pruebas, build y E2E pertinentes; corregir errores; actualizar documentación y ADRs; registrar los resultados reales; crear `etapa-N-completada`; presentar informe y detenerse para aprobación.

## Sub-etapas

Si un alcance no cabe en una interacción sin omitir criterios de aceptación, presentar una propuesta de sub-etapas y esperar aprobación antes de dividirlo.

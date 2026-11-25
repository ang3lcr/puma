# Roadmap

**Estado actual:** Etapas 0–15 completadas en el entorno disponible; validaciones nativas/de hardware de Etapa 15 siguen pendientes. Etapa 16 en curso.

| Etapa | Alcance | Estado |
|---|---|---|
| 0 | Análisis, arquitectura, criterios, licencias y spikes de riesgo | Completada y aprobada; commit `30071a9` |
| 1 | Vite, React, TypeScript estricto, herramientas, i18n, CSP y layout inicial | Completada y aprobada; commit `6828f3b` |
| 2 | Importación y lectura PDF, referencias a fuentes, casos cifrados y metadatos | Completada y aprobada |
| 3 | Miniaturas, virtualización, renderizado bajo demanda y caché LRU | Completada y aprobada |
| 4 | Visor, zoom, navegación, selección, propiedades y accesibilidad | Completada y aprobada; commit `9439264` |
| 5 | Cola priorizada de render PDF, cancelación, progreso y ciclo de vida | Completada y aprobada; commit `b1d6d01` |
| 6 | Modelo de proyecto, comandos delta y deshacer/rehacer | Completada y aprobada |
| 7 | Reordenar, eliminar/restaurar, duplicar y rotar páginas dentro del documento de origen | Completada y aprobada |
| 8 | Detección conservadora de páginas en blanco y revisión | Completada y aprobada |
| 9 | Sugerencias y corrección de orientación, manual y masiva | Completada y aprobada |
| 10 | Editor de márgenes, CropBox y recorte físico explícito | Completada y aprobada |
| 11 | Combinación de documentos y limitaciones de preservación | Completada y aprobada |
| 12 | Guardado, autoguardado, recuperación, cuotas y migraciones | Completada y aprobada |
| 13 | Exportación normal, estimación, validación y cancelación segura | Completada y aprobada; commit `064402b` |
| 14 | Exportación grande, división por partes y recuperación de fallos | Completada; exportación por partes, validación individual y reintento |
| 15 | Estrés, rendimiento, seguridad local y regresión en Chrome/Edge | Suite Chromium ejecutada; mediciones Chrome/Edge nativos y hardware pendiente |
| 16 | Guías finales, limitaciones, instalación y distribución | En curso |

## Condición de salida por etapa

Ejecutar los scripts disponibles de TypeScript, lint, pruebas, build y E2E pertinentes; corregir errores; actualizar documentación y ADRs; registrar resultados reales. Crear commit y etiqueta de etapa solo si se verificaron sus criterios de aceptación.

## Sub-etapas

Si un alcance no cabe en una interacción sin omitir criterios de aceptación, presentar una propuesta de sub-etapas y esperar aprobación antes de dividirlo.

# Estrategia de pruebas y criterios propuestos

**Estado:** criterios para revisión de Etapa 0. No hay todavía una aplicación ni scripts de proyecto.

## Entorno de referencia

Objetivo a confirmar: Chrome estable en Windows, CPU de 4 núcleos, RAM de 8 GB y SSD, sin pestañas pesadas. Repetir pruebas relevantes en Edge estable. Registrar modelo y número de CPU, RAM, almacenamiento, sistema operativo, versión exacta del navegador y estado de otras aplicaciones.

El equipo medido para los spikes fue diferente: AMD Ryzen 5 2600X (6 núcleos/12 hilos), Windows 11 Pro 10.0.26200, aproximadamente 16 GiB visibles. El navegador integrado informó Electron 43.8.6/Chromium 150.0.7871.250; no se encontró instalación nativa de Chrome o Edge ni se confirmó el tipo de SSD. Estos datos no demuestran cumplimiento en el equipo de referencia.

## Criterios de rendimiento propuestos

| Métrica | Propuesta y forma de medir |
|---|---|
| Importación de PDF de 500 MB | Mostrar número de páginas en <5 s en el corpus de aceptación; registrar bytes/rangos realmente leídos. No cargar todo el archivo si PDF.js puede satisfacer la lectura por rangos. |
| Primera miniatura | <1 s desde seleccionar el documento; separar tiempo de carga fría del tiempo con caché. |
| Miniatura individual | Promedio <300 ms en lote etiquetado; informar mediana, p95 y dimensiones/resolución. |
| Hilo principal | Ninguna tarea >50 ms durante análisis o exportación; medir Long Tasks en E2E y mantener el trabajo costoso en Worker. |
| Memoria con 1,000 páginas | Pico de la pestaña <1.5 GiB en navegación. Preferir `performance.measureUserAgentSpecificMemory()` en contexto compatible; de lo contrario, DevTools/Administrador de tareas de Chrome. Medir RSS/heap/WASM por separado cuando sea posible. |
| Renderizado grande | Máximo de 3 páginas simultáneas en alta resolución; miniaturas acotadas por caché LRU en bytes. |
| Clasificación «En blanco» | 0 falsos positivos en el set etiquetado y recall ≥95 %. Ningún borrado automático; las clases ambiguas van a revisión. Reportar matriz de confusión por escaneo, texto, firma, sello, ruido, bordes y fondo. |
| Orientación | Propuesta: precisión ≥99 % entre sugerencias de alta confianza y cobertura ≥70 % en corpus etiquetado; baja confianza se marca «Requiere revisión». Corrección automática desactivada por defecto. Medir por rotación, contenido digital/escaneado y tipo de página. |
| Exportación | Reabrir cada salida con PDF.js; comprobar páginas, orden, rotaciones, CropBox y texto seleccionable en páginas no rasterizadas. Nunca presentar una salida parcial como válida. |
| Privacidad | E2E del flujo principal falla si se solicita cualquier recurso a un dominio externo. Registrar también solicitudes fallidas. |

Los umbrales de orientación, memoria y hardware deben aprobarse antes de convertirse en criterios definitivos. El spike actual no valida el clasificador de páginas en blanco ni estos umbrales de producto.

## Matriz de pruebas prevista

- **Unitarias (Vitest):** rangos PDF, conversión de unidades, UserUnit/rotación, geometría de CropBox, clasificación, comandos y deltas, parser de selección por rangos, estimación de memoria y migraciones.
- **Componentes (Testing Library):** importación/error/contraseña, selección por teclado, estados de revisión, navegación, etiquetas ARIA y anuncios `aria-live`.
- **E2E (Playwright/Chromium):** importación, análisis, rotación, márgenes, undo/redo, orden, exportación y reapertura/validación del archivo. Comprobar ausencia de tráfico externo y errores de consola.
- **Fixtures:** PDFs creados con semilla fija; páginas digitales, escaneadas y mixtas; rotaciones nativas, dimensiones variadas, página vacía, ruido, sello, firma, bordes, cifrado y texto pequeño. Los fixtures grandes se generan bajo demanda y no se suben al repositorio.
- **Estrés/perfil:** 500 y 1,000 páginas, desplazamiento rápido, caché, renderizado concurrente, cancelación y duración prolongada. Guardar hardware, navegador, versión de fixture y medidas.

## Validación efectuada en Etapa 0

Se ejecutaron spikes puntuales de Node y Chromium integrado, detallados en [el informe](./docs/stage0-spike-report.md). No se ejecutaron `npm run typecheck`, `lint`, `test`, `build` o E2E: no existe aún manifiesto ni aplicación, y la Etapa 0 prohíbe implementarlos. No declarar esos comandos como exitosos.

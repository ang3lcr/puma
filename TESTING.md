# Estrategia de pruebas y criterios propuestos

**Estado:** criterios de rendimiento aprobados en Etapa 0; validaciones de las Etapas 1–8 ejecutadas. Medición en el hardware Chrome/Edge de referencia aún pendiente.

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

Se aprobó conservar los umbrales propuestos y el objetivo de hardware (4 núcleos/8 GiB). El equipo local no es equivalente y no se encontró Chrome/Edge nativo, por lo que las métricas no se declaran cumplidas. El spike no valida el clasificador de páginas en blanco.

## Matriz de pruebas prevista

- **Unitarias (Vitest):** rangos PDF, conversión de unidades, UserUnit/rotación, geometría de CropBox, clasificación, comandos y deltas, parser de selección por rangos, estimación de memoria y migraciones.
- **Componentes (Testing Library):** importación/error/contraseña, selección por teclado, estados de revisión, navegación, etiquetas ARIA y anuncios `aria-live`.
- **E2E (Playwright/Chromium):** importación, análisis, rotación, márgenes, undo/redo, orden, exportación y reapertura/validación del archivo. Comprobar ausencia de tráfico externo y errores de consola.
- **Fixtures:** PDFs creados con semilla fija; páginas digitales, escaneadas y mixtas; rotaciones nativas, dimensiones variadas, página vacía, ruido, sello, firma, bordes, cifrado y texto pequeño. Los fixtures grandes se generan bajo demanda y no se suben al repositorio.
- **Estrés/perfil:** 500 y 1,000 páginas, desplazamiento rápido, caché, renderizado concurrente, cancelación y duración prolongada. Guardar hardware, navegador, versión de fixture y medidas.

## Validación de Etapa 1

Los spikes de Etapa 0 están detallados en [el informe](./docs/stage0-spike-report.md). Ejecución realizada en Windows 11 con Node 24.19.0, npm 11.17.0, Playwright 1.65.1 y su Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 1 archivo, 2 pruebas aprobadas |
| `npm run build` | Correcto; Vite 8.3.8, 18 módulos, JS 224.80 kB / 70.05 kB gzip y CSS 7.92 kB / 2.27 kB gzip |
| `npm run test:e2e` | 1 E2E aprobada: shell, CSP de producción, tema y cero solicitudes HTTP(S) a otros orígenes |

También se inspeccionó la vista con el Chromium integrado de VS Code/Electron: anchos de 1440 px y 390 px, sin desbordamiento horizontal; el panel de propiedades se mantiene visible en móvil. Estos navegadores Chromium no sustituyen el smoke test pendiente en instalaciones nativas de Chrome y Edge estables sobre el hardware de referencia.

El servidor dev también se probó en Chromium integrado 150.0.7871.250/Electron 43.8.6: respuesta 200, CSS aplicado y ningún error de consola o de página. Su CSP relaja scripts/estilos inline y Workers `blob:` únicamente para React Fast Refresh/HMR; la prueba E2E confirma que la política de preview no tiene esas excepciones.

## Validación de Etapa 2

Ejecución en Windows 11 con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 2 archivos, 8 pruebas aprobadas; incluye rangos válidos/incorrectos, aborto, confirmación de lectura extensa y controles UI |
| `npm run build` | Correcto; Vite 8.3.8. Shell inicial JS 236.16 kB / 73.55 kB gzip; módulo PDF.js diferido 447.26 kB / 134.89 kB gzip; Worker local 1,271.91 kB |
| `npm run test:e2e` | 3 E2E aprobadas: CSP y shell, importación local/metadatos/error de PDF inválido, contraseña incorrecta/correcta y cancelación de PDF cifrado |

La suite comprueba que no hay solicitudes HTTP(S) a otros orígenes durante la shell y la importación normal. También verifica el layout con un viewport de 390 px, sin desbordamiento horizontal y con los metadatos visibles. El módulo PDF.js se divide en un chunk que solo se solicita tras iniciar una importación; Worker y chunk se sirven desde el mismo origen.

La confirmación de lectura extensa se activa para fuentes de al menos 400 MiB cuando la unión de rangos solicitados alcanza el 95 % del archivo. Se prueba la confirmación/rechazo con blobs pequeños usando un umbral de prueba; las mediciones de memoria y tiempo con PDFs grandes, Chrome/Edge nativos y hardware de 4 núcleos/8 GiB siguen pendientes.

## Validación de Etapa 3

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, `@tanstack/react-virtual` 3.14.28, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 3 archivos, 10 pruebas aprobadas; incluye caché LRU y límite por bytes |
| `npm run build` | Correcto; shell JS 276.86 kB / 85.51 kB gzip; módulo PDF.js diferido 447.46 kB / 134.94 kB gzip; Worker local 1,271.91 kB |
| `npm run test:e2e` | 4 E2E aprobadas: CSP/shell, importación/metadatos/error y reapertura al cambiar de documento, PDF de 1.000 páginas con virtualización y render, contraseña/cancelación |

La E2E de 1.000 páginas confirma que el número de filas DOM se mantiene por debajo de 12, que se renderiza una miniatura visible y que el desplazamiento al final llega a la página 1.000. Esta prueba funcional no mide tiempos de render, memoria máxima ni cumplimiento de los umbrales de rendimiento: las mediciones en Chrome/Edge nativos y hardware de referencia continúan pendientes.

## Validación de Etapa 4

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 3 archivos, 10 pruebas aprobadas |
| `npm run build` | Correcto; shell JS 283.57 kB / 87.34 kB gzip; módulo PDF.js diferido 447.46 kB / 134.94 kB gzip; Worker local 1,271.91 kB |
| `npm run test:e2e` | 4 E2E aprobadas: CSP/shell, importación local y reapertura, visor/zoom/validación, selección y navegación con 1.000 páginas, contraseña/cancelación |

La suite comprueba render real del canvas, zoom, error de número de página, navegación por teclado, selección desde miniaturas, dimensiones/rotación y ausencia de solicitudes externas. También verifica que la página cabe en el viewport del visor al cambiar a móvil y que no hay desbordamiento horizontal del documento. La inspección visual en el navegador integrado confirma el ajuste y la presentación; no sustituye pruebas de memoria/rendimiento en Chrome/Edge nativos ni verifica las métricas de producción.

## Validación de Etapa 5

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 5 archivos, 15 pruebas aprobadas; incluye prioridad, FIFO, estados, cancelación, fallos, `dispose()` de la cola, progreso accesible y recuperación de error del visor |
| `npm run build` | Correcto; shell JS 286.81 kB / 88.25 kB gzip, CSS 15.14 kB / 3.73 kB gzip, módulo PDF.js diferido 447.46 kB / 134.94 kB gzip y Worker local 1,271.91 kB |
| `npm run test:e2e` | 4 E2E aprobadas: CSP/shell, importación local/reapertura, visor/zoom/navegación, virtualización de 1.000 páginas y contraseña/cancelación |

Las E2E confirman que el visor y las miniaturas conectados a la cola completan renders reales y mantienen la navegación/virtualización. Las pruebas unitarias verifican prioridad de página visible sobre miniaturas en espera, cancelación y liberación al destruir la cola. Esta suite no mide latencia, memoria máxima ni cancelación bajo estrés; las pruebas nativas en Chrome/Edge y el hardware de referencia siguen pendientes.

## Validación de Etapa 6

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 6 archivos, 17 pruebas aprobadas; incluye importación/undo/redo, ramas de historial, IDs de página y liberación tras cancelación |
| `npm run build` | Correcto; shell JS 291.57 kB / 89.61 kB gzip, CSS 15.61 kB / 3.78 kB gzip, módulo PDF.js diferido 447.46 kB / 134.94 kB gzip y Worker local 1,271.91 kB |
| `npm run test:e2e` | 4 E2E aprobadas; incluye importación deshecha/rehacida por botones y atajos de teclado, junto con CSP, PDF local y virtualización |

El historial no clona bytes de `File`; los comandos retienen la misma referencia y deltas de IDs/metadatos. La prueba E2E verifica también deshacer/rehacer mientras se importan y reabren documentos. La persistencia del proyecto y la edición de páginas quedan fuera de esta etapa.

## Validación de Etapa 7

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 6 archivos, 21 pruebas aprobadas; incluye movimiento con páginas eliminadas, duplicación, rotación, eliminación/restauración, deltas e historial |
| `npm run build` | Correcto; shell JS 298.61 kB / 91.57 kB gzip, CSS 16.16 kB / 3.84 kB gzip, módulo PDF.js diferido 447.46 kB / 134.94 kB gzip y Worker local 1,271.91 kB |
| `npm run test:e2e` | 5 E2E aprobadas; incluye reordenar, duplicar, girar, eliminar/restaurar y undo/redo, además de CSP, importación local, virtualización y contraseña |

El reordenamiento conserva el documento y número fuente; la rotación se refleja en miniaturas y visor, y la eliminación es lógica para permitir restauración y undo/redo. La validación no mide rendimiento/memoria en PDFs grandes ni en instalaciones nativas de Chrome/Edge; esos criterios continúan pendientes.

## Validación de Etapa 8

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm test` | 8 archivos, 28 pruebas aprobadas; incluye clasificador de píxeles, guardas de anotaciones, cancelación, cola, historial y UI |
| `npm run test:e2e` | Build correcto; 6 E2E aprobadas, incluida detección en PDF real, revisión reversible y conservación del número de páginas |

El fixture E2E confirma que una página blanca se marca como candidata y una página con texto se clasifica como contenido. Las anotaciones se envían a revisión sin rasterizar; una cancelación durante la lectura de texto detiene el análisis. El detector procesa secuencialmente y la clasificación de píxeles corre en Worker local. No se midieron falsos positivos/recall, memoria ni tareas largas: no hay corpus etiquetado y siguen pendientes las pruebas de Chrome/Edge nativos en hardware de referencia.

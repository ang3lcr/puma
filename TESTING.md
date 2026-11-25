# Estrategia de pruebas y criterios propuestos

**Estado:** criterios de rendimiento aprobados en Etapa 0; validaciones funcionales de las Etapas 1–15 ejecutadas. Las mediciones de rendimiento y memoria en Chrome/Edge nativos y hardware de referencia siguen pendientes.

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

La validación original de Etapa 8 cubrió una página blanca, una página con texto, anotaciones y cancelación. La corrección de Etapa 10 amplía esas pruebas para OCR extraíble pero visualmente blanco y fondos escaneados claros; el detector actual procesa una muestra visual de cada página, también cuando hay texto, y clasifica píxeles en un Worker local. No se midieron falsos positivos/recall, memoria ni tareas largas: no hay corpus etiquetado y siguen pendientes las pruebas de Chrome/Edge nativos en hardware de referencia.

## Validación de Etapa 9

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm test` | 10 archivos, 41 pruebas aprobadas; incluye sugerencias cardinales, entradas ambiguas, cancelación y rotaciones en lote reversibles |
| `npm run test:e2e` | Build correcto; 7 E2E aprobadas, incluida orientación de texto a 0°/90°/180°/270°, rotación nativa `/Rotate`, corrección individual/masiva, undo/redo y viewport de 390 px |

El fixture sintético valida el cálculo geométrico y los comandos de UI, no la precisión sobre documentos reales. El analizador requiere al menos 16 caracteres y una dirección cardinal con ≥90 % del texto válido; estos umbrales aún no se calibran. Páginas sin texto digital, escritura vertical, poco texto, direcciones mixtas y texto no cardinal quedan para revisión manual. No se midieron precisión/cobertura en corpus, tareas largas, memoria ni rendimiento en Chrome/Edge nativos.

## Validación de Etapa 10

Ejecución en Windows con Node 24.19.0, npm 11.17.0, PDF.js 6.5.438, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm test` | 11 archivos, 54 pruebas aprobadas; incluye conversión de CropBox y márgenes en UserUnit/cuatro rotaciones, validación de geometría, historial, clasificación por contraste y cancelación |
| `npm run test:e2e` | Build correcto; 9 E2E aprobadas, incluidas guías de recorte arrastrables y por teclado, undo/redo, fondo gris claro, OCR invisible, rotación, revisión y viewport móvil |

El fixture E2E usa un PDF con CropBox no nativa, origen no nulo y UserUnit 2; valida las dimensiones físicas y el remapeo de márgenes al girar. El arrastre actualiza una previsualización provisional y queda como un solo cambio reversible al soltar; el teclado también ajusta los lados. La detección usa luminancia de contraste y no trata texto OCR invisible como contenido, aunque no se ha calibrado con documentos reales. Las pruebas verifican el estado del proyecto y la previsualización, no la escritura de un PDF de salida: materializar y reabrir el CropBox se reserva para la Etapa 13. El editor solo contrae el área visible que expone PDF.js; no mide ni amplía hasta MediaBox. No se validó todavía en Chrome/Edge nativos ni en el hardware de referencia.

## Validación de Etapa 11

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm test` | 11 archivos, 55 pruebas aprobadas; incluye reordenamiento reversible entre fuentes y verificación de procedencia |
| `npm run test:e2e` | Build correcto; 10 E2E aprobadas, incluida composición entre dos PDFs, posición global, undo/redo y avisos de preservación |

El orden global intercalado se almacena como secuencia de páginas del proyecto, sin cambiar `documentId`, `sourcePageNumber` ni los bytes originales. Las advertencias informan que una exportación combinada puede invalidar firmas y no preservar elementos interactivos/estructurales; esta etapa aún no genera un archivo combinado. La generación y validación del PDF se reserva para la Etapa 13.

## Validación de Etapa 12

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm test` | 12 archivos, 60 pruebas aprobadas; incluye serialización sin fuentes, migración de v0 a v1, validación de registros, cuota y relink conservando undo/redo |
| `npm run test:e2e` | Build correcto; 11 E2E aprobadas, incluida recuperación después de recargar, rechazo de fuente incorrecta, verificación de huella/páginas y edición undo/redo recuperada |

El proyecto y el historial de comandos se guardan en una única entrada de IndexedDB con debounce de 500 ms y botón de guardado inmediato. El serializador elimina las referencias `File` tanto de los documentos como de las operaciones históricas; la prueba verifica que tampoco se guardan bytes fuente. Al restaurar se validan versión, orden e invariantes de páginas. Como no se persisten handles, el usuario debe re-seleccionar cada fuente y se comprueba su nombre, tamaño, huella PDF y número de páginas antes de enlazarla. La cuota estimada es informativa (no reserva espacio); las escrituras notifican errores, incluida cuota agotada. Los datos pueden ser desalojados por el navegador. No se validó retención tras reinicio en Chrome/Edge nativos ni en el hardware de referencia.

## Validación de Etapa 13

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm test` | 13 archivos, 68 pruebas aprobadas; incluye presupuesto y estimación por fuentes únicas, fuentes cifradas/faltantes y cancelación antes y durante la copia |
| `npm run build` | Correcto; shell JS 352.04 kB / 106.04 kB gzip, exportación diferida 422.87 kB / 176.79 kB gzip, importación PDF.js 447.47 kB / 134.95 kB gzip y Worker PDF.js 1,271.91 kB |
| `npm run test:e2e` | Build correcto; 12 E2E aprobadas, incluida descarga validada con CropBox/rotación, orden entre PDFs fuente, páginas duplicadas/restauradas y cancelación sin descarga |

Las E2E reabren los archivos descargados con pdf-lib y comprueban cantidad, geometría, rotación y orden global; internamente, la aplicación también valida cada salida con PDF.js antes de iniciar la descarga. La cancelación espera el término de la operación no interrumpible de pdf-lib y descarta el resultado, sin crear una descarga. Las fuentes cifradas o que faltan y el exceso sobre 1.5 GiB estimados impiden iniciar la exportación. La heurística y las pruebas con fixtures pequeños no demuestran el pico real de memoria ni cumplen el criterio de rendimiento en PDFs grandes; Chrome/Edge nativos y el hardware de referencia siguen pendientes.

## Validación de Etapa 14

Ejecución local en Windows 10.0.26200.0 con Node 24.19.0, npm 11.17.0, Playwright 1.65.1 y Chromium 159.0.8154.6:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Correcto, sin errores TypeScript |
| `npm run lint` | Correcto, sin infracciones |
| `npm run test` | 13 archivos, 73 pruebas aprobadas; incluye planificación por presupuesto/máximo de páginas, orden y exclusión de eliminadas, imposibilidad de una página individual, geometría CropBox/rotación, cancelación, error parcial y reintento desde la siguiente parte |
| `npm run build` | Correcto; Vite 8.3.8, exportación diferida 423.52 kB / 176.99 kB gzip |
| `npm run test:e2e` | Build correcto; 13 E2E aprobadas. La prueba de partes descarga 3 PDFs contiguos, reabre cada uno con pdf-lib, comprueba CropBox y localiza la rotación aplicada en la parte correspondiente; el flujo de producción valida cada salida completa con PDF.js antes de descargarla |
| `git diff --check` | Correcto |

La prueba unitaria sustituye el adaptador de apertura PDF.js por un lector simulado, porque en Vitest el `?url` del worker se resolvió como `C:\node_modules\pdfjs-dist`. La E2E ejecuta el build real y verifica la validación de cada archivo mediante PDF.js en Chromium; pdf-lib vuelve a abrir los archivos descargados en la prueba para comprobar cantidad y CropBox. Se probaron cancelación, error y reintento con fixtures pequeños, sin construir PDFs grandes. El presupuesto de 1.5 GiB y la estimación son heurísticos, no una medición ni una garantía de memoria. Chrome/Edge nativos y el equipo de referencia no están disponibles en este entorno; las métricas de hardware siguen pendientes.

La primera ejecución completa de E2E tuvo 12 aprobadas y 1 fallo porque el texto esperado en la prueba de composición quedó obsoleto tras actualizar el aviso; se corrigió la expectativa y la repetición terminó con 13/13 aprobadas. La primera variante de la aserción de giro asumía que la página girada estaría en la primera descarga; se comprobó en cambio la rotación entre las tres salidas, que pasó en la parte correspondiente. Playwright mostró la advertencia de entorno `NO_COLOR` ignorada por `FORCE_COLOR`; no afectó los resultados.

## Validación de Etapa 15

Ejecución en Windows 10.0.26200.0, Node 24.19.0 y npm 11.17.0. Playwright 1.65.1 ejecutó su Chromium 159.0.8154.6 (revisión de Playwright 1255). `Get-Command chrome,msedge` y las cuatro rutas de instalación estándar consultadas no encontraron Chrome ni Edge nativos. WMI denegó `Get-CimInstance`; no se pudo medir modelo de CPU, núcleos físicos, RAM ni almacenamiento. La variable de entorno reportó 12 procesadores lógicos, dato de entorno que no confirma el hardware físico ni satisface el objetivo de 4 núcleos/8 GiB.

| Comando/inspección | Resultado |
|---|---|
| `npm run typecheck` | Correcto |
| `npm run lint` | Correcto |
| `npm run test` | 13 archivos, 73 pruebas aprobadas; incluye colas/cancelación, limpieza de recursos, caché, persistencia/migraciones y errores de PDFs |
| `npm run build` | Correcto; build de producción local |
| `npm run test:e2e` | 14 E2E aprobadas en Chromium, incluida virtualización funcional de 1,000 páginas, CSP, cero solicitudes a otros orígenes, importación de PDF inválido, persistencia/re-vinculación, cancelación de exportación y nombres/metadatos hostiles presentados como texto |
| Chrome/Edge nativos | No encontrados en PATH ni en las rutas estándar consultadas; regresión nativa no ejecutada |
| Hardware de referencia | No verificable: WMI denegó acceso; no se infiere memoria ni núcleo físico |

Fixtures y métodos: PDFs pequeños deterministas de 1,000 páginas, CropBox, orientación, contraseña y contenido malicioso en nombre/título; la prueba de solicitudes intercepta tráfico HTTP(S) fuera del origen durante shell/importación, y la E2E inspecciona CSP de `vite preview`. El caso hostil comprueba que nombre y metadatos se muestran como texto, no crean elementos `img`/`svg`, no ejecutan el marcador XSS y no originan solicitudes externas. Las pruebas unitarias cubren cancelación, `cleanup`/`destroy` y liberación de cachés; el código revoca las URL de descarga mediante temporizador, pero ese temporizador no se midió.

La ejecución prueba regresión funcional, no es una auditoría formal de seguridad. No se midieron pico de memoria, RSS/heap/WASM, Long Tasks, latencia de importación/miniaturas ni el corpus etiquetado de clasificación/orientación. El E2E de 1,000 páginas verifica virtualización y render visible, no el umbral de 1.5 GiB. Esas métricas siguen **pendientes/no verificadas** hasta disponer de herramientas, corpus y hardware compatibles. La primera ejecución de la nueva prueba hostil falló por un selector ambiguo (`.metadata-row`); se acotó al renglón de título y la repetición pasó. Playwright siguió mostrando `NO_COLOR` ignorada por `FORCE_COLOR`.

## Validación final de Etapa 16

Se revisó consistencia entre README, roadmap, arquitectura, estrategia de pruebas, ADR 0001 y avisos de terceros. No hubo dependencias nuevas; se actualizaron los avisos para reflejarlo. La guía de Windows usa `npm.cmd`/`npx.cmd` porque este PowerShell bloquea `npm.ps1` por la directiva de ejecución. Se documentaron instalación con lockfile, scripts, uso local, recuperación/re-vinculación, exportación y errores, límites de preservación, privacidad/CSP, licencias, navegadores comprobados y pendientes, compilación y publicación estática.

Validación final desde el checkout Windows descrito arriba (con los `node_modules` existentes; no se volvió a instalar dependencias):

| Comando | Resultado |
|---|---|
| `npm.cmd --prefix C:\Users\ang3l\Documents\projects\puma run typecheck` | Correcto |
| `npm.cmd --prefix C:\Users\ang3l\Documents\projects\puma run lint` | Correcto |
| `npm.cmd --prefix C:\Users\ang3l\Documents\projects\puma run test` | 13 archivos, 73 pruebas aprobadas |
| `npm.cmd --prefix C:\Users\ang3l\Documents\projects\puma run build` | Correcto; Vite 8.3.8, 221 módulos transformados |
| `npm.cmd --prefix C:\Users\ang3l\Documents\projects\puma run test:e2e` | Build correcto; 14/14 E2E aprobadas con Chromium 159.0.8154.6 |
| `git diff --check` | Correcto |

El primer intento con `npm` directo no se pudo iniciar porque PowerShell bloqueó `npm.ps1`; se usó `npm.cmd` para las validaciones posteriores. `npm ci` y una publicación real no se ejecutaron; la instalación y distribución están documentadas, no declaradas como probadas. Se mantienen pendientes las mediciones nativas de Chrome/Edge y de hardware de referencia, además de las métricas indicadas en la Etapa 15.

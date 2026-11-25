# Changelog

## Etapa 10

- Añadido editor de márgenes físicos en milímetros que crea una CropBox por página, considerando UserUnit y la orientación cardinal efectiva. La caja se limita a la caja visible original de PDF.js; se puede restaurar con un comando reversible.
- El visor sombrea el área excluida y las miniaturas identifican páginas con CropBox ajustada. El cambio modifica el estado del proyecto, no el PDF fuente; la exportación que materializa la caja se realizará en la Etapa 13 y no se elimina ni rasteriza contenido.
- Añadidas pruebas de geometría con orígenes no nulos, UserUnit, cuatro rotaciones, validación de márgenes, historial, duplicación y flujo E2E con undo/redo, restauración, orientación y viewport móvil.
- Validación: typecheck y lint correctos; 11 archivos de pruebas unitarias/componentes y 51 pruebas aprobadas; build correcto; 8 E2E aprobadas.
- La CropBox editada solo puede reducir la caja visible original. La expansión hasta MediaBox, la escritura del PDF exportado, persistencia y validación en Chrome/Edge nativos quedan pendientes de etapas posteriores.

## Etapa 9

- Añadido análisis cancelable por página de la orientación de texto digital. Solo se sugiere un giro cuando al menos 16 caracteres válidos comparten una dirección cardinal dominante (≥90 %); escritura vertical, poco texto, direcciones mixtas, inclinación no cardinal y páginas sin texto requieren revisión.
- Se consideran la rotación nativa del PDF y la rotación actual del proyecto para calcular el giro objetivo. El análisis no altera páginas automáticamente; las sugerencias se aplican por página o en lote, con un único comando reversible.
- Añadidas selección múltiple y rotación manual masiva 90° a izquierda/derecha o 180°, además de controles individuales. Las páginas escaneadas sin texto digital se dejan a criterio manual; no se incorporó OCR.
- Validación: typecheck y lint correctos; 10 archivos de pruebas unitarias/componentes, 41 pruebas aprobadas; build correcto; 7 E2E aprobadas, incluidas las cuatro orientaciones, `/Rotate` nativo, corrección individual/masiva y viewport móvil.
- Bundle de producción: shell JS 314.94 kB / 95.28 kB gzip, CSS 19.06 kB / 4.23 kB gzip, módulo de orientación diferido 2.28 kB / 1.07 kB gzip, módulo PDF.js diferido 447.46 kB / 134.94 kB gzip y Worker local de PDF.js 1,271.91 kB.
- La precisión ≥99 % y cobertura ≥70 % no se declaran: los límites son heurísticos y no existe corpus etiquetado representativo. Las métricas de rendimiento/memoria en Chrome/Edge nativos también siguen pendientes.

## Etapa 8

- Añadido análisis local, secuencial y cancelable de páginas: texto y anotaciones se identifican antes de rasterizar; las demás páginas se renderizan a una muestra acotada y los píxeles se clasifican en un Worker local.
- Las páginas completamente blancas se marcan como posibles candidatas; contenido escaso o anotaciones requieren revisión. No se elimina ninguna página automáticamente y las decisiones manuales de conservar/confirmar son reversibles.
- La cola de render prioriza la página visible, luego el análisis y finalmente las miniaturas. Las mutaciones del proyecto se desactivan durante el análisis.
- Añadidas pruebas de clasificación, anotaciones, cancelación, registro/historial y E2E con PDF real de página vacía y texto. El porcentaje de confianza se omite: no existe corpus etiquetado para calibrarlo.
- Validación: typecheck y lint correctos; 8 archivos de pruebas unitarias/componentes, 28 pruebas aprobadas; build correcto; 6 E2E aprobadas.
- Bundle de producción: shell JS 305.58 kB / 93.33 kB gzip, CSS 17.38 kB / 4.00 kB gzip, módulo de análisis diferido 3.57 kB / 1.49 kB gzip, módulo PDF.js diferido 447.46 kB / 134.94 kB gzip y Workers locales de análisis (0.99 kB) y PDF.js (1,271.91 kB).
- Los umbrales de falsos positivos/recall siguen sin demostrarse; requieren corpus etiquetado y validación en Chrome/Edge nativos sobre el hardware de referencia.

## Etapa 7 — 2026-11-25

- Integradas operaciones reversibles para reordenar, duplicar, rotar 90° y eliminar/restaurar páginas en el documento de origen; los movimientos entre documentos quedan pospuestos a la Etapa 11.
- La selección y navegación usan IDs estables y el orden del proyecto, conservando el número de página fuente para PDF.js. Visor y miniaturas aplican el delta de rotación; las páginas eliminadas siguen visibles con una acción accesible para restaurarlas.
- Añadidas pruebas unitarias para orden e inversas con páginas eliminadas, duplicación/rotación/eliminación/restauración, historial y rechazo de movimientos entre documentos; E2E cubre el flujo de edición y undo/redo.
- Validación: typecheck y lint correctos; 6 archivos de pruebas unitarias/componentes, 21 pruebas aprobadas; build correcto; 5 E2E aprobadas.
- Bundle de producción: shell JS 298.61 kB / 91.57 kB gzip; CSS 16.16 kB / 3.84 kB gzip; módulo PDF.js diferido 447.46 kB / 134.94 kB gzip; Worker local 1,271.91 kB. Las métricas nativas de memoria/rendimiento de Chrome/Edge siguen pendientes.
- Etapa 7 aprobada antes de comenzar la Etapa 8.

## Etapa 6 — 2026-11-25

- Añadido un modelo normalizado de proyecto con IDs estables para documentos y páginas, orden de documentos y orden global de páginas.
- La importación registra documento y páginas como un comando delta reversible; el historial guarda referencias `File` y metadatos/IDs, nunca duplica bytes PDF.
- Añadidos controles y atajos Deshacer/Rehacer; al deshacer la importación activa se libera su sesión PDF, y al rehacer el documento vuelve a la lista para abrirse bajo demanda.
- La selección temporal no crea comandos; una acción nueva después de undo descarta la rama de redo.
- Validación: typecheck y lint correctos; 6 archivos de pruebas unitarias/componentes, 17 pruebas aprobadas; build correcto; 4 E2E aprobadas, incluidas undo/redo por controles y teclado, importación local, render PDF y ausencia de tráfico externo.
- Bundle de producción: shell JS 291.57 kB / 89.61 kB gzip; CSS 15.61 kB / 3.78 kB gzip; módulo PDF.js diferido 447.46 kB / 134.94 kB gzip; Worker local 1,271.91 kB. Las métricas nativas de memoria/rendimiento de Chrome/Edge siguen pendientes.
- Etapa 6 aprobada antes de comenzar la Etapa 7.

## Etapa 5 — 2026-11-25

- Añadida `PageRenderQueue`, con una tarea PDF de canvas a la vez, FIFO por prioridad, prioridad de página visible y cancelación de trabajos en espera o activos.
- Integrada la cola con visor y miniaturas. La cancelación propaga `AbortSignal` a `RenderTask.cancel()`; se espera a que el render finalice antes de limpiar la página o reutilizar el canvas. Las páginas se liberan con `page.cleanup()`.
- Añadidos estados accesibles de cola/renderizado, progreso indeterminado y errores visibles; no se muestran porcentajes de progreso no disponibles.
- Añadidas pruebas de prioridad, orden, estados, cancelación, errores y destrucción de la cola.
- Validación: typecheck y lint correctos; 5 archivos de pruebas unitarias/componentes, 15 pruebas aprobadas; build correcto; 4 E2E aprobadas, incluidas renderización real, navegación, miniaturas virtualizadas y cero tráfico externo.
- Bundle de producción: shell JS 286.81 kB / 88.25 kB gzip; CSS 15.14 kB / 3.73 kB gzip; módulo PDF.js diferido 447.46 kB / 134.94 kB gzip; Worker local 1,271.91 kB. Las métricas nativas de memoria/rendimiento de Chrome/Edge siguen pendientes.
- Etapa 5 aprobada antes de comenzar la Etapa 6.

## Etapa 4 — 2026-11-25

- Añadido visor de página única con zoom de 25–300 %, ajuste a página y renderizado local bajo demanda.
- Añadida navegación anterior/siguiente, salto a número de página con validación, navegación por flechas cuando el visor tiene foco y selección sincronizada desde miniaturas.
- Añadidas propiedades de página de solo lectura (dimensiones físicas y rotación), controles y anuncios accesibles, además de layout adaptable.
- Limitado el canvas principal a 16,777,216 píxeles y 8,192 px por lado; se puede reducir la resolución efectiva en páginas de dimensiones extremas para mantener acotada la asignación.
- Validación: typecheck y lint correctos; 3 archivos de pruebas unitarias, 10 pruebas aprobadas; build correcto; 4 E2E aprobadas para visor/render, zoom, validación de página, selección, navegación de 1.000 páginas y ausencia de tráfico externo.
- Bundle de producción: shell JS 283.57 kB / 87.34 kB gzip; módulo PDF.js diferido 447.46 kB / 134.94 kB gzip; Worker local 1,271.91 kB. Métricas de memoria/rendimiento en Chrome/Edge nativos y hardware de referencia no medidas.

## Etapa 3 — 2026-11-25

- Añadida lista de miniaturas virtualizada con `@tanstack/react-virtual`; el renderizado PDF ocurre bajo demanda para las páginas cercanas al viewport.
- Añadida caché LRU de `ImageBitmap` limitada a 64 MiB, con liberación explícita de recursos expulsados y al desmontar la aplicación.
- El renderizado se cancela al desmontar miniaturas y se llama `page.cleanup()`; al cambiar de documento se destruye la sesión PDF anterior y se reabre el seleccionado desde su `File`.
- Añadidos fixture determinista de 1.000 páginas y E2E para verificar el render, el tamaño acotado del DOM, el desplazamiento al final y la miniatura de la última página.
- Validación: typecheck y lint correctos; 3 archivos de pruebas unitarias, 10 pruebas aprobadas; build de producción correcto; 4 E2E aprobadas en Chromium.
- El bundle de producción incluye shell JS de 276.86 kB / 85.51 kB gzip, módulo PDF.js diferido de 447.46 kB / 134.94 kB gzip y Worker local de 1,271.91 kB. No se declaran validadas las métricas de Chrome/Edge nativos en hardware de 4 núcleos/8 GiB.
- Etapa 3 aprobada antes de comenzar la Etapa 4.

## Etapa 1 — 2026-11-25

- Inicializada la base Vite, React y TypeScript estricto con ESLint, Vitest, Testing Library y Playwright.
- Añadida shell de escritorio en español con tema oscuro inicial, alternancia de tema y paneles accesibles.
- Definida CSP de desarrollo/preview y cabeceras para hosting estático compatible.
- Añadidas pruebas unitarias, de componentes y E2E; typecheck, lint, test, build y E2E aprobados.
- Confirmado el smoke test de Vite dev en Chromium integrado y la CSP estricta de producción en Playwright.
- Etapa 1 aprobada; commit `6828f3b`, tag `etapa-1-completada`.

## Etapa 2 — 2026-11-25

- Integrada la dependencia PDF.js 6.5.438 y su Worker local, cargados al iniciar una importación.
- Añadida importación múltiple mediante selector/arrastre, lectura de rangos con `Blob.slice()` y progreso.
- Leídos número de páginas y metadatos filtrados; incluidos indicadores de cifrado, formularios y firmas.
- Añadida solicitud de contraseña sin persistirla, reintento con contraseña incorrecta y cancelación explícita.
- Añadida confirmación antes de leer casi todo un PDF de 400 MiB o más; desactivadas precarga y lectura en streaming de PDF.js.
- Los originales no se modifican; la referencia `File` se mantiene solo durante la sesión y el `PDFDocumentLoadingTask` se destruye tras leer metadatos.
- Añadidas pruebas de transporte por rangos, fallos, importación local, metadatos, cifrado, contraseña y cancelación.
- Etapa 2 aprobada antes de empezar miniaturas y renderizado.

## Etapa 0 — 2026-11-25

- Añadida propuesta de arquitectura, roadmap, estrategia de pruebas, avisos de licencias y decisiones ADR.
- Medidos spikes de pdf-lib, PDF.js, acceso por rangos, almacenamiento local, OpenCV.js y orientación OSD sintética.
- No se creó todavía la aplicación ni se fijaron dependencias de producción.
- Pendiente de aprobación del hardware de referencia y de los umbrales propuestos antes de iniciar la Etapa 1.

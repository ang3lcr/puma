# Changelog

## Etapa 3 — 2026-11-25

- Añadida lista de miniaturas virtualizada con `@tanstack/react-virtual`; el renderizado PDF ocurre bajo demanda para las páginas cercanas al viewport.
- Añadida caché LRU de `ImageBitmap` limitada a 64 MiB, con liberación explícita de recursos expulsados y al desmontar la aplicación.
- El renderizado se cancela al desmontar miniaturas y se llama `page.cleanup()`; al cambiar de documento se destruye la sesión PDF anterior y se reabre el seleccionado desde su `File`.
- Añadidos fixture determinista de 1.000 páginas y E2E para verificar el render, el tamaño acotado del DOM, el desplazamiento al final y la miniatura de la última página.
- Validación: typecheck y lint correctos; 3 archivos de pruebas unitarias, 10 pruebas aprobadas; build de producción correcto; 4 E2E aprobadas en Chromium.
- El bundle de producción incluye shell JS de 276.86 kB / 85.51 kB gzip, módulo PDF.js diferido de 447.46 kB / 134.94 kB gzip y Worker local de 1,271.91 kB. No se declaran validadas las métricas de Chrome/Edge nativos en hardware de 4 núcleos/8 GiB.
- Pendiente la aprobación de Etapa 3 antes de empezar el visor y la navegación de Etapa 4.

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
- Pendiente la aprobación de Etapa 2 antes de empezar miniaturas y renderizado.

## Etapa 0 — 2026-11-25

- Añadida propuesta de arquitectura, roadmap, estrategia de pruebas, avisos de licencias y decisiones ADR.
- Medidos spikes de pdf-lib, PDF.js, acceso por rangos, almacenamiento local, OpenCV.js y orientación OSD sintética.
- No se creó todavía la aplicación ni se fijaron dependencias de producción.
- Pendiente de aprobación del hardware de referencia y de los umbrales propuestos antes de iniciar la Etapa 1.

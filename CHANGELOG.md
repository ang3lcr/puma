# Changelog

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

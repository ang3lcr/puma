# Document Studio

Document Studio es una aplicación de escritorio web, local y sin backend para revisar, organizar y exportar documentos PDF, incluidos escaneos.

## Estado

**Etapa 11 completada, pendiente de aprobación.** La aplicación importa PDFs locales con PDF.js, muestra miniaturas virtualizadas y un visor de página única con zoom, navegación por teclado o número, selección desde miniaturas y propiedades de página. El proyecto mantiene documentos y páginas con IDs estables y un orden global; importar, reordenar, duplicar, rotar, recortar y eliminar/restaurar páginas son operaciones reversibles con controles Deshacer/Rehacer y atajos Ctrl/Cmd+Z y Ctrl/Cmd+Shift+Z. Se sugieren giros cuando la dirección del texto digital es coherente; las páginas escaneadas o ambiguas requieren revisión. Los giros manuales, aplicar una sugerencia, rotar una selección y ajustar los márgenes de una página son acciones explícitas y reversibles. El editor convierte márgenes físicos en milímetros a una CropBox en coordenadas PDF, admite UserUnit y giros cardinales, y permite arrastrar sus cuatro guías o ajustarlas con teclado/campos numéricos. El visor sombrea el área excluida. El recorte solo puede reducir la caja visible original; no revela contenido que ya estuviera fuera de ella. El orden global del proyecto define la composición de varios PDFs: se pueden intercalar páginas de distintas fuentes sin cambiar su origen ni sus números fuente. La composición es reversible y no escribe los archivos originales; se advierte que firmas pueden invalidarse y que elementos interactivos/estructurales pueden no preservarse. La exportación del PDF combinado se reserva para la Etapa 13. Una cola serializa los renderizados, prioriza la página visible, luego el análisis y finalmente las miniaturas. El render del visor limita el canvas a 16,777,216 píxeles y 8,192 px por lado; la caché de miniaturas se limita a 64 MiB. La detección de páginas posiblemente vacías analiza el contraste visual, no confía en texto extraído por sí solo y requiere confirmación manual; nunca elimina páginas. La orientación no está validada con un corpus etiquetado; persistencia y exportación siguen pendientes.

## Revisión

- [Informe de Etapa 0](./docs/stage0-spike-report.md): entorno y resultados medidos.
- [Arquitectura propuesta](./ARCHITECTURE.md): procesamiento, datos, memoria, almacenamiento y seguridad.
- [Roadmap](./ROADMAP.md): etapas 0–16 y criterios de parada.
- [Estrategia de pruebas](./TESTING.md): métricas propuestas y validación.
- [ADRs](./docs/adr/): decisiones técnicas propuestas.
- [Avisos de terceros](./THIRD_PARTY_NOTICES): licencias revisadas de candidatos.

## Principios

- Los archivos originales permanecen en el equipo y no se envían a servicios externos.
- Importar y analizar no debe reconstruir ni modificar el PDF original.
- Las operaciones de página se guardan como cambios del proyecto; exportar es un paso separado y verificable.
- Una detección de baja confianza requiere revisión. Nunca se eliminan páginas automáticamente.
- Si no es seguro generar un único PDF grande, se informa y se ofrecen partes válidas en lugar de producir un archivo incompleto.

## Desarrollo local

Requiere Node.js compatible con Vite 8 (20.19+ o 22.12+).

```powershell
npm install
npx playwright install chromium
npm run dev
```

Instalar Chromium una sola vez es necesario para ejecutar la suite E2E.

Scripts de validación:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

La suite E2E usa Playwright Chromium y prueba el build de producción mediante `vite preview`. Para un hosting estático, `public/_headers` define las cabeceras CSP y de seguridad en proveedores que soportan ese formato; en otros hostings hay que configurar las mismas cabeceras HTTP. El servidor de desarrollo permite recursos inline/blob solo para React Fast Refresh y HMR de Vite; preview y producción no permiten `unsafe-inline` ni Workers `blob:`.

## Importación local

Selecciona uno o varios PDFs o arrástralos al espacio de trabajo. PDF.js lee rangos desde el `File` original y mantiene su procesamiento en el equipo. La aplicación solicita la contraseña de documentos cifrados sin guardarla; metadatos y nombres se muestran como texto. Si un PDF de al menos 400 MiB requiere leer el 95 % o más del archivo, se solicita confirmación antes de continuar.

La referencia al `File` dura solo durante la sesión. El historial conserva referencias a los archivos y deltas pequeños de metadatos/IDs, no copias de los bytes PDF. Solo el documento activo conserva una sesión PDF abierta; al cambiar de documento se libera la sesión anterior y se vuelve a abrir el nuevo desde su `File`. Al recargar el navegador hay que volver a seleccionar los archivos; persistencia de handles y recuperación pertenecen a la Etapa 12. La lista virtualiza páginas y genera miniaturas visibles bajo demanda. La cola permite un render PDF a la vez; da prioridad a la página visible, después al análisis y luego a miniaturas, e informa estados de espera/renderizado. La detección renderiza una muestra reducida de cada página, incluso si contiene texto extraíble, para no confundir OCR invisible con contenido visible. El clasificador estima el fondo por luminancia: fondos claros uniformes pueden ser vacíos, mientras que páginas oscuras, marcas escasas y anotaciones requieren revisión manual. Las decisiones son reversibles y nunca hay eliminación automática; el clasificador aún no está calibrado con un corpus etiquetado. La secuencia de páginas puede intercalar varias fuentes y cada página conserva su documento y número de origen. Se pueden duplicar, rotar, editar márgenes/CropBox, eliminar o restaurar páginas; todas estas operaciones se pueden deshacer. El recorte se muestra como un área sombreada con guías arrastrables y accesibles por teclado, y se limita a la caja visible que informa PDF.js; la exportación para materializar la CropBox y crear el PDF combinado pertenece a la Etapa 13. La interfaz advierte que la exportación puede invalidar firmas y no garantiza preservar formularios, anotaciones, marcadores, capas, adjuntos ni metadatos. La caché LRU mantiene hasta 64 MiB de `ImageBitmap` y libera recursos expulsados o al cerrar la aplicación. Importar y editar el proyecto no modifica el original ni crea una exportación.

## Alcance de las etapas

El diseño y las decisiones de la Etapa 0 fueron aprobados. Se conservan el objetivo de prueba de 4 núcleos/8 GiB y los umbrales de [TESTING.md](./TESTING.md), que todavía deben validarse en Chrome/Edge cuando ese hardware/navegador esté disponible. Las Etapas 1–10 entregaron shell, importación local, miniaturas virtualizadas, visor accesible, cola de render PDF, modelo/historial, operaciones de páginas, detección conservadora, sugerencias de orientación y editor explícito de CropBox; persistencia y exportación siguen pendientes.

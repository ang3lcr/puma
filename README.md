# Document Studio

Document Studio es una aplicación de escritorio web, local y sin backend para revisar, organizar y exportar documentos PDF, incluidos escaneos.

## Estado

**Etapas 0–16 implementadas.** La regresión disponible se ejecutó en Windows con Chromium de Playwright; las mediciones en Chrome/Edge nativos y hardware de referencia siguen pendientes. La aplicación importa PDFs locales con PDF.js, muestra miniaturas virtualizadas y un visor de página única con zoom, navegación por teclado o número, selección desde miniaturas y propiedades de página. El proyecto mantiene documentos y páginas con IDs estables y un orden global; importar, reordenar, duplicar, rotar, recortar y eliminar/restaurar páginas son operaciones reversibles con controles Deshacer/Rehacer y atajos Ctrl/Cmd+Z y Ctrl/Cmd+Shift+Z. Se sugieren giros cuando la dirección del texto digital es coherente; las páginas escaneadas o ambiguas requieren revisión. Los giros manuales, aplicar una sugerencia, rotar una selección y ajustar los márgenes de una página son acciones explícitas y reversibles. El editor convierte márgenes físicos en milímetros a una CropBox en coordenadas PDF, admite UserUnit y giros cardinales, y permite arrastrar sus cuatro guías o ajustarlas con teclado/campos numéricos. El visor sombrea el área excluida. El recorte solo puede reducir la caja visible original; no revela contenido que ya estuviera fuera de ella. El orden global del proyecto define la composición de varios PDFs: se pueden intercalar páginas de distintas fuentes sin cambiar su origen ni sus números fuente. La exportación incluye páginas activas, aplica orden/rotación/CropBox y valida con PDF.js cada archivo completo antes de descargarlo. La salida normal respeta el presupuesto heurístico de 1.5 GiB; si requiere división, informa los rangos globales y puede limitar el máximo de páginas por parte. Una página que supera el presupuesto por sí sola se rechaza. Se advierte que las firmas pierden validez y que no se garantiza conservar elementos interactivos/estructurales. Los documentos y cambios solo permanecen en memoria durante la sesión. Al cerrar o recargar la aplicación, el proyecto de trabajo se pierde. Una cola serializa los renderizados, prioriza la página visible, luego el análisis y finalmente las miniaturas. El render del visor limita el canvas a 16,777,216 píxeles y 8,192 px por lado; la caché de miniaturas se limita a 64 MiB. La detección de páginas posiblemente vacías analiza el contraste visual, no confía en texto extraído por sí solo y requiere confirmación manual; nunca elimina páginas. La orientación no está validada con un corpus etiquetado.

## Exportación por partes

Si una salida única supera el presupuesto heurístico, Document Studio propone PDFs separados con rangos contiguos del orden global. También se puede fijar un máximo de páginas por parte. Cada archivo se genera y reabre con PDF.js antes de iniciar su descarga; una cancelación o un error conserva las partes ya completadas y permite reintentar desde la primera pendiente. Si una sola página no cabe según la estimación, la exportación se rechaza. El límite de 1.5 GiB y la estimación `300 MiB + 3 × max(fuentes únicas, salida estimada)` son heurísticos, no garantías de memoria.

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

## Privacidad y licencias

La aplicación no usa backend, telemetría ni recursos de terceros. Los PDF se leen desde los archivos seleccionados en el navegador; La aplicación no conserva proyectos ni archivos anteriores entre sesiones. La CSP de producción restringe recursos al mismo origen y deshabilita objetos y scripts inline. Revisa [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES) y conserva los avisos/LICENSE de las dependencias al distribuir. Estos controles describen la implementación; no constituyen una auditoría formal de seguridad.

## Desarrollo local

Requiere Node.js compatible con Vite 8 (20.19+ o 22.12+).

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run dev
```

Instalar Chromium una sola vez es necesario para ejecutar la suite E2E.

Se usan los ejecutables `.cmd` para que los comandos funcionen en PowerShell aunque la directiva local bloquee scripts `npm.ps1`/`npx.ps1`.

Scripts de validación:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:watch
```

La suite E2E usa Playwright Chromium y prueba el build de producción mediante `vite preview`. Para un hosting estático, `public/_headers` define las cabeceras CSP y de seguridad en proveedores que soportan ese formato; en otros hostings hay que configurar las mismas cabeceras HTTP. El servidor de desarrollo permite recursos inline/blob solo para React Fast Refresh y HMR de Vite; preview y producción no permiten `unsafe-inline` ni Workers `blob:`.

## Distribuir

En Windows, con Node.js 20.19+ (o 22.12+) y npm, ejecuta `npm.cmd ci` y `npm.cmd run build`. Publica el contenido de `dist/` en un hosting estático que sirva la aplicación y sus assets desde el mismo origen. Configura en el servidor las cabeceras definidas en `public/_headers` si el proveedor no las aplica automáticamente. Comprueba la compilación con `npm.cmd run preview`; no uses el servidor de desarrollo para distribución.

Al redistribuir, incluye [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES) y conserva los archivos LICENSE/NOTICE de las dependencias incluidas. Los avisos enumeran las licencias revisadas y no constituyen una auditoría legal. El soporte objetivo de producto es Chrome y Edge de escritorio en sus dos últimas versiones estables; este objetivo todavía no está validado en instalaciones nativas. La única regresión de navegador ejecutada aquí fue Chromium 159.0.8154.6 distribuido por Playwright 1.65.1 en Windows 10.0.26200.0. No se verificaron otras plataformas.

## Importación local

Selecciona uno o varios PDFs o arrástralos al espacio de trabajo. PDF.js lee rangos desde el `File` original y mantiene su procesamiento en el equipo. La aplicación solicita la contraseña de documentos cifrados sin guardarla; metadatos y nombres se muestran como texto. Si un PDF de al menos 400 MiB requiere leer el 95 % o más del archivo, se solicita confirmación antes de continuar.

El historial de edición conserva en memoria los cambios y referencias a los archivos abiertos; al cerrar o recargar, el proyecto de trabajo se pierde y hay que importar de nuevo los PDF. Solo el documento activo conserva una sesión PDF abierta; al cambiar de documento se libera la sesión anterior y se vuelve a abrir el nuevo desde su `File`. La lista virtualiza páginas y genera miniaturas visibles bajo demanda. La cola permite un render PDF a la vez; da prioridad a la página visible, después al análisis y luego a miniaturas, e informa estados de espera/renderizado. La detección renderiza una muestra reducida de cada página, incluso si contiene texto extraíble, para no confundir OCR invisible con contenido visible. El clasificador estima el fondo por luminancia: fondos claros uniformes pueden ser vacíos, mientras que páginas oscuras, marcas escasas y anotaciones requieren revisión manual. Las decisiones son reversibles y nunca hay eliminación automática; el clasificador aún no está calibrado con un corpus etiquetado. La secuencia de páginas puede intercalar varias fuentes y cada página conserva su documento y número de origen. Se pueden duplicar, rotar, editar márgenes/CropBox, eliminar o restaurar páginas; todas estas operaciones se pueden deshacer. El recorte se muestra como un área sombreada con guías arrastrables y accesibles por teclado, y se limita a la caja visible que informa PDF.js. La exportación materializa ese recorte en las páginas copiadas. El presupuesto usa `300 MiB + 3 × max(fuentes únicas, salida estimada)` con límite heurístico de 1.5 GiB; PDF.js reabre y comprueba la salida antes de descargarla. pdf-lib no admite cancelar una operación interna en curso; la interfaz espera su finalización y descarta el resultado si se solicitó cancelar. La exportación por partes valida cada salida antes de descargarla y permite reintentar las partes pendientes. La interfaz advierte que la exportación invalida firmas y no garantiza preservar formularios, anotaciones, marcadores, capas, adjuntos ni metadatos. La caché LRU mantiene hasta 64 MiB de `ImageBitmap` y libera recursos expulsados o al cerrar la aplicación. Importar y editar el proyecto no modifica el original; solo la exportación crea una descarga.

## Alcance de las etapas

El diseño y las decisiones de la Etapa 0 fueron aprobados. Se conservan el objetivo de prueba de 4 núcleos/8 GiB y los umbrales de [TESTING.md](./TESTING.md), que todavía deben validarse en Chrome/Edge cuando ese hardware/navegador esté disponible. Las Etapas 1–16 entregaron shell, importación local, miniaturas virtualizadas, visor accesible, cola de render PDF, modelo/historial, operaciones de páginas, detección conservadora, sugerencias de orientación, editor explícito de CropBox, exportación normal y por partes, pruebas funcionales de regresión y guías finales. Las métricas de hardware/navegadores de referencia siguen pendientes según TESTING.md.

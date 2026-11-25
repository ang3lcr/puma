# Document Studio

Document Studio es una aplicación de escritorio web, local y sin backend para revisar, organizar y exportar documentos PDF, incluidos escaneos.

## Estado

**Etapa 5 completada, pendiente de aprobación.** La aplicación importa PDFs locales con PDF.js, muestra miniaturas virtualizadas y un visor de página única con zoom, navegación por teclado o número, selección desde miniaturas y propiedades de página. Una cola serializa los renderizados, prioriza la página visible sobre miniaturas en espera y cancela el trabajo al cambiar de página o salir de la ventana virtual. El render del visor limita el canvas a 16,777,216 píxeles y 8,192 px por lado; la caché de miniaturas se limita a 64 MiB. No modifica páginas ni exporta documentos.

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

La referencia al `File` dura solo durante la sesión. Solo el documento activo conserva una sesión PDF abierta; al cambiar de documento se libera la sesión anterior y se vuelve a abrir el nuevo desde su `File`. Al recargar el navegador hay que volver a seleccionar los archivos; persistencia de handles y recuperación pertenecen a la Etapa 12. La lista virtualiza páginas y genera miniaturas visibles bajo demanda. La cola permite un render PDF a la vez; da prioridad a la página visible, informa estados de espera/renderizado y cancela tareas al navegar o desmontar miniaturas. Se puede seleccionar una miniatura, navegar por número o flechas, y ajustar el zoom entre 25 % y 300 % o a página. Las propiedades muestran dimensiones físicas y rotación. La caché LRU mantiene hasta 64 MiB de `ImageBitmap` y libera recursos expulsados o al cerrar la aplicación. Importar no modifica el original ni crea una exportación.

## Alcance de las etapas

El diseño y las decisiones de la Etapa 0 fueron aprobados. Se conservan el objetivo de prueba de 4 núcleos/8 GiB y los umbrales de [TESTING.md](./TESTING.md), que todavía deben validarse en Chrome/Edge cuando ese hardware/navegador esté disponible. Las Etapas 1–5 entregaron shell, importación local, miniaturas virtualizadas, visor accesible y cola de render PDF; aún no hay edición ni exportación.

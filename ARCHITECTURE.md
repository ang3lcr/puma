# Arquitectura propuesta

**Estado:** arquitectura base aprobada en Etapa 0; Etapas 1–12 aprobadas y Etapa 13 implementada, pendiente de aprobación. La exportación por partes sigue pendiente.

## Alcance técnico

- Aplicación cliente con React, TypeScript estricto y Vite; sin backend, API, telemetría ni recursos de terceros en tiempo de ejecución.
- Navegadores de producto: Chrome y Edge de escritorio, últimas dos versiones estables. El navegador integrado medido en el spike es Electron/Chromium y no sustituye la validación en esos productos.
- PDF.js 6.5.438 para lectura, metadatos, renderizado y validación de exportaciones; pdf-lib 1.17.1 para generar PDFs dentro del presupuesto de memoria.
- El Worker local de PDF.js atiende la lectura PDF; `PageRenderQueue` serializa los trabajos que usan canvas, prioriza la página visible, luego el análisis y finalmente las miniaturas, y propaga cancelación. La Etapa 8 clasifica muestras de píxeles en un Worker local y no carga OpenCV.
- IndexedDB conserva un proyecto local activo, sus metadatos y el historial delta. Los objetos `File`, bytes PDF, contraseñas y handles no se serializan. Tras recargar, el usuario vuelve a seleccionar las fuentes y se verifican por nombre, tamaño, huella PDF y número de páginas.

## Límites establecidos por los spikes

1. **PDF.js:** para fuentes locales usar un `PDFDataRangeTransport` que responda las solicitudes de PDF.js con `Blob.slice()`. La implementación usa rangos de 64 KiB, desactiva precarga automática y streaming, y confirma antes de satisfacer rangos que llevarían a leer al menos el 95 % de un archivo de 400 MiB o más. El umbral es una protección heurística, no una garantía de memoria. En un PDF sintético de 500 MiB, el spike leyó 131,500 bytes en dos rangos y obtuvo el número de páginas en 120 ms; no se garantiza el mismo volumen para todos los PDF.
2. **pdf-lib:** no es una solución de streaming. La copia y el guardado mantienen buffers completos. En el fixture de 500 MiB se midieron 1,050.8 MiB RSS en el punto de guardado. La exportación estima `300 MiB + 3 × max(bytes fuente únicos, salida estimada por página)` y rechaza el trabajo si excede 1.5 GiB; es una cota heurística, no una garantía. La estimación no sustituye mediciones con PDFs realistas en Chrome/Edge. La exportación por partes se reserva para la Etapa 14.
3. **OpenCV.js:** no se propone como dependencia inicial. En el spike, el archivo pesó 13.3 MB (3.76 MB gzip), tardó 338 ms en inicializarse en Worker y fue más lento que un bucle sencillo sobre `ImageData` para umbralizar y contar 4.19 MP. Se comienza con operaciones locales de píxeles; reconsiderar OpenCV si una operación concreta demuestra una mejora medida.
4. **Tesseract OSD:** candidato opcional, de carga diferida y totalmente local. En cuatro imágenes sintéticas corrigió las cuatro orientaciones, pero tardó 367–936 ms por página y requiere un núcleo legacy y datos OSD. No habilitar correcciones automáticas basándose solo en ese conjunto.
5. **Almacenamiento:** guardar automáticamente el estado y el historial delta del proyecto en IndexedDB, con guardado inmediato opcional, versión de esquema y migración. No persistir los PDFs ni handles; después de recargar se solicitan de nuevo las fuentes y se valida su huella antes de reabrirlas. OPFS y handles persistentes quedan fuera de esta etapa.

Los detalles y las limitaciones de los experimentos están en [el informe](./docs/stage0-spike-report.md) y en los [ADRs](./docs/adr/).

## Componentes previstos

```text
src/
  app/                 composición de la aplicación y navegación
  components/          controles accesibles compartidos
  features/
    documents/         importación, metadatos y referencias a fuentes
    pages/             lista virtualizada, visor y selección
    blank-detection/   clasificación conservadora y revisión
    orientation/       análisis de texto, sugerencias y corrección manual/masiva
    margins/           márgenes físicos, geometría CropBox y previsualización
    merging/           orden y composición lógica
    export/            estimación, generación y validación
    projects/          guardado, recuperación y migraciones
  i18n/                catálogo español; sin textos de UI incrustados
  pdf/                 adaptadores PDF.js/pdf-lib, cola de render y geometría
  storage/             persistencia IndexedDB y referencias de proyecto
  workers/             análisis visual futuro y mensajes tipados
  store/               estado normalizado y comandos con deltas
  types/               contratos del dominio y mensajes Worker
  utils/
  tests/
scripts/
  generate-fixtures/   fixtures pequeños deterministas; grandes bajo demanda
docs/
  adr/
```

La lista larga se virtualiza con `@tanstack/react-virtual`; se renderizan miniaturas bajo demanda al entrar en la ventana visible y se cancelan al salir. `PageRenderQueue` mantiene una sola tarea PDF de render activa, conserva FIFO dentro de cada prioridad y adelanta la página visible a las miniaturas que siguen en espera. Al cancelar un trabajo activo aborta su `RenderTask` de PDF.js y espera su finalización antes de usar otro canvas. La interfaz expone espera, renderizado con progreso indeterminado y errores; no inventa porcentajes de progreso. La selección de miniatura se mantiene sincronizada con el visor de una página, que permite zoom de 25–300 %, ajuste a página y navegación por controles, número o flechas cuando el visor tiene foco. Las páginas se pueden reordenar en la secuencia combinada con controles accesibles, incluso entre documentos fuente; cada página mantiene su relación con el PDF y el número de origen. También se pueden duplicar, rotar 90° por vez y eliminar/restaurar sin alterar los archivos originales. Las miniaturas siguen agrupadas por documento fuente y el visor indica la posición global. Presenta dimensiones físicas y rotación efectiva. El canvas principal está limitado a 16,777,216 píxeles y 8,192 px por lado para acotar memoria; la resolución puede reducirse al alcanzar esos límites. La caché LRU de miniaturas mantiene hasta 64 MiB de `ImageBitmap`, contabilizados a 4 bytes por píxel, y cierra los recursos al expulsarlos o desmontar la aplicación. Al desmontar una miniatura se cancela el renderizado y se llama `page.cleanup()`; al cambiar de documento se destruye el `PDFDocumentLoadingTask` anterior.

## Modelo de dominio

- **Documento:** ID estable, nombre tratado como texto no confiable, tamaño, fecha de modificación, cantidad de páginas, metadatos filtrados, indicadores de cifrado/firmas/formularios y referencia reabrible a la fuente.
- **Página:** ID estable propio, documento y número de origen, rotación nativa, rotación solicitada por el usuario, CropBox modificada en coordenadas PDF (nula significa conservar la caja visible original), UserUnit, dimensiones, tipo de contenido, análisis con confianza, estado de eliminación y estado de modificación. Los márgenes se editan en milímetros y se convierten usando UserUnit y rotación cardinal. La caja solo puede reducir el área visible que PDF.js expone; no se amplía sobre la caja original ni se modifica el contenido/fuente. El modelo conserva los deltas de rotación y CropBox como comandos reversibles; en duplicados se hereda el recorte. `documentId` y `sourcePageNumber` mantienen la procedencia; el `pageOrder` global permite intercalar páginas para la composición sin reasignar ni copiar la fuente.
- **Proyecto:** ID estable, documentos y páginas normalizados por ID, orden de documentos y orden global de páginas. La selección temporal permanece fuera del historial. En memoria, los documentos conservan una referencia al `File`; el formato persistido omite el archivo y sus bytes.
- **Comando:** delta reversible `forward`/`inverse`; importar un documento añade sus registros y páginas en una entrada de historial. Undo/redo mueve el comando entre pilas y una nueva acción descarta la rama de redo.

## Flujo de datos

1. Importar uno o varios archivos sin alterar el original. PDF.js lee rangos y obtiene metadatos; el conteo de páginas no requiere renderizar todas las páginas. Solo se conserva abierta la sesión PDF del documento activo; al cambiar de documento se libera y el seleccionado se reabre desde su `File`.
2. Renderizar miniaturas únicamente para las páginas próximas al viewport y renderizar en el visor solo la página seleccionada. La cola serializa las tareas de canvas y prioriza la página seleccionada, luego el análisis y finalmente las miniaturas.
3. Para la detección de páginas vacías, examinar anotaciones y luego renderizar una muestra de hasta 256 × 256 píxeles de cada página, incluso si tiene texto extraíble; el texto OCR invisible no prueba que exista contenido visible. Transferir la muestra al Worker local, estimar el fondo con el percentil 90 de luminancia y clasificar marcas por contraste. Procesar páginas secuencialmente y permitir cancelación. Fondos oscuros/ambiguos, señales dispersas y anotaciones requieren revisión manual.
4. Registrar sugerencias de análisis sin modificar el contenido. No eliminar páginas automáticamente; las decisiones manuales son reversibles. La confianza no se presenta como porcentaje mientras los detectores carezcan de calibración con un corpus etiquetado.
5. Para orientar páginas, usar la dirección dominante de texto digital solo cuando sea suficiente y coherente; guardar el giro objetivo como sugerencia, nunca aplicarlo automáticamente. Páginas escaneadas sin texto digital, escritura vertical, direcciones mezcladas o texto inclinado quedan para inspección manual. No se incluye OCR en esta etapa.
6. Editar márgenes físicos desde la caja visible original de PDF.js, ya sea con campos numéricos o arrastrando guías gráficas accesibles por teclado. Convertirlos a una CropBox en espacio de usuario PDF considerando UserUnit y rotación efectiva; previsualizar durante el gesto y guardar un único delta reversible al soltar. Restaurar márgenes cero vuelve a la caja fuente; el editor no altera MediaBox ni borra/rasteriza objetos. La exportación materializa la CropBox sin rasterizar el contenido.
7. Registrar cada importación y operación de página como una orden reversible del proyecto. Ctrl/Cmd+Z deshace, Ctrl/Cmd+Shift+Z o Ctrl/Cmd+Y rehace; los campos editables conservan sus atajos nativos. Las rotaciones de una o varias páginas, cada CropBox y los cambios de orden global se registran como comandos delta. Una página puede moverse entre fuentes de la secuencia combinada sin perder su referencia al PDF original.
8. Estimar memoria antes de exportar. Cargar cada fuente única y copiar páginas activas en su orden global con pdf-lib; aplicar giros y CropBox, y no modificar los originales. Reabrir el buffer completo con PDF.js y validar el número de páginas, geometría y rotación de cada página. Crear el Blob y comenzar la descarga solo tras validar toda la salida. Los PDFs cifrados se rechazan. La cancelación se atiende entre operaciones; como pdf-lib no interrumpe una carga/copia/serialización interna, se descarta el resultado cuando termina dicha operación y nunca se inicia una descarga incompleta. Si el presupuesto no alcanza, se rechaza la exportación individual; dividir por partes corresponde a la Etapa 14.
9. Serializar Maps y comandos delta como registros versionados sin `File`. Autoguardar tras 500 ms de inactividad y ofrecer guardado inmediato. Al recuperar, validar el esquema y el orden del proyecto antes de hidratarlo; al volver a seleccionar fuentes, exigir coincidencia de nombre, tamaño, huella PDF y cantidad de páginas. Consultar `navigator.storage.estimate()`, avisar al acercarse a la cuota y mostrar explícitamente errores `QuotaExceededError`; la estimación no reserva espacio.

## Seguridad, privacidad y compatibilidad

- CSP estricta servida también como cabecera HTTP: recursos solo del mismo origen, sin CDN, telemetría, `eval` o `object-src`; permitir únicamente los esquemas locales imprescindibles para PDF/Workers después de validarlos. La política de desarrollo permite scripts/estilos inline y Workers `blob:` solo para React Fast Refresh/HMR de Vite; preview y hosting de producción no permiten `unsafe-inline` ni `blob:` para Workers. Usar rutas locales de Worker.
- La versión integrada de PDF.js no expone `isEvalSupported` en su API. Se usa sin el Viewer ni el gestor de scripting; la comprobación del bundle fijado no encontró llamadas a `eval()` ni `new Function()`. No se ejecutan acciones ni JavaScript del PDF.
- La importación retiene el `File` durante la sesión, sin copiarlo a IndexedDB. El modelo/historial mantiene referencias al `File` solo en memoria; el serializador las omite también en comandos de undo/redo. La sesión PDF se destruye al cambiar de documento o desmontar la aplicación. La fuente se vuelve a seleccionar tras recargar y su huella/número de páginas se verifican antes de enlazarla. No se guardan contraseñas.
- La exportación solo incluye páginas activas, conserva duplicados y orden global, y materializa rotaciones/CropBox. PDF.js valida la salida completa antes de permitir su descarga; las firmas digitales dejan de ser válidas y no se garantiza conservar formularios, anotaciones, marcadores, capas, adjuntos ni metadatos. El proceso no es streaming y la heurística de memoria no garantiza el pico real.
- Escapar nombres, metadatos y mensajes procedentes de PDF. No insertar HTML proporcionado por documentos.
- IndexedDB, OPFS y el almacenamiento del navegador están sujetos a cuota y evicción; consultar `navigator.storage.estimate()` y manejar errores explícitamente. La versión actual requiere volver a seleccionar los PDFs después de recargar; persistencia de handles y copia opcional a OPFS quedan para una decisión futura.
- Las firmas digitales dejan de ser válidas tras modificar o combinar el PDF. Formularios, anotaciones, marcadores, capas, adjuntos, etiquetas y restricciones de permisos se evalúan y documentan antes de exportar; no prometer preservación no comprobada.

## Decisiones aún abiertas

Hardware exacto de aceptación, límites definitivos de memoria, comportamiento para PDF con restricciones/permisos, persistencia opcional de handles/OPFS y criterios de orientación automática. Ver [informe de Etapa 0](./docs/stage0-spike-report.md).

# Arquitectura propuesta

**Estado:** arquitectura base aprobada en Etapa 0; shell aprobada en Etapa 1; importación local y metadatos implementados en Etapa 2. Miniaturas, edición, persistencia de proyecto y exportación siguen pendientes de sus etapas.

## Alcance técnico

- Aplicación cliente con React, TypeScript estricto y Vite; sin backend, API, telemetría ni recursos de terceros en tiempo de ejecución.
- Navegadores de producto: Chrome y Edge de escritorio, últimas dos versiones estables. El navegador integrado medido en el spike es Electron/Chromium y no sustituye la validación en esos productos.
- PDF.js 6.5.438 para lectura, metadatos y renderizado; pdf-lib solo para generar o modificar exportaciones cuyo presupuesto de memoria sea seguro.
- Web Workers para lectura por rangos, miniaturas y análisis visual. La vista visible tiene prioridad sobre el análisis masivo.
- IndexedDB conserva el estado pequeño del proyecto y, cuando el navegador lo permita, handles de archivos. Los bytes originales no se guardan automáticamente en IndexedDB.

## Límites establecidos por los spikes

1. **PDF.js:** para fuentes locales usar un `PDFDataRangeTransport` que responda las solicitudes de PDF.js con `Blob.slice()`. La implementación usa rangos de 64 KiB, desactiva precarga automática y streaming, y confirma antes de satisfacer rangos que llevarían a leer al menos el 95 % de un archivo de 400 MiB o más. El umbral es una protección heurística, no una garantía de memoria. En un PDF sintético de 500 MiB, el spike leyó 131,500 bytes en dos rangos y obtuvo el número de páginas en 120 ms; no se garantiza el mismo volumen para todos los PDF.
2. **pdf-lib:** no es una solución de streaming. La copia y el guardado mantienen un buffer de salida completo. En el fixture de 500 MiB se midieron 1,050.8 MiB RSS en el punto de guardado. Se propone un presupuesto inicial conservador de `300 MiB + 3 × tamaño mayor entre entrada y salida estimada`; es una cota heurística, no una garantía. Con el límite de pestaña propuesto de 1.5 GiB, una exportación individual de más de aproximadamente 400 MiB deberá advertir y ofrecer exportación por partes. La estrategia exacta queda pendiente de aprobación y validación en Chrome/Edge.
3. **OpenCV.js:** no se propone como dependencia inicial. En el spike, el archivo pesó 13.3 MB (3.76 MB gzip), tardó 338 ms en inicializarse en Worker y fue más lento que un bucle sencillo sobre `ImageData` para umbralizar y contar 4.19 MP. Se comienza con operaciones locales de píxeles; reconsiderar OpenCV si una operación concreta demuestra una mejora medida.
4. **Tesseract OSD:** candidato opcional, de carga diferida y totalmente local. En cuatro imágenes sintéticas corrigió las cuatro orientaciones, pero tardó 367–936 ms por página y requiere un núcleo legacy y datos OSD. No habilitar correcciones automáticas basándose solo en ese conjunto.
5. **Almacenamiento:** preferir un handle de File System Access API persistido en IndexedDB, sujeto a permiso renovado. Si el usuario importa mediante `<input type=file>`, el `File` es válido durante la sesión y al volver a abrir el proyecto se solicita re-seleccionarlo si ya no está disponible. OPFS será una copia opcional solo con consentimiento y espacio suficiente; no duplicar archivos silenciosamente.

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
    orientation/       orientación sugerida y confirmación
    margins/           guías, unidades y modos de recorte
    merging/           orden y composición lógica
    export/            estimación, generación y validación
    projects/          guardado, recuperación y migraciones
  i18n/                catálogo español; sin textos de UI incrustados
  pdf/                 adaptadores PDF.js/pdf-lib y geometría PDF
  storage/             IndexedDB, handles y referencias a archivos
  workers/             renderizado y cola tipada de análisis
  store/               estado normalizado y comandos con deltas
  types/               contratos del dominio y mensajes Worker
  utils/
  tests/
scripts/
  generate-fixtures/   fixtures pequeños deterministas; grandes bajo demanda
docs/
  adr/
```

La lista larga se virtualiza; se renderizan miniaturas bajo demanda y como máximo tres páginas en alta resolución. La caché LRU tiene límite explícito de bytes, no solo de entradas. Al descartar páginas se llaman `page.cleanup()`, `PDFDocumentProxy.destroy()`, `ImageBitmap.close()` y `URL.revokeObjectURL()` cuando corresponda.

## Modelo de dominio

- **Documento:** ID estable, nombre tratado como texto no confiable, tamaño, fecha de modificación, cantidad de páginas, metadatos filtrados, indicadores de cifrado/firmas/formularios y referencia reabrible a la fuente.
- **Página:** ID estable propio, documento y número de origen, rotación nativa, rotación solicitada por el usuario, MediaBox/CropBox/UserUnit, dimensiones, márgenes, tipo de contenido, análisis con confianza, estado de eliminación y estado de modificación. Una duplicación crea un nuevo ID y conserva el vínculo con su página de origen.
- **Proyecto:** orden y estado lógico, configuraciones, selección y revisión. No contiene copias del PDF en el historial.
- **Comando:** delta reversible con `apply`/`undo`; una operación masiva ocupa una entrada de historial. Selección y vista temporal no crean comandos.

## Flujo de datos

1. Importar uno o varios archivos sin alterar el original. PDF.js lee rangos y obtiene metadatos; el conteo de páginas no requiere renderizar todas las páginas.
2. Renderizar únicamente la página seleccionada o las miniaturas próximas al viewport. Texto digital se conserva como texto; imágenes y páginas mixtas no se rasterizan para analizarlas.
3. Procesar imágenes de resolución reducida en Worker con un límite de concurrencia, cancelación, prioridades y mensajes tipados. Transferir buffers cuando sea seguro para evitar copias.
4. Registrar sugerencias de análisis sin modificar el contenido. Ante baja confianza, marcar «Requiere revisión».
5. Aplicar acciones del usuario al modelo mediante comandos reversibles.
6. Estimar memoria antes de exportar. Crear el PDF completo en memoria con pdf-lib solo dentro del presupuesto; validar el buffer reabriéndolo con PDF.js y contar páginas antes de escribirlo a destino. Usar escritura temporal/atómica si la API disponible la admite. Si el presupuesto no alcanza, ofrecer archivos de salida por rangos o rechazar la exportación individual con un mensaje claro.

## Seguridad, privacidad y compatibilidad

- CSP estricta servida también como cabecera HTTP: recursos solo del mismo origen, sin CDN, telemetría, `eval` o `object-src`; permitir únicamente los esquemas locales imprescindibles para PDF/Workers después de validarlos. La política de desarrollo permite scripts/estilos inline y Workers `blob:` solo para React Fast Refresh/HMR de Vite; preview y hosting de producción no permiten `unsafe-inline` ni `blob:` para Workers. Usar rutas locales de Worker.
- La versión integrada de PDF.js no expone `isEvalSupported` en su API. Se usa sin el Viewer ni el gestor de scripting; la comprobación del bundle fijado no encontró llamadas a `eval()` ni `new Function()`. No se ejecutan acciones ni JavaScript del PDF.
- La importación retiene el `File` durante la sesión, sin copiar el archivo a IndexedDB. El `PDFDocumentLoadingTask` se destruye tras leer metadatos; la Etapa 3 volverá a abrir la fuente para renderizar bajo demanda. La fuente se debe volver a seleccionar tras recargar; la persistencia de handles se implementará con el almacenamiento del proyecto.
- Escapar nombres, metadatos y mensajes procedentes de PDF. No insertar HTML proporcionado por documentos.
- La File System Access API es específica de Chromium. Si no está disponible, pedir que se vuelva a seleccionar la fuente después de recargar. OPFS e IndexedDB están sujetos a cuota y evicción; consultar `navigator.storage.estimate()` y manejar errores explícitamente.
- Las firmas digitales dejan de ser válidas tras modificar o combinar el PDF. Formularios, anotaciones, marcadores, capas, adjuntos, etiquetas y restricciones de permisos se evalúan y documentan antes de exportar; no prometer preservación no comprobada.

## Decisiones aún abiertas

Hardware exacto de aceptación, límites definitivos de memoria, comportamiento para PDF con restricciones/permisos, persistencia opcional en OPFS y criterios de orientación automática. Ver [informe de Etapa 0](./docs/stage0-spike-report.md).

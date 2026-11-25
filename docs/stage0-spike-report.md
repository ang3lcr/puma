# Informe de Etapa 0 — análisis y spikes

**Fecha:** 2026-11-25  
**Estado:** documentación y pruebas técnicas preliminares listas para revisión; falta aprobar hardware, umbrales y decisiones antes de la Etapa 1.

## 1. Entorno inspeccionado

- Workspace original vacío; no había código, dependencias, manifiesto npm ni repositorio Git.
- Windows 11 Pro 10.0.26200; AMD Ryzen 5 2600X, 6 núcleos/12 hilos; 16,727,320 KiB de memoria física visible (aprox. 16 GiB; 7,373,640 KiB libres al medir). Tipo de SSD no verificado.
- Node 24.19.0, npm 11.17.0. Python y las instalaciones nativas de Chrome/Edge no se encontraron.
- El navegador integrado informó `Code/1.146.0`, Electron 43.8.6, Chromium/Chrome 150.0.7871.250 y 12 hilos. No expuso `deviceMemory` ni `performance.measureUserAgentSpecificMemory`; `performance.memory` sí estaba disponible, pero no mide de forma fiable memoria WASM/Worker.
- Es distinto del hardware propuesto por el prompt (4 núcleos/8 GB) y del Chrome/Edge estable requerido. Las cifras de browser son orientativas, no aprobación del hardware de referencia.

## 2. Resumen ejecutivo

| Área | Resultado medido | Decisión propuesta |
|---|---|---|
| pdf-lib / 500 MiB | Guardar una página alcanzó 1,050.8 MiB RSS; salida completa de 500 MiB | Mantener solo con presupuesto estricto; ofrecer partes válidas si excede |
| PDF.js / rangos | 500 MiB: 131,500 bytes en dos rangos; conteo en 120 ms | Adaptar `PDFDataRangeTransport` a `Blob.slice()` |
| PDF.js / miniatura | PDF vacío de 1,000 páginas: primer render 23 ms a 153×198 px | Render bajo demanda, no todas las páginas |
| OpenCV.js | 13.3 MB raw/3.76 MB gzip; 338 ms carga; más lento en tarea simple | No incluir inicialmente; `ImageData` en Worker |
| OPFS/IndexedDB | OPFS 500 MiB: 4.79 s; IndexedDB 500 MiB: commit 0.45 s | Referencia persistente sin copia por defecto; OPFS solo opt-in |
| Orientación | OSD sintético 4/4; 0.37–0.94 s/página | OSD opcional; sugerir, no corregir automáticamente |

Las mediciones completas, método y limitaciones están abajo. Los fixtures fueron sintéticos y no sustituyen documentos reales etiquetados.

## 3. Spike pdf-lib y presupuesto de memoria

**Versiones:** pdf-lib 1.17.1, Node 24.19.0. Generé PDFs sintéticos válidos de una página con un stream de espacios sin comprimir de 200 MiB y 500 MiB. Se midió RSS en hitos del proceso; no se presenta como muestreo continuo de memoria.

| Tamaño de stream | Tamaño fuente | Leer bytes | `PDFDocument.load` | `copyPages` | `save` | RSS en el hito de guardado | Tamaño de salida |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 200 MiB | 209,715,628 B | 161 ms | 7 ms | 10 ms | 321 ms | 450.8 MiB | 209,716,146 B |
| 500 MiB | 524,288,428 B | 306 ms | 5 ms | 4 ms | 751 ms | 1,050.8 MiB | 524,288,946 B |

En ambos casos, RSS aumentó aproximadamente el tamaño de la salida al guardar. El fixture contiene solo espacios, por lo que **no** mide la expansión en memoria de JPEG/PNG grandes, fuentes, cifrado, anotaciones o estructuras patológicas. No prueba que PDFs reales de 500 MiB puedan exportarse con seguridad.

**Conclusión:** pdf-lib no debe tratarse como streaming. Propuesta de alerta heurística `300 MiB + 3 × max(entrada, salida estimada)` bajo un límite de pestaña de 1.5 GiB; rechazar/partir cuando se exceda. Alternativas WASM requieren otro spike y revisión de licencia; MuPDF/AGPL no se adopta.

## 4. Spike PDF.js, lectura por rangos y miniaturas

**Versiones:** PDF.js (`pdfjs-dist`) 6.5.438. En el navegador integrado se abrió el PDF sintético de 500 MiB mediante un `PDFDataRangeTransport` de prueba que leía del archivo del servidor por rangos, sin descargar el cuerpo completo:

- Conteo de páginas: 1; tiempo desde `getDocument` a documento listo: **119.7 ms**.
- Solicitudes al archivo: **2**; bytes solicitados: **131,500 de 524,288,428** (aprox. 0.025 %).
- PDF vacío sintético de 1,000 páginas: **12,714 B**; conteo correcto; primera miniatura a 0.25×: **23.4 ms**, 153×198 px.
- En Node, lectura completa del archivo de 500 MiB: **225 ms**; `getDocument` terminó en **100 ms**; RSS alcanzó **565.5 MiB** con un único `Uint8Array` compartiendo el buffer leído. No se duplicó el buffer intencionalmente.

**Decisión:** lectura local por rangos respaldada por `Blob.slice()`, `isEvalSupported: false`, `page.cleanup()` y destrucción del loading task. Un PDF arbitrario puede exigir más rangos o la lectura completa; el fixture no modela índices complejos ni escaneos.

## 5. Spike OpenCV.js vs operaciones simples

**Versión:** `@techstark/opencv-js` 5.0.0-release.1, licencia Apache-2.0.

- Archivo distribuido: 13,298,869 B sin comprimir y 3,763,192 B gzip.
- Inicialización en Worker Chromium: **337.8 ms**.
- Operación sobre 4,194,304 píxeles (umbral y conteo, promedio de tres iteraciones): bucle JavaScript **6.33 ms**; OpenCV `threshold` + `countNonZero` **9.10 ms**. El tiempo OpenCV excluye construcción/copia de la matriz; no se pudo medir memoria WASM con las APIs disponibles.
- Se confirmó que OpenCV funciona dentro de un Worker y se liberó la matriz con `delete()`.

**Decisión:** no cargar OpenCV para operaciones simples. Implementar escala de grises, umbral y proyecciones con `ImageData`/`OffscreenCanvas` en Worker; valorar una biblioteca solo para un operador complejo que demuestre una mejora y un beneficio de precisión.

## 6. Spike de persistencia local de 500 MiB

**Navegador:** Electron/Chromium integrado, origen local seguro `http://127.0.0.1`. File System Access API y OPFS estaban disponibles. `navigator.storage.estimate()` informó cuota **2,669,217,365 B**; la cuota y la política dependen del perfil, no son garantías.

- **OPFS:** escritura secuencial en bloques de 16 MiB de un archivo de 524,288,428 B y verificación de tamaño: **4,792 ms** (incluye lecturas locales por bloques). El archivo de prueba fue eliminado después.
- **IndexedDB:** 32 bloques `ArrayBuffer` del mismo tamaño: carga de bloques **3,004 ms** y commit de escritura **451 ms**. La base de datos de prueba fue eliminada después.
- **File System Access API:** se comprobó disponibilidad, no el flujo interactivo de picker/permiso ni reapertura tras reinicio.
- El objeto `File` no se ensayó tras reiniciar el navegador; por su ciclo de vida, no es referencia persistente garantizada.

**Decisión propuesta:** guardar el estado del proyecto y handles en IndexedDB; preferir un handle de archivo sin duplicar bytes. Para selector HTML/drag-and-drop, pedir que se re-seleccione el archivo tras una recarga si no puede recuperarse. OPFS solo como copia explícita, con comprobación previa de cuota y consentimiento. Nunca guardar automáticamente el PDF completo en IndexedDB.

## 7. Spike de orientación y Tesseract.js OSD

**Versiones:** tesseract.js 7.0.0, core 7.0.0 y `@tesseract.js-data/osd` 1.0.0. El módulo OSD y el Worker se sirvieron localmente, sin CDN. `worker.detect` requiere `legacyCore: true` y `legacyLang: true`.

Se generaron cuatro imágenes 1600×1200 con texto Arial sintético, conocidas y giradas 0°, 90°, 180° y 270°:

| Giro aplicado a la imagen | Corrección OSD reportada | Tiempo |
|---:|---:|---:|
| 0° | 0° | 936 ms (primera página) |
| 90° | 270° | 411 ms |
| 180° | 180° | 397 ms |
| 270° | 90° | 367 ms |

Carga inicial del Worker/modelo: **591 ms**. Coincidieron 4/4 en estas imágenes sintéticas; confianza de orientación observada 15.2–20.9. La proyección simple acertó el eje horizontal/vertical 4/4 en **30–116 ms**, pero solo 2/4 ángulos completos: no diferencia una imagen de 0° de 180° por sí sola. OSD reportó advertencias de resolución sintética 0 dpi; la prueba continuó.

Los assets revisados incluyen un bundle `tesseract.js` de 1.41 MB, worker de 111 KB, datos OSD comprimidos de aproximadamente 4.32 MB y núcleo con variantes hasta 45 MB desempaquetadas; el core/modelo activos añaden varios MB. No se midió memoria del Worker. La sintaxis de configuración local debe volver a probarse al integrar.

**Decisión:** OSD opcional, diferido y local. No usar 4 ejemplos para fijar precisión de producto. Antes de sugerir correcciones automáticas se necesita un set mayor, etiquetado y representativo de escaneos, texto digital, poco contenido y las cuatro orientaciones.

## 8. Licencias y decisiones

Las versiones/licencias consultadas están en [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES). PDF.js es Apache-2.0; pdf-lib MIT; OpenCV.js y Tesseract.js/core Apache-2.0; datos OSD MIT. Transitivas relevantes incluyen pako (MIT AND Zlib), `@pdf-lib/standard-fonts` y `@pdf-lib/upng` (MIT), idb-keyval (Apache-2.0) y wasm-feature-detect (Apache-2.0). La lista queda pendiente de lockfile definitivo. MuPDF no se selecciona por AGPL.

ADRs propuestos:

- [0001 — memoria y exportación](./adr/0001-large-pdf-memory-and-export.md)
- [0002 — análisis sin OpenCV inicial](./adr/0002-image-analysis-without-opencv.md)
- [0003 — referencias y persistencia](./adr/0003-file-reference-and-local-storage.md)
- [0004 — sugerencias de orientación](./adr/0004-orientation-suggestions.md)
- [0005 — lectura PDF.js por rangos](./adr/0005-pdfjs-local-range-transport.md)

## 9. Trabajo pendiente y aprobación

- Ejecutar los mismos tests en Chrome y Edge estables y en el hardware aprobado de 4 núcleos/8 GB o en el hardware de referencia que indique el usuario.
- Probar PDFs reales/sintéticos con imágenes grandes, texto seleccionable, mezcla de ambos, páginas rotadas, cifrado, formularios, anotaciones, firmas y xref no trivial.
- Construir y etiquetar fixtures para medir falsos positivos de páginas en blanco y precisión/cobertura de orientación.
- Validar las dependencias propuestas en un proyecto inicial real y generar avisos desde lockfile.
- Confirmar qué sucede con PDFs que restringen copia/modificación y aprobar el presupuesto/método de exportación por partes.

No se ejecutaron scripts de lint, typecheck, unit, build ni E2E: no existe proyecto inicial y la Etapa 0 no debe implementarlo. El trabajo está listo para revisión; la siguiente etapa requiere aprobación expresa.

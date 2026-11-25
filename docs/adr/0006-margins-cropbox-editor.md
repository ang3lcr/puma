# ADR 0006 — Editor de márgenes y CropBox

- **Estado:** aprobado para la Etapa 10.
- **Fecha:** 2026-11-25.

## Contexto

La Etapa 10 permite definir un recorte antes de implementar persistencia y exportación. La aplicación debe mantener intactos los bytes fuente y expresar el recorte de manera reversible dentro del proyecto. PDF.js expone `PDFPageProxy.view`, que representa el área visible/intersección del PDF, junto con `userUnit` y rotación; su API pública no expone directamente MediaBox para reconstruir área que ya quedó fuera de una CropBox original.

## Decisión

- Cada página mantiene una `cropBox` en coordenadas PDF de espacio de usuario. `null` representa conservar la caja visible original de PDF.js.
- El editor captura márgenes físicos en milímetros. Convierte con `UserUnit` y la rotación cardinal efectiva (rotación nativa más delta del proyecto), por lo que las etiquetas superior/derecha/inferior/izquierda corresponden a la orientación mostrada.
- La caja resultante debe tener área positiva y permanecer dentro de `page.view`. Márgenes cero restauran la caja original; no se permite ampliar la caja para revelar contenido fuera del área visible actual.
- El visor sombrea el área excluida y las miniaturas indican que la página tiene una CropBox modificada. Cada ajuste y restauración es un comando reversible; las duplicaciones heredan el CropBox.
- El cambio solo altera el modelo del proyecto y la previsualización. No reescribe el PDF fuente, ni rasteriza o elimina objetos. Aplicar la CropBox al PDF generado y validar la salida se reserva para la Etapa 13.

## Consecuencias

- Los valores de márgenes son físicos y permanecen consistentes al rotar la página; la geometría guardada continúa en coordenadas PDF.
- Los PDFs cuya CropBox original sea más pequeña que su MediaBox no pueden recuperar el área oculta mediante este editor. Ampliar la caja requeriría obtener y validar MediaBox con una API o parser adecuado, fuera del alcance actual.
- No se afirma que el PDF se haya recortado físicamente hasta que la etapa de exportación escriba y reabra la salida. El archivo fuente permanece idéntico durante toda la edición.

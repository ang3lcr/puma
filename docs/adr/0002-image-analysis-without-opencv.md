# ADR 0002 — Operaciones de imagen iniciales

- **Estado:** aprobado en Etapa 0 e implementado en Etapa 8; validación del detector contra corpus etiquetado pendiente.
- **Fecha:** 2026-11-25.

## Contexto

`@techstark/opencv-js@5.0.0-release.1` pesa 13,298,869 bytes (3,763,192 bytes gzip) y funcionó en un Worker Chromium en 338 ms. Sobre 4,194,304 píxeles, una umbralización y conteo sencillo tomó 6.33 ms en un bucle JavaScript frente a 9.10 ms en OpenCV; el tiempo OpenCV no incluye crear/copiar la matriz. El runtime no expone una medición fiable de memoria WASM.

## Alternativas

1. Cargar OpenCV siempre. Ofrece operadores avanzados, con costo de bundle, inicialización y memoria.
2. Cargarlo de forma diferida en Worker. Reduce el impacto inicial, pero el usuario que ejecuta análisis paga la carga y el costo de memoria.
3. Implementar los operadores necesarios sobre `ImageData`/`OffscreenCanvas` dentro de Worker. Menor peso y suficiente para escala de grises, umbrales, conteos y proyecciones; algoritmos complejos requieren validación propia.

## Decisión propuesta

Comenzar con operaciones de píxeles tipadas y pequeñas en Worker. No incluir OpenCV como dependencia obligatoria. Reconsiderarlo únicamente para un operador concreto (p. ej. morfología/componentes) después de comparar exactitud, latencia y memoria contra la implementación simple. Si se aprueba, fijar versión y cargar solo localmente y bajo demanda.

## Consecuencias

- Menos peso y trabajo de inicialización en el flujo normal.
- La lógica de componentes conectados y filtros requerirá pruebas exhaustivas y fixtures etiquetados.
- El spike de cuatro millones de píxeles no mide la precisión del detector de páginas en blanco.
- La Etapa 8 usa un umbral de píxel sencillo sobre muestras locales de hasta 256 × 256. Texto y anotaciones evitan la clasificación automática como vacía; píxeles escasos requieren revisión y no se elimina ninguna página.
- Sin un corpus etiquetado no se declaran falsos positivos, recall ni confianza calibrada; la salida es solo una sugerencia para revisión humana.

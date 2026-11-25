# ADR 0004 — Sugerencias de orientación

- **Estado:** implementado en Etapa 9; validación en corpus etiquetado pendiente.
- **Fecha:** 2026-11-25.

## Contexto

En cuatro imágenes sintéticas con seis líneas de texto, proyecciones horizontales/verticales identificaron correctamente el eje en 4/4, pero no distinguen 0° de 180° ni 90° de 270° sin más señales. `tesseract.js@7.0.0` con núcleo/datos legacy y `osd.traineddata.gz` clasificó correctamente los cuatro giros sintéticos; inicializó en 591 ms y tardó 367–936 ms por página. No se usaron escaneos reales ni un corpus representativo.

## Alternativas

1. Usar solo proyecciones: rápido y ligero, pero insuficiente para decidir orientación completa y débil en páginas con poco contenido.
2. Incluir Tesseract OSD siempre: mejor señal direccional potencial, con varios MB de núcleo/modelo y costo por página.
3. Ofrecer OSD opcional/diferido y clasificar dudas como revisión: conserva precisión y no impone costo de OCR al flujo normal.

## Decisión

Usar la dirección del texto digital de PDF.js para sugerir el giro objetivo solo si hay texto suficiente, domina una sola dirección cardinal y no hay escritura vertical. Las páginas sin texto digital, con texto insuficiente, direcciones mezcladas o inclinación no cardinal requieren revisión manual. Las páginas escaneadas no reciben una sugerencia de dirección porque las proyecciones por sí solas no distinguen todos los giros posibles; no se incluye OCR en esta etapa. Tesseract OSD permanece como opción futura, local y explícita, si se aprueba su inclusión.

Una sugerencia nunca altera la rotación hasta que la persona elige aplicarla. Aplicar una sugerencia o rotar una selección genera un único comando reversible; la corrección automática está desactivada.

## Consecuencias

- Requiere corpus etiquetado de páginas mixtas y suficientes ejemplos de 0°, 90°, 180° y 270° para fijar confianza y cobertura.
- La prueba sintética 4/4 no es una precisión de producto.
- Tesseract.js necesita `legacyCore`/`legacyLang` para `worker.detect`; distribuir el modelo local y verificar ausencia de tráfico externo.
- La Etapa 9 usa umbrales heurísticos de texto, no calibrados; la interfaz no declara un porcentaje de confianza. La validación de precisión/cobertura queda pendiente del corpus de aceptación.
- Las páginas escaneadas y las páginas ambiguas conservan los controles de giro manual y selección múltiple, pero requieren que la persona determine el sentido.

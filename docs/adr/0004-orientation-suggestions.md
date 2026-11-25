# ADR 0004 — Sugerencias de orientación

- **Estado:** propuesta de Etapa 0; pendiente de aprobación.
- **Fecha:** 2026-11-25.

## Contexto

En cuatro imágenes sintéticas con seis líneas de texto, proyecciones horizontales/verticales identificaron correctamente el eje en 4/4, pero no distinguen 0° de 180° ni 90° de 270° sin más señales. `tesseract.js@7.0.0` con núcleo/datos legacy y `osd.traineddata.gz` clasificó correctamente los cuatro giros sintéticos; inicializó en 591 ms y tardó 367–936 ms por página. No se usaron escaneos reales ni un corpus representativo.

## Alternativas

1. Usar solo proyecciones: rápido y ligero, pero insuficiente para decidir orientación completa y débil en páginas con poco contenido.
2. Incluir Tesseract OSD siempre: mejor señal direccional potencial, con varios MB de núcleo/modelo y costo por página.
3. Ofrecer OSD opcional/diferido y clasificar dudas como revisión: conserva precisión y no impone costo de OCR al flujo normal.

## Decisión propuesta

Usar PDF.js/texto para páginas digitales y proyecciones simples en escaneos como señal, no como certeza. No adivinar 0° frente a 180° con geometría solamente. Mantener Tesseract OSD como módulo opcional empaquetado localmente; cargarlo en Worker solo si se aprueba y la persona lo solicita. Una sugerencia no altera la rotación; corrección automática desactivada por defecto.

## Consecuencias

- Requiere corpus etiquetado de páginas mixtas y suficientes ejemplos de 0°, 90°, 180° y 270° para fijar confianza y cobertura.
- La prueba sintética 4/4 no es una precisión de producto.
- Tesseract.js necesita `legacyCore`/`legacyLang` para `worker.detect`; distribuir el modelo local y verificar ausencia de tráfico externo.

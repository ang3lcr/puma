# Document Studio

Document Studio es una aplicación de escritorio web, local y sin backend para revisar, organizar y exportar documentos PDF, incluidos escaneos.

## Estado

**Etapa 0: análisis y spikes técnicos, lista para revisión.** Este workspace estaba vacío. Se han añadido únicamente documentación y decisiones propuestas; todavía no hay aplicación ni dependencias de proyecto. La Etapa 1 no comenzará hasta aprobar esta propuesta.

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

## Próximo paso

Revisar y aprobar o ajustar las decisiones, el hardware de referencia y los criterios propuestos en el informe. Tras la aprobación se iniciará únicamente la Etapa 1.

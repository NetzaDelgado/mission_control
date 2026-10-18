# Modelo de vuelo educativo

La API `simulate(config)` utiliza kg, m, s, N y m/s². `dryMass` es la masa del vehículo **sin motor ni agua**: el motor completo se suma una sola vez en Estes; en agua se suman el agua y la masa del aire ideal inicial. Los parámetros de conveniencia son botella en L, llenado en %, presión manométrica en bar y diámetro de tobera en mm. El ángulo se mide desde la vertical y el viento tiene signo sobre el eje horizontal.

## Fuentes consultadas el 18 de octubre de 2026

| Motor | Impulso de catálogo | Duración | Masa inicial | Propelente | Retardo |
| --- | ---: | ---: | ---: | ---: | ---: |
| [A8-3](https://estesrockets.com/products/a8-3-engines) | 2.5 N·s | 0.8 s | 15.6 g | 4.1 g | 3 s |
| [B6-4](https://estesrockets.com/products/b6-4-engines) | 5 N·s | 0.8 s | 17.9 g | 6.5 g | 4 s |
| [C6-5](https://estesrockets.com/products/c6-5-engines) | 10 N·s | 1.6 s | 24.1 g | 12.2 g | 5 s |
| [D12-5](https://estesrockets.com/products/d12-5-engines) | 20 N·s | 1.6 s | 45.6 g | 24.2 g | 5 s |

Se usan las especificaciones técnicas de las fichas individuales del fabricante. Algunas descripciones comerciales y paquetes mezclan masas o identifican erróneamente el empuje pico como promedio; esos textos no se usaron. Estos impulsos son valores publicados de catálogo, no resultados de certificación NAR. Todas las curvas son un perfil sintético por tramos, normalizado de forma exacta al impulso declarado; no son curvas digitalizadas de banco ni se ajustan al empuje pico publicado. La pérdida de propelente se distribuye proporcionalmente al impulso acumulado. No se descuenta masa de retardo ni de carga de expulsión.

La [explicación de códigos de Estes](https://help.estesrockets.com/article/47-what-do-the-engine-codes-mean) define el último número como segundos entre fin del empuje y expulsión. Esa es la lógica de apertura implementada para Estes.

Las bases de fuerzas y fases se apoyan en NASA Glenn: [vuelo del hidrocohete](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/flight-of-a-water-rocket/), [ecuación de empuje](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-thrust/) y [resistencia aerodinámica](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/). La implementación es original, no incorpora software NASA ni implica validación, licencia o respaldo de NASA.

## Ecuaciones y supuestos

- Integración de punto medio, pasos nominales de 2.5 ms durante impulso y 10 ms después; se reducen para el vaciado de agua y escalas rápidas de resistencia. Desde la apertura se usa el área completa potencial del paracaídas para limitar el paso, aunque el área física todavía esté inflándose. Se limita la duración a 240 s y el número de pasos; los resultados incompletos llevan advertencia.
- Movimiento 2D con masa variable y gravedad constante de 9.80665 m/s². La guía restringe posición y aceleración al eje inicial hasta abandonarla. Después el eje del empuje conserva el ángulo inicial; no hay grados de libertad rotacionales ni cálculo de estabilidad.
- Resistencia vectorial `F = -0.5 rho Cd A |v_rel| v_rel`, relativa al viento horizontal. `rho = 1.225 exp(-h/8500)` es una aproximación atmosférica a nivel del mar, no una atmósfera meteorológica local.
- Hidrocohete: presión absoluta inicial = ambiente + manométrica; `P V^1.4 = constante`. La velocidad de salida se estima con Bernoulli, `u = sqrt(2 ΔP/rho_agua)`. Caudal `mdot = 0.85 rho_agua A_tobera u`; empuje `mdot u`. El coeficiente 0.85 es un supuesto fijo. Se detiene al vaciar el agua o igualarse presiones. La masa de aire inicial se calcula con gas ideal a 288.15 K y permanece constante. **No se modelan descarga final de aire, humedad/condensación, tubo de lanzamiento ni geometría interna.** Con llenado 0 se informa que la propulsión por aire no está implementada.
- Paracaídas: área circular y Cd independiente, inflado lineal idealizado en 0.4 s. En Estes se activa después de duración + retardo; en agua, en el apogeo. No modela mecanismo real, fallo de apertura ni esfuerzos estructurales.
- El suelo intercepta el descenso con interpolación del último paso. Las velocidades de la última muestra son velocidades inmediatamente antes del contacto, no una simulación del impacto.
- `summary.drift` es desplazamiento horizontal **firmado**; `maxAcceleration` es la magnitud de aceleración neta en m/s², incluyendo recuperación, no carga propia en g. `flightTime` se mide desde la ignición/liberación. Las muestras están reducidas para visualización; las métricas se calculan en los pasos internos.

Los límites de entrada, incluyendo **0–8 bar**, definen únicamente el dominio numérico de esta interfaz. No expresan una presión segura para recipientes. La señal de velocidad de salida de guía inferior a 10 m/s es diagnóstica y no certifica estabilidad. La compatibilidad se refiere a los perfiles de motores incluidos y al modelo de propulsión: no se comprueba un montaje físico, kit comercial o vehículo real.

Pruebas: integral del impulso, conservación de masas, ausencia de despegue sin presión o con carga excesiva, simetría del viento, restricción de guía, tiempos de recuperación, efecto de resistencia, entradas inválidas y finitud en configuraciones límite. Son verificaciones de software y consistencia física, **no validación experimental**.

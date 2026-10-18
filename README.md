# ÓRBITA · Laboratorio de vuelo

Aplicación web en español para explorar cohetes de modelismo con motores ESTES e hidrocohetes. El control de misión es simulado y no se conecta a hardware.

## Abrir y desarrollar

Requiere Node.js 20 o posterior. La aplicación no necesita paquetes ni compilación para ejecutarse.

```powershell
cd .\mission_control
node server.mjs
```

Abre **http://127.0.0.1:4173**. Es necesario servir los archivos por HTTP porque utiliza módulos de JavaScript.

```powershell
node --test tests/*.test.mjs
node --check dist/app.js
node --check dist/physics.js
```

## Publicar en GitHub Pages

El sitio estático se publica desde `dist`; no requiere servidor Node.js, compilación ni dependencias en GitHub. El workflow `.github/workflows/pages.yml` despliega esa carpeta automáticamente al hacer push a la rama `main`, o manualmente desde la pestaña **Actions**.

1. Crea el repositorio con el contenido de esta carpeta como raíz (incluida `.github`) y confirma que la rama principal se llame `main`.
2. En el repositorio, abre **Settings → Pages** y selecciona **GitHub Actions** como fuente de publicación.
3. Espera a que termine el workflow **Publish GitHub Pages**. La URL del sitio aparecerá en **Settings → Pages** y en el despliegue del workflow.

Las rutas de los recursos son relativas, así que la aplicación funciona tanto en la URL de un repositorio como en un dominio personalizado. El repositorio puede ser público o privado; la disponibilidad del sitio depende del plan y la configuración de GitHub Pages de la cuenta. Los datos guardados en la bitácora permanecen en el navegador y son independientes por origen.

## Funciones

- Motores ESTES A8-3, B6-4, C6-5 y D12-5: impulso y masas de las fichas públicas del fabricante, con perfiles de empuje sintéticos explícitamente identificados.
- Hidrocohetes: volumen de botella, llenado, presión manométrica y diámetro de tobera; expansión adiabática durante expulsión de agua.
- Masa seca, diámetro, arrastre, viento, ángulo desde vertical, guía y recuperación configurables.
- Predicción de apogeo, velocidad máxima, duración y desplazamiento; trayectoria 2D, reproducción, pausa, velocidad variable y búsqueda temporal.
- Telemetría y cronología de ignición, despegue, salida de guía, fin del empuje, apogeo, recuperación y contacto con el suelo.
- Bitácora de hasta 30 misiones en `localStorage`, comparación de resultados, recuperación de configuraciones y exportación JSON.
- Exportación CSV de muestras en unidades SI. El CSV usa coma como separador y punto decimal.
- Vistas de fuentes NASA y guía del modelo. Diseño adaptable a pantallas estrechas.

Los datos de la bitácora pertenecen al navegador y al origen del sitio. La vista local y el sitio publicado tienen almacenamientos separados. Borrar los datos del navegador elimina la bitácora; exporta JSON para conservar una copia. No se envían configuraciones ni telemetría a un servidor.

## Modelo y límites

Implementación propia de masa puntual en dos dimensiones, gravedad, masa variable y arrastre cuadrático relativo al viento. Las escalas horizontal y vertical de la gráfica son independientes. La duración empieza en la ignición o liberación. Consulta [physics-notes.md](physics-notes.md) para ecuaciones, unidades, fuentes de motores y detalles de integración.

No calcula estabilidad rotacional, integridad estructural, cargas de recuperación ni condiciones de seguridad para lanzamientos. Las curvas ESTES no son ensayos certificados y el hidrocohete omite la fase final de descarga de aire. Los resultados no se han validado experimentalmente. Los rangos de parámetros son límites de entrada del simulador, no límites operativos seguros.

## Exploración de herramientas NASA

Se revisó el [catálogo de software NASA](https://software.nasa.gov/software/category/all) y estas fuentes primarias:

| Recurso | Aplicación en ÓRBITA |
| --- | --- |
| [RocketModeler](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocketmodeler/) | Referente educativo especialmente próximo: modelos sólidos, cohetes de botella y secuencia de misión. |
| [Open MCT](https://nasa.github.io/openmct/) | Referente para presentar telemetría y navegar datos temporales; framework abierto bajo Apache 2.0. |
| [Core Flight System](https://software.nasa.gov/software/GSC-18719-1) | Referente conceptual de comandos, estados y eventos; repositorio abierto bajo Apache 2.0. |
| [GMAT](https://software.nasa.gov/software/GSC-19640-1) | Referencia complementaria para análisis orbital; no es el motor de este simulador. |

No se incorpora código de estos proyectos ni se presenta el resultado como software NASA o ESTES. Las marcas se usan para identificar las referencias y motores. Los archivos de la aplicación son `dist/index.html`, `dist/style.css`, `dist/app.js`, `dist/physics.js` y `dist/mark.svg`.

## Verificación

Pruebas automatizadas de impulso integrado, masas, viento, guía, recuperación, entradas inválidas, agotamiento del agua y convergencia de configuraciones representativas. Las pruebas de consistencia del software no constituyen validación experimental. Se comprobó respuesta HTTP 200 de la aplicación local. La sesión de creación no disponía de navegador conectado para revisar visualmente el diseño.

La tipografía se solicita a Google Fonts; si no hay conexión se usan fuentes de sistema. La lógica del simulador se ejecuta enteramente en el navegador.

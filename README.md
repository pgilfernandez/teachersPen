# TeachersPen

Aplicación de escritorio para dibujar encima de otras aplicaciones mientras su contenido sigue actualizándose. Primera versión de desarrollo; plataforma inicial de pruebas: macOS Monterey 12.7.6, Intel.

## Ejecutar

Para ejecutar el código fuente se utiliza Node.js 20 o posterior; para instalar toda la cadena de empaquetado con sus requisitos oficiales se recomienda Node.js 22.12 o posterior. Node.js es necesario **para desarrollar**, no para usar la aplicación empaquetada.

```sh
npm ci
npm start
```

La barra se puede mover arrastrando el asa de seis puntos (2×3). La aplicación también aparece en la barra de menús/bandeja del sistema. Desde allí puedes recuperar las herramientas o volver al escritorio.

En **Preferencias → Activación → Mantener pulsado**, el cambio se aplica y guarda inmediatamente; no hace falta pulsar Guardar. Mantén el atajo mientras dibujas. Funciona con el atajo de activación, herramientas, colores y pizarras. Soltar la tecla principal o cualquiera de los modificadores devuelve el control al escritorio y conserva los trazos. Esc interrumpe el dibujo aunque sigas manteniendo el atajo; para volver a activarlo debes soltarlo y pulsarlo otra vez. Los botones de la barra permiten activar el dibujo manualmente. El modo inicial sigue siendo pulsar para activar/desactivar.

Los dos modos aparecen como opciones visibles y la opción marcada indica el modo realmente activo. Los botones de las herramientas y colores activan el dibujo al pulsarlos y salen al volver a pulsar la misma selección. Cambiar de herramienta mantiene el dibujo activo. Esto es independiente del modo elegido para los atajos.

## Presentación de la barra

La barra completa es una sola fila sin logotipo ni botón de interacción: asa de seis puntos, herramientas, fondos blanco/negro, temporizador con un 5, colores, diámetro del trazo y acciones. Preferencias, Contraer y Salir están juntos al final y usan iconos Lucide. El campo del diámetro tiene 68 px de ancho. Contraer una barra visible pasa al modo mínimo.

En **Preferencias → Barra de dibujo** puedes elegir un modo, que se aplica y guarda inmediatamente:

- **Visible:** mantiene la barra completa en pantalla.
- **Mínima:** muestra solo un círculo con el icono de TeachersPen. Tiene un 20% de transparencia (80% de opacidad) y un 40% al pasar el ratón (60% de opacidad). Arrastrarlo cambia su posición; hacer clic abre la barra completa. El botón **Contraer** vuelve al círculo. Su posición se recuerda entre sesiones y se ajusta si se desconecta un monitor.
- **Oculta:** deja únicamente el icono en la barra de menús de macOS o la bandeja del sistema de Windows/Linux. En macOS también desaparece del Dock y del selector de aplicaciones. Los atajos siguen dibujando sin mostrar la barra, el círculo ni el aviso inferior. Las anotaciones permanecen visibles.

El menú del icono del sistema permite abrir la barra completa, cambiar entre los tres modos, abrir Preferencias o salir. Si abres temporalmente la barra en modo oculto, **Ocultar** vuelve a esconderla. Volver a ejecutar TeachersPen también permite recuperar la barra. En Linux, la ubicación y disponibilidad de los iconos de bandeja dependen del escritorio; la validación de Windows/Linux sigue pendiente.

La liberación se comprueba mediante un pequeño ejecutable nativo, cada 8 ms y solo mientras mantienes un atajo. Usa Core Graphics en macOS, `GetAsyncKeyState` en Windows y X11 en Linux. No instala un monitor permanente de teclado ni registra lo que escribes. El ejecutable macOS se compila para Intel y Apple Silicon con versión mínima 11.0. Windows y Linux siguen pendientes de prueba real.

- `Ctrl+Mayús+Espacio`: activar/salir del dibujo. En Mac es Control, no Command.
- `Esc`: salir cuando la capa de dibujo tiene el foco.
- `Ctrl+Mayús+A/Q/W/S`: mano alzada/línea/flecha/rectángulo.
- `Ctrl+Mayús+O`: círculo. Arrastra desde el centro para definir el radio.
- `Ctrl+Mayús+E/D/C/R/F`: los cinco colores; también activan el dibujo.
- `Ctrl+Mayús+Z/Y`: deshacer/rehacer en el monitor activo.
- `Ctrl+Mayús+X`: borrar todos los monitores (se puede deshacer por monitor).
- `Ctrl+Mayús+H`: ocultar/mostrar trazos.
- `Ctrl+Mayús+V/B`: alternar pizarra blanca/negra y fondo transparente.
- `Ctrl+Mayús+T`: iniciar/cancelar el temporizador (5 minutos por defecto).

Las preferencias permiten cambiar el grosor, colores, duración y atajos. Guardar aplica los cambios; si un atajo está ocupado o es inválido se conservan los ajustes anteriores. Los trazos se guardan solo en memoria y permanecen fijos en coordenadas de pantalla. En modo interacción los trazos siguen visibles y los clics atraviesan la capa. Las pizarras tienen un fondo opaco hasta que vuelves a pulsar su botón/atajo.

Si abres una pizarra después de ocultar los trazos, empieza limpia: las anotaciones ocultas se borran del lienzo y se pueden recuperar explícitamente con Deshacer. Cambiar entre blanco y negro conserva los trazos visibles que estés usando.

## Compatibilidad

| Plataforma | Base de esta versión | Estado |
| --- | --- | --- |
| macOS | Big Sur 11+, Intel x64 y Apple Silicon arm64 | Pruebas iniciales en Monterey Intel; Big Sur y arm64 pendientes de prueba real |
| Windows | Windows 10+, x64 | Pendiente de prueba real |
| Linux | x64, escritorio X11, distribuciones con bibliotecas compatibles con Electron 37 | Pendiente de prueba real; no se fija aún una distribución mínima verificada |
| Linux Wayland | Se fuerza el backend X11 mediante XWayland | Experimental; no garantiza superposición sobre aplicaciones Wayland nativas |

Electron está fijado exactamente en **37.10.3**, última versión publicada de la rama 37 consultada al iniciar el proyecto. Electron 38 elimina Big Sur. No actualizar Electron de versión mayor sin revisar el requisito macOS 11. `minimumSystemVersion` del paquete macOS también está fijado en 11.0.

**Deuda de mantenimiento:** Electron 37 está fuera de soporte upstream. Preservar Big Sur con Electron implica mantener un runtime antiguo. Antes de distribución pública habrá que decidir cómo mantener esa rama o migrar la integración de escritorio. Se carga solo contenido local, con sandbox, aislamiento de contexto, sin integración Node en la interfaz y sin navegación externa. Estas medidas no sustituyen las actualizaciones de seguridad.

Windows 7/8/8.1 quedan fuera de esta base (Electron dejó de admitirlos en la versión 23). Soportarlos requeriría revisar la tecnología, no simplemente cambiar una opción de empaquetado. No se promete compatibilidad de CPU, GPU o distribución Linux sin probarla.

Canvas 2D, dibujo bajo demanda, sin WebGPU, filtros ni animaciones permanentes. Si un controlador gráfico antiguo da problemas puedes probar:

```sh
npm start -- --software-rendering
```

Ese argumento se transmite a Electron y desactiva la aceleración por hardware. No es el modo predeterminado; debe probarse con la transparencia en cada sistema.

## Verificación y empaquetado

```sh
npm run typecheck
npm test
npm run smoke
npm run smoke -- --smoke-hidden-start
npm run test:hold:mac
npm run pack
```

`smoke` abre ventanas reales, prueba dibujo mediante eventos sintéticos, deshacer, cambios de fondo, aislamiento del renderer, preferencias y registro de atajos. Sale al terminar y no escribe preferencias. No equivale a comprobar entrada física, paso de clics, todos los escritorios/fullscreen ni otros sistemas.

También comprueba los modos de barra, la transparencia del círculo, que arrastrarlo no abra las herramientas, que el clic sí lo haga y que el dibujo oculto mantenga la barra y el Dock escondidos. `--smoke-hidden-start` verifica además el arranque directamente en modo oculto.

Verificación de los modos de barra (01/11/2026, Monterey 12.7.6 Intel): nueve pruebas unitarias, smoke con inicio visible y oculto, atajos mantenidos en modo oculto y prueba de clic/arrastre con eventos de ratón enviados a macOS. Se comprobó la escritura de la posición en disco y, en la `.app` empaquetada, que la capa de dibujo recibe el foco sin mostrar barra, círculo, aviso inferior ni Dock. Windows/Linux pendientes de validación.

`test:hold:mac` comprueba además el estado nativo con eventos enviados al sistema (Ctrl+Mayús+F19), la liberación de la tecla y la liberación anticipada de un modificador. Invoca el mismo manejador del atajo para iniciar la prueba: macOS no entrega esos eventos sintetizados al registro global de Carbon. Por tanto, no sustituye la prueba con teclado físico. Solo se ejecuta si ya existe permiso para simular eventos; no solicita permisos automáticamente. Las pruebas unitarias cubren repetición, atajos solapados, cancelación y fallo del comprobador sin necesitar esos permisos.

La compilación ahora necesita herramientas C: Xcode Command Line Tools en macOS, Visual Studio x64 Native Tools en Windows y compilador C más cabeceras X11 (`libx11-dev` o equivalente) en Linux. La aplicación empaquetada incluye el ejecutable y no necesita compilador. Empaqueta Linux en la distribución más antigua que se vaya a admitir para no elevar innecesariamente la versión de glibc.

Primera verificación local (31/10/2026): typecheck, dos pruebas de historial/validación de preferencias y smoke de la aplicación fuente y de la `.app` empaquetada completados en Monterey 12.7.6 x64. Se comprobó que el paquete declara `LSMinimumSystemVersion=11.0`. La aplicación local está en `release/mac/TeachersPen.app`.

Para generar instaladores: `npm run dist:mac`, `npm run dist:win`, `npm run dist:linux`. La configuración macOS genera x64 y arm64 separados. Windows y Linux se deben empaquetar/validar en sus sistemas correspondientes. Los paquetes locales no están firmados ni notarizados.

## Pendiente

- Validación manual con ratón, pantallas completas, cambios de Spaces y dos monitores con distinto escalado.
- Pruebas en Big Sur, Apple Silicon, Windows y Linux/X11; backend específico para Wayland.
- Persistencia/exportación de anotaciones y recuperación tras cierre.
- Firma, notarización e instaladores probados.

## Referencias técnicas

- [Electron 38: retirada de Big Sur](https://www.electronjs.org/blog/electron-38-0)
- [Plataformas de Electron 37](https://github.com/electron/electron/blob/v37.10.3/README.md#platform-support)
- [Retirada de Windows 7/8](https://www.electronjs.org/blog/electron-23-0)

## Iconos

Los iconos propios de la interfaz son SVG de [Lucide](https://lucide.dev/guide/react/), incluidos en el bundle sin peticiones de red. Se usa `PencilLine` como identidad de TeachersPen en el círculo mínimo, el Dock y la bandeja del sistema; las herramientas utilizan los símbolos de lápiz, línea, flecha, rectángulo y círculo correspondientes.

`scripts/build-icons.mjs` genera automáticamente PNG, ICNS e ICO a partir del mismo icono oficial. El rasterizador se usa solo al compilar y no se distribuye con la app. Se incluye la licencia de Lucide en `dist/icons/LICENSE-lucide.txt`. Los requisitos de sistema siguen siendo los mismos.

## Organización

`src/main.ts` gestiona ventanas, monitores, atajos y preferencias. `src/preload.ts` expone un puente IPC limitado. `src/shared.ts` define el contrato y valida preferencias. `src/model.ts` conserva trazos e historial. `src/renderer/` contiene interfaz y Canvas. `scripts/build.mjs` compila sin servidor web. Las preferencias se escriben de forma atómica en `settings.json` dentro del directorio de datos de Electron (`~/Library/Application Support/TeachersPen` en macOS, según el nombre de aplicación).

`src/hold.ts` coordina los atajos mantenidos y su cancelación; `src/native-hold.ts` gestiona el proceso de comprobación. `native/key-state.c` contiene las implementaciones de macOS, Windows y X11 y se compila durante el build.

`src/toolbar.ts` distingue clic y arrastre y ajusta posiciones a los monitores. El círculo utiliza una ventana pequeña independiente; su posición se guarda de forma atómica en `window-state.json`, junto a `settings.json`.

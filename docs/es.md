# OctoPrint

Siga y controle su impresora 3D desde Gladys a través de
[OctoPrint](https://octoprint.org), la interfaz web libre para impresoras 3D
(a menudo instalada en una Raspberry Pi con OctoPi). Todo se queda en su red
local: Gladys habla directamente con OctoPrint, sin cuenta en la nube.

La integración se ha probado con un OctoPrint real (1.11.8) que controla su
impresora virtual integrada: impresiones reales, pausa, reanudación,
cancelación, fin de impresión. Todavía no se ha probado con una impresora
física: sus comentarios son bienvenidos en el foro de Gladys.

## Requisitos

- Gladys Assistant 5.1 o posterior.
- OctoPrint 1.5 o posterior, accesible desde la máquina de Gladys. La página
  de autorización del botón Conectar requiere OctoPrint 1.10 o posterior; con
  una versión anterior, la solicitud aparece en la interfaz de OctoPrint.
- Un usuario de OctoPrint autorizado a controlar la impresora (quien acepta la
  solicitud: la clave tiene sus permisos).
- Para la imagen de la webcam: OctoPrint 1.9 o posterior, con una webcam capaz
  de tomar capturas (lo habitual en OctoPi).

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. En **Dirección de OctoPrint**, introduzca la dirección con la que abre
   OctoPrint en su navegador, por ejemplo `http://192.168.1.50`. Se admite un
   puerto o una ruta (`http://192.168.1.50:5000`,
   `https://example.org/octoprint`). Mejor una dirección IP: los nombres
   `octopi.local` no se resuelven dentro del contenedor de la integración.
   Guarde.
3. Haga clic en **Conectar con OctoPrint**. Se abre la página de autorización
   de OctoPrint: inicie sesión si se le pide y autorice a **Gladys
   Assistant**. La integración recibe su clave sola y la guarda en **Clave de
   API** (el campo sigue oculto). El estado de la pantalla de configuración
   pasa a conectado.
4. Sin el botón Conectar: cree una clave en OctoPrint (**Ajustes →
   Application Keys**, o la clave de API de su usuario), péguela en **Clave de
   API** y guarde.
5. Una segunda o tercera impresora: rellene **Impresora 2** e **Impresora 3**
   de la misma forma (una instancia de OctoPrint cada una).
6. **Idioma** elige el idioma de los nombres de las funciones y de los textos
   que crea la integración (francés por defecto). Los nombres de las funciones
   se fijan al añadir el dispositivo a Gladys.

Después, añada la impresora desde la pestaña **Descubrir**.

## El dispositivo impresora

Un dispositivo por instancia de OctoPrint, con el nombre de la instancia de
OctoPrint (**Ajustes → Apariencia**), u «OctoPrint». Los valores llegan en
tiempo real por la conexión push de OctoPrint (cada 5 segundos, los eventos al
instante).

| Función                 | Lo que muestra                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estado                  | Operativa, Imprimiendo, Pausando, En pausa, Reanudando, Cancelando, Finalizando, Error, Impresora desconectada, OctoPrint inaccesible, Clave de API rechazada |
| Archivo                 | El archivo que se imprime, o el último                                                                                                                        |
| Progreso                | Porcentaje de la impresión (se mantiene en 100 % tras una impresión terminada, 0 tras una cancelación)                                                        |
| Tiempo transcurrido     | En minutos                                                                                                                                                    |
| Tiempo restante         | Estimado por OctoPrint, en minutos (0 en reposo)                                                                                                              |
| Boquilla, Cama, Recinto | Temperaturas en grados enteros; una boquilla por extrusor, el recinto solo si el perfil de impresora declara un recinto calefactado                           |
| … (consigna)            | Consignas: se cambian desde el panel (boquilla 0 a 350 °C, cama 0 a 150 °C, recinto 0 a 100 °C)                                                               |
| Pausar, Reanudar        | Pulsadores                                                                                                                                                    |
| Webcam                  | La imagen de la webcam, a través de OctoPrint (si hay una webcam con captura configurada)                                                                     |

A propósito, el dispositivo no tiene botón de **cancelar**: una pulsación sin
confirmación arruinaría una impresión. La cancelación la ofrecen el widget
(con confirmación) y las escenas.

Lo que tiene la impresora (boquillas, cama y recinto calefactados, webcam)
viene del perfil de impresora activo en OctoPrint. Cuando cambia, Gladys
propone actualizar el dispositivo en la pestaña **Descubrir**.

## Widget del panel

Añada el widget **Impresión 3D** a un panel y elija la impresora en sus
ajustes. Muestra:

- el indicador de progreso, el tiempo restante, las temperaturas de la
  boquilla y de la cama (en directo);
- el estado, el archivo, el tiempo transcurrido, la hora prevista de fin, las
  consignas activas;
- los botones adecuados al momento: **Pausar** o **Reanudar** y **Cancelar**
  (pide confirmación) durante una impresión; **Precalentar** y, cuando algo
  calienta, **Enfriar** en reposo.

Las temperaturas de precalentamiento son ajustes del widget (200 °C y 60 °C
por defecto, PLA).

## Desencadenantes de escena

En la categoría **Integraciones** del editor de escenas. Cada uno puede
limitarse a una impresora.

- **Impresión iniciada**: variables nombre de la impresora, archivo.
- **Impresión terminada**: variables nombre de la impresora, archivo, tiempo
  de impresión (en texto, como `1 h 05 min`, y en minutos).
- **Impresión fallida o cancelada**: puede limitarse a un motivo (cancelada,
  error). Variables nombre de la impresora, archivo, tiempo de impresión,
  motivo.
- **Impresión en pausa**: por un usuario o por la propia impresora (fin del
  filamento). Variables nombre de la impresora, archivo, tiempo transcurrido.

Las variables se leen en las acciones siguientes con, por ejemplo,
`{{triggerEvent.data.file}}` y `{{triggerEvent.data.duration}}`.

## Acciones de escena

- **Pausar, reanudar o cancelar una impresión**: devuelve **Aplicado** en
  falso cuando no había nada que pausar, reanudar o cancelar (la escena
  continúa).
- **Precalentar la impresora**: consignas de la boquilla (de todas) y de la
  cama, 200 °C y 60 °C por defecto. Se rechaza durante una impresión
  (Aplicado: falso): una escena que precalienta a una hora fija nunca toca una
  impresión en curso.
- **Apagar los calentadores**: todas las consignas a 0, también durante una
  impresión (que entonces falla).

## Ejemplos de escenas

- **Impresión terminada → notificación**: desencadenante Impresión terminada,
  acción «Enviar un mensaje»:
  `{{triggerEvent.data.file}} terminado en {{triggerEvent.data.duration}}`.
- **Humo detectado → detenerlo todo**: desencadenante en el detector de humo,
  acciones Pausar, reanudar o cancelar una impresión (cancelar), después
  Apagar los calentadores, después apagar el enchufe inteligente de la
  impresora.
- **Lista al levantarse**: a las 7:00 entre semana, Precalentar la impresora
  (sin efecto si hay una impresión en curso).
- **Luz para la webcam**: Impresión iniciada → encender la luz del taller;
  Impresión terminada o Impresión fallida → apagarla.

## Solución de problemas

- **OctoPrint no responde**: compruebe la dirección desde la máquina de Gladys
  (`curl http://192.168.1.50/api/version` responde 403 sin clave: OctoPrint es
  accesible). Use una dirección IP en lugar de `octopi.local`.
- **Clave de API ausente o rechazada**: haga clic de nuevo en Conectar, o pegue
  una clave nueva. Una clave revocada en OctoPrint (**Ajustes → Application
  Keys**) deja de funcionar al instante.
- **Conectar no hace nada / «rechazada o caducada»**: la solicitud debe
  aceptarse en 10 minutos, por un usuario autorizado a dar acceso. OctoPrint
  acepta como máximo 3 solicitudes por minuto: espere un minuto antes de
  volver a intentarlo. Si el plugin Application Keys está desactivado, pegue
  una clave.
- **La dirección redirige** (de http a https): introduzca la dirección final.
- **No hay imagen de la webcam**: la imagen debe ser un JPEG de 150 KB como
  máximo (un límite de Gladys): reduzca la resolución de la webcam en
  OctoPrint.
- **Los valores llegan con 10 s de retraso**: la conexión push no está
  disponible (un proxy inverso sin WebSocket): la integración lee entonces la
  API cada 10 segundos y deduce los eventos de impresión de los cambios de
  estado.
- Registros: en la página de la integración en Gladys, o `docker logs` en el
  anfitrión. `LOG_LEVEL=debug` muestra el detalle. La clave de API nunca
  aparece en los registros.

## Límites

- Tres instancias de OctoPrint como máximo.
- Sin envío de archivos, sin inicio de impresión desde Gladys, sin comandos
  G-code, sin timelapse.
- La imagen de la webcam es una captura renovada cada minuto (y a petición),
  no un flujo de vídeo.
- Sin la conexión push, puede perderse un evento de menos de 10 segundos, y
  una impresión detenida por un error solo se indica como fallida (motivo
  «error») si OctoPrint muestra el estado de error.
- Desarrollada sin impresora física (se usó la impresora virtual de
  OctoPrint): sus comentarios son bienvenidos.
- Sin relación con OctoPrint. OctoPrint es un proyecto de Gina Häußge.

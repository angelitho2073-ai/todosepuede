# Bot de WhatsApp Business con Claude

Atiende a tus clientes por WhatsApp las 24 horas, cotiza con tus precios, registra pedidos,
**Claude hace el trabajo**, lo revisa para que suene natural y tú lo apruebas desde un panel
antes de que se entregue automáticamente al cliente.

```
Cliente escribe ─► Bot responde y cotiza (catalogo.json)
                 ─► Cliente confirma ─► Pedido "Esperando pago"
Tú confirmas el pago en el panel ─► Claude elabora el trabajo
                 ─► Revisión de estilo (tono natural, sin errores)
                 ─► "Listo para revisar" en tu panel (te llega aviso a tu WhatsApp)
Tú revisas / editas ─► "Aprobar y entregar" ─► El cliente lo recibe (texto o Word)
Cliente pide cambios ─► el bot reabre el pedido y Claude lo corrige
```

## Dos formas de conectar WhatsApp

| | **Código QR** (por defecto) | **API oficial de Meta** |
|---|---|---|
| Cómo se conecta | Escaneas un QR, como WhatsApp Web | Configuras una app en Meta |
| Tu celular | Sigue funcionando normal | El número deja de usarse en la app |
| Dificultad | 5 minutos | 1 a 2 horas |
| Riesgo | Usa una conexión no oficial: WhatsApp puede bloquear números que hacen spam o envíos masivos. Para responder a quien te escribe, el riesgo es bajo. | Ninguno |
| Ve fotos (capturas de pago) | Sí | No (solo sabe que llegó una foto) |

## Instalación rápida (modo QR)

1. Instala **Node.js 20 o superior** (https://nodejs.org).
2. Crea tu clave de Claude en https://console.anthropic.com → *API Keys* (se paga según el uso).
3. En la carpeta del proyecto:

   ```bash
   cd whatsapp-bot
   npm install
   cp .env.example .env     # abre .env y pon ANTHROPIC_API_KEY, ADMIN_TOKEN y OWNER_PHONE
   npm start
   ```

4. Abre `http://localhost:3000`, entra con tu `ADMIN_TOKEN` y ve a la pestaña **Conexión**.
5. En tu celular: WhatsApp → **Configuración / ⋮** → **Dispositivos vinculados** → **Vincular un dispositivo**
   y escanea el QR. (Si abres el panel en el mismo celular, usa **Obtener código** y en WhatsApp elige
   *Vincular con número de teléfono*.)
6. Listo: escribe a tu número desde otro celular y la asistente responderá.

> El programa tiene que estar **encendido** para responder. Si lo corres en tu PC y la apagas, el bot se detiene.
> Para que funcione 24/7 súbelo a un servidor (ver abajo). La sesión se guarda en `data/sesion-whatsapp`,
> así no tienes que escanear cada vez.

### Si tú escribes a un cliente

Si respondes desde tu celular, la asistente lo detecta y **se calla en ese chat** por
`HUMANO_PAUSA_HORAS` (6 h por defecto) para no interrumpirte. También puedes pausarla o reactivarla
desde la pestaña **Chats**.

## Cómo evita respuestas repetitivas

- Lee toda la conversación (últimos 60 mensajes) con la hora de cada uno antes de responder.
- Tiene reglas claras: no repetir saludos, precios ni listas ya dados; variar los cierres; responder
  cada pregunta del último mensaje.
- **Detector automático**: si la respuesta se parece en más de un 80 % a algo que ya envió en ese chat,
  se descarta y Claude escribe otra versión antes de enviarla.
- Junta los mensajes seguidos del cliente (espera `AGRUPAR_MS`) para responder una sola vez a todo.
- Responde también preguntas generales (consejos, dudas, explicaciones), no solo de ventas. Lo que no
  sabe del negocio no lo inventa: te lo consulta por WhatsApp y sigue atendiendo.

Para que responda "todo", **completa bien `catalogo.json`**: horarios, ubicación, formas de pago,
garantías y la sección `preguntasFrecuentes` con lo que tus clientes suelen preguntar.

## Modo API oficial de Meta (opcional)

Pon `WHATSAPP_MODO=api` en `.env` y configura:

1. https://developers.facebook.com → *Mis apps* → *Crear app* → tipo **Empresa** → agrega **WhatsApp**.
2. Copia el **Identificador del número de teléfono** → `WHATSAPP_PHONE_NUMBER_ID`.
3. Token permanente: Configuración del negocio → Usuarios del sistema → Generar token con permisos
   `whatsapp_business_messaging` y `whatsapp_business_management` → `WHATSAPP_TOKEN`.
4. *Configuración de la app → Básica* → **Clave secreta** → `WHATSAPP_APP_SECRET`.
5. WhatsApp → Configuración → **Webhook**: URL `https://TU-DOMINIO/webhook`, token de verificación
   = `WHATSAPP_VERIFY_TOKEN`, y suscríbete a **messages**.

En este modo WhatsApp solo deja escribir libremente dentro de las 24 h desde el último mensaje del cliente.

## Tenerlo encendido 24/7

- **Render.com / Railway.app**: crea un "Web Service" desde este repositorio con directorio raíz
  `whatsapp-bot`, comando `npm install` / `npm start`, carga las variables del `.env` y añade un
  **disco persistente** en `/data` con `DATA_DIR=/data` (ahí se guarda la sesión de WhatsApp y los pedidos).
- **Un VPS o una PC que siempre esté prendida**: `npm install -g pm2 && pm2 start src/server.js --name bot`.

> GitHub Pages (donde está la web del colegio) solo sirve páginas estáticas; no puede ejecutar este bot.

## Personalizar precios y servicios

Edita `catalogo.json` (o la pestaña **Precios** del panel). Cada servicio tiene nombre, precio,
unidad, tiempo y los datos que el bot debe pedir al cliente. El bot **nunca** inventa precios
fuera del catálogo; si algo no está, te pasa la conversación a ti.

## El panel

- **Conexión**: QR para vincular tu WhatsApp y estado de la conexión (🟢/🔴).
- **Pedidos**: confirma pagos, mira lo que hizo Claude, edítalo, pídele que lo rehaga con
  instrucciones, y entrégalo como texto o documento Word.
- **Chats**: lee todas las conversaciones, pausa el bot en un chat para atender tú y escribe al
  cliente desde ahí. Cuando el bot detecta un reclamo o algo que no sabe resolver, se pausa solo y
  te avisa a `OWNER_PHONE`.
- **Precios**: edita el catálogo en vivo.

## Variables importantes

| Variable | Para qué |
|---|---|
| `WHATSAPP_MODO` | `qr` (por defecto) o `api`. |
| `CLAUDE_ESFUERZO_CHAT` | `medium` por defecto. `high` piensa más cada respuesta (más lento y caro), `low` es más rápido. |
| `HUMANO_PAUSA_HORAS` | Horas que el bot se calla en un chat después de que escribes tú. |
| `REQUIERE_PAGO` | `true`: el trabajo empieza cuando confirmas el adelanto. `false`: empieza al confirmar el pedido. |
| `AUTO_ENTREGA` | `false` (recomendado): tú apruebas cada entrega. `true`: se envía sin revisión. |
| `OWNER_PHONE` | Tu número para recibir avisos de pedidos nuevos, listos o con problemas. |
| `CLAUDE_MODEL` | Modelo de Claude (por defecto `claude-opus-5-5`). |

## Limitaciones a tener en cuenta

- **Audios de voz**: la asistente sabe que llegó un audio pero no lo escucha; le pedirá al cliente que lo
  escriba o puedes atenderlo tú. Las **fotos** sí las ve (en modo QR).
- Ninguna asistente acierta el 100 % de las veces: revisa la pestaña **Chats** los primeros días y
  ajusta `catalogo.json` con las preguntas que aparezcan.
- Los trabajos que Claude produce son de texto (CV, cartas, redacción, traducciones, planes…).
  Diseños gráficos o trabajos físicos los haces tú y los envías desde el chat.
- Revisa siempre los datos antes de entregar: Claude marca con `[COMPLETAR: ...]` lo que falte.

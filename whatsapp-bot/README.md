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

## Qué necesitas

1. **Node.js 20 o superior**.
2. **Clave de Claude**: créala en https://console.anthropic.com (API Keys). Se cobra por uso.
3. **WhatsApp Business Platform (API oficial de Meta)**. La app de WhatsApp Business del celular
   *no* se puede conectar a un bot; necesitas la API en la nube de Meta (gratis para empezar):
   1. Entra a https://developers.facebook.com → *Mis apps* → *Crear app* → tipo **Empresa**.
   2. Agrega el producto **WhatsApp**. Te da un número de prueba; luego puedes registrar tu número
      real (ese número **dejará de funcionar en la app del celular** mientras use la API).
   3. Copia el **Identificador del número de teléfono** → `WHATSAPP_PHONE_NUMBER_ID`.
   4. Crea un **token permanente**: Configuración del negocio → Usuarios del sistema → Agregar →
      Generar token con permisos `whatsapp_business_messaging` y `whatsapp_business_management`
      → `WHATSAPP_TOKEN`.
   5. En *Configuración de la app → Básica* copia la **Clave secreta** → `WHATSAPP_APP_SECRET`.

## Instalación

```bash
cd whatsapp-bot
npm install
cp .env.example .env     # y completa los valores
npm start
```

Abre `http://localhost:3000` e ingresa tu `ADMIN_TOKEN` para ver el panel.

## Publicarlo en internet (necesario para que Meta envíe los mensajes)

Meta necesita una URL pública con HTTPS. Opciones:

- **Render.com / Railway.app** (recomendado): crea un "Web Service" desde este repositorio con
  directorio raíz `whatsapp-bot`, comando `npm install` y `npm start`, y carga las variables del
  `.env` en su panel. Añade un **disco persistente** montado en `/data` y pon `DATA_DIR=/data`
  para no perder pedidos al reiniciar.
- **Pruebas en tu PC**: `npx ngrok http 3000` y usa la URL https que te da.

> GitHub Pages (donde está la web del colegio) solo sirve páginas estáticas; no puede ejecutar este bot.

Luego, en Meta → WhatsApp → **Configuración → Webhook**:

- URL de devolución de llamada: `https://TU-DOMINIO/webhook`
- Token de verificación: el mismo valor de `WHATSAPP_VERIFY_TOKEN`
- Suscríbete al campo **messages**.

Escribe al número desde otro celular: el bot debería responder.

## Personalizar precios y servicios

Edita `catalogo.json` (o la pestaña **Precios** del panel). Cada servicio tiene nombre, precio,
unidad, tiempo y los datos que el bot debe pedir al cliente. El bot **nunca** inventa precios
fuera del catálogo; si algo no está, te pasa la conversación a ti.

## El panel

- **Pedidos**: confirma pagos, mira lo que hizo Claude, edítalo, pídele que lo rehaga con
  instrucciones, y entrégalo como texto o documento Word.
- **Chats**: lee todas las conversaciones, pausa el bot en un chat para atender tú y escribe al
  cliente desde ahí. Cuando el bot detecta un reclamo o algo que no sabe resolver, se pausa solo y
  te avisa a `OWNER_PHONE`.
- **Precios**: edita el catálogo en vivo.

## Variables importantes

| Variable | Para qué |
|---|---|
| `REQUIERE_PAGO` | `true`: el trabajo empieza cuando confirmas el adelanto. `false`: empieza al confirmar el pedido. |
| `AUTO_ENTREGA` | `false` (recomendado): tú apruebas cada entrega. `true`: se envía sin revisión. |
| `OWNER_PHONE` | Tu número para recibir avisos de pedidos nuevos, listos o con problemas. |
| `CLAUDE_MODEL` | Modelo de Claude (por defecto `claude-opus-5-5`). |

## Limitaciones a tener en cuenta

- **Ventana de 24 horas de WhatsApp**: solo puedes enviar mensajes libres si el cliente te escribió
  en las últimas 24 h. Si un trabajo tarda más, la entrega puede fallar; pídele al cliente que te
  escriba o crea una *plantilla aprobada* en Meta para avisos.
- El bot entiende texto. Si el cliente manda fotos, audios o archivos, el bot lo sabe pero no ve el
  contenido; revisa esos chats en el panel.
- Los trabajos que Claude produce son de texto (CV, cartas, redacción, traducciones, planes…).
  Diseños gráficos o trabajos físicos los haces tú y los envías desde el chat.
- Revisa siempre los datos antes de entregar: Claude marca con `[COMPLETAR: ...]` lo que falte.

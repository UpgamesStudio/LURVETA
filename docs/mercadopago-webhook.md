# Firma de notificaciones de Mercado Pago

1. En **Tus integraciones**, abre la aplicación que emite los pagos y configura su evento **Pagos** en **Webhooks**. Usa la URL pública del backend con la ruta `/pagos/mercadopago/webhook`.
2. Guarda la **clave secreta de Webhooks** de esa aplicación como `MERCADOPAGO_WEBHOOK_SECRET` en el entorno correspondiente de Railway. Usa la clave de ese ambiente y conserva las credenciales que ya usa el backend para consultar los pagos.
3. Prueba primero en el entorno de pruebas. Comprueba que la notificación firmada llegue, que el producto se entregue una sola vez al repetirla y que un aviso con firma inválida obtenga HTTP 401. Repite la comprobación de recepción tras activar la variable en producción.

Cuando la variable está configurada, el servidor exige la firma antes de consultar el pago y usa el ID firmado de la URL. Durante la transición, un entorno sin la variable sigue consultando cada pago a Mercado Pago con sus credenciales y aplica límites al endpoint. Con `NODE_ENV=production` y sin la variable, el arranque registra un **error** y cada hora en que lleguen avisos sin firma se registra otro: la configuración insegura no pasa en silencio. No se corta la recepción para no dejar sin entregar los pagos pendientes; la defensa mientras tanto es que cada aviso se verifica consultando el pago a Mercado Pago con el token propio, que el monto y la moneda deben coincidir con los fijados al cobrar y que la entrega es idempotente (referencia única `mp:<id>`, un reintento o un aviso repetido no entrega dos veces y un reembolso lo revierte).

[Validación de Webhooks en Mercado Pago Developers](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/optional-notifications)

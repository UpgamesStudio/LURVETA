# Firma de notificaciones de Mercado Pago

1. En **Tus integraciones**, abre la aplicación que emite los pagos y configura su evento **Pagos** en **Webhooks**. Usa la URL pública del backend con la ruta `/pagos/mercadopago/webhook`.
2. Guarda la **clave secreta de Webhooks** de esa aplicación como `MERCADOPAGO_WEBHOOK_SECRET` en el entorno correspondiente de Railway. Usa la clave de ese ambiente y conserva las credenciales que ya usa el backend para consultar los pagos.
3. Prueba primero en el entorno de pruebas. Comprueba que la notificación firmada llegue, que el producto se entregue una sola vez al repetirla y que un aviso con firma inválida obtenga HTTP 401. Repite la comprobación de recepción tras activar la variable en producción.

Cuando la variable está configurada, el servidor exige la firma antes de consultar el pago y usa el ID firmado de la URL. Durante la transición, un entorno sin la variable sigue consultando cada pago a Mercado Pago con sus credenciales y aplica límites al endpoint. Los logs de inicio indican que falta habilitar la validación de firma.

[Validación de Webhooks en Mercado Pago Developers](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/optional-notifications)

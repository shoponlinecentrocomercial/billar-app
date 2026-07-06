'use strict';
// Configuración de entorno del cliente.
//
// En un despliegue web normal (navegador, PWA) se deja en null: el cliente
// conecta por WebSocket al mismo origen/ruta desde la que se sirvió la página.
//
// En una build nativa empaquetada con Capacitor (app de iOS/Android), la
// página se carga desde un origen local (https://localhost) y no hay "mismo
// origen" al que conectar, así que hay que fijar aquí la URL real del
// servidor de partidas, por ejemplo:
  window.BILLAR_SERVER_URL = 'wss://tacobooks.com:2087';
//window.BILLAR_SERVER_URL = null;

// Igual que arriba pero para el enlace de invitación que se comparte en el
// chat (con https:// en vez de wss://), ya que dentro de la app nativa
// location.href no es una URL que el rival pueda abrir en su navegador.
window.BILLAR_SHARE_URL = 'https://tacobooks.com:2087';
//window.BILLAR_SHARE_URL = null;

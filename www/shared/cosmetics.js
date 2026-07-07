'use strict';
// Datos de personalización (personaje, taco, tapete), compartidos entre
// servidor (validación) y cliente (dibujo). Solo datos, sin nada de canvas.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cosmetics = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // 3 mujeres, 2 hombres, cada uno con rasgos y personalidad distintos.
  const CHARACTERS = [
    { id: 'valentina', name: 'Valentina "Ojo de Águila"', gender: 'f',
      skin: '#e8b48a', hair: '#2b1a12', hairStyle: 'ponytail', outfit: '#c0392b', accessory: 'none',
      vibe: 'Calculadora y directa; nunca falla un tiro fácil.' },
    { id: 'marisol', name: 'Marisol "Mano Suave"', gender: 'f',
      skin: '#8a5a34', hair: '#160c08', hairStyle: 'bun', outfit: '#2e8b57', accessory: 'glasses',
      vibe: 'Estratega paciente, siempre un paso por delante.' },
    { id: 'noa', name: 'Noa "Relámpago"', gender: 'f',
      skin: '#f2d0b0', hair: '#caa23a', hairStyle: 'short', outfit: '#7c4dff', accessory: 'tattoo',
      vibe: 'Rápida, impulsiva, ama el riesgo.' },
    { id: 'dario', name: 'Darío "El Muro"', gender: 'm',
      skin: '#c8925f', hair: '#111111', hairStyle: 'buzz', outfit: '#f0c541', accessory: 'none',
      vibe: 'Defensivo, casi imposible de superar.' },
    { id: 'kenji', name: 'Kenji "Mano de Seda"', gender: 'm',
      skin: '#e0b98f', hair: '#1a1a1a', hairStyle: 'undercut', outfit: '#2757ba', accessory: 'glasses',
      vibe: 'Elegante y preciso, nunca se altera.' },
  ];

  const CUES = [
    { id: 'classic', name: 'Clásico', colors: ['#d8b06a', '#8a5a2a', '#4a2e12'] },
    { id: 'ebony', name: 'Ébano', colors: ['#3a3a3a', '#1c1c1c', '#050505'] },
    { id: 'neon', name: 'Neón', colors: ['#8affff', '#2fd7d7', '#0a3d3d'], glow: '#4dfcff' },
    { id: 'gold', name: 'Oro', colors: ['#fff3b0', '#e8c34a', '#7a5a10'], glow: '#ffdf70' },
  ];

  const FELTS = [
    { id: 'green', name: 'Clásico verde', base: '#1f7a43' },
    { id: 'blue', name: 'Azul torneo', base: '#1b4f8a' },
    { id: 'red', name: 'Rojo', base: '#8a1f2b' },
    { id: 'black', name: 'Negro', base: '#222222' },
  ];

  return { CHARACTERS, CUES, FELTS };
});

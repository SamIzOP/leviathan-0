// The Movement Lab is development-only: production builds drop this branch entirely.
const labReady: Promise<unknown> = import.meta.env.DEV
  ? import('../../shared/src/movement-lab').then((m) => m.registerMovementLab())
  : Promise.resolve();
// Gallery assets stay behind the server's existing development gate.
if (new URLSearchParams(location.search).get('gallery') === '1') {
  const socket = new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  );
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'hello') return;
    socket.close();
    if (message.devTools)
      void import('./gallery').then((m) => m.startGallery());
    else void labReady.then(() => import('./main'));
  };
} else void labReady.then(() => import('./main'));

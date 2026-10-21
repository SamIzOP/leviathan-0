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
    else void import('./main');
  };
} else void import('./main');

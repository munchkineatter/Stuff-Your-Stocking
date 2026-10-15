// Auto-reconnecting WebSocket. Calls onOpen(send) on every (re)connect so the
// page can re-introduce itself, and onMessage(msg) for each server message.
export function connect({ onOpen, onMessage, onStatus }) {
  let ws;
  let delay = 500;
  let queue = [];

  const send = (msg) => {
    const data = JSON.stringify(msg);
    if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    else queue.push(data);
  };

  function open() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => {
      delay = 500;
      onStatus?.(true);
      onOpen?.(send);
      for (const data of queue) ws.send(data);
      queue = [];
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    };
    ws.onclose = () => {
      onStatus?.(false);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 8000);
    };
  }

  open();
  return send;
}

export const money = (() => {
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return (n) => fmt.format(n);
})();

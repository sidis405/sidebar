import { useEffect, useRef, useState } from "react";
import { nextBackoffMs } from "../shared/backoff.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";

export type WsState = "connecting" | "open" | "reconnecting" | "closed";

export type WsApi = {
  state: WsState;
  send: (m: ClientMessage) => void;
  subscribe: (fn: (m: ServerMessage) => void) => () => void;
  /** Number of failed reconnect attempts so far (0 when freshly opened). */
  attempts: number;
};

export function useWs(): WsApi {
  const [state, setState] = useState<WsState>("connecting");
  const [attempts, setAttempts] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Set<(m: ServerMessage) => void>>(new Set());
  const attemptsRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

    const connect = () => {
      if (closedRef.current) return;
      setState(attemptsRef.current === 0 ? "connecting" : "reconnecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        attemptsRef.current = 0;
        setAttempts(0);
        setState("open");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerMessage;
          for (const fn of subscribersRef.current) fn(msg);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (closedRef.current) return;
        const delay = nextBackoffMs(attemptsRef.current);
        attemptsRef.current += 1;
        setAttempts(attemptsRef.current);
        setState("reconnecting");
        timerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };
    };

    connect();
    return () => {
      closedRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  const api: WsApi = {
    state,
    attempts,
    send: (m) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    },
    subscribe: (fn) => {
      subscribersRef.current.add(fn);
      return () => subscribersRef.current.delete(fn);
    },
  };
  return api;
}

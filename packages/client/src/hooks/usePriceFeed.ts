import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SOCKET_EVENTS, type CheckRunSummary, type PriceUpdateEvent } from "@price-tracker/shared";
import { api, type DashboardRow } from "../api";

function rowKey(productId: string, competitorSiteId: string) {
  return `${productId}::${competitorSiteId}`;
}

export function usePriceFeed() {
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastRun, setLastRun] = useState<CheckRunSummary | null>(null);
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    api.getDashboard().then(setRows).catch(console.error);

    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on(SOCKET_EVENTS.PRICE_UPDATE, (event: PriceUpdateEvent) => {
      const key = rowKey(event.product.id, event.site.id);
      setRows((prev) => {
        const idx = prev.findIndex(
          (r) => rowKey(r.product.id, r.site.id) === key
        );
        const nextRow: DashboardRow = {
          product: event.product,
          site: event.site,
          latest: event.price,
          disparity: event.disparity,
          priceChanged: event.priceChanged,
        };
        if (idx === -1) return [...prev, nextRow];
        const copy = [...prev];
        copy[idx] = nextRow;
        return copy;
      });

      setFlashKeys((prev) => new Set(prev).add(key));
      setTimeout(() => {
        setFlashKeys((prev) => {
          const copy = new Set(prev);
          copy.delete(key);
          return copy;
        });
      }, 1500);
    });

    socket.on(SOCKET_EVENTS.CHECK_RUN_COMPLETE, (summary: CheckRunSummary) => {
      setLastRun(summary);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return { rows, connected, lastRun, flashKeys, rowKey };
}

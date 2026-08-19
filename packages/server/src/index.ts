import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import cron from "node-cron";
import { DEFAULT_POLL_INTERVAL_MINUTES } from "@price-tracker/shared";
import { productsRouter } from "./routes/products";
import { sitesRouter } from "./routes/sites";
import { checksRouter } from "./routes/checks";
import { runPriceCheck } from "./priceChecker";

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const POLL_INTERVAL_MINUTES = Number(
  process.env.POLL_INTERVAL_MINUTES ?? DEFAULT_POLL_INTERVAL_MINUTES
);

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});
app.locals.io = io;

app.use("/api/products", productsRouter);
app.use("/api/sites", sitesRouter);
app.use("/api/checks", checksRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, pollIntervalMinutes: POLL_INTERVAL_MINUTES });
});

io.on("connection", (socket) => {
  socket.emit("connected", { pollIntervalMinutes: POLL_INTERVAL_MINUTES });
});

// clamp to a sane floor so a bad env var can't hammer competitor sites
const intervalMinutes = Math.max(1, POLL_INTERVAL_MINUTES);
cron.schedule(`*/${intervalMinutes} * * * *`, () => {
  runPriceCheck(io).catch((err) => {
    console.error("Scheduled price check failed:", err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Price tracker server listening on http://localhost:${PORT}`);
  console.log(`Polling competitor prices every ${intervalMinutes} minute(s)`);
});

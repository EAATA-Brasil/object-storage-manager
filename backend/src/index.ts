import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDB, pool } from "./db";
import accountRoutes from "./routes/accounts";
import replicationRoutes from "./routes/replication";
import { decrypt } from "./utils/crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

// Configuração de CORS Dinâmico
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(",") 
  : ["http://localhost:5173", "http://localhost:3000"];

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (como mobile apps ou curl) ou se estiver na whitelist
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json());

// Rotas
app.use("/api/accounts", accountRoutes);
app.use("/api/replication", replicationRoutes);

// Optimizer global config polling
app.get("/api/storage/optimizer/config", async (_req, res) => {
  try {
    const [storages]: any = await pool.query("SELECT id, endpoint, access_key, secret_key FROM storage_accounts");
    
    // Descriptografa chaves antes de mandar para o Optimizer (Python)
    const decryptedStorages = storages.map((s: any) => ({
      ...s,
      access_key: decrypt(s.access_key),
      secret_key: decrypt(s.secret_key)
    }));

    const [buckets]: any = await pool.query(`
      SELECT 
        storage_account_id as storage_id, 
        bucket_name as bucket, 
        enabled, 
        prefix_root, 
        prefix_work, 
        min_size_kb, 
        video_max_mb 
      FROM bucket_optimizer_configs
    `);

    // Converte enabled de 0/1 para true/false para o Python
    const formattedBuckets = buckets.map((b: any) => ({
      ...b,
      enabled: !!b.enabled
    }));

    res.json({
      storages: decryptedStorages,
      buckets: formattedBuckets
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch optimizer config" });
  }
});

async function start() {
  try {
    await initDB();
    console.log("MySQL initialized and tables verified");
    
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();

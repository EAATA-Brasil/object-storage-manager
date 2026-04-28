import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDB, pool } from "./db";
import accountRoutes from "./routes/accounts";
import replicationRoutes from "./routes/replication";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

// Rotas
app.use("/api/accounts", accountRoutes);
app.use("/api/replication", replicationRoutes);

// Optimizer global config polling
app.get("/api/storage/optimizer/config", async (_req, res) => {
  try {
    const [storages] = await pool.query("SELECT id, endpoint, access_key, secret_key FROM storage_accounts");
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
      storages,
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
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();

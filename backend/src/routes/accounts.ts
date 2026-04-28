import { Router } from "express";
import { pool, getManagerInstanceId } from "../db";
import { v4 as uuidv4 } from "uuid";
import { 
  createS3Client, 
  getBuckets, 
  getBucketAnalytics, 
  getBucketLifecycle, 
  setBucketLifecycle, 
  getBucketNotification,
  setBucketNotification,
  getBucketVersioning,
  setBucketVersioning,
  updateBucketAccessPolicy
} from "../services/s3";

const router = Router();

// Helper to setup notification
async function setupOptimizerNotification(storageId: string, bucketName: string) {
  try {
    const [rows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [storageId]);
    const account = rows[0];
    if (!account) return;

    // Busca todos os prefixos ativos para este bucket
    const [configs]: any = await pool.query(
      "SELECT prefix_root FROM bucket_optimizer_configs WHERE storage_account_id = ? AND bucket_name = ? AND enabled = 1",
      [storageId, bucketName]
    );

    const prefixes = configs.map((c: any) => c.prefix_root);

    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    await setBucketNotification(client, bucketName, prefixes);
    console.log(`Auto-notification updated for ${bucketName}. Total prefixes: ${prefixes.length}`);
  } catch (err) {
    console.error(`Auto-notification setup FAILED for ${bucketName}:`, err);
  }
}

async function setupBucketPolicy(storageId: string, bucketName: string) {
  try {
    const [rows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [storageId]);
    const account = rows[0];
    if (!account) return;

    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    // Busca configurações das pastas
    const [folderConfigs]: any = await pool.query(
      "SELECT prefix_root as prefix, access_policy as policy, custom_policy as custom FROM bucket_optimizer_configs WHERE storage_account_id = ? AND bucket_name = ?",
      [storageId, bucketName]
    );

    await updateBucketAccessPolicy(
      client, 
      bucketName, 
      { policy: account.access_policy, custom: account.custom_policy },
      folderConfigs
    );
    
    console.log(`Bucket policy updated for ${bucketName} (Global: ${account.access_policy}, Folders: ${folderConfigs.length})`);
  } catch (err) {
    console.error(`Bucket policy update FAILED for ${bucketName}:`, err);
  }
}

async function syncOptimizerConfigToS3(storageId: string, bucketName: string, forceOwnerUrl?: string) {
  try {
    const [rows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [storageId]);
    const account = rows[0];
    if (!account) return;

    const [configs]: any = await pool.query(
      "SELECT * FROM bucket_optimizer_configs WHERE storage_account_id = ? AND bucket_name = ?",
      [storageId, bucketName]
    );

    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    const managerId = await getManagerInstanceId();

    // Wrapper com ID ÚNICO da instância
    const persistenceData = {
      version: 1,
      manager_id: managerId,
      last_sync_owner: forceOwnerUrl || process.env.PUBLIC_OPTIMIZER_URL || "unknown",
      configs: configs
    };

    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: ".manager-config/optimizer.json",
      Body: JSON.stringify(persistenceData, null, 2),
      ContentType: "application/json"
    }));

    console.log(`Optimizer config persisted to S3 for ${bucketName} (ManagerID: ${managerId})`);
  } catch (err) {
    console.error(`S3 persistence FAILED for ${bucketName}:`, err);
  }
}

async function setupAutoLifecycle(storageId: string, bucketName: string, workPrefix: string, enabled: boolean) {
  try {
    const [rows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [storageId]);
    const account = rows[0];
    if (!account) return;

    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    const currentConfig = await getBucketLifecycle(client, bucketName);
    const ruleId = `AutoCleanup-${workPrefix.replace(/[^a-zA-Z0-9]/g, "-")}`;
    
    // Filtra regras antigas deste prefixo
    let rules = (currentConfig.Rules || []).filter((r: any) => r.ID !== ruleId);

    if (enabled) {
      rules.push({
        ID: ruleId,
        Status: "Enabled",
        Filter: { Prefix: workPrefix },
        Expiration: { Days: 1 }
      });
    }

    await setBucketLifecycle(client, bucketName, rules);
    console.log(`Auto-lifecycle setup ${enabled ? "ON" : "OFF"} for ${bucketName}/${workPrefix}`);
  } catch (err) {
    console.error(`Auto-lifecycle setup FAILED for ${bucketName}/${workPrefix}:`, err);
  }
}

// CRUD Accounts
router.get("/", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, name, endpoint, region, access_key, provider, created_at FROM storage_accounts");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

router.post("/", async (req, res) => {
  const { name, endpoint, region, access_key, secret_key, provider } = req.body;
  const id = uuidv4();
  
  try {
    await pool.query(
      "INSERT INTO storage_accounts (id, name, endpoint, region, access_key, secret_key, provider) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, name, endpoint, region || "us-east-1", access_key, secret_key, provider || "minio"]
    );
    res.json({ id, name });
  } catch (err) {
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM storage_accounts WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// S3 Operations
router.get("/:id/buckets", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account: any = (rows as any[])[0];
    
    if (!account) return res.status(404).json({ error: "Account not found" });

    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    const data = await getBuckets(client);
    res.json(data.Buckets || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/buckets/:bucketName/versioning", async (req, res) => {
  const { id, bucketName } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account: any = (rows as any[])[0];
    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });
    const data = await getBucketVersioning(client, bucketName);
    res.json({ enabled: data.Status === "Enabled" });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/buckets/:bucketName/versioning", async (req, res) => {
  const { id, bucketName } = req.params;
  const { enabled } = req.body;
  try {
    const [rows] = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account: any = (rows as any[])[0];
    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });
    await setBucketVersioning(client, bucketName, enabled);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/buckets/:bucketName/access-policy", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows]: any = await pool.query("SELECT access_policy, custom_policy FROM storage_accounts WHERE id = ?", [id]);
    res.json({ 
      policy: rows[0]?.access_policy || 'private',
      custom: rows[0]?.custom_policy ? JSON.parse(rows[0].custom_policy) : null
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/buckets/:bucketName/access-policy", async (req, res) => {
  const { id, bucketName } = req.params;
  const { policy, custom } = req.body;
  try {
    await pool.query("UPDATE storage_accounts SET access_policy = ?, custom_policy = ? WHERE id = ?", [policy, custom ? JSON.stringify(custom) : null, id]);
    await setupBucketPolicy(id, bucketName);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/buckets/:bucketName/analytics", async (req, res) => {
  const { id, bucketName } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account: any = (rows as any[])[0];
    
    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    const analytics = await getBucketAnalytics(client, bucketName);
    res.json(analytics);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/buckets/:bucketName/lifecycle", async (req, res) => {
  const { id, bucketName } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account: any = (rows as any[])[0];
    
    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    const lifecycle = await getBucketLifecycle(client, bucketName);
    res.json(lifecycle);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/buckets/:bucketName/lifecycle", async (req, res) => {
  const { id, bucketName } = req.params;
  const { rules } = req.body;
  try {
    const [rows] = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account: any = (rows as any[])[0];
    
    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    await setBucketLifecycle(client, bucketName, rules);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Optimizer Configs
router.get("/:id/buckets/:bucketName/optimizer", async (req, res) => {
  const { id, bucketName } = req.params;
  try {
    // 1. Tenta buscar do banco local
    const [rows]: any = await pool.query(
      "SELECT * FROM bucket_optimizer_configs WHERE storage_account_id = ? AND bucket_name = ?",
      [id, bucketName]
    );
    
    if (rows.length > 0) {
      return res.json(rows);
    }

    // 2. Se não tem no banco, tenta buscar no S3 (Auto-discovery)
    const [accRows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account = accRows[0];
    if (!account) return res.json([]);

    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const s3Response = await client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: ".manager-config/optimizer.json"
      }));
      
      const bodyContents = await s3Response.Body?.transformToString();
      if (bodyContents) {
        const remoteConfigs = JSON.parse(bodyContents);
        console.log(`Auto-discovered ${remoteConfigs.length} optimizer configs in S3 for ${bucketName}. Importing...`);
        
        // 3. Importa para o banco local
        for (const cfg of remoteConfigs) {
          await pool.query(`
            INSERT IGNORE INTO bucket_optimizer_configs 
            (storage_account_id, bucket_name, enabled, prefix_root, prefix_work, min_size_kb, video_max_mb, auto_lifecycle, access_policy, custom_policy)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [id, bucketName, cfg.enabled, cfg.prefix_root, cfg.prefix_work, cfg.min_size_kb, cfg.video_max_mb, cfg.auto_lifecycle, cfg.access_policy, cfg.custom_policy]);
        }

        // Retorna os dados recém-importados
        const [newRows]: any = await pool.query(
          "SELECT * FROM bucket_optimizer_configs WHERE storage_account_id = ? AND bucket_name = ?",
          [id, bucketName]
        );
        return res.json(newRows);
      }
    } catch (s3Err: any) {
      // Arquivo não existe no S3, tudo bem
      if (s3Err.name !== 'NoSuchKey') {
        console.warn(`S3 Discovery error for ${bucketName}:`, s3Err.message);
      }
    }

    res.json([]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/buckets/:bucketName/optimizer", async (req, res) => {
  const { id, bucketName } = req.params;
  const { enabled, prefix_root, prefix_work, min_size_kb, video_max_mb, auto_lifecycle, access_policy, custom_policy } = req.body;
  console.log(`Setting up optimizer for bucket ${bucketName}, id ${id}. Body:`, req.body);
  try {
    await pool.query(`
      INSERT INTO bucket_optimizer_configs 
      (storage_account_id, bucket_name, enabled, prefix_root, prefix_work, min_size_kb, video_max_mb, auto_lifecycle, access_policy, custom_policy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, bucketName, enabled, prefix_root, prefix_work, min_size_kb, video_max_mb, auto_lifecycle, access_policy || 'private', custom_policy ? JSON.stringify(custom_policy) : null]);
    
    // Sempre atualiza as notificações do bucket
    await setupOptimizerNotification(id, bucketName);

    // Atualiza política de acesso
    await setupBucketPolicy(id, bucketName);

    if (auto_lifecycle) {
      console.log(`Enabling auto-lifecycle for ${bucketName}/${prefix_work}`);
      await setupAutoLifecycle(id, bucketName, prefix_work, true);
    }

    // NOVO: Aplica a política de acesso definida no Optimizer à pasta TEMP (prefix_work)
    if (access_policy) {
      await pool.query(`
        INSERT INTO bucket_folder_policies (storage_account_id, bucket_name, folder_prefix, policy, custom_policy)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE policy = VALUES(policy), custom_policy = VALUES(custom_policy)
      `, [id, bucketName, prefix_work, access_policy, custom_policy ? JSON.stringify(custom_policy) : null]);
      
      await setupBucketPolicy(id, bucketName);
    }
    
    await syncOptimizerConfigToS3(id, bucketName);
    res.json({ success: true });
  } catch (err: any) {
    console.error("CRITICAL ERROR in POST /optimizer:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

router.put("/:id/buckets/:bucketName/optimizer/:configId", async (req, res) => {
  const { id, bucketName, configId } = req.params;
  const { enabled, prefix_root, prefix_work, min_size_kb, video_max_mb, auto_lifecycle, access_policy, custom_policy } = req.body;

  console.log(`Updating optimizer config ${configId} for bucket ${bucketName}. Lifecycle: ${auto_lifecycle}`);

  try {
    await pool.query(`
      UPDATE bucket_optimizer_configs 
      SET enabled = ?, prefix_root = ?, prefix_work = ?, min_size_kb = ?, video_max_mb = ?, auto_lifecycle = ?, access_policy = ?, custom_policy = ?
      WHERE id = ?
    `, [
      enabled ? 1 : 0, 
      prefix_root, 
      prefix_work, 
      Number(min_size_kb) || 0, 
      Number(video_max_mb) || 0, 
      auto_lifecycle ? 1 : 0, 
      access_policy || 'private',
      custom_policy ? JSON.stringify(custom_policy) : null,
      configId
    ]);

    // Sempre atualiza as notificações do bucket (adiciona ou remove conforme 'enabled')
    await setupOptimizerNotification(id, bucketName);

    // Atualiza política de acesso
    await setupBucketPolicy(id, bucketName);

    // Configura ou remove o ciclo de vida automático
    await setupAutoLifecycle(id, bucketName, prefix_work, !!auto_lifecycle);

    // NOVO: Aplica a política de acesso definida no Optimizer à pasta TEMP (prefix_work)
    if (access_policy) {
      await pool.query(`
        INSERT INTO bucket_folder_policies (storage_account_id, bucket_name, folder_prefix, policy, custom_policy)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE policy = VALUES(policy), custom_policy = VALUES(custom_policy)
      `, [id, bucketName, prefix_work, access_policy, custom_policy ? JSON.stringify(custom_policy) : null]);
      
      await setupBucketPolicy(id, bucketName);
    }

    await syncOptimizerConfigToS3(id, bucketName);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error updating optimizer config:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/buckets/:bucketName/optimizer/:configId", async (req, res) => {
  const { id, bucketName, configId } = req.params;
  try {
    await pool.query("DELETE FROM bucket_optimizer_configs WHERE id = ?", [configId]);
    
    // Atualiza as notificações para remover o prefixo deletado
    await setupOptimizerNotification(id, bucketName);

    // Atualiza política de acesso
    await setupBucketPolicy(id, bucketName);

    await syncOptimizerConfigToS3(id, bucketName);
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error deleting optimizer config:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/buckets/:bucketName/optimizer-stats", async (req, res) => {
  const { id, bucketName } = req.params;
  try {
    const [rows]: any = await pool.query(`
      SELECT 
        COUNT(*) as count,
        SUM(bytes_before) as total_before,
        SUM(bytes_after) as total_after
      FROM processed_files 
      WHERE storage_account_id = ? AND bucket_name = ?
    `, [id, bucketName]);
    
    const stats = rows[0];
    const saved = (stats.total_before || 0) - (stats.total_after || 0);
    
    res.json({
      count: stats.count || 0,
      total_before: stats.total_before || 0,
      total_after: stats.total_after || 0,
      bytes_saved: saved > 0 ? saved : 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/buckets/:bucketName/log-processed", async (req, res) => {
  const { id, bucketName } = req.params;
  const { file_key, file_type, bytes_before, bytes_after } = req.body;
  try {
    await pool.query(`
      INSERT INTO processed_files (storage_account_id, bucket_name, file_key, file_type, bytes_before, bytes_after)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, bucketName, file_key, file_type, bytes_before, bytes_after]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sync entire bucket optimizer infrastructure
router.post("/:id/buckets/:bucketName/optimizer-sync-infra", async (req, res) => {
  const { id, bucketName } = req.params;
  try {
    const [configs]: any = await pool.query(
      "SELECT * FROM bucket_optimizer_configs WHERE storage_account_id = ? AND bucket_name = ?",
      [id, bucketName]
    );

    if (configs.length === 0) {
      return res.status(404).json({ error: "No optimizer configs found to sync" });
    }

    // 1. Reconfigura notificações (aponta para este ambiente)
    await setupOptimizerNotification(id, bucketName);

    // 2. Reconfigura políticas de acesso
    await setupBucketPolicy(id, bucketName);

    // 3. Reconfigura lifecycles para cada pasta
    for (const cfg of configs) {
      await setupAutoLifecycle(id, bucketName, cfg.prefix_work, !!cfg.auto_lifecycle);
    }

    // 4. Registra este ambiente como o novo dono no S3
    await syncOptimizerConfigToS3(id, bucketName);

    res.json({ success: true, message: "Infrastructure synced to this environment" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sync status check
router.get("/:id/buckets/:bucketName/optimizer-sync-status", async (req, res) => {
  const { id, bucketName } = req.params;
  try {
    const [accRows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [id]);
    const account = accRows[0];
    if (!account) return res.json({ synced: false });

    const client = createS3Client({
      endpoint: account.endpoint,
      accessKeyId: account.access_key,
      secretAccessKey: account.secret_key,
      region: account.region,
    });

    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const s3Response = await client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: ".manager-config/optimizer.json"
      }));
      
      const bodyContents = await s3Response.Body?.transformToString();
      if (bodyContents) {
        const remoteData = JSON.parse(bodyContents);
        const myId = await getManagerInstanceId();
        
        // Validação DUPLA: ID da Instância e URL (opcional, ID é o mais forte)
        const isSynced = remoteData.manager_id === myId;
        return res.json({ synced: isSynced });
      }
    } catch (s3Err: any) {
      //NoSuchKey etc
    }

    res.json({ synced: false });
  } catch (err) {
    res.json({ synced: false });
  }
});

// Trigger Batch Optimization
router.post("/:id/buckets/:bucketName/optimizer/:configId/run-batch", async (req, res) => {
  const { id, bucketName } = req.params;
  const { prefix, dry_run, limit } = req.body;
  
  try {
    const optimizerUrl = process.env.OPTIMIZER_URL || "http://localhost:8000";
    const params = new URLSearchParams();
    params.append("storage_id", id);
    params.append("bucket", bucketName);
    if (prefix) params.append("prefix", prefix);
    if (dry_run) params.append("dry_run", "true");
    if (limit) params.append("limit", limit.toString());

    const response = await fetch(`${optimizerUrl}/batch?${params.toString()}`, {
      method: "POST",
    });

    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.error("Failed to trigger batch:", err);
    res.status(500).json({ error: "Failed to trigger batch optimization", details: err.message });
  }
});

// Folder-specific policies
router.post("/:id/buckets/:bucketName/folder-policy", async (req, res) => {
  const { id, bucketName } = req.params;
  const { prefix, policy, custom } = req.body;
  try {
    await pool.query(`
      INSERT INTO bucket_folder_policies (storage_account_id, bucket_name, folder_prefix, policy, custom_policy)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE policy = VALUES(policy), custom_policy = VALUES(custom_policy)
    `, [id, bucketName, prefix, policy, custom ? JSON.stringify(custom) : null]);
    
    await setupBucketPolicy(id, bucketName);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

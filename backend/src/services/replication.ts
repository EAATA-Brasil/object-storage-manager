import { exec } from "child_process";
import { promisify } from "util";
import { pool } from "../db";
import { decrypt } from "../utils/crypto";

const execAsync = promisify(exec);

// Diretório temporário para configurações do MC (evita erro de permissão no Docker)
const MC_CONFIG_DIR = "/tmp/.mc";

/**
 * Configura um alias no MC para uma conta de storage.
 */
async function setMCAlias(storageId: string) {
  const [rows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [storageId]);
  const account = rows[0];
  if (!account) throw new Error(`Storage account ${storageId} not found`);

  // Alias precisa começar com letra e ser alfanumérico
  const alias = `acc${storageId.replace(/-/g, '')}`;
  
  const access = decrypt(account.access_key);
  const secret = decrypt(account.secret_key);

  const cmd = `mc --config-dir ${MC_CONFIG_DIR} alias set "${alias}" "${account.endpoint}" "${access}" "${secret}"`;
  
  try {
    await execAsync(cmd);
    return alias;
  } catch (err: any) {
    console.error(`FAILED to set MC alias for ${storageId}:`, err.message);
    throw new Error(`CLI Error: Failed to connect to storage account`);
  }
}

/**
 * Garante que o versionamento está ativado (requisito para replicação).
 */
async function ensureVersioning(storageId: string, bucketName: string) {
  const alias = await setMCAlias(storageId);
  const cmd = `mc --config-dir ${MC_CONFIG_DIR} version enable "${alias}/${bucketName}"`;
  await execAsync(cmd);
}

/**
 * Configura replicação de bucket (Bucket-to-Bucket).
 */
export async function setupBucketReplication(config: ReplicationConfig) {
  const { source_storage_id, source_bucket, target_storage_id, target_bucket, priority } = config;
  
  if (!source_bucket || !target_bucket) throw new Error("Source and target buckets are required for bucket replication");

  const sourceAlias = await setMCAlias(source_storage_id);
  const targetAlias = await setMCAlias(target_storage_id);

  // 1. Ativa versionamento em ambos (obrigatório)
  await ensureVersioning(source_storage_id, source_bucket);
  await ensureVersioning(target_storage_id, target_bucket);

  const [targetRows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [target_storage_id]);
  const target = targetRows[0];

  const escapedAccess = encodeURIComponent(decrypt(target.access_key));
  const escapedSecret = encodeURIComponent(decrypt(target.secret_key));
  
  const remoteUrl = target.endpoint.replace("http://", "").replace("https://", "");
  const protocol = target.endpoint.startsWith("https") ? "https" : "http";
  const remoteBucketUrl = `${protocol}://${escapedAccess}:${escapedSecret}@${remoteUrl}/${target_bucket}`;

  let cmd = `mc --config-dir ${MC_CONFIG_DIR} replicate add "${sourceAlias}/${source_bucket}" --remote-bucket "${remoteBucketUrl}"`;
  
  if (priority !== undefined) {
    cmd += ` --priority ${priority}`;
  }

  const { stdout, stderr } = await execAsync(cmd, { timeout: 20000 });
  return { stdout, stderr };
}

/**
 * Configura Site Replication (Espelhamento de Cluster Inteiro).
 */
export async function setupSiteReplication(sourceId: string, targetId: string) {
  const sourceAlias = await setMCAlias(sourceId);
  const targetAlias = await setMCAlias(targetId);

  const cmd = `mc --config-dir ${MC_CONFIG_DIR} admin replicate add "${sourceAlias}" "${targetAlias}"`;
  const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
  return { stdout, stderr };
}

/**
 * Lista as replicações ativas em um bucket.
 */
export async function listReplications(storageId: string, bucketName: string) {
  try {
    const alias = await setMCAlias(storageId);
    const cmd = `mc --config-dir ${MC_CONFIG_DIR} replicate ls "${alias}/${bucketName}" --json`;
    const { stdout } = await execAsync(cmd);
    return stdout.split("\n")
      .filter(l => l.trim())
      .map(l => {
        try {
          const parsed = JSON.parse(l);
          return parsed.rule || parsed;
        } catch (e) { return null; }
      })
      .filter(r => r && r.ID);
  } catch (e: any) {
    console.warn(`Replication list failed for ${bucketName}:`, e.message);
    return [];
  }
}

/**
 * Status do Site Replication.
 */
export async function getSiteReplicationStatus(storageId: string) {
  try {
    const alias = await setMCAlias(storageId);
    const cmd = `mc --config-dir ${MC_CONFIG_DIR} admin replicate info "${alias}" --json`;
    const { stdout } = await execAsync(cmd);
    const data = JSON.parse(stdout);
    if (!data || !data.sites || data.sites.length <= 1) return null;
    return data;
  } catch (e: any) {
    // Retorna null se não for um cluster ou comando falhar
    return null;
  }
}

/**
 * Remove uma regra de replicação de bucket.
 */
export async function removeBucketReplication(storageId: string, bucketName: string, ruleId: string) {
  const alias = await setMCAlias(storageId);
  const cmd = `mc --config-dir ${MC_CONFIG_DIR} replicate rm "${alias}/${bucketName}" --id "${ruleId}"`;
  const { stdout, stderr } = await execAsync(cmd);
  return { stdout, stderr };
}

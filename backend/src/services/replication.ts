import { exec } from "child_process";
import { promisify } from "util";
import { pool } from "../db";

const execAsync = promisify(exec);

export interface ReplicationConfig {
  source_storage_id: string;
  source_bucket?: string;
  target_storage_id: string;
  target_bucket?: string;
  type: 'bucket' | 'site';
  priority?: number;
}

/**
 * Configura um alias no MC para uma conta de storage.
 * Gera um alias compatível (começa com letra e sem hífens).
 */
async function setMCAlias(storageId: string) {
  const [rows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [storageId]);
  const account = rows[0];
  if (!account) throw new Error(`Storage account ${storageId} not found`);

  // Alias precisa começar com letra e ser alfanumérico
  const alias = `acc${storageId.replace(/-/g, '')}`;
  
  const cmd = `mc alias set "${alias}" "${account.endpoint}" "${account.access_key}" "${account.secret_key}"`;
  await execAsync(cmd);
  return alias;
}

/**
 * Garante que o versionamento está ativado (requisito para replicação).
 */
async function ensureVersioning(storageId: string, bucketName: string) {
  const alias = await setMCAlias(storageId);
  const cmd = `mc version enable "${alias}/${bucketName}"`;
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

  // 2. Obtém as credenciais do alvo para montar a URL de replicação
  const [targetRows]: any = await pool.query("SELECT * FROM storage_accounts WHERE id = ?", [target_storage_id]);
  const target = targetRows[0];

  // 3. Adiciona a regra de replicação
  const escapedAccess = encodeURIComponent(target.access_key);
  const escapedSecret = encodeURIComponent(target.secret_key);
  
  const remoteUrl = target.endpoint.replace("http://", "").replace("https://", "");
  const protocol = target.endpoint.startsWith("https") ? "https" : "http";
  const remoteBucketUrl = `${protocol}://${escapedAccess}:${escapedSecret}@${remoteUrl}/${target_bucket}`;

  let cmd = `mc replicate add "${sourceAlias}/${source_bucket}" --remote-bucket "${remoteBucketUrl}"`;
  
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

  // No MinIO, Site Replication exige que os sites sejam "pareados"
  const cmd = `mc admin replicate add "${sourceAlias}" "${targetAlias}"`;
  const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
  
  return { stdout, stderr };
}

/**
 * Lista as replicações ativas em um bucket.
 */
export async function listReplications(storageId: string, bucketName: string) {
  const alias = await setMCAlias(storageId);
  const cmd = `mc replicate ls "${alias}/${bucketName}" --json`;
  try {
    const { stdout } = await execAsync(cmd);
    return stdout.split("\n")
      .filter(l => l.trim())
      .map(l => {
        try {
          const parsed = JSON.parse(l);
          // O mc retorna a regra dentro de um campo 'rule'
          return parsed.rule || parsed;
        } catch (e) { return null; }
      })
      .filter(r => r && r.ID); // Filtra apenas regras válidas com ID
  } catch (e) {
    return [];
  }
}

/**
 * Status do Site Replication.
 * Retorna null se não houver replicação ativa (mais de 1 site).
 */
export async function getSiteReplicationStatus(storageId: string) {
  const alias = await setMCAlias(storageId);
  const cmd = `mc admin replicate info "${alias}" --json`;
  try {
    const { stdout } = await execAsync(cmd);
    const data = JSON.parse(stdout);
    // Se não houver campo 'sites' ou só houver 1 site, não é um cluster
    if (!data || !data.sites || data.sites.length <= 1) return null;
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * Remove uma regra de replicação de bucket.
 */
export async function removeBucketReplication(storageId: string, bucketName: string, ruleId: string) {
  const alias = await setMCAlias(storageId);
  // mc replicate rm ALIAS/BUCKET --id "RULE_ID"
  const cmd = `mc replicate rm "${alias}/${bucketName}" --id "${ruleId}"`;
  const { stdout, stderr } = await execAsync(cmd);
  return { stdout, stderr };
}

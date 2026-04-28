import { 
  S3Client, 
  ListBucketsCommand, 
  ListObjectsV2Command, 
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketNotificationConfigurationCommand,
  PutBucketNotificationConfigurationCommand,
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  GetBucketPolicyCommand,
  PutBucketPolicyCommand,
  DeleteBucketPolicyCommand
} from "@aws-sdk/client-s3";

export interface S3Credentials {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export function createS3Client(creds: S3Credentials) {
  return new S3Client({
    endpoint: creds.endpoint,
    region: creds.region || "us-east-1",
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
    forcePathStyle: true, // Necessário para MinIO e outros S3-compatible
  });
}

export async function getBuckets(client: S3Client) {
  const cmd = new ListBucketsCommand({});
  return client.send(cmd);
}

export async function getBucketVersioning(client: S3Client, bucket: string) {
  const cmd = new GetBucketVersioningCommand({ Bucket: bucket });
  return client.send(cmd);
}

export async function setBucketVersioning(client: S3Client, bucket: string, enabled: boolean) {
  const cmd = new PutBucketVersioningCommand({
    Bucket: bucket,
    VersioningConfiguration: {
      Status: enabled ? "Enabled" : "Suspended"
    }
  });
  return client.send(cmd);
}

export async function getBucketPolicy(client: S3Client, bucket: string) {
  try {
    const cmd = new GetBucketPolicyCommand({ Bucket: bucket });
    const response = await client.send(cmd);
    return response.Policy ? JSON.parse(response.Policy) : null;
  } catch (err: any) {
    if (err.name === "NoSuchBucketPolicy") return null;
    throw err;
  }
}

export async function setBucketPolicy(client: S3Client, bucket: string, policy: any) {
  const cmd = new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: JSON.stringify(policy)
  });
  return client.send(cmd);
}

/**
 * Gera uma declaração de política para um prefixo e um conjunto de ações.
 */
function generateStatement(bucket: string, prefix: string, actions: string[], sid: string) {
  const resource = prefix === "" ? `arn:aws:s3:::${bucket}/*` : `arn:aws:s3:::${bucket}/${prefix}*`;
  
  const statements: any[] = [];
  
  // Ações que se aplicam aos objetos (Resource: bucket/prefix*)
  const objectActions = actions.filter(a => a !== "s3:ListBucket");
  if (objectActions.length > 0) {
    statements.push({
      Sid: sid + "Obj",
      Effect: "Allow",
      Principal: "*",
      Action: objectActions,
      Resource: resource
    });
  }

  // Ação ListBucket (Resource: bucket apenas, mas com condição de prefixo)
  if (actions.includes("s3:ListBucket")) {
    statements.push({
      Sid: sid + "List",
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:ListBucket"],
      Resource: `arn:aws:s3:::${bucket}`,
      Condition: prefix === "" ? {} : {
        StringLike: { "s3:prefix": [`${prefix}*`] }
      }
    });
  }

  return statements;
}

/**
 * Atualiza a política do bucket com base em regras globais e por prefixo.
 */
export async function updateBucketAccessPolicy(
  client: S3Client, 
  bucket: string, 
  globalConfig: { policy: string, custom?: string },
  folderConfigs: Array<{ prefix: string, policy: string, custom?: string }>
) {
  const statements: any[] = [];

  // 1. Regra Global
  if (globalConfig.policy === 'public') {
    statements.push(...generateStatement(bucket, "", ["s3:GetObject"], "GlobalPublic"));
  } else if (globalConfig.policy === 'custom' && globalConfig.custom) {
    try {
      const perms = JSON.parse(globalConfig.custom);
      const actions = Object.entries(perms).filter(([_, v]) => v).map(([k]) => k);
      if (actions.length > 0) {
        statements.push(...generateStatement(bucket, "", actions, "GlobalCustom"));
      }
    } catch (e) {}
  }

  // 2. Regras por Pasta (apenas se a global não for total public)
  // Nota: Se a global for public GetObject, ainda podemos querer adicionar Write custom em pastas.
  for (const [idx, folder] of folderConfigs.entries()) {
    if (folder.policy === 'public') {
      statements.push(...generateStatement(bucket, folder.prefix, ["s3:GetObject"], `FolderPublic${idx}`));
    } else if (folder.policy === 'custom' && folder.custom) {
      try {
        const perms = JSON.parse(folder.custom);
        const actions = Object.entries(perms).filter(([_, v]) => v).map(([k]) => k);
        if (actions.length > 0) {
          statements.push(...generateStatement(bucket, folder.prefix, actions, `FolderCustom${idx}`));
        }
      } catch (e) {}
    }
  }

  if (statements.length === 0) {
    try {
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
    } catch (e) {}
    return;
  }

  const policy = {
    Version: "2012-10-17",
    Statement: statements
  };

  await setBucketPolicy(client, bucket, policy);
}

interface FolderNode {
  name: string;
  fullPath: string;
  size: number;
  count: number;
  children: Record<string, FolderNode>;
}

export async function getBucketAnalytics(client: S3Client, bucket: string) {
  let totalSize = 0;
  let objectCount = 0;
  let isTruncated = true;
  let continuationToken: string | undefined = undefined;

  const root: FolderNode = {
    name: "raiz",
    fullPath: "",
    size: 0,
    count: 0,
    children: {}
  };

  while (isTruncated) {
    const cmd: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    });
    
    const response = await client.send(cmd);
    
    if (response.Contents) {
      for (const obj of response.Contents) {
        const size = obj.Size || 0;
        const key = obj.Key || "";
        totalSize += size;
        objectCount += 1;

        // Processa o caminho para construir a árvore
        const parts = key.split("/");
        let currentNode = root;
        let currentPath = "";

        // Se o arquivo estiver numa pasta, parts terá mais de 1 elemento (ou o último é o arquivo)
        // Percorremos apenas até o penúltimo elemento (as pastas)
        for (let i = 0; i < parts.length - 1; i++) {
          const folderName = parts[i] + "/";
          currentPath += folderName;

          if (!currentNode.children[folderName]) {
            currentNode.children[folderName] = {
              name: folderName,
              fullPath: currentPath,
              size: 0,
              count: 0,
              children: {}
            };
          }
          
          currentNode = currentNode.children[folderName];
          currentNode.size += size;
          currentNode.count += 1;
        }

        // Adiciona o tamanho ao nó raiz (total do bucket)
        root.size += size;
        root.count += 1;
      }
    }
    
    isTruncated = !!response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }

  // Função para converter o mapa recursivo em arrays ordenados para o frontend
  const formatNode = (node: FolderNode): any => {
    const children = Object.values(node.children)
      .map(formatNode)
      .sort((a, b) => b.size - a.size);
    
    return {
      name: node.name,
      fullPath: node.fullPath,
      size: node.size,
      count: node.count,
      children: children.length > 0 ? children : undefined
    };
  };

  return { 
    totalSize, 
    objectCount, 
    tree: formatNode(root).children || [] 
  };
}

export async function getBucketLifecycle(client: S3Client, bucket: string) {
  try {
    const cmd = new GetBucketLifecycleConfigurationCommand({ Bucket: bucket });
    return await client.send(cmd);
  } catch (err: any) {
    if (err.name === "NoSuchLifecycleConfiguration") {
      return { Rules: [] };
    }
    throw err;
  }
}

export async function setBucketLifecycle(client: S3Client, bucket: string, rules: any[]) {
  const cmd = new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: { Rules: rules },
  });
  return client.send(cmd);
}

export async function getBucketNotification(client: S3Client, bucket: string) {
  try {
    const cmd = new GetBucketNotificationConfigurationCommand({ Bucket: bucket });
    return await client.send(cmd);
  } catch (err: any) {
    return {};
  }
}

export async function setBucketNotification(client: S3Client, bucket: string, prefixes: string[]) {
  const cmd = new PutBucketNotificationConfigurationCommand({
    Bucket: bucket,
    NotificationConfiguration: {
      QueueConfigurations: prefixes.map(prefix => ({
        Id: `Optimizer-${prefix.replace(/[^a-zA-Z0-9]/g, "-")}`,
        QueueArn: "arn:minio:sqs::1:webhook",
        Events: ["s3:ObjectCreated:*"],
        Filter: {
          Key: {
            FilterRules: [
              { Name: "prefix", Value: prefix }
            ]
          }
        }
      }))
    }
  });
  return client.send(cmd);
}

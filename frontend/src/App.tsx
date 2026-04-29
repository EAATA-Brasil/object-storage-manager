import { useState, useEffect, useRef } from "react";
import "./App.css";
import ReplicationPanel from "./ReplicationPanel";

interface StorageAccount {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  provider: string;
  replicationStatus?: {
    isCluster: boolean;
    hasBucketReplication: boolean;
  };
}

interface Bucket {
  Name: string;
  CreationDate: string;
}

interface FolderNode {
  name: string;
  fullPath: string;
  size: number;
  count: number;
  children?: FolderNode[];
}

interface Analytics {
  totalSize: number;
  objectCount: number;
  tree: FolderNode[];
}

const FolderRow = ({ 
  node, 
  depth, 
  onUseInLifecycle, 
  onUseInOptimizer,
  onUpdateFolderPolicy,
  formatSize 
}: { 
  node: FolderNode; 
  depth: number; 
  onUseInLifecycle: (path: string) => void;
  onUseInOptimizer: (path: string) => void;
  onUpdateFolderPolicy: (path: string, policy: string) => void;
  formatSize: (b: number) => string;
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <>
      <tr>
        <td style={{ paddingLeft: `${depth * 24 + 16}px` }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {hasChildren ? (
              <button className="toggle-btn" onClick={() => setExpanded(!expanded)}>
                {expanded ? "▼" : "▶"}
              </button>
            ) : <span style={{width: '36px'}}></span>}
            <span className="folder-name">{node.name}</span>
          </div>
        </td>
        <td>{node.count} arquivos</td>
        <td style={{ fontWeight: '700' }}>{formatSize(node.size)}</td>
        <td className="folder-actions-cell">
          <div className="folder-actions-wrapper">
            <select 
              className="select-sm folder-access-select" 
              defaultValue="private" 
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  onUpdateFolderPolicy(node.fullPath, 'custom');
                } else {
                  onUpdateFolderPolicy(node.fullPath, e.target.value);
                }
              }}
            >
              <option value="private">🔒 Privado</option>
              <option value="public">🌐 Público</option>
              <option value="custom">🛠️ Custom</option>
            </select>
            <div className="folder-action-buttons">
              <button className="btn-link" onClick={() => onUseInLifecycle(node.fullPath)}>
                + Lifecycle
              </button>
              <button className="btn-link btn-link-blue" onClick={() => onUseInOptimizer(node.fullPath)}>
                + Optimizer
              </button>
            </div>
          </div>
        </td>
      </tr>
      {expanded && hasChildren && node.children!.map((child, i) => (
        <FolderRow 
          key={i} node={child} depth={depth + 1} 
          onUseInLifecycle={onUseInLifecycle} 
          onUseInOptimizer={onUseInOptimizer}
          onUpdateFolderPolicy={onUpdateFolderPolicy}
          formatSize={formatSize}
        />
      ))}
    </>
  );
};

function App() {
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<StorageAccount | null>(null);
  const [showLifecycleForm, setShowLifecycleForm] = useState(false);
  
  // Roteamento baseado em Hash
  const [route, setRoute] = useState(window.location.hash || "#/");
  const [selectedAccount, setSelectedAccount] = useState<StorageAccount | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [view, setView] = useState<"accounts" | "buckets" | "bucket-configs" | "replication">("accounts");

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [lifecycle, setLifecycle] = useState<any>(null);
  const [optimizerConfigs, setOptimizerConfigs] = useState<any[]>([]);
  
  // Replicação
  const [bucketReplicationRules, setBucketReplicationRules] = useState<any[]>([]);
  const [loadingReplication, setLoadingReplication] = useState(false);
  const [showReplicationForm, setShowReplicationForm] = useState(false);
  const [newReplica, setNewReplica] = useState({ target_storage_id: "", target_bucket: "", priority: 1 });
  const [editingReplicationId, setEditingReplicationId] = useState<string | null>(null);
  const [targetBuckets, setTargetBuckets] = useState<string[]>([]);

  const [showOptimizerForm, setShowOptimizerForm] = useState(false);
  const [editingOptimizer, setEditingOptimizer] = useState<any>(null);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [loadingOptimizer, setLoadingOptimizer] = useState(false);
  const [versioningEnabled, setVersioningEnabled] = useState(false);
  const [bucketAccessPolicy, setBucketAccessPolicy] = useState("private");
  const [bucketCustomPolicy, setBucketCustomPolicy] = useState<any>(null);
  const [optimizerStats, setOptimizerStats] = useState({ count: 0, total_before: 0, total_after: 0, bytes_saved: 0 });
  const [infraSynced, setInfraSynced] = useState(false);
  const [showCustomPolicyModal, setShowCustomPolicyModal] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [selectedResults, setSelectedResults] = useState<any>(null);

  const notifiedScansRef = useRef<Set<string>>(new Set());

  // Polling para atualizar status de scanning e detectar conclusões (agora por CONTA inteira)
  useEffect(() => {
    let interval: any;
    
    if (selectedAccount) {
      interval = setInterval(() => {
        fetch(`/api/accounts/${selectedAccount.id}/optimizer-configs`)
          .then(res => res.json())
          .then(data => {
            if (!Array.isArray(data)) return;
            
            const newNotifications: any[] = [];
            
            data.forEach((newCfg: any) => {
              // 1. Rastreia notificações (global por conta)
              const scanKey = `${newCfg.id}-${newCfg.last_scan_at}`;

              // Se terminou uma varredura e ainda não notificamos
              if (newCfg.is_scanning === 0 && newCfg.last_scan_at && !notifiedScansRef.current.has(scanKey)) {
                // Só notifica se não for a primeira carga da página (evita spam ao abrir)
                if (notifiedScansRef.current.size > 0) {
                  const results = newCfg.last_scan_results ? JSON.parse(newCfg.last_scan_results) : null;
                  newNotifications.push({
                    id: `${scanKey}-${Date.now()}`,
                    title: "✅ Varredura Completa",
                    message: `O bucket "${newCfg.bucket_name}" finalizou a pasta "${newCfg.prefix_root || '/'}".`,
                    results: results,
                    prefix: newCfg.prefix_root
                  });
                }
                notifiedScansRef.current.add(scanKey);
              }
            });

            if (newNotifications.length > 0) {
              setNotifications(prev => [...newNotifications, ...prev]);
            }

            // 2. Atualiza o estado visual se o bucket selecionado estiver no lote
            if (selectedBucket) {
              const currentBucketConfigs = data.filter(c => c.bucket_name === selectedBucket);
              setOptimizerConfigs(currentBucketConfigs);
            }
          })
          .catch(() => {});
      }, 3000);
    }
    
    return () => { if (interval) clearInterval(interval); };
  }, [selectedAccount, selectedBucket]);
  const [customPolicyTarget, setCustomPolicyTarget] = useState<{type: 'bucket' | 'folder', id?: number} | null>(null);
  const [tempCustomPerms, setTempCustomPerms] = useState({
    "s3:GetObject": true,
    "s3:PutObject": false,
    "s3:DeleteObject": false,
    "s3:ListBucket": false
  });

  const [newRule, setNewRule] = useState({ id: "", prefix: "", days: 30, status: "Enabled" });
  const [editingLifecycleId, setEditingLifecycleId] = useState<string | null>(null);
  const [newOptimizer, setNewOptimizer] = useState({ 
    enabled: true, 
    prefix_root: "", 
    prefix_work: "", 
    min_size_kb: 0, 
    video_max_mb: 0,
    auto_lifecycle: false,
    access_policy: "private",
    custom_policy: null as any
  });
  const [formData, setFormData] = useState({ name: "", endpoint: "", region: "us-east-1", access_key: "", secret_key: "", provider: "minio" });

  // Sincroniza Rota com Estado
  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Processa a Rota
  useEffect(() => {
    const parts = route.split("/");
    if (route === "#/" || route === "") {
      setView("accounts");
      setSelectedAccount(null);
      setSelectedBucket(null);
    } else if (route === "#/replication") {
      setView("replication");
    } else if (parts[1] === "account" && parts[3] === "buckets") {
      const accId = parts[2];
      const acc = accounts.find(a => a.id === accId);
      if (acc) {
        if (selectedAccount?.id !== accId) { setBuckets([]); setAnalytics(null); }
        setSelectedAccount(acc);
        setView("buckets");
        fetchBuckets(acc);
      }
    } else if (parts[1] === "account" && parts[3] === "bucket" && parts[4]) {
      const accId = parts[2];
      const bktName = parts[4];
      const acc = accounts.find(a => a.id === accId);
      if (acc) {
        setSelectedAccount(acc);
        setSelectedBucket(bktName);
        setView("bucket-configs");
        loadBucketConfigs(acc.id, bktName);
      }
    }
  }, [route, accounts]);

  useEffect(() => {
    if (newReplica.target_storage_id) {
      fetch(`/api/accounts/${newReplica.target_storage_id}/buckets`)
        .then(res => res.json())
        .then(data => setTargetBuckets(data.map((b: any) => b.Name)))
        .catch(() => setTargetBuckets([]));
    } else {
      setTargetBuckets([]);
    }
  }, [newReplica.target_storage_id]);

  const fetchAccounts = async () => {
    try {
      const response = await fetch("/api/accounts");
      const data = await response.json();
      const accountsWithStatus = await Promise.all(data.map(async (acc: StorageAccount) => {
        try {
          const res = await fetch(`/api/replication/site/${acc.id}/info`);
          return { ...acc, replicationStatus: { isCluster: res.ok, hasBucketReplication: false } };
        } catch {
          return acc;
        }
      }));
      setAccounts(accountsWithStatus);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const fetchBuckets = async (account: StorageAccount) => {
    setLoadingBuckets(true);
    try {
      const response = await fetch(`/api/accounts/${account.id}/buckets`);
      const data = await response.json();
      if (response.ok) setBuckets(data);
    } catch (error) { console.error(error); } finally { setLoadingBuckets(false); }
  };

  const loadBucketConfigs = async (accId: string, bucketName: string) => {
    setLoadingConfigs(true);
    setLoadingOptimizer(true);
    setLoadingReplication(true);
    try {
      const [resAnlytics, resLifecycle, resOptimizer, resVersioning, resPolicy, resStats, resReplication, resSyncStatus] = await Promise.all([
        fetch(`/api/accounts/${accId}/buckets/${bucketName}/analytics`),
        fetch(`/api/accounts/${accId}/buckets/${bucketName}/lifecycle`),
        fetch(`/api/accounts/${accId}/buckets/${bucketName}/optimizer`),
        fetch(`/api/accounts/${accId}/buckets/${bucketName}/versioning`),
        fetch(`/api/accounts/${accId}/buckets/${bucketName}/access-policy`),
        fetch(`/api/accounts/${accId}/buckets/${bucketName}/optimizer-stats`),
        fetch(`/api/replication/bucket/${accId}/${bucketName}`),
        fetch(`/api/accounts/${accId}/buckets/${bucketName}/optimizer-sync-status`)
      ]);
      if (resAnlytics.ok) setAnalytics(await resAnlytics.json());
      if (resLifecycle.ok) setLifecycle(await resLifecycle.json());
      if (resOptimizer.ok) setOptimizerConfigs(await resOptimizer.json());
      if (resVersioning.ok) {
        const vData = await resVersioning.json();
        setVersioningEnabled(vData.enabled);
      }
      if (resPolicy.ok) {
        const pData = await resPolicy.json();
        setBucketAccessPolicy(pData.policy);
        setBucketCustomPolicy(pData.custom);
      }
      if (resStats.ok) setOptimizerStats(await resStats.json());
      if (resReplication.ok) {
        const repData = await resReplication.json();
        setBucketReplicationRules(repData || []);
      }
      if (resSyncStatus.ok) {
        const syncData = await resSyncStatus.json();
        setInfraSynced(syncData.synced);
      }
    } catch (error) { console.error(error); } finally { setLoadingConfigs(false); setLoadingOptimizer(false); setLoadingReplication(false); }
  };

  const handleAddReplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !selectedBucket) return;
    try {
      // Se estiver editando, removemos a regra antiga primeiro
      if (editingReplicationId) {
        await fetch(`/api/replication/bucket/${selectedAccount.id}/${selectedBucket}/${editingReplicationId}`, {
          method: "DELETE"
        });
      }

      const res = await fetch(`/api/replication/bucket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_storage_id: selectedAccount.id,
          source_bucket: selectedBucket,
          target_storage_id: newReplica.target_storage_id,
          target_bucket: newReplica.target_bucket,
          priority: newReplica.priority
        }),
      });
      if (res.ok) {
        setShowReplicationForm(false);
        setEditingReplicationId(null);
        setNewReplica({ target_storage_id: "", target_bucket: "", priority: 1 });
        loadBucketConfigs(selectedAccount.id, selectedBucket);
      } else {
        const err = await res.json();
        alert("Erro: " + err.error);
      }
    } catch (e) { alert("Erro ao salvar replicação"); }
  };

  const handleEditReplication = (rule: any) => {
    // Extrai o storage_id e o bucket do Destination do mc
    // O mc retorna algo como "arn:minio:replication:us-east-1:3485038c...:bucketname"
    // Precisamos encontrar qual conta tem esse bucket. 
    // Para simplificar a UX, vamos focar em editar a PRIORIDADE, 
    // já que o destino é mais complexo de mapear reverso sem metadados extras.
    
    setEditingReplicationId(rule.ID);
    setNewReplica({
      ...newReplica,
      priority: rule.Priority || 1
    });
    setShowReplicationForm(true);
  };

  const handleDeleteReplication = async (ruleId: string) => {
    if (!selectedAccount || !selectedBucket || !confirm("Remover esta réplica?")) return;
    try {
      const res = await fetch(`/api/replication/bucket/${selectedAccount.id}/${selectedBucket}/${ruleId}`, {
        method: "DELETE"
      });
      if (res.ok) loadBucketConfigs(selectedAccount.id, selectedBucket);
    } catch (e) { alert("Erro ao deletar"); }
  };

  const formatReplicaDest = (dest: any) => {
    if (!dest) return "-";
    const bucket = dest.Bucket?.split(":").pop();
    return bucket || "-";
  };

  const handleUpdateBucketAccessPolicy = async (newPolicy: string) => {
    if (!selectedAccount || !selectedBucket) return;
    if (newPolicy === 'custom') {
      setCustomPolicyTarget({ type: 'bucket' });
      setTempCustomPerms(bucketCustomPolicy || { "s3:GetObject": true, "s3:PutObject": false, "s3:DeleteObject": false, "s3:ListBucket": false });
      setShowCustomPolicyModal(true);
      return;
    }
    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/access-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: newPolicy }),
      });
      if (res.ok) {
        setBucketAccessPolicy(newPolicy);
        setBucketCustomPolicy(null);
      }
    } catch (error) {
      alert("Erro ao alterar política do bucket");
    }
  };

  const handleSaveCustomPolicy = async () => {
    if (!selectedAccount || !selectedBucket || !customPolicyTarget) return;

    if (customPolicyTarget.type === 'bucket') {
      try {
        const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/access-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policy: 'custom', custom: tempCustomPerms }),
        });
        if (res.ok) {
          setBucketAccessPolicy('custom');
          setBucketCustomPolicy(tempCustomPerms);
          setShowCustomPolicyModal(false);
        }
      } catch (e) { alert("Erro ao salvar"); }
    } else {
      setNewOptimizer({ ...newOptimizer, access_policy: 'custom', custom_policy: tempCustomPerms });
      setShowCustomPolicyModal(false);
    }
  };

  const toggleVersioning = async () => {
    if (!selectedAccount || !selectedBucket) return;
    const newState = !versioningEnabled;
    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/versioning`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newState }),
      });
      if (res.ok) setVersioningEnabled(newState);
    } catch (error) {
      alert("Erro ao alterar versionamento");
    }
  };

  const navigateTo = (path: string) => {
    window.location.hash = path;
  };

  const handleAddLifecycleRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !selectedBucket) return;
    
    const ruleToAdd = { 
      ID: newRule.id || `Rule-${Date.now()}`, 
      Status: newRule.status, 
      Filter: { Prefix: newRule.prefix }, 
      Expiration: { Days: Number(newRule.days) } 
    };

    let updatedRules;
    if (editingLifecycleId) {
      updatedRules = (lifecycle?.Rules || []).map((r: any) => 
        r.ID === editingLifecycleId ? ruleToAdd : r
      );
    } else {
      updatedRules = [...(lifecycle?.Rules || []), ruleToAdd];
    }

    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/lifecycle`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: updatedRules }),
      });
      if (res.ok) { 
        setShowLifecycleForm(false); 
        setEditingLifecycleId(null);
        setNewRule({ id: "", prefix: "", days: 30, status: "Enabled" }); 
        loadBucketConfigs(selectedAccount.id, selectedBucket); 
      }
    } catch (error) { alert("Erro ao salvar"); }
  };

  const handleEditLifecycle = (rule: any) => {
    setEditingLifecycleId(rule.ID);
    setNewRule({
      id: rule.ID,
      prefix: rule.Filter?.Prefix || "",
      days: rule.Expiration?.Days || 30,
      status: rule.Status || "Enabled"
    });
    setShowLifecycleForm(true);
    setTimeout(() => {
      document.getElementById('lifecycle-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedAccount || !selectedBucket || !confirm("Remover?")) return;
    const updatedRules = (lifecycle?.Rules || []).filter((r: any) => r.ID !== ruleId);
    try {
      await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/lifecycle`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: updatedRules }),
      });
      loadBucketConfigs(selectedAccount.id, selectedBucket);
    } catch (error) { alert("Erro"); }
  };

  const handleSaveOptimizer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount || !selectedBucket) return;
    try {
      const url = editingOptimizer
              ? `/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${editingOptimizer.id}`
              : `/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer`;
      const method = editingOptimizer ? "PUT" : "POST";

      const res = await fetch(url, {
        method, 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(newOptimizer),
      });
      if (res.ok) { 
        setShowOptimizerForm(false);
        setEditingOptimizer(null);
        loadBucketConfigs(selectedAccount.id, selectedBucket);
        alert("Configuração do Optimizer salva!"); 
      }
    } catch (error) { alert("Erro ao salvar"); }
  };

  const handleDeleteOptimizer = async (configId: number) => {
    if (!selectedAccount || !selectedBucket || !confirm("Remover esta configuração?")) return;
    try {
      await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${configId}`, {
        method: "DELETE"
      });
      loadBucketConfigs(selectedAccount.id, selectedBucket);
    } catch (error) { alert("Erro ao deletar"); }
  };

  const handleSyncOptimizerInfra = async () => {
    if (!selectedAccount || !selectedBucket) return;
    if (!confirm("Isso fará com que este Manager (PC/VPS atual) passe a receber as notificações de novos arquivos deste bucket. Deseja continuar?")) return;
    
    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer-sync-infra`, {
        method: "POST"
      });
      const data = await res.json();
      if (res.ok) {
        setInfraSynced(true);
        alert("Infraestrutura sincronizada! Este ambiente agora processará as otimizações automáticas.");
      } else {
        alert("Erro: " + data.error);
      }
    } catch (e) { alert("Erro de conexão"); }
  };

  const handleRunBatch = async (configId: number, prefix: string) => {
    if (!selectedAccount || !selectedBucket) return;
    if (!confirm(`Deseja iniciar a varredura (batch) na pasta ${prefix}?`)) return;

    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${configId}/run-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix })
      });
      const data = await res.json();
      if (res.ok) {
        alert("Varredura iniciada em segundo plano! Você pode acompanhar o status pelo botão 'Varrendo...'.");
      } else {
        alert("Erro ao iniciar batch: " + (data.error || "Erro desconhecido"));
      }
    } catch (error) { alert("Erro de conexão ao iniciar batch"); }
  };

  const handleForceUnlock = async (configId: number) => {
    if (!selectedAccount || !selectedBucket) return;
    if (!confirm("Isso irá resetar o estado de varredura. Use apenas se a varredura estiver travada há muito tempo. Continuar?")) return;

    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${configId}/unlock-force`, {
        method: "POST",
      });
      if (res.ok) {
        loadBucketConfigs(selectedAccount.id, selectedBucket);
        alert("Estado resetado com sucesso!");
      }
    } catch (error) { alert("Erro ao resetar estado"); }
  };

  const handleToggleLifecycle = async (config: any) => {

    if (!selectedAccount || !selectedBucket) return;
    const updated = { ...config, auto_lifecycle: !config.auto_lifecycle };
    
    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${config.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        loadBucketConfigs(selectedAccount.id, selectedBucket);
      } else {
        const err = await res.json();
        alert("Erro no servidor: " + (err.error || "Erro desconhecido"));
      }
    } catch (error) { alert("Erro de conexão ao atualizar lifecycle"); }
  };

  const handleUpdateFolderPolicy = async (prefix: string, policy: string) => {
    if (!selectedAccount || !selectedBucket) return;
    if (policy === 'custom') {
      setCustomPolicyTarget({ type: 'folder', prefix } as any);
      setTempCustomPerms({ "s3:GetObject": true, "s3:PutObject": false, "s3:DeleteObject": false, "s3:ListBucket": false });
      setShowCustomPolicyModal(true);
      return;
    }
    try {
      const res = await fetch(`/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/folder-policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, policy }),
      });
      if (res.ok) {
        alert(`Política da pasta "${prefix}" atualizada para ${policy}!`);
      }
    } catch (error) { alert("Erro ao atualizar política da pasta"); }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editingAccount ? `/api/accounts/${editingAccount.id}` : "/api/accounts";
      const method = editingAccount ? "PUT" : "POST";
      
      const res = await fetch(url, { 
        method, 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(formData) 
      });
      
      if (res.ok) { 
        setShowForm(false); 
        setEditingAccount(null);
        setFormData({ name: "", endpoint: "", region: "us-east-1", access_key: "", secret_key: "", provider: "minio" });
        fetchAccounts(); 
      }
    } catch (error) { alert("Erro ao salvar conta"); }
  };

  const handleEditAccount = (acc: StorageAccount) => {
    setEditingAccount(acc);
    setFormData({
      name: acc.name,
      endpoint: acc.endpoint,
      region: acc.region,
      access_key: "", 
      secret_key: "",
      provider: acc.provider
    });
    setShowForm(true);
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm("Excluir conta?")) return;
    try { await fetch("/api/accounts/" + id, { method: "DELETE" }); fetchAccounts(); } catch (error) { alert("Erro"); }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  useEffect(() => { fetchAccounts(); }, []);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <h2 onClick={() => navigateTo("/")} style={{cursor: 'pointer'}}>Storage Manager</h2>
        <nav>
          <ul>
            <li className={view === "accounts" ? "active" : ""} onClick={() => navigateTo("/")}>
              📦 <span>Contas</span>
            </li>
            <li className={view === "replication" ? "active" : ""} onClick={() => navigateTo("/replication")}>
              🔄 <span>Espelhamento</span>
            </li>
            {selectedAccount && (
              <li className={view === "buckets" ? "active" : ""} onClick={() => navigateTo(`/account/${selectedAccount.id}/buckets`)}>
                🪣 <span>Buckets</span>
              </li>
            )}
            {selectedBucket && (
              <li className={view === "bucket-configs" ? "active" : ""} onClick={() => {}}>
                ⚙️ <span>{selectedBucket}</span>
              </li>
            )}
          </ul>
        </nav>
      </aside>

      <main className="content">
        {view === "accounts" && (
          <>
            <header>
              <h1>Minhas Contas</h1>
              <button className="btn-primary" onClick={() => {
                setEditingAccount(null);
                setFormData({ name: "", endpoint: "", region: "us-east-1", access_key: "", secret_key: "", provider: "minio" });
                setShowForm(true);
              }}>+ Nova Conta</button>
            </header>
            {loading ? <p>Carregando...</p> : (
              <div className="account-grid">
                {accounts.map((acc) => (
                  <div key={acc.id} className="account-card">
                    <div className="badge">{acc.provider}</div>
                    <h3>{acc.name}</h3>
                    <p style={{justifyContent: 'flex-start', gap: '8px'}}><span>Endpoint:</span> <strong>{acc.endpoint}</strong></p>
                    <div className="card-actions">
                      <button className="btn-primary" onClick={() => navigateTo(`/account/${acc.id}/buckets`)}>📦 Ver Buckets</button>
                      <button className="btn-secondary" onClick={() => handleEditAccount(acc)}>✏️ Editar</button>
                      <button className="btn-danger" onClick={() => handleDeleteAccount(acc.id)}>🗑️ Excluir</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {view === "replication" && (
          <ReplicationPanel accounts={accounts} />
        )}

        {view === "buckets" && selectedAccount && (
          <>
            <header>
              <button className="btn-back" onClick={() => navigateTo("/")}>← Voltar</button>
              <h1>Buckets em {selectedAccount.name}</h1>
              <div style={{width: '40px'}}></div>
            </header>
            {loadingBuckets ? <p>Buscando buckets...</p> : (
              <div className="bucket-list">
                <table>
                  <thead><tr><th>Nome do Bucket</th><th>Data de Criação</th><th>Ações</th></tr></thead>
                  <tbody>
                    {buckets.map((bucket) => (
                      <tr key={bucket.Name}>
                        <td><strong>{bucket.Name}</strong></td>
                        <td style={{ color: '#64748b' }}>{new Date(bucket.CreationDate).toLocaleDateString()}</td>
                        <td>
                          <button className="btn-secondary" onClick={() => navigateTo(`/account/${selectedAccount.id}/bucket/${bucket.Name}`)}>⚙️ Configurações</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {view === "bucket-configs" && selectedAccount && selectedBucket && (
          <>
            <header>
              <div className="header-title-row">
                <button className="btn-back" onClick={() => navigateTo(`/account/${selectedAccount.id}/buckets`)}>← Voltar</button>
                <h1>{selectedBucket}</h1>
              </div>
              <div className="header-actions">
                <div className="header-action-item">
                  <label>Acesso:</label>
                  <select 
                    value={bucketAccessPolicy} 
                    onChange={e => handleUpdateBucketAccessPolicy(e.target.value)}
                  >
                    <option value="private">🔒 Privado</option>
                    <option value="public">🌐 Público</option>
                    <option value="custom">🛠️ Custom</option>
                  </select>
                  {bucketAccessPolicy === 'custom' && (
                    <button className="btn-link-sm" onClick={() => {
                      setCustomPolicyTarget({ type: 'bucket' });
                      setTempCustomPerms(bucketCustomPolicy || { "s3:GetObject": true, "s3:PutObject": false, "s3:DeleteObject": false, "s3:ListBucket": false });
                      setShowCustomPolicyModal(true);
                    }}>⚙️</button>
                  )}
                </div>
                <div className="header-action-item">
                  <label className="switch">
                    <input type="checkbox" checked={versioningEnabled} onChange={toggleVersioning} />
                    <span className="slider slider-cyan round"></span>
                  </label>
                  <span>Versioning</span>
                </div>
              </div>
            </header>

            <div className="config-page">
              <section className="config-section">
                <h2>📊 Analytics & Hierarquia</h2>
                {loadingConfigs ? <p>Analisando...</p> : analytics ? (
                  <div className="analytics-container">
                    <div className="analytics-summary">
                      <div className="stat-card">
                        <span className="stat-label">Total Objetos</span>
                        <span className="stat-value">{analytics.objectCount}</span>
                      </div>
                      <div className="stat-card">
                        <span className="stat-label">Espaço Utilizado</span>
                        <span className="stat-value">{formatSize(analytics.totalSize)}</span>
                      </div>
                      <div className="stat-card optimized-card">
                        <span className="stat-label">Espaço Otimizado</span>
                        <span className="stat-value">{formatSize(optimizerStats.bytes_saved)}</span>
                        <small style={{fontSize: '0.7rem', color: '#64748b'}}>{optimizerStats.count} arquivos processados</small>
                      </div>
                    </div>
                    <div className="folder-breakdown">
                      <table className="folder-table">
                        <thead><tr><th>Pasta / Prefixo</th><th>Contagem</th><th>Tamanho</th><th>Ações</th></tr></thead>
                        <tbody>
                          {analytics.tree.map((node, i) => (
                            <FolderRow 
                              key={i} node={node} depth={0} formatSize={formatSize}
                              onUpdateFolderPolicy={handleUpdateFolderPolicy}
                              onUseInLifecycle={(path) => {
                                setNewRule({...newRule, prefix: path});
                                setShowLifecycleForm(true);
                                setTimeout(() => {
                                  document.getElementById('lifecycle-section')?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                              }}
                              onUseInOptimizer={(path) => {
                                setNewOptimizer({
                                  ...newOptimizer,
                                  prefix_root: path,
                                  prefix_work: path + "otimizando/",
                                  access_policy: "private",
                                  custom_policy: null
                                });
                                setShowOptimizerForm(true);
                                setEditingOptimizer(null);
                                setTimeout(() => {
                                  document.getElementById('optimizer-section')?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                              }}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : <p>Erro.</p>}
              </section>

              <section className="config-section" id="optimizer-section">
                <header style={{marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <h2>⚙️ Optimizer (Otimização Automática)</h2>
                  <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                    {optimizerConfigs.length > 0 && (
                      infraSynced ? (
                        <span className="badge badge-success" style={{margin: 0, padding: '0.5rem 1rem'}}>
                          ✅ Conectado a este ambiente
                        </span>
                      ) : (
                        <button className="btn-secondary" onClick={handleSyncOptimizerInfra} title="Faz este Manager assumir o processamento automático deste bucket">
                          🔄 Sincronizar com este ambiente
                        </button>
                      )
                    )}
                    {!showOptimizerForm && (
                      <button className="btn-primary" onClick={() => {
                        setShowOptimizerForm(true);
                        setEditingOptimizer(null);
                        setNewOptimizer({ enabled: true, prefix_root: "", prefix_work: "", min_size_kb: 0, video_max_mb: 0, auto_lifecycle: false, access_policy: "private", custom_policy: null });
                      }}>+ Nova Pasta</button>
                    )}
                  </div>
                </header>

                {showOptimizerForm && (
                  <div className="rule-form-container" style={{marginBottom: '2rem', border: '1px solid #e2e8f0', padding: '1.5rem', borderRadius: '8px'}}>
                    <h3>{editingOptimizer ? "Editar Configuração" : "Nova Pasta para Monitorar"}</h3>
                    <form onSubmit={handleSaveOptimizer} className="optimizer-form">
                      <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '2rem', marginBottom: '1.5rem'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.8rem'}}>
                          <label className="switch">
                            <input type="checkbox" checked={newOptimizer.enabled} onChange={e => setNewOptimizer({...newOptimizer, enabled: e.target.checked})} />
                            <span className="slider round"></span>
                          </label>
                          <span><strong>Optimizer: {newOptimizer.enabled ? "Ativo" : "Pausado"}</strong></span>
                        </div>
                        
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.8rem'}}>
                          <label className="switch">
                            <input type="checkbox" checked={newOptimizer.auto_lifecycle} onChange={e => setNewOptimizer({...newOptimizer, auto_lifecycle: e.target.checked})} />
                            <span className="slider slider-cyan round"></span>
                          </label>
                          <span><strong>Limpeza Automática (1 dia)</strong></span>
                        </div>
                      </div>

                      <div className="form-row" style={{display: 'flex', gap: '1.5rem'}}>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Prefixo Raiz (Onde monitorar)</label>
                          <input value={newOptimizer.prefix_root} onChange={e => setNewOptimizer({...newOptimizer, prefix_root: e.target.value})} placeholder="ocorrencias/" />
                        </div>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Prefixo de Trabalho (Temp)</label>
                          <input value={newOptimizer.prefix_work} onChange={e => setNewOptimizer({...newOptimizer, prefix_work: e.target.value})} placeholder="ocorrencias/otimizando/" />
                        </div>
                      </div>

                      <div className="form-row" style={{display: 'flex', gap: '1.5rem', marginTop: '1rem'}}>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Tamanho Mínimo (KB)</label>
                          <input type="number" value={newOptimizer.min_size_kb} onChange={e => setNewOptimizer({...newOptimizer, min_size_kb: Number(e.target.value)})} />
                        </div>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Tamanho Máximo Vídeo (MB)</label>
                          <input type="number" value={newOptimizer.video_max_mb} onChange={e => setNewOptimizer({...newOptimizer, video_max_mb: Number(e.target.value)})} />
                        </div>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Status de Acesso</label>
                          <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                            <select 
                              value={newOptimizer.access_policy} 
                              onChange={e => {
                                if (e.target.value === 'custom') {
                                  setCustomPolicyTarget({ type: 'folder' });
                                  setTempCustomPerms(newOptimizer.custom_policy || { "s3:GetObject": true, "s3:PutObject": false, "s3:DeleteObject": false, "s3:ListBucket": false });
                                  setShowCustomPolicyModal(true);
                                } else {
                                  setNewOptimizer({...newOptimizer, access_policy: e.target.value});
                                }
                              }}
                              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            >
                              <option value="private">🔒 Privado</option>
                              <option value="public">🌐 Público (Leitura)</option>
                              <option value="custom">🛠️ Customizado</option>
                            </select>
                            {newOptimizer.access_policy === 'custom' && (
                              <button type="button" className="btn-link" style={{fontSize: '0.75rem'}} onClick={() => {
                                setCustomPolicyTarget({ type: 'folder' });
                                setTempCustomPerms(newOptimizer.custom_policy || { "s3:GetObject": true, "s3:PutObject": false, "s3:DeleteObject": false, "s3:ListBucket": false });
                                setShowCustomPolicyModal(true);
                              }}>⚙️</button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="card-actions" style={{justifyContent: 'flex-end', marginTop: '1.5rem'}}>
                        <button type="button" className="btn-secondary" onClick={() => setShowOptimizerForm(false)}>Cancelar</button>
                        <button type="submit" className="btn-primary">Salvar</button>
                      </div>
                    </form>
                  </div>
                )}

                {loadingOptimizer ? <p>Carregando...</p> : (
                  <div className="optimizer-list">
                    {optimizerConfigs.length === 0 ? <p>Nenhuma pasta configurada.</p> : (
                      <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                        {optimizerConfigs.map((config) => (
                          <div key={config.id} className="rule-card" style={{borderLeft: config.enabled ? '4px solid #10b981' : '4px solid #ef4444', paddingLeft: '10px'}}>
                            <div className="rule-info">
                              <p><strong>{config.prefix_root || "/ (Root)"}</strong> {config.enabled ? <span style={{color: '#10b981', fontSize: '0.8rem'}}>(Ativo)</span> : <span style={{color: '#ef4444', fontSize: '0.8rem'}}>(Pausado)</span>}</p>
                              <p style={{fontSize: '0.8rem', color: '#64748b'}}><strong>Trabalho:</strong> <code>{config.prefix_root || "/"}</code> | <strong>Temp:</strong> <code>{config.prefix_work}</code></p>
                              <p style={{fontSize: '0.8rem', color: '#64748b'}}>
                                Min: {config.min_size_kb}KB | Max Vídeo: {config.video_max_mb}MB
                                {config.auto_lifecycle ? <span style={{marginLeft: '10px', color: '#0ea5e9', fontWeight: 'bold'}}>✨ Limpeza Ativa</span> : ""}
                                <span style={{
                                  marginLeft: '10px', 
                                  padding: '2px 6px', 
                                  borderRadius: '4px', 
                                  background: config.access_policy === 'public' ? '#dcfce7' : '#f1f5f9',
                                  color: config.access_policy === 'public' ? '#166534' : '#475569',
                                  fontSize: '0.7rem',
                                  fontWeight: 'bold'
                                }}>
                                  {config.access_policy === 'public' ? '🌐 PÚBLICO' : '🔒 PRIVADO'}
                                </span>
                              </p>
                            </div>
                            <div className="rule-actions">
                              <div className="rule-action-group">
                                <label className="switch" style={{transform: 'scale(0.8)'}}>
                                  <input type="checkbox" checked={config.auto_lifecycle} onChange={() => handleToggleLifecycle(config)} />
                                  <span className="slider slider-cyan round"></span>
                                </label>
                                <span className="action-label">LIMPEZA</span>
                              </div>

                              <div className="btn-sweep-container" style={{display: 'flex', gap: '4px'}}>
                                <button 
                                  className={`btn-secondary btn-sweep ${config.is_scanning ? 'loading' : ''}`} 
                                  onClick={() => handleRunBatch(config.id, config.prefix_root)}
                                  disabled={config.is_scanning}
                                >
                                  {config.is_scanning ? "⏳ Varrendo..." : "🚀 Varrer Agora"}
                                </button>
                                {config.is_scanning && (
                                  <button 
                                    className="btn-danger btn-icon" 
                                    title="Resetar estado (Forçar Destravar)"
                                    onClick={() => handleForceUnlock(config.id)}
                                    style={{padding: '0 8px', fontSize: '10px'}}
                                  >
                                    🔄
                                  </button>
                                )}
                              </div>
                              <div className="rule-action-buttons">
                                <button className="btn-secondary btn-icon" disabled={config.is_scanning} onClick={() => {
                                  setEditingOptimizer(config);
                                  setNewOptimizer({
                                    enabled: config.enabled,
                                    prefix_root: config.prefix_root,
                                    prefix_work: config.prefix_work,
                                    min_size_kb: config.min_size_kb,
                                    video_max_mb: config.video_max_mb,
                                    auto_lifecycle: config.auto_lifecycle,
                                    access_policy: config.access_policy || 'private',
                                    custom_policy: config.custom_policy
                                  });
                                  setShowOptimizerForm(true);
                                  setTimeout(() => {
                                    document.getElementById('optimizer-section')?.scrollIntoView({ behavior: 'smooth' });
                                  }, 100);
                                }}>✏️</button>
                                <button className="btn-danger btn-icon" disabled={config.is_scanning} onClick={() => handleDeleteOptimizer(config.id)}>🗑️</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="config-section">
                <header style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem'}}>
                  <h2>🔄 Replicação do Bucket</h2>
                  <button className="btn-primary" onClick={() => {
                    setEditingReplicationId(null);
                    setNewReplica({ target_storage_id: "", target_bucket: "", priority: 1 });
                    setShowReplicationForm(true);
                  }}>+ Nova Réplica</button>
                </header>
                {showReplicationForm && (
                  <div className="rule-form-container" style={{background:'#f8fafc', padding:'1.5rem', borderRadius:'12px', border:'1px solid #e2e8f0', marginBottom:'1.5rem'}}>
                    <form onSubmit={handleAddReplication}>
                      <h3>{editingReplicationId ? "Editar Réplica" : "Nova Réplica"}</h3>
                      <div className="form-group">
                        <label>Storage Destino</label>
                        <select 
                          value={newReplica.target_storage_id} 
                          onChange={e => setNewReplica({...newReplica, target_storage_id: e.target.value})} 
                          required
                          disabled={!!editingReplicationId}
                        >
                          <option value="">Selecione...</option>
                          {accounts.filter(a => a.id !== selectedAccount.id).map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.name}</option>
                          ))}
                        </select>
                        {editingReplicationId && <small style={{color:'#64748b'}}>O destino não pode ser alterado. Remova e crie outra se necessário.</small>}
                      </div>
                      <div className="form-row" style={{display: 'flex', gap: '1rem', marginTop:'1rem'}}>
                        <div className="form-group" style={{flex: 1}}>
                          <label>Bucket Destino</label>
                          <input 
                            value={newReplica.target_bucket} 
                            onChange={e => setNewReplica({...newReplica, target_bucket: e.target.value})} 
                            list="target-buckets-cfg" 
                            required 
                            disabled={!!editingReplicationId}
                          />
                          <datalist id="target-buckets-cfg">
                            {targetBuckets.map(b => (
                              <option key={b} value={b} />
                            ))}
                          </datalist>
                        </div>
                        <div className="form-group" style={{maxWidth:'100px'}}>
                          <label>Prioridade</label>
                          <input type="number" min="1" value={newReplica.priority} onChange={e => setNewReplica({...newReplica, priority: Number(e.target.value)})} />
                        </div>
                      </div>
                      <div className="card-actions" style={{justifyContent:'flex-end', marginTop:'1rem'}}>
                        <button type="button" className="btn-secondary" onClick={() => { setShowReplicationForm(false); setEditingReplicationId(null); }}>Cancelar</button>
                        <button type="submit" className="btn-primary">{editingReplicationId ? "Salvar Alterações" : "Ativar"}</button>
                      </div>
                    </form>
                  </div>
                )}
                <div className="table-scroll" style={{maxHeight:'300px'}}>
                  <table>
                    <thead><tr><th>ID</th><th>Destino</th><th>Prio</th><th>Status</th><th>Ações</th></tr></thead>
                    <tbody>
                      {bucketReplicationRules.map(r => (
                        <tr key={r.ID}>
                          <td>{r.ID.substring(0,8)}</td>
                          <td>{formatReplicaDest(r.Destination)}</td>
                          <td>{r.Priority}</td>
                          <td><span className="badge badge-success" style={{marginBottom: 0}}>{r.Status}</span></td>
                          <td>
                            <div style={{display:'flex', gap:'8px'}}>
                              <button className="btn-secondary" style={{padding:'4px 8px'}} onClick={() => handleEditReplication(r)}>✏️</button>
                              <button className="btn-danger" style={{padding:'4px 8px'}} onClick={() => handleDeleteReplication(r.ID)}>🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {bucketReplicationRules.length === 0 && (
                        <tr><td colSpan={5} style={{textAlign:'center', color:'#64748b'}}>Nenhuma regra de espelhamento ativa.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="config-section" id="lifecycle-section">
                <header style={{marginBottom: '1rem'}}>
                  <h2>🕒 Lifecycle Rules</h2>
                  {!showLifecycleForm && <button className="btn-primary" onClick={() => {
                    setShowLifecycleForm(true);
                    setTimeout(() => {
                      document.getElementById('lifecycle-section')?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }}>+ Nova Regra</button>}
                </header>

                {showLifecycleForm && (
                  <div className="rule-form-container">
                    <form onSubmit={handleAddLifecycleRule}>
                      <h3>{editingLifecycleId ? "Editar Regra de Expiração" : "Nova Regra de Expiração"}</h3>
                      <div className="form-group">
                        <label>Identificador</label>
                        <input 
                          value={newRule.id} 
                          onChange={e => setNewRule({...newRule, id: e.target.value})} 
                          placeholder="Ex: Limpeza" 
                          disabled={!!editingLifecycleId} 
                        />
                        {editingLifecycleId && <small style={{color: '#64748b'}}>O ID não pode ser alterado em uma edição S3.</small>}
                      </div>
                      <div className="form-row" style={{display: 'flex', gap: '1.5rem'}}>
                        <div className="form-group" style={{flex: 1}}><label>Pasta</label><input value={newRule.prefix} onChange={e => setNewRule({...newRule, prefix: e.target.value})} /></div>
                        <div className="form-group" style={{flex: 1}}><label>Dias</label><input type="number" value={newRule.days} onChange={e => setNewRule({...newRule, days: Number(e.target.value)})} /></div>
                      </div>
                      <div className="card-actions" style={{justifyContent: 'flex-end'}}>
                        <button type="button" className="btn-secondary" onClick={() => { setShowLifecycleForm(false); setEditingLifecycleId(null); }}>Cancelar</button>
                        <button type="submit" className="btn-primary">{editingLifecycleId ? "Salvar Alterações" : "Ativar"}</button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="lifecycle-rules">
                  {lifecycle?.Rules?.map((rule: any, i: number) => (
                    <div key={i} className="rule-card">
                      <div className="rule-info">
                        <p><strong>{rule.ID}</strong></p>
                        <p style={{fontSize: '0.9rem', color: '#64748b'}}>Pasta: <code>{rule.Filter?.Prefix || "/"}</code></p>
                        <p style={{fontSize: '0.9rem', color: '#64748b'}}>Expira em: <strong>{rule.Expiration?.Days} dias</strong></p>
                      </div>
                      <div className="rule-actions">
                        <button className="btn-secondary btn-icon" onClick={() => handleEditLifecycle(rule)}>✏️</button>
                        <button className="btn-danger btn-icon" onClick={() => handleDeleteRule(rule.ID)}>🗑️</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}

        {showForm && (
          <div className="modal-overlay">
            <div className="modal">
              <h2>{editingAccount ? `Editar Conta: ${editingAccount.name}` : "Configurar Nova Conta S3"}</h2>
              <form onSubmit={handleSaveAccount}>
                <div className="form-group"><label>Nome de Exibição</label><input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ex: Produção" /></div>
                <div className="form-group"><label>Endpoint URL</label><input required value={formData.endpoint} onChange={e => setFormData({...formData, endpoint: e.target.value})} placeholder="https://..." /></div>
                <div className="form-row" style={{display: 'flex', gap: '1.5rem'}}>
                  <div className="form-group" style={{flex: 1}}><label>Região</label><input value={formData.region} onChange={e => setFormData({...formData, region: e.target.value})} /></div>
                  <div className="form-group" style={{flex: 1}}><label>Provedor</label><select value={formData.provider} onChange={e => setFormData({...formData, provider: e.target.value})}><option value="minio">MinIO</option><option value="aws">AWS S3</option></select></div>
                </div>
                <div className="form-group">
                  <label>Access Key {editingAccount && <span style={{fontSize:'0.7rem', color:'#64748b'}}>(Deixe vazio para não alterar)</span>}</label>
                  <input required={!editingAccount} value={formData.access_key} onChange={e => setFormData({...formData, access_key: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Secret Key {editingAccount && <span style={{fontSize:'0.7rem', color:'#64748b'}}>(Deixe vazio para não alterar)</span>}</label>
                  <input type="password" required={!editingAccount} value={formData.secret_key} onChange={e => setFormData({...formData, secret_key: e.target.value})} />
                </div>
                <div className="card-actions" style={{justifyContent: 'flex-end'}}>
                  <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setEditingAccount(null); }}>Cancelar</button>
                  <button type="submit" className="btn-primary">{editingAccount ? "Salvar Alterações" : "Salvar Conta"}</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {showCustomPolicyModal && (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: '400px' }}>
              <h2>Permissões Customizadas</h2>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.5rem' }}>
                Defina o que usuários anônimos podem fazer {customPolicyTarget?.type === 'bucket' ? 'neste bucket' : 'nesta pasta'}.
              </p>
              
              <div className="custom-perms-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tempCustomPerms["s3:GetObject"]} onChange={e => setTempCustomPerms({...tempCustomPerms, "s3:GetObject": e.target.checked})} style={{ width: 'auto' }} />
                  <div>
                    <span style={{ fontWeight: 'bold', display: 'block' }}>Ler (Download)</span>
                    <small style={{ color: '#64748b' }}>Acesso aos arquivos via URL direta.</small>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tempCustomPerms["s3:PutObject"]} onChange={e => setTempCustomPerms({...tempCustomPerms, "s3:PutObject": e.target.checked})} style={{ width: 'auto' }} />
                  <div>
                    <span style={{ fontWeight: 'bold', display: 'block' }}>Escrever (Upload)</span>
                    <small style={{ color: '#64748b' }}>Permite que qualquer pessoa envie arquivos.</small>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tempCustomPerms["s3:DeleteObject"]} onChange={e => setTempCustomPerms({...tempCustomPerms, "s3:DeleteObject": e.target.checked})} style={{ width: 'auto' }} />
                  <div>
                    <span style={{ fontWeight: 'bold', display: 'block' }}>Deletar</span>
                    <small style={{ color: '#64748b' }}>Permite apagar arquivos remotamente.</small>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={tempCustomPerms["s3:ListBucket"]} onChange={e => setTempCustomPerms({...tempCustomPerms, "s3:ListBucket": e.target.checked})} style={{ width: 'auto' }} />
                  <div>
                    <span style={{ fontWeight: 'bold', display: 'block' }}>Listar</span>
                    <small style={{ color: '#64748b' }}>Permite ver a lista de arquivos da pasta.</small>
                  </div>
                </label>
              </div>

              <div className="card-actions" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCustomPolicyModal(false)}>Cancelar</button>
                <button type="button" className="btn-primary" onClick={handleSaveCustomPolicy}>Aplicar Permissões</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE RESULTADOS DA VARREDURA */}
        {showResultsModal && selectedResults && (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: '600px' }}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem'}}>
                <h2>📊 Relatório de Otimização</h2>
                <button className="btn-secondary btn-icon" onClick={() => setShowResultsModal(false)}>✕</button>
              </div>
              <p style={{color:'#64748b', fontSize:'0.9rem', marginBottom:'1.5rem'}}>
                Resumo da varredura realizada na pasta <strong>{selectedResults.prefix || '/'}</strong>.
              </p>
              
              <div className="results-grid">
                <div className="result-item">
                  <span className="result-value">{selectedResults.candidates}</span>
                  <span className="result-label">Arquivos Vistos</span>
                </div>
                <div className="result-item">
                  <span className="result-value" style={{color:'#10b981'}}>{selectedResults.processed}</span>
                  <span className="result-label">Otimizados</span>
                </div>
                <div className="result-item">
                  <span className="result-value" style={{color:'#f59e0b'}}>{selectedResults.skipped}</span>
                  <span className="result-label">Pulados/Sem Ganho</span>
                </div>
                <div className="result-item">
                  <span className="result-value" style={{color:'#ef4444'}}>{selectedResults.failed}</span>
                  <span className="result-label">Falhas</span>
                </div>
              </div>

              <div className="card-actions" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn-primary" onClick={() => setShowResultsModal(false)}>Entendido</button>
              </div>
            </div>
          </div>
        )}

        {/* CONTAINER DE NOTIFICAÇÕES */}
        <div className="notifications-container">
          {notifications.map(n => (
            <div key={n.id} className="notification-card">
              <div className="notification-header">
                <h4>{n.title}</h4>
                <span className="notification-close" onClick={() => setNotifications(prev => prev.filter(x => x.id !== n.id))}>✕</span>
              </div>
              <p>{n.message}</p>
              {n.results && (
                <button 
                  className="btn-link" 
                  style={{textAlign:'left', padding:0, marginTop:'0.5rem'}}
                  onClick={() => {
                    setSelectedResults({...n.results, prefix: n.prefix});
                    setShowResultsModal(true);
                    setNotifications(prev => prev.filter(x => x.id !== n.id));
                  }}
                >
                  Ver estatísticas detalhadas →
                </button>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;

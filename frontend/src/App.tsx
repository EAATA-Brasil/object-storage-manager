import { useState, useEffect } from "react";
import "./App.css";

interface StorageAccount {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  provider: string;
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
  formatSize 
}: { 
  node: FolderNode; 
  depth: number; 
  onUseInLifecycle: (path: string) => void;
  onUseInOptimizer: (path: string) => void;
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
        <td>
          <div style={{display: 'flex', gap: '10px'}}>
            <button className="btn-link" onClick={() => onUseInLifecycle(node.fullPath)}>
              + Lifecycle
            </button>
            <button className="btn-link" style={{color: '#0ea5e9'}} onClick={() => onUseInOptimizer(node.fullPath)}>
              + Optimizer
            </button>
          </div>
        </td>
      </tr>
      {expanded && hasChildren && node.children!.map((child, i) => (
        <FolderRow 
          key={i} node={child} depth={depth + 1} 
          onUseInLifecycle={onUseInLifecycle} 
          onUseInOptimizer={onUseInOptimizer}
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
  const [showLifecycleForm, setShowLifecycleForm] = useState(false);
  
  // Roteamento baseado em Hash
  const [route, setRoute] = useState(window.location.hash || "#/");
  const [selectedAccount, setSelectedAccount] = useState<StorageAccount | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [view, setView] = useState<"accounts" | "buckets" | "bucket-configs">("accounts");

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [lifecycle, setLifecycle] = useState<any>(null);
  const [optimizerConfigs, setOptimizerConfigs] = useState<any[]>([]);
  const [showOptimizerForm, setShowOptimizerForm] = useState(false);
  const [editingOptimizer, setEditingOptimizer] = useState<any>(null);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [loadingOptimizer, setLoadingOptimizer] = useState(false);
  const [versioningEnabled, setVersioningEnabled] = useState(false);
  const [bucketAccessPolicy, setBucketAccessPolicy] = useState("private");
  const [bucketCustomPolicy, setBucketCustomPolicy] = useState<any>(null);
  const [showCustomPolicyModal, setShowCustomPolicyModal] = useState(false);
  const [customPolicyTarget, setCustomPolicyTarget] = useState<{type: 'bucket' | 'folder', id?: number} | null>(null);
  const [tempCustomPerms, setTempCustomPerms] = useState({
    "s3:GetObject": true,
    "s3:PutObject": false,
    "s3:DeleteObject": false,
    "s3:ListBucket": false
  });

  const [newRule, setNewRule] = useState({ id: "", prefix: "", days: 30, status: "Enabled" });
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
    } else if (parts[1] === "account" && parts[3] === "buckets") {
      const accId = parts[2];
      const acc = accounts.find(a => a.id === accId);
      if (acc) {
        setSelectedAccount(acc);
        setView("buckets");
        if (buckets.length === 0) fetchBuckets(acc);
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

  const fetchAccounts = async () => {
    try {
      const response = await fetch("http://localhost:3005/api/accounts");
      const data = await response.json();
      setAccounts(data);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  const fetchBuckets = async (account: StorageAccount) => {
    setLoadingBuckets(true);
    try {
      const response = await fetch(`http://localhost:3005/api/accounts/${account.id}/buckets`);
      const data = await response.json();
      if (response.ok) setBuckets(data);
    } catch (error) { console.error(error); } finally { setLoadingBuckets(false); }
  };

  const loadBucketConfigs = async (accId: string, bucketName: string) => {
    setLoadingConfigs(true);
    setLoadingOptimizer(true);
    try {
      const [resAnlytics, resLifecycle, resOptimizer, resVersioning, resPolicy] = await Promise.all([
        fetch(`http://localhost:3005/api/accounts/${accId}/buckets/${bucketName}/analytics`),
        fetch(`http://localhost:3005/api/accounts/${accId}/buckets/${bucketName}/lifecycle`),
        fetch(`http://localhost:3005/api/accounts/${accId}/buckets/${bucketName}/optimizer`),
        fetch(`http://localhost:3005/api/accounts/${accId}/buckets/${bucketName}/versioning`),
        fetch(`http://localhost:3005/api/accounts/${accId}/buckets/${bucketName}/access-policy`)
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
    } catch (error) { console.error(error); } finally { setLoadingConfigs(false); setLoadingOptimizer(false); }
  };

  const handleUpdateBucketAccessPolicy = async (newPolicy: string) => {
    if (!selectedAccount || !selectedBucket) return;
    if (newPolicy === 'custom') {
      setCustomPolicyTarget({ type: 'bucket' });
      // Se já temos uma custom policy carregada, usamos ela, senão usamos o padrão
      setTempCustomPerms(bucketCustomPolicy || { "s3:GetObject": true, "s3:PutObject": false, "s3:DeleteObject": false, "s3:ListBucket": false });
      setShowCustomPolicyModal(true);
      return;
    }
    try {
      const res = await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/access-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: newPolicy }),
      });
      if (res.ok) {
        setBucketAccessPolicy(newPolicy);
        setBucketCustomPolicy(null); // Reset custom policy if switching to simple public/private
      }
    } catch (error) {
      alert("Erro ao alterar política do bucket");
    }
  };

  const handleSaveCustomPolicy = async () => {
    if (!selectedAccount || !selectedBucket || !customPolicyTarget) return;

    if (customPolicyTarget.type === 'bucket') {
      try {
        const res = await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/access-policy`, {
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
      // Para pastas (Optimizer)
      setNewOptimizer({ ...newOptimizer, access_policy: 'custom', custom_policy: tempCustomPerms });
      setShowCustomPolicyModal(false);
    }
  };

  const toggleVersioning = async () => {
    if (!selectedAccount || !selectedBucket) return;
    const newState = !versioningEnabled;
    try {
      const res = await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/versioning`, {
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
    const ruleToAdd = { ID: newRule.id || `Rule-${Date.now()}`, Status: newRule.status, Filter: { Prefix: newRule.prefix }, Expiration: { Days: Number(newRule.days) } };
    const updatedRules = [...(lifecycle?.Rules || []), ruleToAdd];
    try {
      const res = await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/lifecycle`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: updatedRules }),
      });
      if (res.ok) { setShowLifecycleForm(false); setNewRule({ id: "", prefix: "", days: 30, status: "Enabled" }); loadBucketConfigs(selectedAccount.id, selectedBucket); }
    } catch (error) { alert("Erro ao salvar"); }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedAccount || !selectedBucket || !confirm("Remover?")) return;
    const updatedRules = (lifecycle?.Rules || []).filter((r: any) => r.ID !== ruleId);
    try {
      await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/lifecycle`, {
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
        ? `http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${editingOptimizer.id}`
        : `http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer`;
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
      await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${configId}`, {
        method: "DELETE"
      });
      loadBucketConfigs(selectedAccount.id, selectedBucket);
    } catch (error) { alert("Erro ao deletar"); }
  };

  const handleRunBatch = async (configId: number, prefix: string) => {
    if (!selectedAccount || !selectedBucket) return;
    if (!confirm(`Deseja iniciar a varredura (batch) na pasta ${prefix}?`)) return;
    
    try {
      const res = await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${configId}/run-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Batch iniciado!\nCandidatos: ${data.candidates}\nProcessados: ${data.processed}\nPulados: ${data.skipped}`);
      } else {
        alert("Erro ao iniciar batch: " + (data.error || "Erro desconhecido"));
      }
    } catch (error) { alert("Erro de conexão ao iniciar batch"); }
  };

  const handleToggleLifecycle = async (config: any) => {
    if (!selectedAccount || !selectedBucket) return;
    const updated = { ...config, auto_lifecycle: !config.auto_lifecycle };
    
    try {
      const res = await fetch(`http://localhost:3005/api/accounts/${selectedAccount.id}/buckets/${selectedBucket}/optimizer/${config.id}`, {
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

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("http://localhost:3005/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (res.ok) { setShowForm(false); fetchAccounts(); }
    } catch (error) { alert("Erro"); }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm("Excluir conta?")) return;
    try { await fetch("http://localhost:3005/api/accounts/" + id, { method: "DELETE" }); fetchAccounts(); } catch (error) { alert("Erro"); }
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
        <h2 onClick={() => navigateTo("/")} style={{cursor: 'pointer'}}>🚀 <span>Manager</span></h2>
        <nav style={{display: 'block'}}>
          <ul style={{listStyle: 'none', padding: 0}}>
            <li className={view === "accounts" ? "active" : ""} onClick={() => navigateTo("/")}>
              📦 <span>Contas</span>
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
              <button className="btn-primary" onClick={() => setShowForm(true)}>+ Nova Conta</button>
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
                      <button className="btn-danger" onClick={() => handleDeleteAccount(acc.id)}>🗑️ Excluir</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
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
              <button className="btn-back" onClick={() => navigateTo(`/account/${selectedAccount.id}/buckets`)}>← Voltar</button>
              <h1>Detalhes: {selectedBucket}</h1>
              <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#64748b' }}>Acesso Global:</label>
                  <select 
                    value={bucketAccessPolicy} 
                    onChange={e => handleUpdateBucketAccessPolicy(e.target.value)}
                    style={{ padding: '4px 8px', borderRadius: '6px', fontSize: '0.85rem' }}
                  >
                    <option value="private">🔒 Privado</option>
                    <option value="public">🌐 Público</option>
                    <option value="custom">🛠️ Customizado</option>
                  </select>
                  {bucketAccessPolicy === 'custom' && (
                    <button className="btn-link" style={{fontSize: '0.75rem'}} onClick={() => {
                      setCustomPolicyTarget({ type: 'bucket' });
                      setTempCustomPerms(bucketCustomPolicy || { "s3:GetObject": true, "s3:PutObject": false, "s3:DeleteObject": false, "s3:ListBucket": false });
                      setShowCustomPolicyModal(true);
                    }}>⚙️ Configurar</button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label className="switch">
                    <input type="checkbox" checked={versioningEnabled} onChange={toggleVersioning} />
                    <span className="slider slider-cyan round"></span>
                  </label>
                  <span style={{ fontSize: '0.9rem' }}>Versioning</span>
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
                    </div>
                    <div className="folder-breakdown">
                      <table className="folder-table">
                        <thead><tr><th>Pasta / Prefixo</th><th>Contagem</th><th>Tamanho</th><th>Ações</th></tr></thead>
                        <tbody>
                          {analytics.tree.map((node, i) => (
                            <FolderRow 
                              key={i} node={node} depth={0} formatSize={formatSize}
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
                                  prefix_work: path + "otimizando/"
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
                  {!showOptimizerForm && (
                    <button className="btn-primary" onClick={() => {
                      setShowOptimizerForm(true);
                      setEditingOptimizer(null);
                      setNewOptimizer({ enabled: true, prefix_root: "", prefix_work: "", min_size_kb: 0, video_max_mb: 0, auto_lifecycle: false, access_policy: "private" });
                    }}>+ Nova Pasta</button>
                  )}
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
                    {optimizerConfigs.length === 0 ? <p>Nenhuma pasta configurada para o optimizer.</p> : (
                      <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                        {optimizerConfigs.map((config) => (
                          <div key={config.id} className="rule-card" style={{borderLeft: config.enabled ? '4px solid #10b981' : '4px solid #ef4444'}}>
                            <div className="rule-info">
                              <p><strong>{config.prefix_root}</strong> {config.enabled ? <span style={{color: '#10b981', fontSize: '0.8rem'}}>(Ativo)</span> : <span style={{color: '#ef4444', fontSize: '0.8rem'}}>(Pausado)</span>}</p>
                              <p style={{fontSize: '0.8rem', color: '#64748b'}}>Trabalho: <code>{config.prefix_work}</code></p>
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
                            <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                              <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '4px 10px', borderRadius: '8px', border: '1px solid #e2e8f0'}}>
                                <label className="switch" style={{transform: 'scale(0.8)'}}>
                                  <input type="checkbox" checked={config.auto_lifecycle} onChange={() => handleToggleLifecycle(config)} />
                                  <span className="slider slider-cyan round"></span>
                                </label>
                                <span style={{fontSize: '0.75rem', fontWeight: '700', color: '#64748b'}}>LIMPEZA</span>
                              </div>

                              <button className="btn-secondary" style={{padding: '4px 12px', background: '#f0f9ff', color: '#0369a1', borderColor: '#bae6fd'}} onClick={() => handleRunBatch(config.id, config.prefix_root)}>🚀 Varrer Agora</button>
                              <button className="btn-secondary" style={{padding: '4px 8px'}} onClick={() => {
                                setEditingOptimizer(config);
                                setNewOptimizer(config);
                                setShowOptimizerForm(true);
                                setTimeout(() => {
                                  document.getElementById('optimizer-section')?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                              }}>✏️</button>
                              <button className="btn-danger" style={{padding: '4px 8px'}} onClick={() => handleDeleteOptimizer(config.id)}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                      <h3>Nova Regra de Expiração</h3>
                      <div className="form-group"><label>Identificador</label><input value={newRule.id} onChange={e => setNewRule({...newRule, id: e.target.value})} placeholder="Ex: Limpeza" /></div>
                      <div className="form-row" style={{display: 'flex', gap: '1.5rem'}}>
                        <div className="form-group" style={{flex: 1}}><label>Pasta</label><input value={newRule.prefix} onChange={e => setNewRule({...newRule, prefix: e.target.value})} /></div>
                        <div className="form-group" style={{flex: 1}}><label>Dias</label><input type="number" value={newRule.days} onChange={e => setNewRule({...newRule, days: Number(e.target.value)})} /></div>
                      </div>
                      <div className="card-actions" style={{justifyContent: 'flex-end'}}>
                        <button type="button" className="btn-secondary" onClick={() => setShowLifecycleForm(false)}>Cancelar</button>
                        <button type="submit" className="btn-primary">Ativar</button>
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
                      <button className="btn-danger" onClick={() => handleDeleteRule(rule.ID)}>🗑️ Remover</button>
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
              <h2>Configurar Nova Conta S3</h2>
              <form onSubmit={handleCreateAccount}>
                <div className="form-group"><label>Nome de Exibição</label><input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ex: Produção" /></div>
                <div className="form-group"><label>Endpoint URL</label><input required value={formData.endpoint} onChange={e => setFormData({...formData, endpoint: e.target.value})} placeholder="https://..." /></div>
                <div className="form-row" style={{display: 'flex', gap: '1.5rem'}}>
                  <div className="form-group" style={{flex: 1}}><label>Região</label><input value={formData.region} onChange={e => setFormData({...formData, region: e.target.value})} /></div>
                  <div className="form-group" style={{flex: 1}}><label>Provedor</label><select value={formData.provider} onChange={e => setFormData({...formData, provider: e.target.value})}><option value="minio">MinIO</option><option value="aws">AWS S3</option></select></div>
                </div>
                <div className="form-group"><label>Access Key</label><input required value={formData.access_key} onChange={e => setFormData({...formData, access_key: e.target.value})} /></div>
                <div className="form-group"><label>Secret Key</label><input type="password" required value={formData.secret_key} onChange={e => setFormData({...formData, secret_key: e.target.value})} /></div>
                <div className="card-actions" style={{justifyContent: 'flex-end'}}>
                  <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                  <button type="submit" className="btn-primary">Salvar Conta</button>
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
      </main>
    </div>
  );
}

export default App;

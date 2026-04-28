import { useState, useEffect } from "react";

interface StorageAccount {
  id: string;
  name: string;
}

export default function ReplicationPanel() {
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [activeTab, setActiveTab] = useState<'bucket' | 'site'>('bucket');
  const [loading, setLoading] = useState(false);
  
  const [sourceBuckets, setSourceBuckets] = useState<string[]>([]);
  const [targetBuckets, setTargetBuckets] = useState<string[]>([]);

  const [activeBucketRules, setActiveBucketRules] = useState<any[]>([]);
  const [siteInfo, setSiteInfo] = useState<any>(null);

  // Form states
  const [bucketConfig, setBucketConfig] = useState({
    source_storage_id: '',
    source_bucket: '',
    target_storage_id: '',
    target_bucket: '',
    priority: 1
  });

  const [siteConfig, setSiteConfig] = useState({
    sourceId: '',
    targetId: '',
  });

  useEffect(() => {
    fetch("/api/accounts")
      .then(res => res.json())
      .then(data => setAccounts(data));
  }, []);

  // Busca replicações de bucket ativas
  useEffect(() => {
    if (bucketConfig.source_storage_id && bucketConfig.source_bucket) {
      fetch(`/api/replication/bucket/${bucketConfig.source_storage_id}/${bucketConfig.source_bucket}`)
        .then(res => res.json())
        .then(data => setActiveBucketRules(Array.isArray(data) ? data : []))
        .catch(() => setActiveBucketRules([]));
    } else {
      setActiveBucketRules([]);
    }
  }, [bucketConfig.source_storage_id, bucketConfig.source_bucket]);

  // Busca info de Site Replication
  useEffect(() => {
    const id = activeTab === 'site' ? siteConfig.sourceId : bucketConfig.source_storage_id;
    if (id) {
      fetch(`/api/replication/site/${id}/info`)
        .then(res => res.json())
        .then(data => setSiteInfo(data))
        .catch(() => setSiteInfo(null));
    } else {
      setSiteInfo(null);
    }
  }, [siteConfig.sourceId, bucketConfig.source_storage_id, activeTab]);

  // Busca buckets quando a conta de origem muda
  useEffect(() => {
    if (bucketConfig.source_storage_id) {
      fetch(`/api/accounts/${bucketConfig.source_storage_id}/buckets`)
        .then(res => res.json())
        .then(data => setSourceBuckets(data.map((b: any) => b.Name)))
        .catch(() => setSourceBuckets([]));
    }
  }, [bucketConfig.source_storage_id]);

  // Busca buckets quando a conta de destino muda
  useEffect(() => {
    if (bucketConfig.target_storage_id) {
      fetch(`/api/accounts/${bucketConfig.target_storage_id}/buckets`)
        .then(res => res.json())
        .then(data => setTargetBuckets(data.map((b: any) => b.Name)))
        .catch(() => setTargetBuckets([]));
    }
  }, [bucketConfig.target_storage_id]);

  const handleBucketReplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/replication/bucket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bucketConfig, type: 'bucket' }),
      });
      const data = await res.json();
      if (res.ok) alert("Replicação de bucket configurada com sucesso!");
      else alert("Erro: " + data.error);
    } catch (e) { alert("Erro de conexão"); }
    setLoading(false);
  };

  const handleSiteReplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/replication/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(siteConfig),
      });
      const data = await res.json();
      if (res.ok) alert("Site Replication (Site-to-Site) configurado com sucesso!");
      else alert("Erro: " + data.error);
    } catch (e) { alert("Erro de conexão"); }
    setLoading(false);
  };

  const parseARN = (input: any) => {
    if (!input) return { service: 'N/A', clusterId: 'N/A', bucket: 'N/A' };
    const arnStr = typeof input === 'object' ? (input.Bucket || "") : String(input);
    if (arnStr.startsWith('arn:')) {
      const parts = arnStr.split(':');
      const bucket = parts[parts.length - 1];
      const clusterId = parts[parts.length - 2] || "Local";
      const service = parts[1] || "minio";
      return { service: service, clusterId: clusterId, bucket: bucket };
    }
    return { service: 's3', clusterId: 'N/A', bucket: arnStr };
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!bucketConfig.source_storage_id || !bucketConfig.source_bucket || !confirm("Deseja remover esta regra?")) return;
    try {
      const res = await fetch(`/api/replication/bucket/${bucketConfig.source_storage_id}/${bucketConfig.source_bucket}/${ruleId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setActiveBucketRules(prev => prev.filter(r => r.ID !== ruleId));
      }
    } catch (e) { alert("Erro ao deletar"); }
  };

  return (
    <div className="replication-panel">
      <header>
        <h1>Espelhamento (Replication)</h1>
        <p style={{color: '#64748b'}}>Configure a sincronização automática entre seus storages MinIO.</p>
      </header>

      <div className="tabs" style={{display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #e2e8f0'}}>
        <button 
          className={`tab-btn ${activeTab === 'bucket' ? 'active' : ''}`}
          onClick={() => setActiveTab('bucket')}
          style={{padding: '0.8rem 1.5rem', border: 'none', background: 'none', borderBottom: activeTab === 'bucket' ? '2px solid #2563eb' : 'none', cursor: 'pointer', fontWeight: activeTab === 'bucket' ? 'bold' : 'normal'}}
        >
          🪣 Bucket-to-Bucket
        </button>
        <button 
          className={`tab-btn ${activeTab === 'site' ? 'active' : ''}`}
          onClick={() => setActiveTab('site')}
          style={{padding: '0.8rem 1.5rem', border: 'none', background: 'none', borderBottom: activeTab === 'site' ? '2px solid #2563eb' : 'none', cursor: 'pointer', fontWeight: activeTab === 'site' ? 'bold' : 'normal'}}
        >
          🌐 Site Replication (Cluster)
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'bucket' && (
          <form onSubmit={handleBucketReplication} className="config-form">
            <div className="form-grid" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem'}}>
              <div className="source-side">
                <h3>Origem (Source)</h3>
                <div className="form-group">
                  <label>Storage de Origem</label>
                  <select 
                    value={bucketConfig.source_storage_id} 
                    onChange={e => setBucketConfig({...bucketConfig, source_storage_id: e.target.value})}
                    required
                  >
                    <option value="">Selecione...</option>
                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Bucket de Origem</label>
                  <input 
                    placeholder="Ex: imagens-prod" 
                    value={bucketConfig.source_bucket} 
                    onChange={e => setBucketConfig({...bucketConfig, source_bucket: e.target.value})}
                    list="source-buckets-list"
                    required
                  />
                  <datalist id="source-buckets-list">
                    {sourceBuckets.map(b => <option key={b} value={b} />)}
                  </datalist>
                </div>
              </div>

              <div className="target-side">
                <h3>Destino (Target)</h3>
                <div className="form-group">
                  <label>Storage de Destino</label>
                  <select 
                    value={bucketConfig.target_storage_id} 
                    onChange={e => setBucketConfig({...bucketConfig, target_storage_id: e.target.value})}
                    required
                  >
                    <option value="">Selecione...</option>
                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Bucket de Destino</label>
                  <input 
                    placeholder="Ex: backup-bucket" 
                    value={bucketConfig.target_bucket} 
                    onChange={e => setBucketConfig({...bucketConfig, target_bucket: e.target.value})}
                    list="target-buckets-list"
                    required
                  />
                  <datalist id="target-buckets-list">
                    {targetBuckets.map(b => <option key={b} value={b} />)}
                  </datalist>
                </div>
                <div className="form-group">
                  <label>Prioridade (Número)</label>
                  <input 
                    type="number"
                    min="1"
                    value={bucketConfig.priority} 
                    onChange={e => setBucketConfig({...bucketConfig, priority: Number(e.target.value)})}
                    required
                  />
                </div>
              </div>
            </div>

            <div style={{marginTop: '2rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', fontSize: '0.85rem'}}>
              <strong>Nota:</strong> Esta ação ativará automaticamente o <strong>Versionamento</strong> em ambos os buckets.
            </div>

            <button type="submit" className="btn-primary" style={{marginTop: '2rem'}} disabled={loading}>
              {loading ? "Configurando..." : "Ativar Replicação de Bucket"}
            </button>
          </form>
        )}

        {activeTab === 'site' && (
          <form onSubmit={handleSiteReplication} className="config-form">
            <div className="form-grid" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem'}}>
              <div className="form-group">
                <label>Storage Principal (Site 1)</label>
                <select 
                  value={siteConfig.sourceId} 
                  onChange={e => setSiteConfig({...siteConfig, sourceId: e.target.value})}
                  required
                >
                  <option value="">Selecione...</option>
                  {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Storage de Espelho (Site 2)</label>
                <select 
                  value={siteConfig.targetId} 
                  onChange={e => setSiteConfig({...siteConfig, targetId: e.target.value})}
                  required
                >
                  <option value="">Selecione...</option>
                  {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{marginTop: '2rem', padding: '1rem', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px', fontSize: '0.85rem', color: '#991b1b'}}>
              <strong>Atenção:</strong> O Site Replication sincroniza <strong>todos</strong> os buckets.
            </div>

            <button type="submit" className="btn-primary" style={{marginTop: '2rem'}} disabled={loading}>
              {loading ? "Pareando Sites..." : "Ativar Site Replication"}
            </button>
          </form>
        )}
      </div>

      {(activeBucketRules.length > 0 || siteInfo) && (
        <div className="active-replications" style={{marginTop: '4rem', padding: '2rem', background: 'white', borderRadius: '1rem', border: '1px solid #e2e8f0'}}>
          <h2>⚙️ Configurações Ativas Detectadas</h2>
          
          {siteInfo && (
            <div className="site-info-box" style={{marginBottom: '2rem', padding: '1.5rem', background: '#f0f9ff', borderRadius: '0.8rem', border: '1px solid #bae6fd'}}>
              <h3 style={{marginTop: 0}}>🌐 Site Replication (Cluster)</h3>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem'}}>
                {siteInfo.sites?.map((site: any) => (
                  <div key={site.name} style={{padding: '1rem', background: 'white', borderRadius: '0.5rem', border: '1px solid #e0f2fe'}}>
                    <div style={{fontWeight: 'bold', color: '#0369a1'}}>{site.name}</div>
                    <div style={{fontSize: '0.85rem', color: '#64748b'}}>{site.endpoint}</div>
                    <div style={{marginTop: '0.5rem'}}>
                      <span style={{padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', background: site.health === 'ok' ? '#dcfce7' : '#fee2e2', color: site.health === 'ok' ? '#166534' : '#991b1b'}}>
                        {site.health === 'ok' ? 'SAUDÁVEL' : 'OFFLINE'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeBucketRules.length > 0 && (
            <div className="bucket-rules-box">
              <h3>🪣 Regras de Bucket ({bucketConfig.source_bucket})</h3>
              <table style={{width: '100%', borderCollapse: 'collapse', marginTop: '1rem'}}>
                <thead>
                  <tr style={{textAlign: 'left', borderBottom: '2px solid #f1f5f9', background: '#f8fafc'}}>
                    <th style={{padding: '1rem'}}>ID Regra</th>
                    <th>Serviço</th>
                    <th>ID Cluster</th>
                    <th>Bucket</th>
                    <th>Prio</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {activeBucketRules.map((rule: any) => {
                    const info = parseARN(rule.Destination);
                    return (
                      <tr key={rule.ID} style={{borderBottom: '1px solid #f1f5f9'}}>
                        <td style={{padding: '1rem', fontSize: '0.75rem', color: '#64748b'}} title={rule.ID}>
                          {rule.ID.substring(0, 8)}...
                        </td>
                        <td>
                          <span style={{textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 'bold', background: '#eff6ff', color: '#1e40af', padding: '2px 6px', borderRadius: '4px'}}>
                            {info?.service}
                          </span>
                        </td>
                        <td><code style={{fontSize: '0.7rem', color: '#475569'}}>{info?.clusterId}</code></td>
                        <td><strong style={{color: '#0f172a'}}>{info?.bucket}</strong></td>
                        <td><span style={{fontSize: '0.8rem'}}>{rule.Priority}</span></td>
                        <td>
                          <span style={{fontSize: '0.65rem', fontWeight: 'bold', padding: '4px 8px', borderRadius: '10px', background: rule.Status === 'Enabled' ? '#dcfce7' : '#fee2e2', color: rule.Status === 'Enabled' ? '#166534' : '#991b1b'}}>
                            {rule.Status?.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <button 
                            className="btn-danger" 
                            style={{padding: '4px 8px', fontSize: '0.8rem'}} 
                            onClick={() => handleDeleteRule(rule.ID)}
                          >🗑️</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

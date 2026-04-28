import { Router } from "express";
import { 
  setupBucketReplication, 
  setupSiteReplication, 
  listReplications, 
  getSiteReplicationStatus,
  removeBucketReplication
} from "../services/replication";

const router = Router();

// POST /api/replication/bucket
router.post("/bucket", async (req, res) => {
  try {
    const result = await setupBucketReplication(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/replication/site
router.post("/site", async (req, res) => {
  const { sourceId, targetId } = req.body;
  try {
    const result = await setupSiteReplication(sourceId, targetId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/replication/bucket/:storageId/:bucketName
router.get("/bucket/:storageId/:bucketName", async (req, res) => {
  const { storageId, bucketName } = req.params;
  try {
    const list = await listReplications(storageId, bucketName);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/replication/site/:storageId/info
router.get("/site/:storageId/info", async (req, res) => {
  const { storageId } = req.params;
  try {
    const status = await getSiteReplicationStatus(storageId);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/replication/bucket/:storageId/:bucketName/:ruleId
router.delete("/bucket/:storageId/:bucketName/:ruleId", async (req, res) => {
  const { storageId, bucketName, ruleId } = req.params;
  try {
    const result = await removeBucketReplication(storageId, bucketName, ruleId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

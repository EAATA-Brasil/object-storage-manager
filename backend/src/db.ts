import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function initDB() {
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage_accounts (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      endpoint VARCHAR(255) NOT NULL,
      region VARCHAR(100),
      access_key VARCHAR(255) NOT NULL,
      secret_key VARCHAR(255) NOT NULL,
      provider VARCHAR(50) DEFAULT 'minio',
      access_policy VARCHAR(50) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migração manual: adiciona a coluna se não existir
  try {
    await pool.query("ALTER TABLE storage_accounts ADD COLUMN access_policy VARCHAR(50) DEFAULT 'private'");
  } catch (e) {}

  try {
    await pool.query("ALTER TABLE storage_accounts ADD COLUMN custom_policy TEXT");
  } catch (e) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bucket_optimizer_configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      storage_account_id VARCHAR(36) NOT NULL,
      bucket_name VARCHAR(255) NOT NULL,
      enabled BOOLEAN DEFAULT FALSE,
      prefix_root VARCHAR(255) DEFAULT 'ocorrencias/',
      prefix_work VARCHAR(255) DEFAULT 'ocorrencias/otimizando/',
      min_size_kb INT DEFAULT 0,
      video_max_mb INT DEFAULT 0,
      auto_lifecycle BOOLEAN DEFAULT FALSE,
      access_policy VARCHAR(50) DEFAULT 'private',
      custom_policy TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_bucket_prefix (storage_account_id, bucket_name, prefix_root),
      FOREIGN KEY (storage_account_id) REFERENCES storage_accounts(id) ON DELETE CASCADE
    )
  `);

  // Migrações manuais para optimizer
  try {
    await pool.query("ALTER TABLE bucket_optimizer_configs ADD COLUMN auto_lifecycle BOOLEAN DEFAULT FALSE");
  } catch (e) {}

  try {
    await pool.query("ALTER TABLE bucket_optimizer_configs ADD COLUMN access_policy VARCHAR(50) DEFAULT 'private'");
  } catch (e) {}

  try {
    await pool.query("ALTER TABLE bucket_optimizer_configs ADD COLUMN custom_policy TEXT");
  } catch (e) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      storage_account_id VARCHAR(36) NOT NULL,
      bucket_name VARCHAR(255) NOT NULL,
      file_key TEXT NOT NULL,
      file_type VARCHAR(50),
      bytes_before BIGINT,
      bytes_after BIGINT,
      optimized_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (storage_account_id) REFERENCES storage_accounts(id) ON DELETE CASCADE
    )
  `);
}
